import * as THREE from 'three';
import { AnySupport } from './types';

export interface SupportMetricOptions {
  support: AnySupport;
  baseTopY: number;
  contactOffset?: number;
  baseTarget?: THREE.Object3D | null;
  modelTargets?: THREE.Object3D[] | null;
  maxRayHeight?: number;
  raycaster?: THREE.Raycaster;
  modelBounds?: { min: THREE.Vector3; max: THREE.Vector3 } | null; // For fallback height calculation
}

export interface SupportMetrics {
  baseY: number;
  height: number;
}

const DEFAULT_MAX_RAY_HEIGHT = 2000;

// Target spacing between sample points (in scene units, e.g., mm)
const SAMPLE_SPACING = 5;
 
const unitVecUp = new THREE.Vector3(0, 1, 0);
const unitVecDown = new THREE.Vector3(0, -1, 0);

const tempOrigin = new THREE.Vector3();

// Generate samples along concentric circles for circular supports
const generateCircleSamples = (centerX: number, centerZ: number, radius: number): Array<[number, number]> => {
  const samples: Array<[number, number]> = [[centerX, centerZ]];
  
  if (radius < 0.5) return samples;
  
  // Determine number of rings based on radius and spacing
  const numRings = Math.max(1, Math.ceil(radius / SAMPLE_SPACING));
  
  for (let ring = 1; ring <= numRings; ring++) {
    const r = (ring / numRings) * radius;
    // Circumference-based point count to maintain spacing
    const circumference = 2 * Math.PI * r;
    const numPoints = Math.max(4, Math.ceil(circumference / SAMPLE_SPACING));
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      samples.push([centerX + Math.cos(angle) * r, centerZ + Math.sin(angle) * r]);
    }
  }
  
  return samples;
};

// Generate grid samples for rectangular supports
const generateRectSamples = (centerX: number, centerZ: number, width: number, depth: number): Array<[number, number]> => {
  const samples: Array<[number, number]> = [];
  
  const hw = width / 2;
  const hd = depth / 2;
  
  // Determine grid resolution based on dimensions
  const numX = Math.max(2, Math.ceil(width / SAMPLE_SPACING) + 1);
  const numZ = Math.max(2, Math.ceil(depth / SAMPLE_SPACING) + 1);
  
  for (let ix = 0; ix < numX; ix++) {
    const x = -hw + (ix / (numX - 1)) * width;
    for (let iz = 0; iz < numZ; iz++) {
      const z = -hd + (iz / (numZ - 1)) * depth;
      samples.push([centerX + x, centerZ + z]);
    }
  }
  
  return samples;
};

// Generate samples for custom polygon using scanline approach
const generatePolygonSamples = (centerX: number, centerZ: number, polygon: Array<[number, number]>): Array<[number, number]> => {
  const samples: Array<[number, number]> = [[centerX, centerZ]];
  
  if (!polygon || polygon.length < 3) return samples;
  
  // Add vertices and edge midpoints
  polygon.forEach(([x, z]) => samples.push([centerX + x, centerZ + z]));
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[(i + 1) % polygon.length];
    
    // Add midpoint
    samples.push([centerX + (ax + bx) / 2, centerZ + (az + bz) / 2]);
    
    // Add intermediate points for long edges
    const edgeLen = Math.hypot(bx - ax, bz - az);
    if (edgeLen > SAMPLE_SPACING * 2) {
      const numIntermediate = Math.ceil(edgeLen / SAMPLE_SPACING) - 1;
      for (let j = 1; j <= numIntermediate; j++) {
        const t = j / (numIntermediate + 1);
        samples.push([centerX + ax + t * (bx - ax), centerZ + az + t * (bz - az)]);
      }
    }
  }
  
  // Find bounding box of polygon
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  polygon.forEach(([x, z]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  });
  
  // Point-in-polygon test using ray casting
  const pointInPolygon = (px: number, pz: number): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i];
      const [xj, zj] = polygon[j];
      if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };
  
  // Grid sample interior points
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const numX = Math.max(2, Math.ceil(width / SAMPLE_SPACING) + 1);
  const numZ = Math.max(2, Math.ceil(depth / SAMPLE_SPACING) + 1);
  
  for (let ix = 1; ix < numX - 1; ix++) {
    const x = minX + (ix / (numX - 1)) * width;
    for (let iz = 1; iz < numZ - 1; iz++) {
      const z = minZ + (iz / (numZ - 1)) * depth;
      if (pointInPolygon(x, z)) {
        samples.push([centerX + x, centerZ + z]);
      }
    }
  }
  
  return samples;
};

export const getSupportSamples = (support: AnySupport): Array<[number, number]> => {
  const { center } = support;

  if (support.type === 'cylindrical') {
    const r = Math.max(1, (support as any).radius as number);
    return generateCircleSamples(center.x, center.y, r);
  } else if (support.type === 'rectangular') {
    const width = (support as any).width as number;
    const depth = (support as any).depth as number;
    return generateRectSamples(center.x, center.y, width, depth);
  } else if (support.type === 'conical') {
    const r = Math.max(1, (support as any).baseRadius as number);
    return generateCircleSamples(center.x, center.y, r);
  } else if (support.type === 'custom') {
    const polygon = (support as any).polygon as Array<[number, number]>;
    if (Array.isArray(polygon)) {
      return generatePolygonSamples(center.x, center.y, polygon);
    }
  }

  // Fallback: just center
  return [[center.x, center.y]];
};

const getRaycaster = (raycaster?: THREE.Raycaster) => {
  const rc = raycaster ?? new THREE.Raycaster();
  // Ensure BVH accelerated raycasting returns the nearest hit only
  (rc as any).firstHitOnly = true;
  return rc;
};

const raycastBaseY = (
  raycaster: THREE.Raycaster,
  baseTarget: THREE.Object3D | null | undefined,
  baseTopY: number,
  maxRayHeight: number,
  x: number,
  z: number,
) => {
  if (!baseTarget) return baseTopY;
  tempOrigin.set(x, baseTopY + maxRayHeight, z);
  raycaster.set(tempOrigin, unitVecDown);
  const hits = raycaster.intersectObject(baseTarget, true);
  return hits && hits.length ? hits[0].point.y : baseTopY;
};

const raycastModelHitY = (
  raycaster: THREE.Raycaster,
  modelTargets: THREE.Object3D[] | null | undefined,
  maxRayHeight: number,
  fromY: number,
  x: number,
  z: number,
) => {
  if (!modelTargets || modelTargets.length === 0) return null;
  const originY = fromY - 0.001;
  tempOrigin.set(x, originY, z);
  raycaster.near = 0;
  raycaster.far = maxRayHeight;
  raycaster.set(tempOrigin, unitVecUp);
  const hits = raycaster.intersectObjects(modelTargets, true);
  return hits && hits.length ? hits[0].point.y : null;
};

export const computeSupportMetrics = ({
  support,
  baseTopY,
  contactOffset = 0,
  baseTarget,
  modelTargets,
  maxRayHeight = DEFAULT_MAX_RAY_HEIGHT,
  raycaster,
  modelBounds,
}: SupportMetricOptions): SupportMetrics | null => {
  const rc = getRaycaster(raycaster);
  // Note: Avoid calling updateMatrixWorld(true) here as it's expensive
  // The matrices should already be updated by the render loop
  const samples = getSupportSamples(support);
  let effectiveBaseY = baseTopY;
  const hitYs: number[] = [];

  for (const [sx, sz] of samples) {
    const baseY = raycastBaseY(rc, baseTarget, baseTopY, maxRayHeight, sx, sz);
    if (!Number.isFinite(baseY)) {
      continue;
    }
    effectiveBaseY = Math.max(effectiveBaseY, baseY);
    const hitY = raycastModelHitY(rc, modelTargets, maxRayHeight, baseY, sx, sz);
    if (hitY == null || !Number.isFinite(hitY)) {
      continue;
    }
    hitYs.push(hitY);
  }

  // If no rays hit the model, use 20% of the model's height as fallback
  if (!hitYs.length) {
    if (modelBounds) {
      const modelHeight = modelBounds.max.y - modelBounds.min.y;
      const fallbackHeight = Math.max(5, modelHeight * 0.2);
      return { baseY: effectiveBaseY, height: fallbackHeight };
    }
    return null;
  }

  // Use the MAXIMUM hit Y - the support should go up to the highest point where it contacts the model
  const maxModelY = hitYs.reduce((max, y) => Math.max(max, y), hitYs[0]);
  // Ensure a meaningful stem even when the model rests directly on the baseplate
  const height = Math.max(5, maxModelY - effectiveBaseY - contactOffset);
  return { baseY: effectiveBaseY, height };
};

export interface FootprintBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Rotate a point around the origin by a given angle (in radians)
 * Uses Three.js convention: positive rotation around Y-axis is counter-clockwise
 * when viewed from above (looking down +Y axis), which means +X rotates towards -Z.
 * 
 * In the XZ plane with Y-up:
 * - Positive angle rotates clockwise in the XZ plane when viewed from above
 */
const rotatePoint = (x: number, z: number, angle: number): [number, number] => {
  if (angle === 0) return [x, z];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Three.js Y-rotation: x' = x*cos + z*sin, z' = -x*sin + z*cos
  return [
    x * cos + z * sin,
    -x * sin + z * cos
  ];
};

export const getSupportFootprintBounds = (support: AnySupport): FootprintBounds => {
  const { center } = support;
  let minX = center.x;
  let maxX = center.x;
  let minZ = center.y;
  let maxZ = center.y;
  
  // Get rotation (rotationY takes precedence, fall back to rotationZ for backwards compatibility)
  const rotation = (support as any).rotationY ?? (support as any).rotationZ ?? 0;

  const expand = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  
  // Helper to expand with a rotated local point
  const expandRotated = (localX: number, localZ: number) => {
    const [rx, rz] = rotatePoint(localX, localZ, rotation);
    expand(center.x + rx, center.y + rz);
  };

  if (support.type === 'cylindrical') {
    // Circles are rotation-invariant
    const radius = (support as any).radius as number;
    expand(center.x - radius, center.y - radius);
    expand(center.x + radius, center.y + radius);
  } else if (support.type === 'rectangular') {
    const width = (support as any).width as number;
    const depth = (support as any).depth as number;
    const hw = width / 2;
    const hd = depth / 2;
    // Rotate all four corners and expand bounds
    expandRotated(-hw, -hd);
    expandRotated(hw, -hd);
    expandRotated(hw, hd);
    expandRotated(-hw, hd);
  } else if (support.type === 'conical') {
    // Circles are rotation-invariant
    const radius = (support as any).baseRadius as number;
    expand(center.x - radius, center.y - radius);
    expand(center.x + radius, center.y + radius);
  } else if (support.type === 'custom') {
    const polygon = (support as any).polygon as Array<[number, number]>;
    if (Array.isArray(polygon)) {
      polygon.forEach(([x, z]) => {
        expandRotated(x, z);
      });
    }
  }

  return { minX, maxX, minZ, maxZ };
};

// Fillet radius constant (should match SupportMeshes.tsx)
const FILLET_RADIUS = 2.0;

/**
 * Get all footprint points for a support including fillet margin.
 * These points are used for convex hull calculation.
 * Accounts for support rotation.
 */
export const getSupportFootprintPoints = (support: AnySupport, filletMargin: number = FILLET_RADIUS): Array<{x: number; z: number}> => {
  const { center } = support;
  const points: Array<{x: number; z: number}> = [];
  
  // Get rotation (rotationY takes precedence, fall back to rotationZ for backwards compatibility)
  const rotation = (support as any).rotationY ?? (support as any).rotationZ ?? 0;
  
  // Helper to add a rotated local point
  const addRotatedPoint = (localX: number, localZ: number) => {
    const [rx, rz] = rotatePoint(localX, localZ, rotation);
    points.push({
      x: center.x + rx,
      z: center.y + rz
    });
  };
  
  if (support.type === 'cylindrical') {
    // Circle approximated by 16 points - rotation doesn't affect circles
    const radius = ((support as any).radius as number) + filletMargin;
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        z: center.y + Math.sin(angle) * radius
      });
    }
  } else if (support.type === 'rectangular') {
    const width = (support as any).width as number;
    const depth = (support as any).depth as number;
    const cornerRadius = ((support as any).cornerRadius as number) || 0;
    const hw = width / 2 + filletMargin;
    const hd = depth / 2 + filletMargin;
    
    if (cornerRadius <= 0) {
      // No corner radius - four corners, rotated
      addRotatedPoint(-hw, -hd);
      addRotatedPoint(hw, -hd);
      addRotatedPoint(hw, hd);
      addRotatedPoint(-hw, hd);
    } else {
      // With corner radius - generate arc points at each corner, then rotate
      const r = Math.min(cornerRadius + filletMargin, hw, hd);
      const arcSegments = 4; // segments per corner
      
      // Corner centers (inset by radius from each corner) - in local space
      const corners = [
        { cx: hw - r, cz: hd - r, startAngle: 0 },           // top-right
        { cx: -hw + r, cz: hd - r, startAngle: Math.PI / 2 }, // top-left
        { cx: -hw + r, cz: -hd + r, startAngle: Math.PI },     // bottom-left
        { cx: hw - r, cz: -hd + r, startAngle: 3 * Math.PI / 2 } // bottom-right
      ];
      
      for (const corner of corners) {
        for (let i = 0; i <= arcSegments; i++) {
          const angle = corner.startAngle + (i / arcSegments) * (Math.PI / 2);
          const localX = corner.cx + Math.cos(angle) * r;
          const localZ = corner.cz + Math.sin(angle) * r;
          addRotatedPoint(localX, localZ);
        }
      }
    }
  } else if (support.type === 'conical') {
    // Use base radius (larger) + fillet margin - rotation doesn't affect circles
    const radius = ((support as any).baseRadius as number) + filletMargin;
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        z: center.y + Math.sin(angle) * radius
      });
    }
  } else if (support.type === 'custom') {
    const polygon = (support as any).polygon as Array<[number, number]>;
    
    // Validate polygon
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return points;
    }
    
    // Validate all points are valid numbers
    for (const pt of polygon) {
      if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
        return points;
      }
    }
    
    // Simple approach: compute centroid and offset each vertex outward by filletMargin
    let cx = 0, cz = 0;
    for (const [x, z] of polygon) {
      cx += x;
      cz += z;
    }
    cx /= polygon.length;
    cz /= polygon.length;
    
    // Generate footprint points by offsetting each vertex outward from local centroid, then rotate
    for (const [x, z] of polygon) {
      const dx = x - cx;
      const dz = z - cz;
      const dist = Math.hypot(dx, dz);
      
      if (dist < 0.001) {
        // Point is at centroid, just add it directly (rotated)
        addRotatedPoint(x, z);
      } else {
        // Offset outward from centroid by filletMargin
        const scale = (dist + filletMargin) / dist;
        const localX = cx + dx * scale;
        const localZ = cz + dz * scale;
        addRotatedPoint(localX, localZ);
      }
    }
  }
  
  return points;
};
