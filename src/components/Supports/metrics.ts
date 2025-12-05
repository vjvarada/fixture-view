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
 
const unitVecUp = new THREE.Vector3(0, 1, 0);
const unitVecDown = new THREE.Vector3(0, -1, 0);

const tempOrigin = new THREE.Vector3();

export const getSupportSamples = (support: AnySupport): Array<[number, number]> => {
  const { center } = support;
  const samples: Array<[number, number]> = [[center.x, center.y]];

  if (support.type === 'cylindrical') {
    const r = Math.max(1, (support as any).radius as number);
    const d = Math.SQRT1_2;
    const spreads: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [d, d],
      [d, -d],
      [-d, d],
      [-d, -d],
    ];
    spreads.forEach(([dx, dz]) => samples.push([center.x + dx * r, center.y + dz * r]));
  } else if (support.type === 'rectangular') {
    const width = (support as any).width as number;
    const depth = (support as any).depth as number;
    const hw = width / 2;
    const hd = depth / 2;
    const corners: Array<[number, number]> = [
      [-hw, -hd],
      [-hw, hd],
      [hw, hd],
      [hw, -hd],
    ];
    corners.forEach(([dx, dz]) => samples.push([center.x + dx, center.y + dz]));
  } else if (support.type === 'conical') {
    const r = Math.max(1, (support as any).baseRadius as number);
    const d = Math.SQRT1_2;
    const spreads: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [d, d],
      [d, -d],
      [-d, d],
      [-d, -d],
    ];
    spreads.forEach(([dx, dz]) => samples.push([center.x + dx * r, center.y + dz * r]));
  } else if (support.type === 'custom') {
    const polygon = (support as any).polygon as Array<[number, number]>;
    if (Array.isArray(polygon)) {
      polygon.forEach(([x, z]) => samples.push([center.x + x, center.y + z]));
      for (let i = 0; i < polygon.length; i++) {
        const [ax, az] = polygon[i];
        const [bx, bz] = polygon[(i + 1) % polygon.length];
        samples.push([center.x + (ax + bx) / 2, center.y + (az + bz) / 2]);
      }
      const maxRadius = polygon.reduce((max, [x, z]) => Math.max(max, Math.hypot(x, z)), 0);
      if (maxRadius > 0.5) {
        const r = Math.max(1, maxRadius * 0.75);
        const d = Math.SQRT1_2;
        const dirs: Array<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [d, d],
          [d, -d],
          [-d, d],
          [-d, -d],
        ];
        dirs.forEach(([dx, dz]) => samples.push([center.x + dx * r, center.y + dz * r]));
      }
    }
  }

  return samples;
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

export const getSupportFootprintBounds = (support: AnySupport): FootprintBounds => {
  const { center } = support;
  let minX = center.x;
  let maxX = center.x;
  let minZ = center.y;
  let maxZ = center.y;

  const expand = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };

  if (support.type === 'cylindrical') {
    const radius = (support as any).radius as number;
    expand(center.x - radius, center.y - radius);
    expand(center.x + radius, center.y + radius);
  } else if (support.type === 'rectangular') {
    const width = (support as any).width as number;
    const depth = (support as any).depth as number;
    const hw = width / 2;
    const hd = depth / 2;
    expand(center.x - hw, center.y - hd);
    expand(center.x + hw, center.y + hd);
  } else if (support.type === 'conical') {
    const radius = (support as any).baseRadius as number;
    expand(center.x - radius, center.y - radius);
    expand(center.x + radius, center.y + radius);
  } else if (support.type === 'custom') {
    const polygon = (support as any).polygon as Array<[number, number]>;
    if (Array.isArray(polygon)) {
      polygon.forEach(([x, z]) => {
        expand(center.x + x, center.y + z);
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
 */
export const getSupportFootprintPoints = (support: AnySupport, filletMargin: number = FILLET_RADIUS): Array<{x: number; z: number}> => {
  const { center } = support;
  const points: Array<{x: number; z: number}> = [];
  
  if (support.type === 'cylindrical') {
    // Circle approximated by 16 points
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
      // No corner radius - four corners
      points.push({ x: center.x - hw, z: center.y - hd });
      points.push({ x: center.x + hw, z: center.y - hd });
      points.push({ x: center.x + hw, z: center.y + hd });
      points.push({ x: center.x - hw, z: center.y + hd });
    } else {
      // With corner radius - generate arc points at each corner
      const r = Math.min(cornerRadius + filletMargin, hw, hd);
      const arcSegments = 4; // segments per corner
      
      // Corner centers (inset by radius from each corner)
      const corners = [
        { cx: center.x + hw - r, cz: center.y + hd - r, startAngle: 0 },           // top-right
        { cx: center.x - hw + r, cz: center.y + hd - r, startAngle: Math.PI / 2 }, // top-left
        { cx: center.x - hw + r, cz: center.y - hd + r, startAngle: Math.PI },     // bottom-left
        { cx: center.x + hw - r, cz: center.y - hd + r, startAngle: 3 * Math.PI / 2 } // bottom-right
      ];
      
      for (const corner of corners) {
        for (let i = 0; i <= arcSegments; i++) {
          const angle = corner.startAngle + (i / arcSegments) * (Math.PI / 2);
          points.push({
            x: corner.cx + Math.cos(angle) * r,
            z: corner.cz + Math.sin(angle) * r
          });
        }
      }
    }
  } else if (support.type === 'conical') {
    // Use base radius (larger) + fillet margin
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
    const cornerRadius = ((support as any).cornerRadius as number) || 0;
    
    if (Array.isArray(polygon) && polygon.length >= 3) {
      if (cornerRadius <= 0) {
        // No corner radius - offset each vertex outward by filletMargin
        // First compute centroid of the polygon
        let cx = 0, cz = 0;
        for (const [x, z] of polygon) {
          cx += x;
          cz += z;
        }
        cx /= polygon.length;
        cz /= polygon.length;
        
        // Offset each point outward from the local centroid
        for (const [x, z] of polygon) {
          const dx = x - cx;
          const dz = z - cz;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.001) {
            points.push({ x: center.x + x, z: center.y + z });
          } else {
            const scale = (dist + filletMargin) / dist;
            points.push({
              x: center.x + cx + dx * scale,
              z: center.y + cz + dz * scale
            });
          }
        }
      } else {
        // With corner radius - generate arc points at each corner
        const n = polygon.length;
        const arcSegments = 4;
        const totalMargin = cornerRadius + filletMargin;
        
        for (let i = 0; i < n; i++) {
          const prev = polygon[(i - 1 + n) % n];
          const curr = polygon[i];
          const next = polygon[(i + 1) % n];
          
          // Vectors to prev and next vertices
          const toPrev = [prev[0] - curr[0], prev[1] - curr[1]];
          const toNext = [next[0] - curr[0], next[1] - curr[1]];
          const lenPrev = Math.hypot(toPrev[0], toPrev[1]);
          const lenNext = Math.hypot(toNext[0], toNext[1]);
          
          if (lenPrev < 0.01 || lenNext < 0.01) {
            // Degenerate corner - just add the point with offset
            points.push({ x: center.x + curr[0], z: center.y + curr[1] });
            continue;
          }
          
          // Clamp radius to half the shortest edge
          const r = Math.min(totalMargin, lenPrev / 2, lenNext / 2);
          
          // Normalize directions
          const dirPrev = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
          const dirNext = [toNext[0] / lenNext, toNext[1] / lenNext];
          
          // Calculate the bisector direction (outward)
          const bisectorX = -(dirPrev[0] + dirNext[0]);
          const bisectorZ = -(dirPrev[1] + dirNext[1]);
          const bisectorLen = Math.hypot(bisectorX, bisectorZ);
          
          if (bisectorLen < 0.01) {
            // Nearly straight corner
            points.push({ x: center.x + curr[0], z: center.y + curr[1] });
            continue;
          }
          
          // Calculate angle between edges
          const dot = dirPrev[0] * dirNext[0] + dirPrev[1] * dirNext[1];
          const angle = Math.acos(Math.max(-1, Math.min(1, -dot)));
          
          // Find arc center - it's along the bisector at distance r / sin(angle/2)
          const halfAngle = angle / 2;
          const sinHalf = Math.sin(halfAngle);
          if (sinHalf < 0.01) {
            points.push({ x: center.x + curr[0], z: center.y + curr[1] });
            continue;
          }
          
          const centerDist = r / sinHalf;
          const arcCenterX = curr[0] + (bisectorX / bisectorLen) * centerDist;
          const arcCenterZ = curr[1] + (bisectorZ / bisectorLen) * centerDist;
          
          // Calculate start and end angles for the arc
          const startAngle = Math.atan2(curr[1] + dirPrev[1] * r - arcCenterZ, curr[0] + dirPrev[0] * r - arcCenterX);
          const endAngle = Math.atan2(curr[1] + dirNext[1] * r - arcCenterZ, curr[0] + dirNext[0] * r - arcCenterX);
          
          // Generate arc points
          for (let j = 0; j <= arcSegments; j++) {
            const t = j / arcSegments;
            // Interpolate angle (handling wrap-around)
            let angleDiff = endAngle - startAngle;
            if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            const a = startAngle + t * angleDiff;
            
            points.push({
              x: center.x + arcCenterX + Math.cos(a) * r,
              z: center.y + arcCenterZ + Math.sin(a) * r
            });
          }
        }
      }
    }
  }
  
  return points;
};
