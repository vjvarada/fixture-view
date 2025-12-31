/**
 * ClampSupportMesh Component
 * 
 * Renders a support mesh for a placed clamp based on its fixture_mount_surface.
 * These supports are non-interactive (no selection, no transform controls).
 * Their position and height update automatically based on the clamp's transform.
 * 
 * OPTIMIZATION: Geometry is created at origin without baking position.
 * Position/rotation are applied via React Three Fiber props to avoid
 * recreating geometry on every clamp transform change during drag.
 * 
 * CSG operations are performed in a web worker to keep the UI responsive.
 */

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { ClampSupportInfo } from '../utils/clampSupportUtils';
import { PlacedClamp } from '../types';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { performClampCSGInWorker } from '@rapidtool/cad-core';
import { 
  computeEdgeNormal, 
  ensureClockwiseWindingXZ 
} from '@/features/supports/utils/polygonUtils';

// Reusable CSG evaluator for better performance
const csgEvaluator = new Evaluator();

interface ClampSupportMeshProps {
  /** The placed clamp this support belongs to */
  placedClamp: PlacedClamp;
  /** Support info extracted from fixture_mount_surface */
  supportInfo: ClampSupportInfo;
  /** Y position of the baseplate top in world coords */
  baseTopY: number;
  /** Corner radius for the support (default: 2mm) */
  cornerRadius?: number;
  /** Whether to show the support (default: true) */
  visible?: boolean;
  /** Fixture cutouts geometry for CSG subtraction (optional) */
  fixtureCutoutsGeometry?: THREE.BufferGeometry | null;
  /** Fixture point top center for positioning cutouts */
  fixturePointTopCenter?: THREE.Vector3;
}

// Fillet parameters (same as regular supports)
const FILLET_RADIUS = 2.0;
const FILLET_SEGMENTS = 12; // Reduced from 24 for faster CSG

// Extrusion parameters - reduced for faster CSG
const EXTRUDE_CURVE_SEGMENTS = 16; // Reduced from 64

// Material for clamp supports (same as regular supports for visual consistency)
const createClampSupportMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: 0x888888, // Same gray as regular supports
    transparent: false,
    opacity: 1,
    metalness: 0.1,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

/**
 * Remove the bottom cap faces from an ExtrudeGeometry.
 * ExtrudeGeometry creates both top and bottom caps which cause internal faces
 * when merged with fillet geometry. This function removes faces at the bottom.
 * @param geometry The ExtrudeGeometry (must be non-indexed or will be converted)
 * @param bottomY The Y coordinate of the bottom cap to remove
 * @param tolerance Tolerance for Y comparison
 */
const removeBottomCapFaces = (geometry: THREE.BufferGeometry, bottomY: number, tolerance: number = 0.01): THREE.BufferGeometry => {
  // Convert to non-indexed if necessary
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = nonIndexed.getAttribute('position');
  const normals = nonIndexed.getAttribute('normal');
  
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  
  // Process triangles (3 vertices each)
  for (let i = 0; i < positions.count; i += 3) {
    const y1 = positions.getY(i);
    const y2 = positions.getY(i + 1);
    const y3 = positions.getY(i + 2);
    
    // Check if all three vertices are at the bottom Y (within tolerance)
    const isBottomFace = 
      Math.abs(y1 - bottomY) < tolerance &&
      Math.abs(y2 - bottomY) < tolerance &&
      Math.abs(y3 - bottomY) < tolerance;
    
    // Also check if the face normal points downward (bottom cap faces point -Y)
    let isDownwardFacing = false;
    if (normals) {
      const ny1 = normals.getY(i);
      const ny2 = normals.getY(i + 1);
      const ny3 = normals.getY(i + 2);
      const avgNy = (ny1 + ny2 + ny3) / 3;
      isDownwardFacing = avgNy < -0.9;
    }
    
    // Skip this triangle if it's a bottom cap face
    if (isBottomFace && isDownwardFacing) {
      continue;
    }
    
    // Keep this triangle
    for (let j = 0; j < 3; j++) {
      newPositions.push(
        positions.getX(i + j),
        positions.getY(i + j),
        positions.getZ(i + j)
      );
      if (normals) {
        newNormals.push(
          normals.getX(i + j),
          normals.getY(i + j),
          normals.getZ(i + j)
        );
      }
    }
  }
  
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  if (newNormals.length > 0) {
    result.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
  }
  
  return result;
};

/**
 * Create the extruded geometry for a custom polygon support AT ORIGIN
 * Position will be applied via React transform props for performance.
 * 
 * @param polygon - The polygon points relative to center
 * @param height - The support height
 * @param cornerRadius - Corner radius for rounded edges
 * @returns BufferGeometry centered at origin with base at Y=0
 */
function createSupportGeometryAtOrigin(
  polygon: Array<[number, number]>,
  height: number,
  cornerRadius: number = 0
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3 || height <= 0) {
    return null;
  }

  // Clamp fillet radius to not exceed support height
  const effectiveFilletRadius = Math.min(FILLET_RADIUS, Math.max(0, height - 0.1));
  const bodyHeight = Math.max(0.1, height - effectiveFilletRadius);

  // Create fillet geometry
  const filletGeo = createPolygonFilletGeometry(polygon, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS);

  // Build the custom shape for the body
  // Mirror the Y (which is actually Z in our polygon) coordinates to match the rotation direction
  // This is the same approach as SupportMeshes.tsx
  const workingPolygon: [number, number][] = polygon.map(([x, z]: [number, number]) => [x, -z]);
  const safeCornerRadius = Math.max(0, cornerRadius);
  const shape = new THREE.Shape();
  let started = false;

  for (let idx = 0; idx < workingPolygon.length; idx++) {
    const curr = workingPolygon[idx];
    const prev = workingPolygon[(idx - 1 + workingPolygon.length) % workingPolygon.length];
    const next = workingPolygon[(idx + 1) % workingPolygon.length];

    const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
    const toNext = [next[0] - curr[0], next[1] - curr[1]];
    const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
    const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);

    if (lenPrev < 0.01 || lenNext < 0.01 || safeCornerRadius < 0.01) {
      if (!started) {
        shape.moveTo(curr[0], curr[1]);
        started = true;
      } else {
        shape.lineTo(curr[0], curr[1]);
      }
      continue;
    }

    const r = Math.min(safeCornerRadius, lenPrev / 2, lenNext / 2);
    const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
    const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];

    if (r > 0.01) {
      const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
      const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];

      if (!started) {
        shape.moveTo(insetStart[0], insetStart[1]);
        started = true;
      } else {
        shape.lineTo(insetStart[0], insetStart[1]);
      }
      shape.quadraticCurveTo(curr[0], curr[1], insetEnd[0], insetEnd[1]);
    } else {
      if (!started) {
        shape.moveTo(curr[0], curr[1]);
        started = true;
      } else {
        shape.lineTo(curr[0], curr[1]);
      }
    }
  }
  shape.closePath();

  // Create the extruded body geometry
  // ExtrudeGeometry creates both top and bottom caps which cause internal faces
  // Remove the bottom cap to allow proper welding with fillet geometry
  let extrudedBody = new THREE.ExtrudeGeometry(shape, { 
    depth: bodyHeight, 
    bevelEnabled: false, 
    curveSegments: EXTRUDE_CURVE_SEGMENTS 
  });
  
  // Rotate to make Y the up direction (extrusion is along Z by default)
  extrudedBody.rotateX(-Math.PI / 2);
  
  // Position body to sit on top of fillet (fillet stays at origin before merge)
  extrudedBody.translate(0, effectiveFilletRadius, 0);
  
  // Remove bottom cap faces (at y = effectiveFilletRadius after translation)
  const bodyGeo = removeBottomCapFaces(extrudedBody, effectiveFilletRadius, 0.01);
  extrudedBody.dispose();

  // Create bottom cap at Y=0 to seal the support
  const bottomCapGeo = createBottomCapGeometry(polygon, cornerRadius, effectiveFilletRadius);

  // Normalize geometries for merging (remove UVs, convert to non-indexed)
  const normalizeGeometry = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const normalized = geo.index ? geo.toNonIndexed() : geo.clone();
    if (normalized.getAttribute('uv')) {
      normalized.deleteAttribute('uv');
    }
    if (normalized.getAttribute('uv2')) {
      normalized.deleteAttribute('uv2');
    }
    return normalized;
  };

  // Collect geometries to merge
  const geometriesToMerge: THREE.BufferGeometry[] = [];
  
  // Add bottom cap first (at Y=0)
  if (bottomCapGeo && bottomCapGeo.attributes.position.count > 0) {
    geometriesToMerge.push(normalizeGeometry(bottomCapGeo));
  }
  
  if (filletGeo && filletGeo.attributes.position.count > 0) {
    geometriesToMerge.push(normalizeGeometry(filletGeo));
  }
  geometriesToMerge.push(normalizeGeometry(bodyGeo));

  // Merge all geometries
  const merged = mergeGeometries(geometriesToMerge, false);
  if (!merged) {
    return null;
  }

  // Weld duplicate vertices at seams (fillet/body/cap boundaries) for watertight mesh
  // Use a tolerance of 0.01mm to account for floating-point precision issues
  const welded = mergeVertices(merged, 0.01);
  welded.computeVertexNormals();
  
  // Do NOT translate - geometry stays at origin
  return welded;
}

/**
 * Create cutouts geometry transformed to be at origin for CSG
 * This is pre-computed once and used for CSG subtraction
 * 
 * The cutouts need to be positioned relative to the support geometry which:
 * - Has its XZ centered at the fixture point (origin)
 * - Has its Y starting at 0 (base of support)
 * 
 * The cutouts in clamp local space:
 * - Are positioned relative to model origin
 * - Need to be shifted so fixture point is at XZ origin
 * - Need Y adjusted so they align with support (which starts at Y=0)
 */
function createCutoutsGeometryAtOrigin(
  fixtureCutoutsGeometry: THREE.BufferGeometry,
  fixturePointTopCenter: THREE.Vector3
): THREE.BufferGeometry {
  const cutoutsClone = fixtureCutoutsGeometry.clone();
  
  // Transform cutouts to be relative to fixture point in XZ
  // But keep Y relative to fixture point Y (which aligns with support top when placed)
  // The support geometry Y=0 corresponds to baseTopY in world space
  // The cutouts need to be at Y position relative to where they cut the support
  cutoutsClone.translate(
    -fixturePointTopCenter.x,
    0, // Don't offset Y - cutouts Y position is relative to fixture point
    -fixturePointTopCenter.z
  );
  
  // Ensure UVs exist for CSG
  if (!cutoutsClone.getAttribute('uv')) {
    const posAttr = cutoutsClone.getAttribute('position');
    if (posAttr) {
      const uvArray = new Float32Array(posAttr.count * 2);
      cutoutsClone.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
    }
  }
  
  return cutoutsClone;
}

/**
 * Create bottom cap geometry for a polygon support
 * This creates a flat cap at Y=0 that matches the fillet's outer perimeter.
 * CRITICAL: Uses SAME polygon ordering as body and fillet (CW, no reversal).
 */
function createBottomCapGeometry(
  polygon: Array<[number, number]>,
  cornerRadius: number,
  filletRadius: number
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3) return null;

  // CRITICAL: Use SAME polygon ordering as body/fillet (CW, no reversal)
  const workingPolygon = ensureClockwiseWindingXZ(polygon);
  const isCW = true;  // We've normalized to CW

  // Use shared utility for computing edge normals
  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    return computeEdgeNormal(p1, p2, isCW);
  };

  const n = workingPolygon.length;
  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p1 = workingPolygon[i];
    const p2 = workingPolygon[(i + 1) % n];
    edgeNormals.push(getEdgeNormal(p1, p2));
  }

  // Compute corner data
  const cornerData: { vx: number; vz: number; insetStart: [number, number]; insetEnd: [number, number]; r: number }[] = [];

  for (let i = 0; i < n; i++) {
    const prev = workingPolygon[(i - 1 + n) % n];
    const curr = workingPolygon[i];
    const next = workingPolygon[(i + 1) % n];

    const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
    const toNext = [next[0] - curr[0], next[1] - curr[1]];
    const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
    const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);

    if (lenPrev < 0.01 || lenNext < 0.01) {
      cornerData.push({ vx: curr[0], vz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
      continue;
    }

    const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
    const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
    const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);

    if (r > 0.01) {
      const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
      const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
      cornerData.push({ vx: curr[0], vz: curr[1], insetStart, insetEnd, r });
    } else {
      cornerData.push({ vx: curr[0], vz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
    }
  }

  // Build outer perimeter at Y=0 (matching fillet's outer edge)
  const perimeterPoints: [number, number][] = [];
  const cornerSegs = 8;

  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];

    // Edge from currCorner.insetEnd to nextCorner.insetStart, offset by filletRadius
    const edgeStartX = currCorner.insetEnd[0] + normal[0] * filletRadius;
    const edgeStartZ = currCorner.insetEnd[1] + normal[1] * filletRadius;
    const edgeEndX = nextCorner.insetStart[0] + normal[0] * filletRadius;
    const edgeEndZ = nextCorner.insetStart[1] + normal[1] * filletRadius;

    perimeterPoints.push([edgeStartX, edgeStartZ]);
    perimeterPoints.push([edgeEndX, edgeEndZ]);

    // Add corner arc at nextCorner
    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];

    if (nextCorner.r < 0.01) {
      // Sharp corner - add arc sweep
      const startAngle = Math.atan2(prevNormal[1], prevNormal[0]);
      const endAngle = Math.atan2(nextNormal[1], nextNormal[0]);
      let angleDiff = endAngle - startAngle;

      if (isCW) {
        if (angleDiff > 0) angleDiff -= 2 * Math.PI;
      } else {
        if (angleDiff < 0) angleDiff += 2 * Math.PI;
      }

      if (Math.abs(angleDiff) > 0.01 && Math.abs(angleDiff) < 2 * Math.PI - 0.01) {
        for (let j = 1; j < cornerSegs; j++) {
          const t = j / cornerSegs;
          const theta = startAngle + t * angleDiff;
          perimeterPoints.push([
            nextCorner.vx + filletRadius * Math.cos(theta),
            nextCorner.vz + filletRadius * Math.sin(theta)
          ]);
        }
      }
    } else {
      // Rounded corner - follow offset Bezier curve
      for (let j = 1; j < cornerSegs; j++) {
        const t = j / cornerSegs;
        const omt = 1 - t;

        const bx = omt * omt * nextCorner.insetStart[0] + 2 * omt * t * nextCorner.vx + t * t * nextCorner.insetEnd[0];
        const bz = omt * omt * nextCorner.insetStart[1] + 2 * omt * t * nextCorner.vz + t * t * nextCorner.insetEnd[1];

        const tx = 2 * omt * (nextCorner.vx - nextCorner.insetStart[0]) + 2 * t * (nextCorner.insetEnd[0] - nextCorner.vx);
        const tz = 2 * omt * (nextCorner.vz - nextCorner.insetStart[1]) + 2 * t * (nextCorner.insetEnd[1] - nextCorner.vz);
        const tLen = Math.sqrt(tx * tx + tz * tz);

        let nx: number, nz: number;
        if (tLen > 0.001) {
          if (isCW) {
            nx = -tz / tLen;
            nz = tx / tLen;
          } else {
            nx = tz / tLen;
            nz = -tx / tLen;
          }
        } else {
          nx = prevNormal[0] * (1 - t) + nextNormal[0] * t;
          nz = prevNormal[1] * (1 - t) + nextNormal[1] * t;
          const nLen = Math.sqrt(nx * nx + nz * nz);
          if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
        }

        perimeterPoints.push([bx + nx * filletRadius, bz + nz * filletRadius]);
      }
    }
  }

  // Create triangulated cap using fan triangulation from centroid
  const positions: number[] = [];
  const indices: number[] = [];

  // Calculate centroid
  let centroidX = 0, centroidZ = 0;
  for (const [x, z] of perimeterPoints) {
    centroidX += x;
    centroidZ += z;
  }
  centroidX /= perimeterPoints.length;
  centroidZ /= perimeterPoints.length;

  // Add center vertex at Y=0 (bottom of fillet)
  positions.push(centroidX, 0, centroidZ);

  // Add perimeter vertices
  for (const [x, z] of perimeterPoints) {
    positions.push(x, 0, z);
  }

  // Face winding for CW polygon looking down (-Y normal):
  // Use (0, next+1, i+1) for downward-facing faces
  for (let i = 0; i < perimeterPoints.length; i++) {
    const next = (i + 1) % perimeterPoints.length;
    indices.push(0, next + 1, i + 1);
  }

  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cap.setIndex(indices);
  cap.computeVertexNormals();
  return cap;
}

/**
 * Create fillet geometry for a polygon support base
 * Uses shared polygon utilities for consistent behavior with SupportMeshes.
 * Normalizes polygon to CW winding internally for consistent manifold geometry.
 * 
 * CRITICAL: Uses SAME vertex ordering as body geometry (CW, no reversal).
 * This ensures fillet corners match body corners exactly for proper welding.
 */
function createPolygonFilletGeometry(
  polygon: Array<[number, number]>,
  cornerRadius: number,
  filletRadius: number,
  segments: number
): THREE.BufferGeometry | null {
  if (polygon.length < 3 || filletRadius <= 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];

  // CRITICAL: Use SAME polygon ordering as body geometry (CW, no reversal).
  // The body uses: normalizedPolygon.map([x,z] => [x,-z]) for Shape, then ExtrudeGeometry + rotateX(-PI/2)
  // This keeps vertices in the SAME ORDER as the normalized polygon.
  // To ensure fillet corners match body corners, we must use the same vertex order.
  const workingPolygon = ensureClockwiseWindingXZ(polygon);
  const isCW = true;  // We've normalized to CW

  // Use shared utility for computing edge normals
  // For CW polygon in XZ plane: outward normal is (-dz, dx) / len
  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    return computeEdgeNormal(p1, p2, isCW);
  };

  // Helper to add a fillet strip along an edge
  const addEdgeFillet = (x1: number, z1: number, x2: number, z2: number, nx: number, nz: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.01) return;

    const stripSegments = Math.max(2, Math.ceil(length / 5));
    const baseIdx = positions.length / 3;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = Math.PI + t * (Math.PI / 2);
      const outDist = filletRadius + filletRadius * Math.cos(angle);
      const y = filletRadius * Math.sin(angle) + filletRadius;

      for (let j = 0; j <= stripSegments; j++) {
        const s = j / stripSegments;
        const px = x1 + s * dx + nx * outDist;
        const pz = z1 + s * dz + nz * outDist;
        positions.push(px, y, pz);
      }
    }

    // Face winding for outward-facing normals
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < stripSegments; j++) {
        const a = baseIdx + i * (stripSegments + 1) + j;
        const b = a + stripSegments + 1;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }
  };

  // Helper to add a corner fillet that follows a quadratic Bezier curve
  const addCornerFillet = (
    vx: number, vz: number,
    insetStartX: number, insetStartZ: number,
    insetEndX: number, insetEndZ: number,
    n1x: number, n1z: number,
    n2x: number, n2z: number,
    r: number
  ) => {
    // Sharp corner case
    if (r < 0.01) {
      const startAngle = Math.atan2(n1z, n1x);
      const endAngle = Math.atan2(n2z, n2x);
      let angleDiff = endAngle - startAngle;

      // For CW polygon, we sweep in the negative direction (clockwise in XZ)
      if (isCW) {
        if (angleDiff > 0) angleDiff -= 2 * Math.PI;
      } else {
        if (angleDiff < 0) angleDiff += 2 * Math.PI;
      }

      if (Math.abs(angleDiff) < 0.01 || Math.abs(angleDiff) > 2 * Math.PI - 0.01) return;

      const baseIdx = positions.length / 3;
      const cornerSegs = Math.max(4, Math.ceil(Math.abs(angleDiff) / (Math.PI / 8)));

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const filletAngle = Math.PI + t * (Math.PI / 2);
        const outDist = filletRadius + filletRadius * Math.cos(filletAngle);
        const y = filletRadius * Math.sin(filletAngle) + filletRadius;

        for (let j = 0; j <= cornerSegs; j++) {
          const theta = startAngle + (j / cornerSegs) * angleDiff;
          positions.push(vx + outDist * Math.cos(theta), y, vz + outDist * Math.sin(theta));
        }
      }

      // Face winding for outward-facing normals
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < cornerSegs; j++) {
          const a = baseIdx + i * (cornerSegs + 1) + j;
          const b = a + cornerSegs + 1;
          const c = a + 1;
          const d = b + 1;
          indices.push(a, b, c);
          indices.push(c, b, d);
        }
      }
      return;
    }

    // Rounded corner - follow the quadratic Bezier path
    const baseIdx = positions.length / 3;
    const cornerSegs = 8;

    for (let i = 0; i <= segments; i++) {
      const filletT = i / segments;
      const filletAngle = Math.PI + filletT * (Math.PI / 2);
      const outDist = filletRadius + filletRadius * Math.cos(filletAngle);
      const y = filletRadius * Math.sin(filletAngle) + filletRadius;

      for (let j = 0; j <= cornerSegs; j++) {
        const t = j / cornerSegs;
        const omt = 1 - t;

        // Bezier point
        const bx = omt * omt * insetStartX + 2 * omt * t * vx + t * t * insetEndX;
        const bz = omt * omt * insetStartZ + 2 * omt * t * vz + t * t * insetEndZ;

        // Bezier tangent
        const tx = 2 * omt * (vx - insetStartX) + 2 * t * (insetEndX - vx);
        const tz = 2 * omt * (vz - insetStartZ) + 2 * t * (insetEndZ - vz);
        const tLen = Math.sqrt(tx * tx + tz * tz);

        // Outward normal for CW polygon: perpendicular to tangent, pointing outward
        // For CW polygon in XZ plane: outward = (-tz, tx) / len
        let nx: number, nz: number;
        if (tLen > 0.001) {
          // isCW is always true now (we normalized to CW)
          nx = -tz / tLen;
          nz = tx / tLen;
        } else {
          nx = n1x * (1 - t) + n2x * t;
          nz = n1z * (1 - t) + n2z * t;
          const nLen = Math.sqrt(nx * nx + nz * nz);
          if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
        }

        positions.push(bx + nx * outDist, y, bz + nz * outDist);
      }
    }

    // Face winding for outward-facing normals
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < cornerSegs; j++) {
        const a = baseIdx + i * (cornerSegs + 1) + j;
        const b = a + cornerSegs + 1;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }
  };

  // Process each edge and corner
  const n = workingPolygon.length;
  const edgeNormals: [number, number][] = [];

  // Compute all edge normals first
  for (let i = 0; i < n; i++) {
    const p1 = workingPolygon[i];
    const p2 = workingPolygon[(i + 1) % n];
    edgeNormals.push(getEdgeNormal(p1, p2));
  }

  // Compute corner inset positions for rounded corners
  const cornerData: { vx: number; vz: number; insetStart: [number, number]; insetEnd: [number, number]; r: number }[] = [];

  for (let i = 0; i < n; i++) {
    const prev = workingPolygon[(i - 1 + n) % n];
    const curr = workingPolygon[i];
    const next = workingPolygon[(i + 1) % n];

    const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
    const toNext = [next[0] - curr[0], next[1] - curr[1]];
    const lenPrev = Math.sqrt(toPrev[0] ** 2 + toPrev[1] ** 2);
    const lenNext = Math.sqrt(toNext[0] ** 2 + toNext[1] ** 2);

    if (lenPrev < 0.01 || lenNext < 0.01) {
      cornerData.push({ vx: curr[0], vz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
      continue;
    }

    const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
    const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
    const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);

    if (r > 0.01) {
      const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
      const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];
      cornerData.push({ vx: curr[0], vz: curr[1], insetStart, insetEnd, r });
    } else {
      cornerData.push({ vx: curr[0], vz: curr[1], insetStart: curr, insetEnd: curr, r: 0 });
    }
  }

  // Add edge fillets (between inset points) and corner fillets
  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];

    // Edge goes from currCorner.insetEnd to nextCorner.insetStart
    const edgeStart = currCorner.insetEnd;
    const edgeEnd = nextCorner.insetStart;

    addEdgeFillet(edgeStart[0], edgeStart[1], edgeEnd[0], edgeEnd[1], normal[0], normal[1]);

    // Add corner fillet at nextCorner
    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];

    addCornerFillet(
      nextCorner.vx, nextCorner.vz,
      nextCorner.insetStart[0], nextCorner.insetStart[1],
      nextCorner.insetEnd[0], nextCorner.insetEnd[1],
      prevNormal[0], prevNormal[1],
      nextNormal[0], nextNormal[1],
      nextCorner.r
    );
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * ClampSupportMesh Component
 * 
 * OPTIMIZED: Geometry is created at origin without baking position.
 * Position/rotation are applied via React Three Fiber transform props.
 * CSG is deferred until gizmo closes to avoid expensive operations during movement.
 */
const ClampSupportMesh: React.FC<ClampSupportMeshProps> = ({
  placedClamp,
  supportInfo,
  baseTopY,
  cornerRadius = 2,
  visible = true,
  fixtureCutoutsGeometry,
  fixturePointTopCenter,
}) => {
  // Track whether THIS clamp's gizmo is open (selected for transform)
  const [isGizmoOpen, setIsGizmoOpen] = useState(false);
  // Track the last CSG-computed geometry to show while gizmo is open
  const lastCSGGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  
  // Listen for clamp selection events to know when gizmo opens/closes
  useEffect(() => {
    const handleClampSelected = (e: CustomEvent) => {
      const selectedClampId = e.detail;
      const nowOpen = selectedClampId === placedClamp.id;
      setIsGizmoOpen(nowOpen);
      
      // Clear worker geometry when gizmo opens so baseGeometry is used during transforms
      if (nowOpen) {
        setWorkerCSGGeometry(null);
      }
    };
    
    window.addEventListener('clamp-selected', handleClampSelected as EventListener);
    return () => {
      window.removeEventListener('clamp-selected', handleClampSelected as EventListener);
    };
  }, [placedClamp.id]);
  
  // Memoize clamp position/rotation to avoid object recreation
  const clampPosition = placedClamp.position;
  const clampRotationY = placedClamp.rotation.y;
  
  // Calculate the support height based on clamp Y position
  // This is the only thing that changes when clamp moves vertically
  const supportHeight = useMemo(() => {
    // In the clamp's local Z-up coordinate system:
    // - fixturePointY = Y position of the pivot point (fixturePointTopCenter)
    // - mountSurfaceLocalY = Y position of the mount surface top
    // 
    // When the clamp is placed at world position.y:
    // - The pivot point is at world Y = placedClamp.position.y
    // - The mount surface top is at:
    //   worldMountSurfaceY = placedClamp.position.y + (mountSurfaceLocalY - fixturePointY)
    //
    // The support fills from baseTopY up to worldMountSurfaceY
    const mountSurfaceWorldY = clampPosition.y + 
      (supportInfo.mountSurfaceLocalY - supportInfo.fixturePointY);
    
    const height = mountSurfaceWorldY - baseTopY;
    return Math.max(1.0, height); // Minimum 1mm height
  }, [clampPosition.y, supportInfo.mountSurfaceLocalY, supportInfo.fixturePointY, baseTopY]);

  // The polygon from supportInfo is in local clamp space, relative to fixture point
  // It does NOT change when the clamp moves - only position/rotation change
  const polygon = supportInfo.polygon;
  
  // Create base geometry at origin - only depends on shape and height
  const baseGeometry = useMemo(() => {
    if (supportHeight < 1.0) return null;
    return createSupportGeometryAtOrigin(polygon, supportHeight, cornerRadius);
  }, [polygon, supportHeight, cornerRadius]);

  // Pre-compute cutouts geometry at origin (relative to fixture point)
  // This only needs to be computed once since it's based on the clamp model
  const cutoutsAtOrigin = useMemo(() => {
    if (!fixtureCutoutsGeometry || !fixturePointTopCenter) return null;
    return createCutoutsGeometryAtOrigin(fixtureCutoutsGeometry, fixturePointTopCenter);
  }, [fixtureCutoutsGeometry, fixturePointTopCenter]);

  // State for worker-computed CSG geometry
  const [workerCSGGeometry, setWorkerCSGGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [isComputingCSG, setIsComputingCSG] = useState(false);
  const workerRequestIdRef = useRef(0);

  // Prepare cutouts geometry with Y offset applied (for worker)
  const cutoutsWithOffset = useMemo(() => {
    if (!cutoutsAtOrigin) return null;
    const clone = cutoutsAtOrigin.clone();
    const yOffset = supportHeight - supportInfo.mountSurfaceLocalY;
    clone.translate(0, yOffset, 0);
    return clone;
  }, [cutoutsAtOrigin, supportHeight, supportInfo.mountSurfaceLocalY]);

  // Perform CSG in web worker - DEFERRED while gizmo is open
  useEffect(() => {
    // Skip CSG while gizmo is open
    if (isGizmoOpen) {
      return;
    }
    
    if (!baseGeometry) {
      setWorkerCSGGeometry(null);
      return;
    }
    
    // If no cutouts, use base geometry directly
    if (!cutoutsWithOffset) {
      setWorkerCSGGeometry(baseGeometry);
      return;
    }

    // Increment request ID to handle race conditions
    const requestId = ++workerRequestIdRef.current;
    setIsComputingCSG(true);
    
    // Emit progress event
    window.dispatchEvent(new CustomEvent('clamp-progress', { 
      detail: { stage: 'csg', progress: 0, message: 'Computing support geometry...' } 
    }));

    // Try worker first, fall back to synchronous if worker fails
    performClampCSGInWorker(
      baseGeometry,
      cutoutsWithOffset,
      (progress) => {
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'csg', progress, message: `Processing CSG (${progress}%)...` } 
        }));
      }
    ).then(result => {
      // Only update if this is still the latest request
      if (requestId === workerRequestIdRef.current) {
        setWorkerCSGGeometry(result || baseGeometry);
        setIsComputingCSG(false);
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'idle', progress: 100, message: '' } 
        }));
      }
    }).catch(() => {
      // Fallback to synchronous CSG on worker failure
      if (requestId === workerRequestIdRef.current) {
        try {
          const supportClone = baseGeometry.clone();
          const cutoutsClone = cutoutsWithOffset.clone();
          
          // Ensure UVs exist
          if (!supportClone.getAttribute('uv')) {
            const posAttr = supportClone.getAttribute('position');
            if (posAttr) {
              const uvArray = new Float32Array(posAttr.count * 2);
              supportClone.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
          }
          
          const supportBrush = new Brush(supportClone);
          const cutoutsBrush = new Brush(cutoutsClone);
          const result = csgEvaluator.evaluate(supportBrush, cutoutsBrush, SUBTRACTION);
          
          if (result?.geometry) {
            result.geometry.computeVertexNormals();
            setWorkerCSGGeometry(result.geometry);
          } else {
            setWorkerCSGGeometry(baseGeometry);
          }
        } catch {
          setWorkerCSGGeometry(baseGeometry);
        }
        setIsComputingCSG(false);
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'idle', progress: 100, message: '' } 
        }));
      }
    });

    return () => {
      // Cancel by incrementing request ID
      workerRequestIdRef.current++;
    };
  }, [baseGeometry, cutoutsWithOffset, isGizmoOpen]);

  // Cache the last successful CSG geometry and determine what to render
  // While gizmo open: use base geometry (fast, updates in real-time)
  // After gizmo closes: use worker CSG geometry (accurate)
  const geometry = useMemo(() => {
    // While gizmo is open, ALWAYS use baseGeometry for real-time height updates
    if (isGizmoOpen) {
      return baseGeometry;
    }
    
    // While CSG is computing, show base geometry
    if (isComputingCSG) {
      return baseGeometry;
    }
    
    // Use worker CSG result if available
    if (workerCSGGeometry) {
      lastCSGGeometryRef.current = workerCSGGeometry;
      return workerCSGGeometry;
    }
    
    // Fallback to cached CSG or base geometry
    return lastCSGGeometryRef.current || baseGeometry;
  }, [workerCSGGeometry, isGizmoOpen, isComputingCSG, baseGeometry]);

  // Create material (stable reference)
  const material = useMemo(() => createClampSupportMaterial(), []);

  // Calculate world position for the support
  // The polygon is already defined relative to the fixture point (origin in local space)
  // So we just need to position the mesh at the fixture point world position
  const worldPosition = useMemo(() => {
    // Position at clamp's fixture point (no offset needed - polygon already has the offset)
    return new THREE.Vector3(
      clampPosition.x,
      baseTopY,
      clampPosition.z
    );
  }, [clampPosition.x, clampPosition.z, baseTopY]);

  // World rotation (only Y rotation matters for support orientation)
  const worldRotationY = THREE.MathUtils.degToRad(clampRotationY);

  if (!visible || !geometry || supportHeight < 1.0) {
    return null;
  }

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[worldPosition.x, worldPosition.y, worldPosition.z]}
      rotation={[0, worldRotationY, 0]}
      castShadow
      receiveShadow
    />
  );
};

export default ClampSupportMesh;
