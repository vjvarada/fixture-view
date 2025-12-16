/**
 * Clamp Placement Utilities
 * 
 * Handles the positioning logic for clamps on workpieces.
 * 
 * For vertical clamps:
 * 1. User clicks on part surface to place the fixture point
 * 2. Raycast to find the click point on the part
 * 3. Position clamp so fixture point touches the part surface
 * 4. Position clamp support OUTSIDE the part silhouette
 */

import * as THREE from 'three';
import { PlacedClamp } from './types';
import { AnySupport } from '../Supports/types';

// ============================================================================
// Constants
// ============================================================================

/** Maximum distance (mm) to search for a clear clamp position */
const MAX_ADJUSTMENT_DISTANCE = 200;

/** Step size (mm) for iterative position searching */
const POSITION_SEARCH_STEP = 1;

/** Resolution for silhouette rendering (pixels) */
const SILHOUETTE_RESOLUTION = 512;

/** Padding around silhouette bounds (mm) */
const SILHOUETTE_PADDING = 5;

/** Minimum angle (radians) for a surface to be considered "top-facing" */
const MIN_TOP_SURFACE_ANGLE = 0.1;

/** Clearance (mm) between support and part boundary */
const SUPPORT_CLEARANCE = 2;

// ============================================================================
// Types
// ============================================================================

/** 2D point on the XZ plane */
export type Point2D = { x: number; z: number };

/** 3D position */
export type Position3D = { x: number; y: number; z: number };

/** 3D rotation in degrees */
export type Rotation3D = { x: number; y: number; z: number };

/** Polygon represented as an array of 2D points */
export type Polygon2D = Array<Point2D>;

/** Local space polygon coordinates as [x, z] tuples */
export type LocalPolygon = Array<[number, number]>;

/**
 * Result of clamp placement calculation
 */
export interface ClampPlacementResult {
  /** Calculated position for the clamp (fixture point center) */
  position: THREE.Vector3;
  /** Calculated rotation in degrees */
  rotation: { x: number; y: number; z: number };
  /** Whether placement was successful */
  success: boolean;
  /** Error message if placement failed */
  error?: string;
  /** Debug info for visualization */
  debugPoints?: {
    closestBoundaryPoint: { x: number; y: number; z: number };
    fixturePoint: { x: number; y: number; z: number };
    estimatedSupportCenter: { x: number; y: number; z: number };
  };
}

/**
 * Options for clamp placement
 */
export interface ClampPlacementOptions {
  /** The point where user clicked (world coordinates) */
  clickPoint: THREE.Vector3;
  /** Normal of the surface at click point */
  surfaceNormal: THREE.Vector3;
  /** Part mesh that was clicked */
  partMesh: THREE.Object3D;
  /** All part meshes in the scene */
  allPartMeshes: THREE.Object3D[];
  /** Part silhouette points (XZ plane) */
  partSilhouette: Array<{ x: number; z: number }>;
  /** Already placed supports */
  existingSupports: AnySupport[];
  /** Already placed clamps */
  existingClamps: PlacedClamp[];
  /** Y position of baseplate top */
  baseTopY: number;
  /** Minimum placement offset (from fixture cutouts) */
  minPlacementOffset: number;
  /** Clamp support footprint size (approximate) */
  supportFootprintSize?: { width: number; depth: number };
  /** Clearance from silhouette edge */
  silhouetteClearance?: number;
  /** Clamp category (vertical or side-push) */
  clampCategory: 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push';
  /** Estimated support center offset from fixture point (local space, for initial placement) */
  estimatedSupportOffset?: { x: number; z: number };
}

/**
 * Result of collision adjustment
 */
export interface CollisionAdjustmentResult {
  /** Adjusted position */
  position: { x: number; y: number; z: number };
  /** Adjusted rotation in degrees */
  rotation: { x: number; y: number; z: number };
  /** Whether adjustment was needed */
  wasAdjusted: boolean;
  /** Description of adjustment made */
  adjustmentReason?: string;
}

// ============================================================================
// Main Placement Functions
// ============================================================================

/**
 * Calculate the optimal position for a vertical clamp
 * 
 * Initial placement rules:
 * 1. Rotate clamp so that: silhouette centroid → fixture point → support center are collinear
 * 2. Move fixture point outward along this line until support clears the silhouette
 * 3. Drop to surface height
 */
export function calculateVerticalClampPlacement(
  options: ClampPlacementOptions
): ClampPlacementResult {
  const {
    clickPoint,
    partSilhouette,
    baseTopY,
    minPlacementOffset,
    silhouetteClearance = SUPPORT_CLEARANCE,
    estimatedSupportOffset = { x: 40, z: 0 }, // Default: support is 40mm to the +X side of fixture point
  } = options;

  // For vertical clamps, the fixture point should rest on top of the part
  // Ensure it's above the minimum clearance from baseplate
  const fixturePointY = Math.max(
    clickPoint.y,
    baseTopY + minPlacementOffset
  );

  // Find the closest point on the silhouette boundary to the fixture point
  const closestBoundary = getClosestPointOnSilhouette(
    { x: clickPoint.x, z: clickPoint.z },
    partSilhouette
  );
  
  // Calculate direction FROM fixture point TO closest boundary point
  // The support should be placed along this direction, past the boundary (outside the part)
  // Line goes: GREEN (fixture) -> RED (boundary) -> BLUE (support)
  let towardBoundaryDir = new THREE.Vector2(
    closestBoundary.x - clickPoint.x,
    closestBoundary.z - clickPoint.z
  );
  
  if (towardBoundaryDir.length() < 0.01) {
    // Click is at boundary, use outward normal direction from boundary
    towardBoundaryDir = new THREE.Vector2(closestBoundary.normalX || 1, closestBoundary.normalZ || 0);
  }
  towardBoundaryDir.normalize();
  
  // Calculate rotation so that support center is collinear: fixture -> boundary -> support
  // The support is at local +X, so we want local +X to point in the towardBoundary direction
  // For Y-axis rotation: to align +X with direction (dx, dz), use atan2(dz, dx)
  // But we need to account for THREE.js coordinate system
  const rotationY = Math.atan2(-towardBoundaryDir.y, towardBoundaryDir.x) * (180 / Math.PI);
  
  // Now we need to push the fixture point along the direction until the support clears the silhouette
  // Calculate where the support center will be in world space
  const rotRad = THREE.MathUtils.degToRad(rotationY);
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  
  // Transform support offset from local to world (rotate by clamp rotation)
  // Local coordinate: supportOffset.x = local X, supportOffset.z = local Z
  // Y-axis rotation: newX = x*cos + z*sin, newZ = -x*sin + z*cos
  const supportOffsetWorld = {
    x: estimatedSupportOffset.x * cosR + estimatedSupportOffset.z * sinR,
    z: -estimatedSupportOffset.x * sinR + estimatedSupportOffset.z * cosR
  };
  
  // Start with fixture point at click position
  let fixtureX = clickPoint.x;
  let fixtureZ = clickPoint.z;
  
  // Check if support center would be inside silhouette
  // Move fixture point along towardBoundary direction until support clears
  const maxPushDistance = MAX_ADJUSTMENT_DISTANCE;
  const stepSize = 2;
  
  for (let dist = 0; dist <= maxPushDistance; dist += stepSize) {
    const testFixtureX = clickPoint.x + towardBoundaryDir.x * dist;
    const testFixtureZ = clickPoint.z + towardBoundaryDir.y * dist;
    
    // Calculate where support center would be
    const supportCenterX = testFixtureX + supportOffsetWorld.x;
    const supportCenterZ = testFixtureZ + supportOffsetWorld.z;
    
    // Check if support center is outside silhouette with clearance
    const supportInsideSilhouette = isPointInsidePolygon(
      { x: supportCenterX, z: supportCenterZ },
      partSilhouette
    );
    
    if (!supportInsideSilhouette) {
      // Also check clearance from silhouette edge
      const distToEdge = distanceToSilhouetteEdge(
        { x: supportCenterX, z: supportCenterZ },
        partSilhouette
      );
      
      if (distToEdge >= silhouetteClearance) {
        // Found valid position
        fixtureX = testFixtureX;
        fixtureZ = testFixtureZ;
        break;
      }
    }
    
    // Update fixture position even if not yet clear (in case we reach max distance)
    fixtureX = testFixtureX;
    fixtureZ = testFixtureZ;
  }

  // The final clamp position is at the fixture point
  const clampPosition = new THREE.Vector3(
    fixtureX,
    fixturePointY,
    fixtureZ
  );

  // Calculate final support center position for debug
  const finalSupportCenterX = fixtureX + supportOffsetWorld.x;
  const finalSupportCenterZ = fixtureZ + supportOffsetWorld.z;

  return {
    position: clampPosition,
    rotation: { x: 0, y: rotationY, z: 0 },
    success: true,
    debugPoints: {
      closestBoundaryPoint: { x: closestBoundary.x, y: fixturePointY, z: closestBoundary.z },
      fixturePoint: { x: fixtureX, y: fixturePointY, z: fixtureZ },
      estimatedSupportCenter: { x: finalSupportCenterX, y: fixturePointY, z: finalSupportCenterZ },
    },
  };
}

/**
 * Adjust clamp position after support data is loaded.
 * Uses 2D silhouette math to ensure support polygon is outside the part boundary.
 * Moves fixture point along the line (fixture → boundary) until support clears.
 * 
 * @param clampPosition Current fixture point position
 * @param clampRotation Clamp rotation (Y rotation matters for support orientation)
 * @param supportPolygon Support footprint polygon in local space [x, z] pairs
 * @param closestBoundaryPoint The closest point on silhouette boundary (RED sphere)
 * @param partSilhouette Part silhouette polygon in world XZ space
 * @param silhouetteClearance Minimum clearance from silhouette edge (mm)
 */
export function adjustClampAfterDataLoad(
  clampPosition: { x: number; y: number; z: number },
  clampRotation: { x: number; y: number; z: number },
  supportPolygon: Array<[number, number]>,
  closestBoundaryPoint: { x: number; z: number } | null,
  partSilhouette: Array<{ x: number; z: number }>,
  silhouetteClearance: number = SUPPORT_CLEARANCE
): { position: { x: number; y: number; z: number }; adjusted: boolean } {
  if (supportPolygon.length === 0 || !partSilhouette || partSilhouette.length < 3) {
    return { position: clampPosition, adjusted: false };
  }
  
  const rotRad = THREE.MathUtils.degToRad(clampRotation.y);
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  
  // Function to transform support polygon to world space given a fixture position
  const transformSupportToWorld = (fixtureX: number, fixtureZ: number) => {
    return supportPolygon.map(([lx, lz]) => ({
      x: fixtureX + lx * cosR + lz * sinR,
      z: fixtureZ - lx * sinR + lz * cosR
    }));
  };
  
  // Function to check if support polygon overlaps with silhouette or is too close to boundary
  // Returns overlaps=true if ANY vertex is inside OR within clearance distance of the boundary
  const checkSupportOverlap = (fixtureX: number, fixtureZ: number): { overlaps: boolean; maxPenetration: number } => {
    const worldSupport = transformSupportToWorld(fixtureX, fixtureZ);
    let maxPenetration = 0;
    let overlaps = false;
    
    for (const vertex of worldSupport) {
      const isInside = isPointInsidePolygon(vertex, partSilhouette);
      const distToEdge = distanceToSilhouetteEdge(vertex, partSilhouette);
      
      if (isInside) {
        // Vertex is inside silhouette - need to move out by distToEdge + clearance
        overlaps = true;
        maxPenetration = Math.max(maxPenetration, distToEdge + silhouetteClearance);
      } else if (distToEdge < silhouetteClearance) {
        // Vertex is outside but within clearance zone - need to move out more
        overlaps = true;
        maxPenetration = Math.max(maxPenetration, silhouetteClearance - distToEdge);
      }
    }
    
    return { overlaps, maxPenetration };
  };
  
  // Check initial overlap
  const initialCheck = checkSupportOverlap(clampPosition.x, clampPosition.z);
  
  if (!initialCheck.overlaps) {
    return { position: clampPosition, adjusted: false };
  }
  
  // Calculate direction to move: from fixture point TOWARD boundary point
  // This is the YELLOW LINE direction
  let moveDir: THREE.Vector2;
  
  if (closestBoundaryPoint) {
    moveDir = new THREE.Vector2(
      closestBoundaryPoint.x - clampPosition.x,
      closestBoundaryPoint.z - clampPosition.z
    );
  } else {
    // Fallback: use centroid-based outward direction
    const centroid = getSilhouetteCenter(partSilhouette);
    moveDir = new THREE.Vector2(
      clampPosition.x - centroid.x,
      clampPosition.z - centroid.z
    );
  }
  
  if (moveDir.length() < 0.01) {
    moveDir.set(1, 0);
  }
  moveDir.normalize();
  
  // Iteratively move fixture point along the direction until support clears
  const maxMoveDistance = MAX_ADJUSTMENT_DISTANCE;
  const stepSize = 1; // 1mm steps for precision
  
  let newFixtureX = clampPosition.x;
  let newFixtureZ = clampPosition.z;
  let foundClearPosition = false;
  
  for (let dist = stepSize; dist <= maxMoveDistance; dist += stepSize) {
    const testX = clampPosition.x + moveDir.x * dist;
    const testZ = clampPosition.z + moveDir.y * dist;
    
    const check = checkSupportOverlap(testX, testZ);
    
    if (!check.overlaps) {
      newFixtureX = testX;
      newFixtureZ = testZ;
      foundClearPosition = true;
      break;
    }
  }
  
  if (!foundClearPosition) {
    // Use the max penetration to estimate required move distance
    const estimatedMove = initialCheck.maxPenetration;
    newFixtureX = clampPosition.x + moveDir.x * estimatedMove;
    newFixtureZ = clampPosition.z + moveDir.y * estimatedMove;
  }
  
  return {
    position: {
      x: newFixtureX,
      y: clampPosition.y,
      z: newFixtureZ
    },
    adjusted: true
  };
}

/**
 * Adjust clamp HEIGHT when pivot controls are CLOSED.
 * 
 * SIMPLIFIED: ONLY adjusts Y position (height).
 * Does NOT change rotation or XZ position.
 * 
 * Drops the clamp so fixture point bottom sits ON TOP of the part surface.
 */
export function adjustClampPositionAfterTransform(
  clampPosition: { x: number; y: number; z: number },
  clampRotation: { x: number; y: number; z: number },
  _supportPolygon: Array<[number, number]>,
  fixturePointRadius: number,
  partMeshes: THREE.Object3D[],
  _partSilhouette: Array<{ x: number; z: number }>,
  baseTopY: number
): CollisionAdjustmentResult {
  const position = { ...clampPosition };
  const rotation = { ...clampRotation }; // Keep rotation unchanged
  let wasAdjusted = false;
  let adjustmentReason: string | undefined;
  
  // ONLY adjust height - drop clamp to part surface
  const dropResult = dropClampToPartSurface(position, fixturePointRadius, partMeshes, baseTopY);
  if (dropResult.adjusted) {
    position.y = dropResult.newY;
    wasAdjusted = true;
    adjustmentReason = 'Adjusted height to part surface';
  }
  
  return { position, rotation, wasAdjusted, adjustmentReason };
}

/**
 * Drop clamp so fixture point disk sits ON TOP of a part surface.
 * 
 * TWO-STEP APPROACH:
 * 1. Raycast DOWN from current position - if we hit a valid top surface (normal opposing ray), drop there
 * 2. If no valid top surface found, fixture point must be INSIDE the part - move UP to exit, then drop down
 */
export function dropClampToPartSurface(
  clampPosition: { x: number; y: number; z: number },
  fixturePointRadius: number,
  partMeshes: THREE.Object3D[],
  baseTopY: number
): { newY: number; adjusted: boolean } {
  if (partMeshes.length === 0) {
    return { newY: clampPosition.y, adjusted: false };
  }
  
  const raycaster = new THREE.Raycaster();
  raycaster.far = 5000;
  
  // 5 raycast points across the fixture point disk
  const sampleRadius = fixturePointRadius * 0.7;
  const testOffsets = [
    { x: 0, z: 0 },
    { x: sampleRadius, z: 0 },
    { x: -sampleRadius, z: 0 },
    { x: 0, z: sampleRadius },
    { x: 0, z: -sampleRadius },
  ];
  
  // STEP 1: Try to find a valid top surface by raycasting DOWN from current position
  // A valid top surface has normal opposing the ray direction (normal.y > 0 when ray is -Y)
  const directDropY = findTopSurfaceBelow(
    clampPosition,
    testOffsets,
    partMeshes,
    raycaster
  );
  
  if (directDropY !== null) {
    // Found a valid top surface - drop to it
    const adjusted = Math.abs(directDropY - clampPosition.y) > 0.01;
    return { newY: directDropY, adjusted };
  }
  
  // STEP 2: No valid top surface found - fixture point must be inside the part mesh
  // Move UP to exit the part, then drop down
  const currentPoint = new THREE.Vector3(clampPosition.x, clampPosition.y, clampPosition.z);
  const exitY = findExitPointMovingUp(currentPoint, partMeshes);
  
  if (exitY === null) {
    // Could not find exit point - no adjustment possible
    return { newY: clampPosition.y, adjusted: false };
  }
  
  // Now drop down from above the part
  const rayStartY = exitY + 100; // Start from above the exit point
  
  let highestSurface = -Infinity;
  
  for (const offset of testOffsets) {
    const rayOrigin = new THREE.Vector3(
      clampPosition.x + offset.x,
      rayStartY,
      clampPosition.z + offset.z
    );
    raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    
    for (const mesh of partMeshes) {
      mesh.updateMatrixWorld(true);
      const hits = raycaster.intersectObject(mesh, true);
      
      for (const hit of hits) {
        if (hit.face) {
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
          const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
          
          // Only consider top-facing surfaces (normal opposing ray direction)
          if (worldNormal.y > MIN_TOP_SURFACE_ANGLE && hit.point.y > highestSurface) {
            highestSurface = hit.point.y;
          }
        }
      }
    }
  }
  
  if (highestSurface === -Infinity) {
    return { newY: clampPosition.y, adjusted: false };
  }
  
  const adjusted = Math.abs(highestSurface - clampPosition.y) > 0.01;
  return { newY: highestSurface, adjusted };
}

/**
 * Find the highest top-facing surface below the given position.
 * Returns null if no valid top surface is found (meaning we're likely inside the mesh).
 */
function findTopSurfaceBelow(
  clampPosition: { x: number; y: number; z: number },
  testOffsets: Array<{ x: number; z: number }>,
  partMeshes: THREE.Object3D[],
  raycaster: THREE.Raycaster
): number | null {
  let highestValidSurface = -Infinity;
  let foundValidSurface = false;
  
  for (const offset of testOffsets) {
    const rayOrigin = new THREE.Vector3(
      clampPosition.x + offset.x,
      clampPosition.y,
      clampPosition.z + offset.z
    );
    raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    
    for (const mesh of partMeshes) {
      mesh.updateMatrixWorld(true);
      const hits = raycaster.intersectObject(mesh, true);
      
      // Check the FIRST hit - if it's a top-facing surface, it's valid
      if (hits.length > 0) {
        const firstHit = hits[0];
        if (firstHit.face) {
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(firstHit.object.matrixWorld);
          const worldNormal = firstHit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
          
          // Valid top surface: normal opposes ray direction (normal.y > 0 when ray is -Y)
          if (worldNormal.y > MIN_TOP_SURFACE_ANGLE) {
            foundValidSurface = true;
            if (firstHit.point.y > highestValidSurface) {
              highestValidSurface = firstHit.point.y;
            }
          }
        }
      }
    }
  }
  
  return foundValidSurface ? highestValidSurface : null;
}

// ============================================================================
// Silhouette Computation
// ============================================================================

/**
 * Compute part silhouette using render-based approach
 * Returns the boundary points of the part's shadow on the XZ plane
 */
export function computePartSilhouetteForClamps(
  meshes: THREE.Object3D[],
  baseTopY: number
): Array<{ x: number; z: number }> {
  if (meshes.length === 0) return [];
  
  // Compute bounding box
  const box = new THREE.Box3();
  meshes.forEach(mesh => {
    mesh.updateMatrixWorld(true);
    box.expandByObject(mesh);
  });
  
  if (box.isEmpty()) return [];
  
  const bounds = {
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z
  };
  
  // Use render-based silhouette extraction
  return computeRenderSilhouette(meshes, baseTopY, bounds);
}

// ============================================================================
// Polygon/Geometry Utilities
// ============================================================================

/**
 * Check if a point is inside a polygon using ray casting algorithm (2D, XZ plane)
 * @param point - The point to test
 * @param polygon - Array of polygon vertices
 * @returns true if point is inside the polygon
 */
export function isPointInsidePolygon(
  point: Point2D,
  polygon: Polygon2D
): boolean {
  if (polygon.length < 3) return false;
  
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    
    if (((zi > point.z) !== (zj > point.z)) &&
        (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Calculate distance from a point to the nearest edge of a polygon
 * @param point - The point to measure from
 * @param polygon - Array of polygon vertices
 * @returns Distance in world units to the nearest edge
 */
function distanceToSilhouetteEdge(
  point: Point2D,
  polygon: Polygon2D
): number {
  if (polygon.length < 2) return Infinity;
  
  let minDist = Infinity;
  
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    // Calculate distance from point to line segment p1-p2
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const lengthSq = dx * dx + dz * dz;
    
    let t = 0;
    if (lengthSq > 0) {
      t = Math.max(0, Math.min(1, ((point.x - p1.x) * dx + (point.z - p1.z) * dz) / lengthSq));
    }
    
    const closestX = p1.x + t * dx;
    const closestZ = p1.z + t * dz;
    
    const dist = Math.sqrt((point.x - closestX) ** 2 + (point.z - closestZ) ** 2);
    minDist = Math.min(minDist, dist);
  }
  
  return minDist;
}

/**
 * Get the closest point on the silhouette boundary to a given point,
 * along with the outward normal at that point
 * @param point - The point to find closest boundary point from
 * @param polygon - The silhouette polygon
 * @returns Closest point coordinates and the outward normal vector
 */
function getClosestPointOnSilhouette(
  point: Point2D,
  polygon: Polygon2D
): { x: number; z: number; normalX: number; normalZ: number } {
  if (polygon.length < 2) {
    return { x: point.x, z: point.z, normalX: 1, normalZ: 0 };
  }
  
  let minDist = Infinity;
  let closestX = point.x;
  let closestZ = point.z;
  let normalX = 1;
  let normalZ = 0;
  
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    // Calculate distance from point to line segment p1-p2
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const lengthSq = dx * dx + dz * dz;
    
    let t = 0;
    if (lengthSq > 0) {
      t = Math.max(0, Math.min(1, ((point.x - p1.x) * dx + (point.z - p1.z) * dz) / lengthSq));
    }
    
    const projX = p1.x + t * dx;
    const projZ = p1.z + t * dz;
    
    const dist = Math.sqrt((point.x - projX) ** 2 + (point.z - projZ) ** 2);
    
    if (dist < minDist) {
      minDist = dist;
      closestX = projX;
      closestZ = projZ;
      
      // Calculate outward normal (perpendicular to edge, pointing away from polygon interior)
      // Edge direction: (dx, dz), perpendicular: (-dz, dx) or (dz, -dx)
      // We want the one pointing outward (away from centroid)
      const edgeLen = Math.sqrt(lengthSq);
      if (edgeLen > 0) {
        // Use the perpendicular that points toward the query point
        const perpX = -dz / edgeLen;
        const perpZ = dx / edgeLen;
        
        // Check which direction points toward the query point
        const toPointX = point.x - projX;
        const toPointZ = point.z - projZ;
        const dot = perpX * toPointX + perpZ * toPointZ;
        
        if (dot >= 0) {
          normalX = perpX;
          normalZ = perpZ;
        } else {
          normalX = -perpX;
          normalZ = -perpZ;
        }
      }
    }
  }
  
  return { x: closestX, z: closestZ, normalX, normalZ };
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Calculate the centroid of a silhouette polygon
 * @param silhouette - Array of polygon vertices
 * @returns The center point of the polygon
 */
function getSilhouetteCenter(silhouette: Polygon2D): Point2D {
  if (silhouette.length === 0) {
    return { x: 0, z: 0 };
  }
  
  let sumX = 0;
  let sumZ = 0;
  for (const p of silhouette) {
    sumX += p.x;
    sumZ += p.z;
  }
  
  return {
    x: sumX / silhouette.length,
    z: sumZ / silhouette.length
  };
}

/**
 * Find the Y position where we exit the part mesh (moving upward)
 */
function findExitPointMovingUp(
  startPoint: THREE.Vector3,
  partMeshes: THREE.Object3D[]
): number | null {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 5000;
  
  // Cast ray upward
  raycaster.set(startPoint, new THREE.Vector3(0, 1, 0));
  
  const allHits: THREE.Intersection[] = [];
  for (const mesh of partMeshes) {
    mesh.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(mesh, true);
    allHits.push(...hits);
  }
  
  if (allHits.length === 0) {
    return null; // No surfaces above
  }
  
  // Sort by distance (closest first)
  allHits.sort((a, b) => a.distance - b.distance);
  
  // Find the first TOP-FACING surface (normal pointing up = we exit through top)
  for (const hit of allHits) {
    if (hit.face) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      
      // Top-facing surface (we exit through it going up)
      if (worldNormal.y > MIN_TOP_SURFACE_ANGLE) {
        return hit.point.y;
      }
    }
  }
  
  // Fallback: return highest hit point
  return allHits[allHits.length - 1].point.y;
}

/**
 * Compute silhouette by rendering the part from above onto an orthographic view
 * and tracing the boundary using Moore Neighborhood algorithm.
 * 
 * Algorithm:
 * 1. Render meshes from top view with black material on white background
 * 2. Read pixels to create a binary occupancy grid
 * 3. Trace the contour using Moore Neighborhood algorithm
 * 4. Simplify the contour using Douglas-Peucker algorithm
 * 
 * @param meshes - The part meshes to compute silhouette for
 * @param baseTopY - Y position of the baseplate top
 * @param bounds - Bounding box of the part in XZ plane
 * @returns Array of points forming the silhouette boundary
 */
function computeRenderSilhouette(
  meshes: THREE.Object3D[],
  baseTopY: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): Array<{ x: number; z: number }> {
  const RESOLUTION = SILHOUETTE_RESOLUTION;
  const PADDING = SILHOUETTE_PADDING;
  
  const minX = bounds.minX - PADDING;
  const maxX = bounds.maxX + PADDING;
  const minZ = bounds.minZ - PADDING;
  const maxZ = bounds.maxZ + PADDING;
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  
  if (width <= 0 || depth <= 0) return [];
  
  // Create offscreen renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true
  });
  renderer.setSize(RESOLUTION, RESOLUTION);
  renderer.setClearColor(0xffffff, 1);
  
  const maxDim = Math.max(width, depth);
  const camera = new THREE.OrthographicCamera(
    -maxDim / 2, maxDim / 2,
    maxDim / 2, -maxDim / 2,
    0.1, 1000
  );
  
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  // Find max Y
  let maxY = baseTopY;
  meshes.forEach(obj => {
    obj.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.updateMatrixWorld(true);
        const childBox = new THREE.Box3().setFromObject(child);
        maxY = Math.max(maxY, childBox.max.y);
      }
    });
  });
  
  camera.position.set(centerX, maxY + 100, centerZ);
  camera.lookAt(centerX, baseTopY, centerZ);
  camera.updateProjectionMatrix();
  
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  
  const blackMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide
  });
  
  meshes.forEach(obj => {
    obj.traverse(child => {
      if (child instanceof THREE.Mesh && child.geometry) {
        child.updateMatrixWorld(true);
        const clonedMesh = new THREE.Mesh(child.geometry.clone(), blackMaterial);
        clonedMesh.matrixAutoUpdate = false;
        clonedMesh.matrix.copy(child.matrixWorld);
        clonedMesh.matrixWorld.copy(child.matrixWorld);
        scene.add(clonedMesh);
      }
    });
  });
  
  renderer.render(scene, camera);
  
  const gl = renderer.getContext();
  const pixels = new Uint8Array(RESOLUTION * RESOLUTION * 4);
  gl.readPixels(0, 0, RESOLUTION, RESOLUTION, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  
  // Cleanup
  renderer.dispose();
  blackMaterial.dispose();
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
  
  // Create binary grid from pixels
  const grid: boolean[][] = [];
  for (let row = 0; row < RESOLUTION; row++) {
    grid.push(new Array(RESOLUTION).fill(false));
  }
  
  let filledCount = 0;
  for (let row = 0; row < RESOLUTION; row++) {
    for (let col = 0; col < RESOLUTION; col++) {
      const pixelIdx = ((RESOLUTION - 1 - row) * RESOLUTION + col) * 4;
      const r = pixels[pixelIdx];
      if (r < 128) {
        grid[row][col] = true;
        filledCount++;
      }
    }
  }
  
  if (filledCount === 0) {
    return [];
  }
  
  // Convert pixel to world coordinates
  const pixelToWorld = (row: number, col: number): { x: number; z: number } => {
    const u = col / RESOLUTION;
    const v = row / RESOLUTION;
    return {
      x: centerX - maxDim / 2 + u * maxDim,
      z: centerZ - maxDim / 2 + v * maxDim
    };
  };
  
  // Use Moore Neighborhood tracing (same as overhangAnalysis.ts)
  const contour = mooreNeighborhoodTrace(grid, RESOLUTION, pixelToWorld);
  
  if (contour.length < 3) {
    return [];
  }
  
  // Simplify to reduce point count
  const cellSize = maxDim / RESOLUTION;
  const simplified = douglasPeuckerSimplify(contour, cellSize * 1.5);
  
  return simplified;
}

/**
 * Moore Neighborhood Contour Tracing Algorithm
 * Traces the boundary of a binary image by following the edge pixels.
 * 
 * @param grid - 2D boolean array representing pixel occupancy
 * @param resolution - Width/height of the grid
 * @param pixelToWorld - Function to convert pixel coordinates to world coordinates
 * @returns Array of world-space points forming the contour
 */
function mooreNeighborhoodTrace(
  grid: boolean[][],
  resolution: number,
  pixelToWorld: (row: number, col: number) => Point2D
): Polygon2D {
  // Helper to check if pixel is part
  const isPartPixel = (row: number, col: number): boolean => {
    if (row < 0 || row >= resolution || col < 0 || col >= resolution) return false;
    return grid[row][col];
  };
  
  // Find starting pixel: scan from top-left, find first part pixel
  let startRow = -1, startCol = -1;
  outer: for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      if (grid[row][col]) {
        startRow = row;
        startCol = col;
        break outer;
      }
    }
  }
  
  if (startRow < 0) {
    return [];
  }
  
  // Moore neighborhood: 8 directions, clockwise starting from the pixel to the left
  const directions = [
    { dr: 0, dc: -1 },  // 0: West (left)
    { dr: -1, dc: -1 }, // 1: NW
    { dr: -1, dc: 0 },  // 2: North (up)
    { dr: -1, dc: 1 },  // 3: NE
    { dr: 0, dc: 1 },   // 4: East (right)
    { dr: 1, dc: 1 },   // 5: SE
    { dr: 1, dc: 0 },   // 6: South (down)
    { dr: 1, dc: -1 },  // 7: SW
  ];
  
  const contour: Array<{ x: number; z: number }> = [];
  const visited = new Set<string>();
  
  let currentRow = startRow;
  let currentCol = startCol;
  let backtrackDir = 0;
  
  const maxIterations = resolution * resolution;
  let iterations = 0;
  
  do {
    const key = `${currentRow},${currentCol}`;
    
    // Add this pixel to contour
    const worldPoint = pixelToWorld(currentRow, currentCol);
    if (contour.length === 0 || 
        contour[contour.length - 1].x !== worldPoint.x || 
        contour[contour.length - 1].z !== worldPoint.z) {
      contour.push(worldPoint);
    }
    
    // Check for loop completion
    if (visited.has(key) && iterations > 8) {
      if (currentRow === startRow && currentCol === startCol) {
        break;
      }
    }
    visited.add(key);
    
    // Scan neighbors clockwise starting from backtrack+1
    let found = false;
    const startScan = (backtrackDir + 1) % 8;
    
    for (let i = 0; i < 8; i++) {
      const dirIdx = (startScan + i) % 8;
      const dir = directions[dirIdx];
      const nr = currentRow + dir.dr;
      const nc = currentCol + dir.dc;
      
      if (isPartPixel(nr, nc)) {
        backtrackDir = (dirIdx + 4) % 8;
        currentRow = nr;
        currentCol = nc;
        found = true;
        break;
      }
    }
    
    if (!found) {
      break;
    }
    
    iterations++;
    if (iterations > maxIterations) {
      break;
    }
    
  } while (currentRow !== startRow || currentCol !== startCol || iterations < 8);
  
  return contour;
}

/**
 * Douglas-Peucker line simplification algorithm
 * Reduces the number of points in a polyline while preserving shape.
 * 
 * @param points - Array of points to simplify
 * @param tolerance - Maximum allowed perpendicular distance from the simplified line
 * @returns Simplified array of points
 */
function douglasPeuckerSimplify(
  points: Polygon2D,
  tolerance: number
): Polygon2D {
  if (points.length <= 2) return points;
  
  let maxDist = 0;
  let maxIndex = 0;
  
  const first = points[0];
  const last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceDP(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  if (maxDist > tolerance) {
    const left = douglasPeuckerSimplify(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeuckerSimplify(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

/**
 * Calculate perpendicular distance from a point to a line segment.
 * Used by Douglas-Peucker algorithm for line simplification.
 * 
 * @param point - The point to measure distance from
 * @param lineStart - Start point of the line segment
 * @param lineEnd - End point of the line segment
 * @returns Perpendicular distance from point to the line segment
 */
function perpendicularDistanceDP(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D
): number {
  const dx = lineEnd.x - lineStart.x;
  const dz = lineEnd.z - lineStart.z;
  const lengthSq = dx * dx + dz * dz;
  
  if (lengthSq === 0) {
    return Math.hypot(point.x - lineStart.x, point.z - lineStart.z);
  }
  
  const t = Math.max(0, Math.min(1, 
    ((point.x - lineStart.x) * dx + (point.z - lineStart.z) * dz) / lengthSq
  ));
  
  const projX = lineStart.x + t * dx;
  const projZ = lineStart.z + t * dz;
  
  return Math.hypot(point.x - projX, point.z - projZ);
}
