/**
 * Clamp Support Utilities
 * 
 * Utilities for creating supports from clamp fixture_mount_surface geometry.
 * The fixture_mount_surface is a thin solid that extends from the clamp base.
 * Its cross-section defines the support polygon, and its top face defines the support height.
 */

import * as THREE from 'three';
import { CustomSupport } from '../Supports/types';
import { PlacedClamp } from './types';

/**
 * Configuration for clamp support generation
 */
export interface ClampSupportConfig {
  /** Corner radius for the extruded support (default: 2mm) */
  cornerRadius?: number;
  /** Contact offset from model (default: 0) */
  contactOffset?: number;
}

/**
 * Information about a clamp's support geometry
 */
export interface ClampSupportInfo {
  /** The polygon outline (2D points in local clamp space, XZ plane) */
  polygon: Array<[number, number]>;
  /** The local Y position of the mount surface bottom in Z-up space (after conversion) */
  mountSurfaceLocalY: number;
  /** Center of the support in local clamp space (XZ plane after conversion) */
  localCenter: THREE.Vector2;
  /** The fixturePointTopCenter Y position in local Z-up space (for height calculation) */
  fixturePointY: number;
  /** Minimum placement offset (distance from fixture point to lowest cutout point) */
  minPlacementOffset: number;
}

/**
 * Extract support polygon from fixture_mount_surface geometry
 * 
 * The fixture_mount_surface is a thin surface marker. We extract:
 * 1. The 2D cross-section polygon (from the XZ plane projection in Z-up space)
 * 2. The local Y position (height of mount surface in Z-up space)
 * 
 * Coordinate systems:
 * - Original OBJ: Y-up (X right, Y up, Z toward viewer)
 * - After Z-up conversion (-90° X rotation): X right, Y = old Z, Z = -old Y
 * 
 * @param geometry The fixture_mount_surface BufferGeometry (already converted to Z-up)
 * @param fixturePointY The Y position of fixturePointTopCenter in local Z-up space
 * @param minPlacementOffset The distance from fixture point to lowest cutout point
 * @returns Support info with polygon and mount surface Y position, or null if extraction fails
 */
export function extractSupportFromMountSurface(
  geometry: THREE.BufferGeometry,
  fixturePointY: number = 0,
  minPlacementOffset: number = 0
): ClampSupportInfo | null {
  if (!geometry || !geometry.attributes.position) {
    console.warn('[ClampSupport] No geometry or position attribute');
    return null;
  }

  const positions = geometry.attributes.position;
  const vertexCount = positions.count;

  if (vertexCount < 3) {
    console.warn('[ClampSupport] Not enough vertices');
    return null;
  }

  // Compute bounding box
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  
  // After Z-up conversion:
  // - Original Z becomes Y (the "up" direction in Z-up space)
  // - Original Y becomes -Z (depth, negated)
  // - X stays X
  // 
  // The mount surface is a thin shape in the XZ plane with a small Y extent
  // We need the min Y (bottom of the mount surface in local space)
  const mountSurfaceLocalY = bbox.min.y;
  
  console.log('[ClampSupport] Mount surface bbox:', {
    minY: bbox.min.y,
    maxY: bbox.max.y,
    minX: bbox.min.x,
    maxX: bbox.max.x,
    minZ: bbox.min.z,
    maxZ: bbox.max.z,
  });
  
  // For simplicity, use a rectangular polygon based on the bounding box
  // This ensures we get a proper solid support shape
  // The polygon points are [x, z] pairs in the XZ plane
  const minX = bbox.min.x;
  const maxX = bbox.max.x;
  const minZ = bbox.min.z;
  const maxZ = bbox.max.z;
  
  // Create rectangle polygon (counter-clockwise when viewed from above/+Y)
  const polygon: Array<[number, number]> = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
  
  // Calculate center
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  console.log('[ClampSupport] Extracted support info (bbox-based):', {
    polygon,
    mountSurfaceLocalY,
    fixturePointY,
    minPlacementOffset,
    center: { x: cx, z: cz },
    width: maxX - minX,
    depth: maxZ - minZ,
  });

  return {
    polygon,
    mountSurfaceLocalY,
    localCenter: new THREE.Vector2(cx, cz),
    fixturePointY,
    minPlacementOffset,
  };
}

/**
 * Compute convex hull using Graham scan algorithm
 */
function computeConvexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points;

  // Find the point with lowest Y (and leftmost if tie)
  let lowestIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i][1] < points[lowestIdx][1] ||
        (points[i][1] === points[lowestIdx][1] && points[i][0] < points[lowestIdx][0])) {
      lowestIdx = i;
    }
  }

  // Swap to put lowest point first
  [points[0], points[lowestIdx]] = [points[lowestIdx], points[0]];
  const pivot = points[0];

  // Sort remaining points by polar angle with respect to pivot
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
    const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
    if (Math.abs(angleA - angleB) < 1e-10) {
      // Same angle - sort by distance
      const distA = (a[0] - pivot[0]) ** 2 + (a[1] - pivot[1]) ** 2;
      const distB = (b[0] - pivot[0]) ** 2 + (b[1] - pivot[1]) ** 2;
      return distA - distB;
    }
    return angleA - angleB;
  });

  // Graham scan
  const hull: Array<[number, number]> = [pivot];
  
  for (const point of sorted) {
    // Remove points that make a clockwise turn
    while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }

  return hull;
}

/**
 * Cross product of vectors OA and OB where O is origin point
 */
function crossProduct(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Create a CustomSupport from a placed clamp
 * 
 * Coordinate systems:
 * - Clamp local space (after Z-up conversion): X, Y are horizontal, Z is up
 * - Three.js world space: X, Z are horizontal, Y is up
 * - Support space: center is Vector2(worldX, worldZ), height is along Y
 * 
 * @param placedClamp The placed clamp instance
 * @param supportInfo The extracted support info from fixture_mount_surface (in clamp local Z-up coords)
 * @param baseTopY The Y position of the baseplate top (Three.js Y-up world coords)
 * @param config Optional support configuration
 * @returns A CustomSupport object or null
 */
export function createClampSupport(
  placedClamp: PlacedClamp,
  supportInfo: ClampSupportInfo,
  baseTopY: number = 0,
  config: ClampSupportConfig = {}
): CustomSupport | null {
  const { cornerRadius = 2, contactOffset = 0 } = config;

  // Transform the polygon from clamp local space to Three.js world space
  // 
  // After Z-up conversion, clamp local space is:
  // - X is right (same as Three.js world X)
  // - Y is up (same as Three.js world Y)
  // - Z is forward (same as Three.js world Z)
  //
  // The polygon points are [localX, localZ] in the horizontal XZ plane.
  // placedClamp.rotation.y is the rotation around the Y axis (vertical).
  const rotationY = THREE.MathUtils.degToRad(placedClamp.rotation.y);
  const cosR = Math.cos(rotationY);
  const sinR = Math.sin(rotationY);

  // Transform each polygon point from clamp local XZ to world XZ
  // polygon[i] is [localX, localZ] in clamp's horizontal plane (after Z-up conversion)
  const worldPolygon: Array<[number, number]> = supportInfo.polygon.map(([localX, localZ]) => {
    // Apply Y-axis rotation (rotation in the XZ horizontal plane)
    // Standard rotation around Y axis:
    // newX = x * cos(θ) - z * sin(θ)
    // newZ = x * sin(θ) + z * cos(θ)
    const rotatedX = localX * cosR - localZ * sinR;
    const rotatedZ = localX * sinR + localZ * cosR;
    
    // Add clamp world position
    const worldX = rotatedX + placedClamp.position.x;
    const worldZ = rotatedZ + placedClamp.position.z;
    
    return [worldX, worldZ] as [number, number];
  });

  // Calculate world center in XZ plane
  let centerX = 0, centerZ = 0;
  for (const [x, z] of worldPolygon) {
    centerX += x;
    centerZ += z;
  }
  centerX /= worldPolygon.length;
  centerZ /= worldPolygon.length;

  // Convert polygon to be relative to center
  const centeredPolygon: Array<[number, number]> = worldPolygon.map(([x, z]) => [
    x - centerX,
    z - centerZ,
  ]);

  // Calculate height: support goes from baseTopY up to the mount surface bottom
  // 
  // In the clamp's local Z-up coordinate system:
  // - fixturePointY = Y position of the pivot point (fixturePointTopCenter)
  // - mountSurfaceLocalY = Y position of the mount surface bottom
  // 
  // When the clamp is placed at world position.y:
  // - The pivot point is at world Y = placedClamp.position.y
  // - The mount surface bottom is at:
  //   worldMountSurfaceY = placedClamp.position.y + (mountSurfaceLocalY - fixturePointY)
  //
  // The support fills from baseTopY up to worldMountSurfaceY
  const mountSurfaceWorldY = placedClamp.position.y + 
    (supportInfo.mountSurfaceLocalY - supportInfo.fixturePointY);
  
  const supportHeight = mountSurfaceWorldY - baseTopY;

  console.log('[ClampSupport] Height calculation:', {
    clampPositionY: placedClamp.position.y,
    mountSurfaceLocalY: supportInfo.mountSurfaceLocalY,
    fixturePointY: supportInfo.fixturePointY,
    mountSurfaceWorldY,
    baseTopY,
    supportHeight,
  });

  // Minimum support height threshold (mm)
  // If the support is too short, don't create it
  const MIN_SUPPORT_HEIGHT = 1.0;

  if (supportHeight < MIN_SUPPORT_HEIGHT) {
    console.log('[ClampSupport] Support height below threshold, skipping:', supportHeight);
    return null;
  }

  return {
    id: `clamp-support-${placedClamp.id}`,
    type: 'custom',
    center: new THREE.Vector2(centerX, centerZ),
    height: supportHeight,
    baseY: baseTopY,
    polygon: centeredPolygon,
    cornerRadius,
    contactOffset,
    rotationY: 0, // Rotation already applied to polygon
  };
}

/**
 * Type guard to check if a support is a clamp support
 */
export function isClampSupport(supportId: string): boolean {
  return supportId.startsWith('clamp-support-');
}

/**
 * Extract clamp ID from a clamp support ID
 */
export function getClampIdFromSupportId(supportId: string): string | null {
  if (!isClampSupport(supportId)) return null;
  return supportId.replace('clamp-support-', '');
}
