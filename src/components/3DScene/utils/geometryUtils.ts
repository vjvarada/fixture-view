/**
 * Geometry and computation utilities for 3DScene
 */

import * as THREE from 'three';
import type { BoundsSummary, FootprintMetrics, OrientationConfigMap, ProjectedSize } from '../types';
import { ViewOrientation } from '@/modules/FileImport/types';
import type { LabelConfig } from '@/features/labels';

// =============================================================================
// Geometry Computation
// =============================================================================

/**
 * Compute the dominant up direction quaternion from geometry normals.
 * Used for auto-orienting models to stand upright.
 */
export const computeDominantUpQuaternion = (geometry: THREE.BufferGeometry): THREE.Quaternion | null => {
  const positionAttribute = geometry.attributes.position;
  if (!positionAttribute) {
    return null;
  }

  const normalsMap = new Map<string, { normal: THREE.Vector3; area: number }>();
  const up = new THREE.Vector3(0, 1, 0);
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  const accumulateNormal = (normal: THREE.Vector3, area: number) => {
    if (!Number.isFinite(area) || area <= 1e-6) {
      return;
    }

    const dir = normal.clone().normalize();
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z)) {
      return;
    }

    const key = `${Math.round(dir.x * 25)},${Math.round(dir.y * 25)},${Math.round(dir.z * 25)}`;
    const entry = normalsMap.get(key);
    if (entry) {
      entry.normal.addScaledVector(dir, area);
      entry.area += area;
    } else {
      normalsMap.set(key, { normal: dir.clone().multiplyScalar(area), area });
    }
  };

  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);

      vA.fromBufferAttribute(positionAttribute, a);
      vB.fromBufferAttribute(positionAttribute, b);
      vC.fromBufferAttribute(positionAttribute, c);

      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      const normal = cb.cross(ab);
      const area = normal.length() * 0.5;
      if (area > 0) {
        accumulateNormal(normal, area);
      }
    }
  } else {
    for (let i = 0; i < positionAttribute.count; i += 3) {
      vA.fromBufferAttribute(positionAttribute, i);
      vB.fromBufferAttribute(positionAttribute, i + 1);
      vC.fromBufferAttribute(positionAttribute, i + 2);

      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      const normal = cb.cross(ab);
      const area = normal.length() * 0.5;
      if (area > 0) {
        accumulateNormal(normal, area);
      }
    }
  }

  let bestEntry: { normal: THREE.Vector3; area: number } | null = null;
  normalsMap.forEach(entry => {
    if (!bestEntry || entry.area > bestEntry.area) {
      bestEntry = { normal: entry.normal.clone(), area: entry.area };
    }
  });

  if (!bestEntry) {
    return null;
  }

  const dominantNormal = bestEntry.normal.normalize();
  if (dominantNormal.lengthSq() < 1e-6) {
    return null;
  }

  if (dominantNormal.y < 0) {
    dominantNormal.negate();
  }

  if (dominantNormal.angleTo(up) < 1e-3) {
    return null;
  }

  const quaternion = new THREE.Quaternion().setFromUnitVectors(dominantNormal, up);
  return quaternion;
};

/**
 * Get the actual minimum Y value from mesh geometry vertices in world space.
 * Uses actual mesh vertices instead of bounding box for more accurate
 * collision detection with the buildplate.
 */
export const getActualMinYFromMesh = (object: THREE.Object3D): number => {
  let minY = Infinity;
  const worldVertex = new THREE.Vector3();
  
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry;
      const positionAttribute = geometry.getAttribute('position');
      
      if (positionAttribute) {
        child.updateMatrixWorld(true);
        const worldMatrix = child.matrixWorld;
        
        for (let i = 0; i < positionAttribute.count; i++) {
          worldVertex.set(
            positionAttribute.getX(i),
            positionAttribute.getY(i),
            positionAttribute.getZ(i)
          );
          worldVertex.applyMatrix4(worldMatrix);
          
          if (worldVertex.y < minY) {
            minY = worldVertex.y;
          }
        }
      }
    }
  });
  
  return minY === Infinity ? 0 : minY;
};

// =============================================================================
// Footprint Metrics
// =============================================================================

/**
 * Calculate footprint metrics for baseplate sizing based on model bounds.
 */
export const getFootprintMetrics = (bounds: BoundsSummary | null): FootprintMetrics => {
  if (!bounds) {
    return {
      radius: 25,
      padding: 12,
      halfLength: 37,
    };
  }

  const unitsScale = bounds.unitsScale ?? 1;
  const sizeX = Math.max(bounds.size.x, 0) * unitsScale;
  const sizeZ = Math.max(bounds.size.z, 0) * unitsScale;
  const longestHalfEdge = Math.max(sizeX, sizeZ) * 0.5;
  const padding = Math.max(longestHalfEdge * 0.35, 5);
  const halfLength = Math.max(longestHalfEdge + padding, longestHalfEdge + 5, longestHalfEdge * 1.5, 36);

  return { radius: longestHalfEdge, padding, halfLength };
};

// =============================================================================
// View Orientation
// =============================================================================

export const ORIENTATION_CONFIG: OrientationConfigMap = {
  front: { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  back: { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  left: { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  right: { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  bottom: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  iso: { direction: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) },
};

/**
 * Get the projected size for a given orientation (for camera fitting).
 */
export const getProjectedSizeForOrientation = (
  bounds: BoundsSummary,
  orientation: ViewOrientation
): ProjectedSize => {
  const { size } = bounds;
  switch (orientation) {
    case 'front':
    case 'back':
      return { horizontal: size.x, vertical: size.y };
    case 'left':
    case 'right':
      return { horizontal: size.z, vertical: size.y };
    case 'top':
    case 'bottom':
      return { horizontal: size.x, vertical: size.z };
    case 'iso':
    default:
      const diagonal = Math.max(size.x, size.y, size.z);
      return { horizontal: diagonal, vertical: diagonal };
  }
};

// =============================================================================
// Grid Configuration
// =============================================================================

/**
 * Calculate grid configuration based on model bounds.
 */
export const calculateGridConfig = (modelBounds: BoundsSummary | null) => {
  if (!modelBounds) {
    return { size: 200, divisions: 20, majorDivisions: 4, cellSize: 10 };
  }
  
  const maxExtentX = Math.max(Math.abs(modelBounds.min.x), Math.abs(modelBounds.max.x));
  const maxExtentZ = Math.max(Math.abs(modelBounds.min.z), Math.abs(modelBounds.max.z));
  const maxExtent = Math.max(maxExtentX, maxExtentZ);
  
  const rawSize = maxExtent * 2 * 1.2;
  
  const niceValues = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  let gridSize = niceValues[0];
  for (const val of niceValues) {
    if (val >= rawSize) {
      gridSize = val;
      break;
    }
    gridSize = val;
  }
  
  const cellSizes = [1, 5, 10, 25, 50, 100, 250, 500];
  let cellSize = 10;
  for (const cs of cellSizes) {
    if (gridSize / cs <= 50) {
      cellSize = cs;
      break;
    }
  }
  
  const divisions = Math.floor(gridSize / cellSize);
  const majorDivisions = cellSize >= 100 ? 1 : (cellSize >= 25 ? 4 : 10);
  
  return { size: gridSize, divisions, majorDivisions, cellSize };
};
