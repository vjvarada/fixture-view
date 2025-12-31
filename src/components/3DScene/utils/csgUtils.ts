/**
 * CSG and geometry building utilities for 3DScene
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LabelConfig } from '@/features/labels';
import { ensureClockwiseWindingXZ, computeEdgeNormal } from '@/features/supports/utils/polygonUtils';

// =============================================================================
// Clamp Support Geometry Constants
// =============================================================================

const FILLET_RADIUS = 2.0;
const FILLET_SEGMENTS = 12;
const EXTRUDE_CURVE_SEGMENTS = 16;

// =============================================================================
// Helper Functions for Clamp Support Geometry
// =============================================================================

/**
 * Remove the bottom cap faces from an ExtrudeGeometry.
 * ExtrudeGeometry creates both top and bottom caps which cause internal faces
 * when merged with fillet geometry. This function removes faces at the bottom.
 */
function removeBottomCapFaces(
  geometry: THREE.BufferGeometry, 
  bottomY: number, 
  tolerance: number = 0.01
): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = nonIndexed.getAttribute('position');
  const normals = nonIndexed.getAttribute('normal');
  
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  
  for (let i = 0; i < positions.count; i += 3) {
    const y1 = positions.getY(i);
    const y2 = positions.getY(i + 1);
    const y3 = positions.getY(i + 2);
    
    const isBottomFace = 
      Math.abs(y1 - bottomY) < tolerance &&
      Math.abs(y2 - bottomY) < tolerance &&
      Math.abs(y3 - bottomY) < tolerance;
    
    let isDownwardFacing = false;
    if (normals) {
      const avgNy = (normals.getY(i) + normals.getY(i + 1) + normals.getY(i + 2)) / 3;
      isDownwardFacing = avgNy < -0.9;
    }
    
    if (isBottomFace && isDownwardFacing) continue;
    
    for (let j = 0; j < 3; j++) {
      newPositions.push(positions.getX(i + j), positions.getY(i + j), positions.getZ(i + j));
      if (normals) {
        newNormals.push(normals.getX(i + j), normals.getY(i + j), normals.getZ(i + j));
      }
    }
  }
  
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  if (newNormals.length > 0) {
    result.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
  }
  return result;
}

/**
 * Create bottom cap geometry for a polygon support at Y=0
 * Uses CW polygon directly (no reverse) to match body geometry.
 */
function createClampBottomCapGeometry(
  polygon: Array<[number, number]>,
  cornerRadius: number,
  filletRadius: number
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3) return null;

  // CRITICAL: Use SAME polygon ordering as body (CW, no reverse)
  const workingPolygon = ensureClockwiseWindingXZ(polygon);
  const isCW = true;  // We've normalized to CW

  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    return computeEdgeNormal(p1, p2, isCW);
  };

  const n = workingPolygon.length;
  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    edgeNormals.push(getEdgeNormal(workingPolygon[i], workingPolygon[(i + 1) % n]));
  }

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

  const perimeterPoints: [number, number][] = [];
  const cornerSegs = 8;

  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];

    const edgeStartX = currCorner.insetEnd[0] + normal[0] * filletRadius;
    const edgeStartZ = currCorner.insetEnd[1] + normal[1] * filletRadius;
    const edgeEndX = nextCorner.insetStart[0] + normal[0] * filletRadius;
    const edgeEndZ = nextCorner.insetStart[1] + normal[1] * filletRadius;

    perimeterPoints.push([edgeStartX, edgeStartZ]);
    perimeterPoints.push([edgeEndX, edgeEndZ]);

    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];

    if (nextCorner.r < 0.01) {
      const startAngle = Math.atan2(prevNormal[1], prevNormal[0]);
      const endAngle = Math.atan2(nextNormal[1], nextNormal[0]);
      let angleDiff = endAngle - startAngle;
      if (isCW) { if (angleDiff > 0) angleDiff -= 2 * Math.PI; }
      else { if (angleDiff < 0) angleDiff += 2 * Math.PI; }

      if (Math.abs(angleDiff) > 0.01 && Math.abs(angleDiff) < 2 * Math.PI - 0.01) {
        for (let j = 1; j < cornerSegs; j++) {
          const theta = startAngle + (j / cornerSegs) * angleDiff;
          perimeterPoints.push([
            nextCorner.vx + filletRadius * Math.cos(theta),
            nextCorner.vz + filletRadius * Math.sin(theta)
          ]);
        }
      }
    } else {
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
          if (isCW) { nx = -tz / tLen; nz = tx / tLen; }
          else { nx = tz / tLen; nz = -tx / tLen; }
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

  const positions: number[] = [];
  const indices: number[] = [];

  let centroidX = 0, centroidZ = 0;
  for (const [x, z] of perimeterPoints) { centroidX += x; centroidZ += z; }
  centroidX /= perimeterPoints.length;
  centroidZ /= perimeterPoints.length;

  positions.push(centroidX, 0, centroidZ);
  for (const [x, z] of perimeterPoints) positions.push(x, 0, z);

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
 */
function createClampFilletGeometry(
  polygon: Array<[number, number]>,
  cornerRadius: number,
  filletRadius: number,
  segments: number
): THREE.BufferGeometry | null {
  if (polygon.length < 3 || filletRadius <= 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  
  // CRITICAL: Use SAME polygon ordering as body (CW, no reverse)
  const workingPolygon = ensureClockwiseWindingXZ(polygon);
  const isCW = true;  // We've normalized to CW

  const getEdgeNormal = (p1: [number, number], p2: [number, number]): [number, number] => {
    return computeEdgeNormal(p1, p2, isCW);
  };

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
        positions.push(x1 + s * dx + nx * outDist, y, z1 + s * dz + nz * outDist);
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

  const addCornerFillet = (
    vx: number, vz: number,
    insetStartX: number, insetStartZ: number,
    insetEndX: number, insetEndZ: number,
    n1x: number, n1z: number,
    n2x: number, n2z: number,
    r: number
  ) => {
    if (r < 0.01) {
      const startAngle = Math.atan2(n1z, n1x);
      const endAngle = Math.atan2(n2z, n2x);
      let angleDiff = endAngle - startAngle;
      if (isCW) { if (angleDiff > 0) angleDiff -= 2 * Math.PI; }
      else { if (angleDiff < 0) angleDiff += 2 * Math.PI; }

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
          indices.push(a, b, a + 1);
          indices.push(a + 1, b, b + 1);
        }
      }
      return;
    }

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

        const bx = omt * omt * insetStartX + 2 * omt * t * vx + t * t * insetEndX;
        const bz = omt * omt * insetStartZ + 2 * omt * t * vz + t * t * insetEndZ;

        const tx = 2 * omt * (vx - insetStartX) + 2 * t * (insetEndX - vx);
        const tz = 2 * omt * (vz - insetStartZ) + 2 * t * (insetEndZ - vz);
        const tLen = Math.sqrt(tx * tx + tz * tz);

        let nx: number, nz: number;
        if (tLen > 0.001) {
          if (isCW) { nx = -tz / tLen; nz = tx / tLen; }
          else { nx = tz / tLen; nz = -tx / tLen; }
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
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
  };

  const n = workingPolygon.length;
  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    edgeNormals.push(getEdgeNormal(workingPolygon[i], workingPolygon[(i + 1) % n]));
  }

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

  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];
    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];

    addEdgeFillet(currCorner.insetEnd[0], currCorner.insetEnd[1], nextCorner.insetStart[0], nextCorner.insetStart[1], normal[0], normal[1]);
    addCornerFillet(
      nextCorner.vx, nextCorner.vz,
      nextCorner.insetStart[0], nextCorner.insetStart[1],
      nextCorner.insetEnd[0], nextCorner.insetEnd[1],
      prevNormal[0], prevNormal[1],
      nextNormal[0], nextNormal[1],
      nextCorner.r
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// =============================================================================
// Main Clamp Support Geometry Builder
// =============================================================================

/**
 * Build a clamp support geometry at origin for CSG operations.
 * This is the FULL implementation with fillet, matching ClampSupportMesh.tsx.
 * 
 * Creates a watertight manifold geometry consisting of:
 * - Bottom cap at Y=0
 * - Fillet geometry transitioning from bottom cap to body
 * - Extruded body (with bottom cap removed to weld with fillet)
 * 
 * All parts are merged and vertices welded for manifold output.
 */
export function buildClampSupportGeometryAtOrigin(
  polygon: Array<[number, number]>,
  height: number,
  cornerRadius: number = 2
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3 || height <= 0) {
    return null;
  }

  // Clamp fillet radius to not exceed support height
  const effectiveFilletRadius = Math.min(FILLET_RADIUS, Math.max(0, height - 0.1));
  const bodyHeight = Math.max(0.1, height - effectiveFilletRadius);

  // Create fillet geometry
  const filletGeo = createClampFilletGeometry(polygon, cornerRadius, effectiveFilletRadius, FILLET_SEGMENTS);

  // Mirror the Y (which is actually Z in our polygon) coordinates to match the rotation direction
  const workingPolygon: [number, number][] = polygon.map(([x, z]) => [x, -z]);
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
  // ExtrudeGeometry creates both top and bottom caps - we need to remove the bottom cap
  let extrudedBody = new THREE.ExtrudeGeometry(shape, { 
    depth: bodyHeight, 
    bevelEnabled: false, 
    curveSegments: EXTRUDE_CURVE_SEGMENTS 
  });
  
  // Rotate to make Y the up direction (extrusion is along Z by default)
  extrudedBody.rotateX(-Math.PI / 2);
  
  // Position body to sit on top of fillet
  extrudedBody.translate(0, effectiveFilletRadius, 0);
  
  // Remove bottom cap faces (at y = effectiveFilletRadius after translation)
  const bodyGeo = removeBottomCapFaces(extrudedBody, effectiveFilletRadius, 0.01);
  extrudedBody.dispose();

  // Create bottom cap at Y=0 to seal the support
  const bottomCapGeo = createClampBottomCapGeometry(polygon, cornerRadius, effectiveFilletRadius);

  // Normalize geometries for merging (remove UVs, convert to non-indexed)
  const normalizeGeometry = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const normalized = geo.index ? geo.toNonIndexed() : geo.clone();
    if (normalized.getAttribute('uv')) normalized.deleteAttribute('uv');
    if (normalized.getAttribute('uv2')) normalized.deleteAttribute('uv2');
    return normalized;
  };

  // Collect geometries to merge
  const geometriesToMerge: THREE.BufferGeometry[] = [];
  
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

  // Weld duplicate vertices at seams for watertight mesh
  const welded = mergeVertices(merged, 0.01);
  welded.computeVertexNormals();
  
  return welded;
}

// =============================================================================
// Label Geometry
// =============================================================================

/**
 * Build a label geometry for CSG operations.
 * Creates a 3D text geometry positioned and rotated according to the label config.
 */
export async function buildLabelGeometry(label: LabelConfig): Promise<THREE.BufferGeometry | null> {
  console.log('[buildLabelGeometry] Starting for label:', label.id, label.text);
  
  try {
    const { FontLoader } = await import('three/addons/loaders/FontLoader.js');
    const { TextGeometry } = await import('three/addons/geometries/TextGeometry.js');
    
    const fontLoader = new FontLoader();
    const fontFile = label.font === 'roboto' 
      ? '/fonts/roboto_bold.typeface.json'
      : label.font === 'arial'
      ? '/fonts/arial_bold.typeface.json'
      : '/fonts/helvetiker_bold.typeface.json';
    
    return new Promise((resolve) => {
      fontLoader.load(
        fontFile, 
        (font) => {
          try {
            const textGeometry = new TextGeometry(label.text, {
              font: font,
              size: label.fontSize,
              depth: label.depth, // 'height' is deprecated, use 'depth'
              curveSegments: 4,
              bevelEnabled: false,
            });
            
            const posAttr = textGeometry.getAttribute('position');
            if (!posAttr || posAttr.count === 0) {
              console.error('[buildLabelGeometry] TextGeometry has no vertices!');
              resolve(null);
              return;
            }
            
            // Center the text
            textGeometry.computeBoundingBox();
            const bbox = textGeometry.boundingBox;
            if (bbox) {
              const centerX = (bbox.min.x + bbox.max.x) / 2;
              const centerY = (bbox.min.y + bbox.max.y) / 2;
              textGeometry.translate(-centerX, -centerY, 0);
            }
            
            // Apply label position and rotation
            const position = label.position instanceof THREE.Vector3 
              ? label.position 
              : new THREE.Vector3(label.position.x, label.position.y, label.position.z);
            const rotation = label.rotation instanceof THREE.Euler 
              ? label.rotation 
              : new THREE.Euler(label.rotation.x, label.rotation.y, label.rotation.z);
            
            const matrix = new THREE.Matrix4()
              .makeRotationFromEuler(rotation)
              .setPosition(position);
            textGeometry.applyMatrix4(matrix);
            
            textGeometry.computeVertexNormals();
            
            console.log('[buildLabelGeometry] Label geometry ready for:', label.text);
            resolve(textGeometry);
          } catch (err) {
            console.error('[buildLabelGeometry] Error creating TextGeometry:', err);
            resolve(null);
          }
        }, 
        undefined,
        (err) => {
          console.error('[buildLabelGeometry] Failed to load font:', fontFile, err);
          resolve(null);
        }
      );
    });
  } catch (err) {
    console.error('[buildLabelGeometry] Top-level error:', err);
    return null;
  }
}
