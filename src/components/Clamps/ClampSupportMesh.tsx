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
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { CustomSupport } from '../Supports/types';
import { ClampSupportInfo, createClampSupport } from './clampSupportUtils';
import { PlacedClamp } from './types';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

// Material for clamp supports (slightly different from regular supports to distinguish)
const createClampSupportMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: 0x6b7280, // Gray-500 - slightly darker than regular supports
    transparent: false,
    opacity: 1,
    metalness: 0.1,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

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
    console.warn('[ClampSupportMesh] Invalid support config:', { polygonLen: polygon?.length, height });
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
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { 
    depth: bodyHeight, 
    bevelEnabled: false, 
    curveSegments: EXTRUDE_CURVE_SEGMENTS 
  });
  
  // Rotate to make Y the up direction (extrusion is along Z by default)
  bodyGeo.rotateX(-Math.PI / 2);
  
  // Position body to sit on top of fillet (fillet stays at origin before merge)
  bodyGeo.translate(0, effectiveFilletRadius, 0);

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
    console.warn('[ClampSupportMesh] Failed to merge geometries');
    return null;
  }

  // Do NOT translate - geometry stays at origin
  merged.computeVertexNormals();
  return merged;
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

// Old function kept for backwards compatibility but unused
function createCustomSupportGeometry(
  support: CustomSupport,
  baseTopY: number
): THREE.BufferGeometry | null {
  const { polygon, height, cornerRadius = 0 } = support;
  const effectiveBaseY = support.baseY ?? baseTopY;
  const geo = createSupportGeometryAtOrigin(polygon, height, cornerRadius);
  if (geo) {
    geo.translate(support.center.x, effectiveBaseY, support.center.y);
  }
  return geo;
}

/**
 * Create bottom cap geometry for a polygon support
 * This creates a flat cap at Y=0 that matches the fillet's outer perimeter
 * Based on SupportMeshes.tsx createBottomCapGeometry for 'custom' type
 */
function createBottomCapGeometry(
  polygon: Array<[number, number]>,
  cornerRadius: number,
  filletRadius: number
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3) return null;

  // Reverse polygon to match fillet's winding
  const workingPolygon: [number, number][] = [...polygon].reverse();

  // Determine winding direction
  let signedArea = 0;
  for (let i = 0; i < workingPolygon.length; i++) {
    const [x1, z1] = workingPolygon[i];
    const [x2, z2] = workingPolygon[(i + 1) % workingPolygon.length];
    signedArea += (x2 - x1) * (z2 + z1);
  }
  const isCW = signedArea > 0;

  // Compute edge normals
  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return [0, 0];
    if (isCW) {
      return [-dz / len, dx / len];
    } else {
      return [dz / len, -dx / len];
    }
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
      let endAngle = Math.atan2(nextNormal[1], nextNormal[0]);
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

  // Fan triangulation with reversed winding for downward normal
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
 * Full implementation from SupportMeshes.tsx that handles rounded corners
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

  // Reverse the polygon to match the body's winding (same as SupportMeshes)
  const workingPolygon: [number, number][] = [...polygon].reverse();

  // Check polygon winding (clockwise or counter-clockwise)
  let signedArea = 0;
  for (let i = 0; i < workingPolygon.length; i++) {
    const [x1, z1] = workingPolygon[i];
    const [x2, z2] = workingPolygon[(i + 1) % workingPolygon.length];
    signedArea += (x2 - x1) * (z2 + z1);
  }
  const isCW = signedArea > 0;

  // Compute edge normals
  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return [0, 0];
    if (isCW) {
      return [-dz / len, dx / len];
    } else {
      return [dz / len, -dx / len];
    }
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
      let endAngle = Math.atan2(n2z, n2x);
      let angleDiff = endAngle - startAngle;

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

        // Outward normal
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
          nx = n1x * (1 - t) + n2x * t;
          nz = n1z * (1 - t) + n2z * t;
          const nLen = Math.sqrt(nx * nx + nz * nz);
          if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
        }

        positions.push(bx + nx * outDist, y, bz + nz * outDist);
      }
    }

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
      // Gizmo is open if THIS clamp is selected
      setIsGizmoOpen(selectedClampId === placedClamp.id);
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

  // Pre-compute and cache the cutouts Brush (BVH building is expensive)
  // This brush is at origin with no Y offset - we'll clone and offset during CSG
  const cutoutsBrushBase = useMemo(() => {
    if (!cutoutsAtOrigin) return null;
    return new Brush(cutoutsAtOrigin);
  }, [cutoutsAtOrigin]);

  // Apply CSG subtraction - DEFERRED while gizmo is open for performance
  // While gizmo is open, we show base geometry; CSG runs after gizmo closes
  const csgGeometry = useMemo(() => {
    // Skip CSG while gizmo is open - will recalculate when gizmo closes
    if (isGizmoOpen) {
      return null; // Signal to use cached or base geometry
    }
    
    if (!baseGeometry) return null;
    
    // If no cutouts, return base geometry
    if (!cutoutsBrushBase) {
      return baseGeometry;
    }

    try {
      // Clone geometries for CSG (don't mutate originals)
      const supportClone = baseGeometry.clone();
      
      // Clone the cutouts geometry and apply Y offset for this support height
      const cutoutsClone = cutoutsAtOrigin!.clone();
      
      // The support geometry:
      // - XZ: polygon is relative to fixture point (origin)
      // - Y: 0 to supportHeight (bottom to top, where top = mount surface)
      //
      // The cutouts geometry (after createCutoutsGeometryAtOrigin):
      // - XZ: translated so fixture point is at origin
      // - Y: original Y positions from clamp model
      //
      // To align cutouts Y with support Y:
      // - In local clamp space, mount surface is at Y = mountSurfaceLocalY
      // - In support space, mount surface (top) is at Y = supportHeight
      // - Offset = supportHeight - mountSurfaceLocalY
      
      const yOffset = supportHeight - supportInfo.mountSurfaceLocalY;
      cutoutsClone.translate(0, yOffset, 0);
      
      // Ensure UVs exist for CSG (three-bvh-csg requires UV attribute)
      if (!supportClone.getAttribute('uv')) {
        const posAttr = supportClone.getAttribute('position');
        if (posAttr) {
          const uvArray = new Float32Array(posAttr.count * 2);
          supportClone.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
        }
      }
      
      // Create brushes for CSG (Brush caches BVH for faster operations)
      const supportBrush = new Brush(supportClone);
      const cutoutsBrush = new Brush(cutoutsClone);
      
      // Perform CSG subtraction using shared evaluator
      const result = csgEvaluator.evaluate(supportBrush, cutoutsBrush, SUBTRACTION);
      
      if (result && result.geometry) {
        result.geometry.computeVertexNormals();
        return result.geometry;
      }
      
      // Fallback to base geometry if CSG fails
      return baseGeometry;
    } catch (error) {
      console.warn('[ClampSupportMesh] CSG subtraction failed:', error);
      return baseGeometry;
    }
  }, [baseGeometry, cutoutsBrushBase, cutoutsAtOrigin, supportHeight, supportInfo.mountSurfaceLocalY, isGizmoOpen]);

  // Cache the last successful CSG geometry and determine what to render
  // While gizmo open: use base geometry (fast)
  // After gizmo closes: use CSG geometry (accurate)
  const geometry = useMemo(() => {
    if (csgGeometry) {
      // CSG completed - cache and use it
      lastCSGGeometryRef.current = csgGeometry;
      return csgGeometry;
    }
    
    if (isGizmoOpen) {
      // While gizmo is open, use base geometry for performance
      // (CSG will recalculate when gizmo closes)
      return baseGeometry;
    }
    
    // Fallback to cached CSG or base geometry
    return lastCSGGeometryRef.current || baseGeometry;
  }, [csgGeometry, isGizmoOpen, baseGeometry]);

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
