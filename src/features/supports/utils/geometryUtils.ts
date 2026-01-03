/**
 * Support Geometry Utilities
 * 
 * Functions for creating fillet, cap, and body geometries for support structures.
 * Extracted from SupportMeshes.tsx to improve maintainability and reduce complexity.
 */

import * as THREE from 'three';
import { computeEdgeNormal, ensureClockwiseWindingXZ } from './polygonUtils';

// ============================================
// Constants
// ============================================

/** Fillet radius in mm */
export const FILLET_RADIUS = 2.0;

/** Number of segments for smooth fillet curves */
export const FILLET_SEGMENTS = 24;

/** Segments for radial geometry (circles, arcs) */
const RADIAL_SEGMENTS = 64;

/** Corner segments for rounded polygons */
const CORNER_SEGMENTS = 8;

// ============================================
// Cylindrical Support Geometry
// ============================================

/**
 * Create a fillet ring for cylindrical supports.
 * Creates a quarter-torus shape curving from baseplate to cylinder wall.
 */
export function createCylindricalFilletGeometry(
  supportRadius: number,
  filletRadius: number = FILLET_RADIUS,
  segments: number = FILLET_SEGMENTS
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  // Generate fillet profile - quarter circle from baseplate to cylinder
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = Math.PI + t * (Math.PI / 2);
    const x = (supportRadius + filletRadius) + filletRadius * Math.cos(angle);
    const y = filletRadius * Math.sin(angle) + filletRadius;

    for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
      const theta = (j / RADIAL_SEGMENTS) * Math.PI * 2;
      positions.push(x * Math.cos(theta), y, x * Math.sin(theta));
    }
  }

  // Generate indices with reversed winding for outward normals
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < RADIAL_SEGMENTS; j++) {
      const a = i * (RADIAL_SEGMENTS + 1) + j;
      const b = a + RADIAL_SEGMENTS + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b, c, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ============================================
// Conical Support Geometry
// ============================================

/**
 * Calculate the Y height where a conical fillet ends (meets cone body).
 */
export function getConicalFilletHeight(
  baseRadius: number,
  topRadius: number,
  coneHeight: number,
  filletRadius: number
): number {
  const radiusDiff = baseRadius - topRadius;
  const slopeAngle = Math.atan2(radiusDiff, coneHeight);
  return filletRadius * (1 - Math.sin(slopeAngle));
}

/**
 * Create a fillet ring for conical supports.
 * Creates an external fillet tangent to both baseplate and cone wall.
 */
export function createConicalFilletGeometry(
  baseRadius: number,
  topRadius: number,
  coneHeight: number,
  filletRadius: number = FILLET_RADIUS,
  segments: number = FILLET_SEGMENTS
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  const radiusDiff = baseRadius - topRadius;
  const slopeAngle = Math.atan2(radiusDiff, coneHeight);

  const filletCenterR = baseRadius + filletRadius;
  const filletCenterY = filletRadius;

  const startAngle = Math.PI + slopeAngle;
  const endAngle = 3 * Math.PI / 2;
  const arcAngle = endAngle - startAngle;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * arcAngle;
    const r = filletCenterR + filletRadius * Math.cos(angle);
    const y = filletCenterY + filletRadius * Math.sin(angle);

    for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
      const theta = (j / RADIAL_SEGMENTS) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
    }
  }

  // Reversed winding for outward normals
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < RADIAL_SEGMENTS; j++) {
      const a = i * (RADIAL_SEGMENTS + 1) + j;
      const b = a + RADIAL_SEGMENTS + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b, c, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ============================================
// Polygon Support Geometry (Custom & Rectangular)
// ============================================

/** Corner data for polygon processing */
interface CornerData {
  vx: number;
  vz: number;
  cx: number;
  cz: number;
  insetStart: [number, number];
  insetEnd: [number, number];
  r: number;
}

/**
 * Compute corner inset data for a polygon vertex.
 */
function computeCornerData(
  polygon: [number, number][],
  index: number,
  cornerRadius: number
): CornerData {
  const n = polygon.length;
  const prev = polygon[(index - 1 + n) % n];
  const curr = polygon[index];
  const next = polygon[(index + 1) % n];

  const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
  const toNext = [next[0] - curr[0], next[1] - curr[1]];
  const lenPrev = Math.hypot(toPrev[0], toPrev[1]);
  const lenNext = Math.hypot(toNext[0], toNext[1]);

  // Degenerate edge - return vertex position with no rounding
  if (lenPrev < 0.01 || lenNext < 0.01) {
    return {
      vx: curr[0], vz: curr[1],
      cx: curr[0], cz: curr[1],
      insetStart: curr, insetEnd: curr, r: 0
    };
  }

  const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
  const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
  const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);

  if (r > 0.01) {
    const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
    const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];

    // Calculate arc center
    const bisectorX = dirPrev[0] + dirNext[0];
    const bisectorZ = dirPrev[1] + dirNext[1];
    const bisectorLen = Math.hypot(bisectorX, bisectorZ);

    const halfAngle = Math.acos(Math.max(-1, Math.min(1, -(dirPrev[0] * dirNext[0] + dirPrev[1] * dirNext[1])))) / 2;
    const distToCenter = halfAngle > 0.01 ? r / Math.sin(halfAngle) : r;

    let cx = curr[0], cz = curr[1];
    if (bisectorLen > 0.01) {
      cx = curr[0] + (bisectorX / bisectorLen) * distToCenter;
      cz = curr[1] + (bisectorZ / bisectorLen) * distToCenter;
    }

    return { vx: curr[0], vz: curr[1], cx, cz, insetStart, insetEnd, r };
  }

  return {
    vx: curr[0], vz: curr[1],
    cx: curr[0], cz: curr[1],
    insetStart: curr, insetEnd: curr, r: 0
  };
}

/**
 * Add edge fillet strip geometry.
 */
function addEdgeFillet(
  positions: number[],
  indices: number[],
  x1: number, z1: number,
  x2: number, z2: number,
  nx: number, nz: number,
  filletRadius: number,
  segments: number
): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
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
      indices.push(a, b, c, c, b, d);
    }
  }
}

/**
 * Add corner fillet geometry (sharp or rounded).
 */
function addCornerFillet(
  positions: number[],
  indices: number[],
  corner: CornerData,
  n1x: number, n1z: number,
  n2x: number, n2z: number,
  filletRadius: number,
  segments: number,
  isCW: boolean
): void {
  const baseIdx = positions.length / 3;

  if (corner.r < 0.01) {
    // Sharp corner - arc sweep
    const startAngle = Math.atan2(n1z, n1x);
    const endAngle = Math.atan2(n2z, n2x);
    let angleDiff = endAngle - startAngle;

    if (isCW && angleDiff > 0) angleDiff -= 2 * Math.PI;
    if (!isCW && angleDiff < 0) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) < 0.01 || Math.abs(angleDiff) > 2 * Math.PI - 0.01) return;

    const cornerSegs = Math.max(4, Math.ceil(Math.abs(angleDiff) / (Math.PI / 8)));

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const filletAngle = Math.PI + t * (Math.PI / 2);
      const outDist = filletRadius + filletRadius * Math.cos(filletAngle);
      const y = filletRadius * Math.sin(filletAngle) + filletRadius;

      for (let j = 0; j <= cornerSegs; j++) {
        const theta = startAngle + (j / cornerSegs) * angleDiff;
        positions.push(corner.vx + outDist * Math.cos(theta), y, corner.vz + outDist * Math.sin(theta));
      }
    }

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < cornerSegs; j++) {
        const a = baseIdx + i * (cornerSegs + 1) + j;
        const b = a + cornerSegs + 1;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }
  } else {
    // Rounded corner - follow quadratic Bezier
    for (let i = 0; i <= segments; i++) {
      const filletT = i / segments;
      const filletAngle = Math.PI + filletT * (Math.PI / 2);
      const outDist = filletRadius + filletRadius * Math.cos(filletAngle);
      const y = filletRadius * Math.sin(filletAngle) + filletRadius;

      for (let j = 0; j <= CORNER_SEGMENTS; j++) {
        const t = j / CORNER_SEGMENTS;
        const omt = 1 - t;

        // Bezier point
        const bx = omt * omt * corner.insetStart[0] + 2 * omt * t * corner.vx + t * t * corner.insetEnd[0];
        const bz = omt * omt * corner.insetStart[1] + 2 * omt * t * corner.vz + t * t * corner.insetEnd[1];

        // Bezier tangent
        const tx = 2 * omt * (corner.vx - corner.insetStart[0]) + 2 * t * (corner.insetEnd[0] - corner.vx);
        const tz = 2 * omt * (corner.vz - corner.insetStart[1]) + 2 * t * (corner.insetEnd[1] - corner.vz);
        const tLen = Math.hypot(tx, tz);

        let nx: number, nz: number;
        if (tLen > 0.001) {
          nx = -tz / tLen;
          nz = tx / tLen;
        } else {
          nx = n1x * (1 - t) + n2x * t;
          nz = n1z * (1 - t) + n2z * t;
          const nLen = Math.hypot(nx, nz);
          if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
        }

        positions.push(bx + nx * outDist, y, bz + nz * outDist);
      }
    }

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < CORNER_SEGMENTS; j++) {
        const a = baseIdx + i * (CORNER_SEGMENTS + 1) + j;
        const b = a + CORNER_SEGMENTS + 1;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }
  }
}

/**
 * Create fillet geometry for polygon-based supports (custom and rectangular).
 * Uses CW winding for consistent manifold geometry.
 */
export function createPolygonFilletGeometry(
  polygon: [number, number][],
  cornerRadius: number = 0,
  filletRadius: number = FILLET_RADIUS,
  segments: number = FILLET_SEGMENTS
): THREE.BufferGeometry {
  if (polygon.length < 3) {
    return new THREE.BufferGeometry();
  }

  const workingPolygon = ensureClockwiseWindingXZ(polygon);
  const n = workingPolygon.length;
  const isCW = true;

  const positions: number[] = [];
  const indices: number[] = [];

  // Compute edge normals
  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    edgeNormals.push(computeEdgeNormal(workingPolygon[i], workingPolygon[(i + 1) % n], isCW));
  }

  // Compute corner data
  const cornerData: CornerData[] = [];
  for (let i = 0; i < n; i++) {
    cornerData.push(computeCornerData(workingPolygon, i, cornerRadius));
  }

  // Add edge fillets and corner fillets
  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];

    addEdgeFillet(
      positions, indices,
      currCorner.insetEnd[0], currCorner.insetEnd[1],
      nextCorner.insetStart[0], nextCorner.insetStart[1],
      normal[0], normal[1],
      filletRadius, segments
    );

    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];
    addCornerFillet(
      positions, indices,
      nextCorner,
      prevNormal[0], prevNormal[1],
      nextNormal[0], nextNormal[1],
      filletRadius, segments, isCW
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Create fillet for rectangular supports using polygon-based approach.
 */
export function createRectangularFilletGeometry(
  width: number,
  depth: number,
  cornerRadius: number = 0,
  filletRadius: number = FILLET_RADIUS,
  segments: number = FILLET_SEGMENTS
): THREE.BufferGeometry {
  const hw = width / 2;
  const hd = depth / 2;
  const r = Math.max(0, Math.min(cornerRadius, hw - 0.01, hd - 0.01));

  // CW order rectangle
  const polygon: [number, number][] = [
    [-hw, -hd], [-hw, hd], [hw, hd], [hw, -hd]
  ];

  return createPolygonFilletGeometry(polygon, r, filletRadius, segments);
}

// ============================================
// Cap Geometry (Top and Bottom)
// ============================================

/**
 * Create polygon-based bottom cap geometry for CSG operations.
 * Matches the fillet's outer perimeter at Y=0.
 */
export function createPolygonBottomCapGeometry(
  polygon: [number, number][],
  cornerRadius: number,
  filletRadius: number
): THREE.BufferGeometry | null {
  if (!polygon || polygon.length < 3) return null;

  const workingPolygon = ensureClockwiseWindingXZ(polygon);
  const n = workingPolygon.length;
  const isCW = true;

  // Compute edge normals
  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    edgeNormals.push(computeEdgeNormal(workingPolygon[i], workingPolygon[(i + 1) % n], isCW));
  }

  // Compute corner data
  const cornerData: CornerData[] = [];
  for (let i = 0; i < n; i++) {
    cornerData.push(computeCornerData(workingPolygon, i, cornerRadius));
  }

  // Build outer perimeter at Y=0
  const perimeterPoints: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const currCorner = cornerData[i];
    const nextCorner = cornerData[(i + 1) % n];
    const normal = edgeNormals[i];

    // Edge points
    perimeterPoints.push([
      currCorner.insetEnd[0] + normal[0] * filletRadius,
      currCorner.insetEnd[1] + normal[1] * filletRadius
    ]);
    perimeterPoints.push([
      nextCorner.insetStart[0] + normal[0] * filletRadius,
      nextCorner.insetStart[1] + normal[1] * filletRadius
    ]);

    // Corner arc
    const prevNormal = edgeNormals[i];
    const nextNormal = edgeNormals[(i + 1) % n];

    if (nextCorner.r < 0.01) {
      // Sharp corner arc
      const startAngle = Math.atan2(prevNormal[1], prevNormal[0]);
      const endAngle = Math.atan2(nextNormal[1], nextNormal[0]);
      let angleDiff = endAngle - startAngle;
      if (isCW && angleDiff > 0) angleDiff -= 2 * Math.PI;

      if (Math.abs(angleDiff) > 0.01 && Math.abs(angleDiff) < 2 * Math.PI - 0.01) {
        for (let j = 1; j < CORNER_SEGMENTS; j++) {
          const t = j / CORNER_SEGMENTS;
          const theta = startAngle + t * angleDiff;
          perimeterPoints.push([
            nextCorner.vx + filletRadius * Math.cos(theta),
            nextCorner.vz + filletRadius * Math.sin(theta)
          ]);
        }
      }
    } else {
      // Rounded corner - follow offset Bezier
      for (let j = 1; j < CORNER_SEGMENTS; j++) {
        const t = j / CORNER_SEGMENTS;
        const omt = 1 - t;

        const bx = omt * omt * nextCorner.insetStart[0] + 2 * omt * t * nextCorner.vx + t * t * nextCorner.insetEnd[0];
        const bz = omt * omt * nextCorner.insetStart[1] + 2 * omt * t * nextCorner.vz + t * t * nextCorner.insetEnd[1];

        const tx = 2 * omt * (nextCorner.vx - nextCorner.insetStart[0]) + 2 * t * (nextCorner.insetEnd[0] - nextCorner.vx);
        const tz = 2 * omt * (nextCorner.vz - nextCorner.insetStart[1]) + 2 * t * (nextCorner.insetEnd[1] - nextCorner.vz);
        const tLen = Math.hypot(tx, tz);

        let nx: number, nz: number;
        if (tLen > 0.001) {
          nx = -tz / tLen;
          nz = tx / tLen;
        } else {
          nx = prevNormal[0] * (1 - t) + nextNormal[0] * t;
          nz = prevNormal[1] * (1 - t) + nextNormal[1] * t;
          const nLen = Math.hypot(nx, nz);
          if (nLen > 0.001) { nx /= nLen; nz /= nLen; }
        }

        perimeterPoints.push([bx + nx * filletRadius, bz + nz * filletRadius]);
      }
    }
  }

  // Triangulate using fan from centroid
  const positions: number[] = [];
  const indices: number[] = [];

  let centroidX = 0, centroidZ = 0;
  for (const [x, z] of perimeterPoints) {
    centroidX += x;
    centroidZ += z;
  }
  centroidX /= perimeterPoints.length;
  centroidZ /= perimeterPoints.length;

  positions.push(centroidX, 0, centroidZ);
  for (const [x, z] of perimeterPoints) {
    positions.push(x, 0, z);
  }

  // Downward-facing winding
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
 * Create bottom cap geometry for various support types.
 */
export function createBottomCapGeometry(
  type: string,
  support: Record<string, unknown>,
  filletRadius: number
): THREE.BufferGeometry | null {
  switch (type) {
    case 'cylindrical': {
      const radius = support.radius as number;
      const outerRadius = radius + filletRadius;
      const cap = new THREE.CircleGeometry(outerRadius, RADIAL_SEGMENTS);
      cap.rotateX(Math.PI / 2); // Face downward
      return cap;
    }

    case 'rectangular': {
      const width = support.width as number;
      const depth = support.depth as number;
      const cornerRadius = (support.cornerRadius as number) ?? 0;
      const hw = width / 2;
      const hd = depth / 2;
      const polygon: [number, number][] = [[-hw, -hd], [-hw, hd], [hw, hd], [hw, -hd]];
      return createPolygonBottomCapGeometry(polygon, cornerRadius, filletRadius);
    }

    case 'conical': {
      const baseRadius = support.baseRadius as number;
      const outerRadius = baseRadius + filletRadius;
      const cap = new THREE.CircleGeometry(outerRadius, RADIAL_SEGMENTS);
      cap.rotateX(Math.PI / 2);
      return cap;
    }

    case 'custom': {
      const polygon = support.polygon as [number, number][];
      const cornerRadius = (support.cornerRadius as number) ?? 0;
      return createPolygonBottomCapGeometry(polygon, cornerRadius, filletRadius);
    }

    default:
      return null;
  }
}

/**
 * Create top cap geometry for support types.
 */
export function createTopCapGeometry(
  type: string,
  support: Record<string, unknown>,
  height: number,
  _filletRadius: number
): THREE.BufferGeometry | null {
  const topY = height;

  switch (type) {
    case 'cylindrical': {
      const radius = support.radius as number;
      const cap = new THREE.CircleGeometry(radius, RADIAL_SEGMENTS);
      cap.rotateX(-Math.PI / 2); // Face upward
      cap.translate(0, topY, 0);
      return cap;
    }

    case 'rectangular': {
      const width = support.width as number;
      const depth = support.depth as number;
      const cornerRadius = (support.cornerRadius as number) ?? 0;

      if (cornerRadius <= 0.01) {
        const cap = new THREE.PlaneGeometry(width, depth);
        cap.rotateX(-Math.PI / 2);
        cap.translate(0, topY, 0);
        return cap;
      }

      const hw = width / 2;
      const hd = depth / 2;
      const r = Math.min(cornerRadius, hw, hd);
      const shape = new THREE.Shape();
      shape.moveTo(-hw + r, -hd);
      shape.lineTo(hw - r, -hd);
      shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
      shape.lineTo(hw, hd - r);
      shape.quadraticCurveTo(hw, hd, hw - r, hd);
      shape.lineTo(-hw + r, hd);
      shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
      shape.lineTo(-hw, -hd + r);
      shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      const cap = new THREE.ShapeGeometry(shape, 32);
      cap.rotateX(-Math.PI / 2);
      cap.translate(0, topY, 0);
      return cap;
    }

    case 'conical': {
      const topRadius = support.topRadius as number;
      const cap = new THREE.CircleGeometry(topRadius, RADIAL_SEGMENTS);
      cap.rotateX(-Math.PI / 2);
      cap.translate(0, topY, 0);
      return cap;
    }

    case 'custom': {
      const polygon = support.polygon as [number, number][];
      const cornerRadius = (support.cornerRadius as number) ?? 0;
      if (!polygon || polygon.length < 3) return null;

      const workingPolygon: [number, number][] = polygon.map(([x, y]) => [x, -y]);
      const shape = new THREE.Shape();
      let started = false;

      for (let idx = 0; idx < workingPolygon.length; idx++) {
        const curr = workingPolygon[idx];
        const prev = workingPolygon[(idx - 1 + workingPolygon.length) % workingPolygon.length];
        const next = workingPolygon[(idx + 1) % workingPolygon.length];

        const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
        const toNext = [next[0] - curr[0], next[1] - curr[1]];
        const lenPrev = Math.hypot(toPrev[0], toPrev[1]);
        const lenNext = Math.hypot(toNext[0], toNext[1]);

        if (lenPrev < 0.01 || lenNext < 0.01 || cornerRadius < 0.01) {
          if (!started) { shape.moveTo(curr[0], curr[1]); started = true; }
          else { shape.lineTo(curr[0], curr[1]); }
          continue;
        }

        const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
        const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
        const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];

        if (r > 0.01) {
          const insetStart: [number, number] = [curr[0] + dirPrev[0] * r, curr[1] + dirPrev[1] * r];
          const insetEnd: [number, number] = [curr[0] + dirNext[0] * r, curr[1] + dirNext[1] * r];

          if (!started) { shape.moveTo(insetStart[0], insetStart[1]); started = true; }
          else { shape.lineTo(insetStart[0], insetStart[1]); }
          shape.quadraticCurveTo(curr[0], curr[1], insetEnd[0], insetEnd[1]);
        } else {
          if (!started) { shape.moveTo(curr[0], curr[1]); started = true; }
          else { shape.lineTo(curr[0], curr[1]); }
        }
      }
      shape.closePath();

      const cap = new THREE.ShapeGeometry(shape, 32);
      cap.rotateX(-Math.PI / 2);
      cap.translate(0, topY, 0);
      return cap;
    }

    default:
      return null;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Remove bottom cap faces from ExtrudeGeometry.
 * ExtrudeGeometry creates internal faces that need removal for manifold mesh.
 */
export function removeBottomCapFaces(
  geometry: THREE.BufferGeometry,
  bottomY: number,
  tolerance: number = 0.01
): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = nonIndexed.getAttribute('position');
  const normals = nonIndexed.getAttribute('normal');

  const newPositions: number[] = [];
  const newNormals: number[] = [];

  // Process each triangle
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

    // Skip bottom cap faces
    if (isBottomFace && isDownwardFacing) continue;

    // Keep this triangle
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
 * Normalize geometry for merging operations.
 * Converts to non-indexed and removes UV attributes.
 */
export function normalizeGeometryForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const normalized = geo.index ? geo.toNonIndexed() : geo.clone();
  normalized.deleteAttribute('uv');
  normalized.deleteAttribute('uv2');
  return normalized;
}
