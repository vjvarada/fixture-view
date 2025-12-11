/**
 * Shadow-Based Support Placement with Overhang Analysis
 * 
 * This algorithm creates supports based on the part's "shadow" (2D projection onto XZ plane)
 * combined with visible overhang detection. Key features:
 * 
 * 1. Shadow Calculation: Projects the entire part onto XZ plane to get a coverage area
 * 2. Visible Overhang Detection: Only considers overhangs "visible" from baseplate (not undercuts)
 * 3. 20% Boundary Extension: Extends support polygon beyond shadow for better wall constraint
 * 4. Symmetric Coverage: Ensures supports are distributed to constrain all sides
 * 5. SYMMETRY-AWARE PLACEMENT: Detects if parts are symmetric (or near-symmetric) about the
 *    X or Z axis (when viewed from top in the 3D scene). For symmetric parts, supports are
 *    automatically placed in a symmetric pattern to match the part's symmetry.
 * 
 * The algorithm:
 * 1. Compute the part's shadow (2D projection onto XZ plane)
 * 2. Expand the shadow boundary by 20% to create a "wall" effect
 * 3. Find visible overhangs (raycast from below to filter out undercuts)
 * 4. DETECT SYMMETRY of the part silhouette about X and Z axes
 * 5. Generate symmetric support positions if symmetry is detected
 * 6. Generate a single custom support polygon that encompasses:
 *    - The expanded shadow boundary
 *    - All visible overhang regions
 */

import * as THREE from 'three';
import { AnySupport, CustomSupport } from './types';

// ============================================================================
// Types
// ============================================================================

export interface OverhangPoint {
  x: number;        // World X coordinate
  y: number;        // World Y coordinate (height of the overhang)
  z: number;        // World Z coordinate
  normalY: number;  // Y component of face normal (more negative = steeper overhang)
  area: number;     // Face area for weighting
}

export interface OverhangCluster {
  points: OverhangPoint[];
  centroidX: number;
  centroidZ: number;
  minY: number;           // Lowest Y in cluster (where support should reach)
  maxY: number;           // Highest Y in cluster
  boundingBox: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  width: number;          // X extent
  depth: number;          // Z extent
  aspectRatio: number;    // width/depth
  totalArea: number;      // Sum of face areas
}

export interface OverhangPlacementOptions {
  overhangAngle?: number;           // Angle from vertical to consider overhang (default 45°)
  buildplateTolerance?: number;     // Y distance from baseplate to ignore (mm)
  clusterDistance?: number;         // Max distance to cluster points (mm)
  minClusterArea?: number;          // Minimum cluster area to place support (mm²)
  aspectRatioThreshold?: number;    // Ratio above which to use rectangular (default 1.2)
  supportType?: 'auto' | 'cylindrical' | 'rectangular' | 'custom';
  supportPadding?: number;          // Extra padding around cluster for support (mm)
  minSupportSize?: number;          // Minimum support radius/width (mm)
  maxSupportSize?: number;          // Maximum support radius/width (mm)
  cornerRadius?: number;            // Corner radius for rectangular supports (mm)
  contactOffset?: number;           // Gap between support top and model (mm)
  maxSupportSpan?: number;          // Maximum span a single support can cover (mm) - larger clusters get subdivided
}

export interface OverhangPlacementResult {
  supports: AnySupport[];
  clusters: OverhangCluster[];
  message: string;
  totalOverhangArea: number;
  /** Debug: the computed perimeter boundary for visualization */
  debugPerimeter?: Array<{ x: number; z: number }>;
}

/** 2D point for shadow/polygon operations */
interface Point2D {
  x: number;
  z: number;
}

/** Shadow analysis result */
interface ShadowAnalysis {
  /** Convex hull of the part's shadow (2D projection) */
  shadowHull: Point2D[];
  /** Shadow expanded by 20% for wall effect */
  expandedShadow: Point2D[];
  /** Bounding box of the shadow */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Center of the shadow */
  center: Point2D;
  /** Approximate area of the shadow */
  area: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Debug flag to enable verbose console logging.
 * Set to true when debugging support placement issues.
 */
const DEBUG_LOGGING = false;

/** Helper function for debug logging */
function debugLog(...args: unknown[]): void {
  if (DEBUG_LOGGING) {
    console.log(...args);
  }
}

const DEFAULT_OPTIONS: Required<OverhangPlacementOptions> = {
  overhangAngle: 60,              // 60° from vertical - slightly more permissive
  buildplateTolerance: 2,         // Ignore faces within 2mm of buildplate
  clusterDistance: 15,            // Cluster points within 15mm
  minClusterArea: 25,             // Minimum 25mm² to warrant a support
  aspectRatioThreshold: 1.5,      // Not used - kept for backward compatibility
  supportType: 'auto',
  supportPadding: 3,              // 3mm padding around cluster
  minSupportSize: 5,              // Minimum 5mm radius/width
  maxSupportSize: 40,             // Maximum 40mm radius/width
  cornerRadius: 2,
  contactOffset: 0,
  maxSupportSpan: 50,             // Maximum 50mm span per support - larger clusters get multiple supports
};

// ============================================================================
// Shadow Calculation
// ============================================================================

/**
 * Compute the "shadow" of a part - its 2D projection onto the XZ plane
 * Uses a grid-based approach to capture the actual silhouette, not just convex hull
 */
function computePartShadow(meshes: THREE.Object3D[], baseTopY: number): ShadowAnalysis {
  const projectedPoints: Point2D[] = [];
  
  // Collect all vertices projected onto XZ plane
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      
      const geometry = child.geometry;
      const positionAttr = geometry.getAttribute('position');
      if (!positionAttr) return;
      
      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld;
      
      // Sample vertices (every vertex for accuracy)
      for (let i = 0; i < positionAttr.count; i++) {
        const vertex = new THREE.Vector3(
          positionAttr.getX(i),
          positionAttr.getY(i),
          positionAttr.getZ(i)
        ).applyMatrix4(worldMatrix);
        
        // Only include vertices above baseplate
        if (vertex.y > baseTopY) {
          projectedPoints.push({ x: vertex.x, z: vertex.z });
        }
      }
    });
  });
  
  if (projectedPoints.length < 3) {
    return {
      shadowHull: [],
      expandedShadow: [],
      bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      center: { x: 0, z: 0 },
      area: 0,
    };
  }
  
  // Calculate bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of projectedPoints) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  
  // Use concave hull (alpha shape) for better silhouette capture
  // First compute convex hull, then refine with concave algorithm
  const convexHull = computeConvexHull(projectedPoints);
  
  // For the actual silhouette, use a concave hull approach
  // This better captures the true shape of complex parts
  const shadowHull = computeConcaveHull(projectedPoints, convexHull);
  
  // Calculate center from the actual shadow points
  let sumX = 0, sumZ = 0;
  for (const p of shadowHull) {
    sumX += p.x;
    sumZ += p.z;
  }
  
  const center = {
    x: sumX / shadowHull.length,
    z: sumZ / shadowHull.length,
  };
  
  // Calculate area using shoelace formula
  const area = Math.abs(polygonSignedArea(shadowHull));
  
  // Expand shadow by 20% from center for wall effect
  const expansionFactor = 0.20; // 20% expansion
  const expandedShadow = shadowHull.map(p => ({
    x: center.x + (p.x - center.x) * (1 + expansionFactor),
    z: center.z + (p.z - center.z) * (1 + expansionFactor),
  }));
  
  return {
    shadowHull,
    expandedShadow,
    bounds: { minX, maxX, minZ, maxZ },
    center,
    area,
  };
}

// ============================================================================
// Visible Overhang Detection (No Undercuts)
// ============================================================================

/**
 * Check if a point is "visible" from below (not blocked by the part itself)
 * Uses raycasting to detect undercuts
 */
function isVisibleFromBelow(
  point: THREE.Vector3,
  meshes: THREE.Object3D[],
  baseTopY: number
): boolean {
  // Cast a ray from the point downward to baseplate
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3(point.x, point.y - 0.1, point.z); // Slightly below the point
  const rayDirection = new THREE.Vector3(0, -1, 0); // Straight down
  
  raycaster.set(rayOrigin, rayDirection);
  raycaster.far = point.y - baseTopY; // Only check down to baseplate
  
  // Collect all meshes for intersection test
  const meshList: THREE.Mesh[] = [];
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshList.push(child);
      }
    });
  });
  
  const intersections = raycaster.intersectObjects(meshList, false);
  
  // If no intersections, the point is visible from below
  // If there are intersections, the overhang is blocked (undercut)
  return intersections.length === 0;
}

/**
 * Find ALL overhanging faces based on angle threshold (no visibility/undercut filtering)
 * This captures the full extent of overhanging regions for better support coverage
 */
function findAllOverhangs(
  meshes: THREE.Object3D[],
  baseTopY: number,
  options: Required<OverhangPlacementOptions>
): OverhangPoint[] {
  const { overhangAngle, buildplateTolerance } = options;
  
  // Convert angle to threshold
  const angleRad = (overhangAngle * Math.PI) / 180;
  const normalThreshold = -Math.cos(angleRad);
  
  const overhangPoints: OverhangPoint[] = [];
  const tempNormal = new THREE.Vector3();
  const tempTriangle = new THREE.Triangle();
  
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      
      const geometry = child.geometry;
      const positionAttr = geometry.getAttribute('position');
      
      if (!positionAttr) return;
      
      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld;
      
      const indices = geometry.index;
      const faceCount = indices 
        ? indices.count / 3 
        : positionAttr.count / 3;
      
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        let i0: number, i1: number, i2: number;
        if (indices) {
          i0 = indices.getX(faceIdx * 3);
          i1 = indices.getX(faceIdx * 3 + 1);
          i2 = indices.getX(faceIdx * 3 + 2);
        } else {
          i0 = faceIdx * 3;
          i1 = faceIdx * 3 + 1;
          i2 = faceIdx * 3 + 2;
        }
        
        const v0 = new THREE.Vector3(
          positionAttr.getX(i0), positionAttr.getY(i0), positionAttr.getZ(i0)
        ).applyMatrix4(worldMatrix);
        
        const v1 = new THREE.Vector3(
          positionAttr.getX(i1), positionAttr.getY(i1), positionAttr.getZ(i1)
        ).applyMatrix4(worldMatrix);
        
        const v2 = new THREE.Vector3(
          positionAttr.getX(i2), positionAttr.getY(i2), positionAttr.getZ(i2)
        ).applyMatrix4(worldMatrix);
        
        const centroid = new THREE.Vector3()
          .add(v0).add(v1).add(v2)
          .divideScalar(3);
        
        // Skip faces touching buildplate
        if (centroid.y <= baseTopY + buildplateTolerance) {
          continue;
        }
        
        // Calculate face normal
        tempTriangle.set(v0, v1, v2);
        tempTriangle.getNormal(tempNormal);
        
        // Check if this is an overhang (60° threshold from vertical)
        // No visibility check - include ALL overhanging faces
        if (tempNormal.y < normalThreshold) {
          const area = tempTriangle.getArea();
          overhangPoints.push({
            x: centroid.x,
            y: centroid.y,
            z: centroid.z,
            normalY: tempNormal.y,
            area,
          });
        }
      }
    });
  });
  
  return overhangPoints;
}

/**
 * Find overhanging faces that are visible from the baseplate (not undercuts)
 */
function findVisibleOverhangs(
  meshes: THREE.Object3D[],
  baseTopY: number,
  options: Required<OverhangPlacementOptions>
): OverhangPoint[] {
  const { overhangAngle, buildplateTolerance } = options;
  
  // Convert angle to threshold
  const angleRad = (overhangAngle * Math.PI) / 180;
  const normalThreshold = -Math.cos(angleRad);
  
  const overhangPoints: OverhangPoint[] = [];
  const tempNormal = new THREE.Vector3();
  const tempTriangle = new THREE.Triangle();
  
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      
      const geometry = child.geometry;
      const positionAttr = geometry.getAttribute('position');
      
      if (!positionAttr) return;
      
      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld;
      
      const indices = geometry.index;
      const faceCount = indices 
        ? indices.count / 3 
        : positionAttr.count / 3;
      
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        let i0: number, i1: number, i2: number;
        if (indices) {
          i0 = indices.getX(faceIdx * 3);
          i1 = indices.getX(faceIdx * 3 + 1);
          i2 = indices.getX(faceIdx * 3 + 2);
        } else {
          i0 = faceIdx * 3;
          i1 = faceIdx * 3 + 1;
          i2 = faceIdx * 3 + 2;
        }
        
        const v0 = new THREE.Vector3(
          positionAttr.getX(i0), positionAttr.getY(i0), positionAttr.getZ(i0)
        ).applyMatrix4(worldMatrix);
        
        const v1 = new THREE.Vector3(
          positionAttr.getX(i1), positionAttr.getY(i1), positionAttr.getZ(i1)
        ).applyMatrix4(worldMatrix);
        
        const v2 = new THREE.Vector3(
          positionAttr.getX(i2), positionAttr.getY(i2), positionAttr.getZ(i2)
        ).applyMatrix4(worldMatrix);
        
        const centroid = new THREE.Vector3()
          .add(v0).add(v1).add(v2)
          .divideScalar(3);
        
        // Skip faces touching buildplate
        if (centroid.y <= baseTopY + buildplateTolerance) {
          continue;
        }
        
        // Calculate face normal
        tempTriangle.set(v0, v1, v2);
        tempTriangle.getNormal(tempNormal);
        
        // Check if this is an overhang
        if (tempNormal.y < normalThreshold) {
          // Check if visible from below (not an undercut)
          if (isVisibleFromBelow(centroid, meshes, baseTopY)) {
            const area = tempTriangle.getArea();
            overhangPoints.push({
              x: centroid.x,
              y: centroid.y,
              z: centroid.z,
              normalY: tempNormal.y,
              area,
            });
          }
        }
      }
    });
  });
  
  return overhangPoints;
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Cluster overhang points (legacy function - kept for compatibility)
 */
function findOverhangingFaces(
  meshes: THREE.Object3D[],
  baseTopY: number,
  options: Required<OverhangPlacementOptions>
): OverhangPoint[] {
  const { overhangAngle, buildplateTolerance } = options;
  
  // Convert angle to threshold: cos(angle from down vector)
  // A face pointing straight down has normalY = -1
  // overhangAngle of 45° means we want faces with normalY < -cos(45°) = -0.707
  const angleRad = (overhangAngle * Math.PI) / 180;
  const normalThreshold = -Math.cos(angleRad);
  
  const overhangPoints: OverhangPoint[] = [];
  
  const tempVec = new THREE.Vector3();
  const tempNormal = new THREE.Vector3();
  const tempTriangle = new THREE.Triangle();
  
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      
      const geometry = child.geometry;
      const positionAttr = geometry.getAttribute('position');
      const normalAttr = geometry.getAttribute('normal');
      
      if (!positionAttr) return;
      
      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
      
      const indices = geometry.index;
      const faceCount = indices 
        ? indices.count / 3 
        : positionAttr.count / 3;
      
      for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
        // Get vertex indices for this face
        let i0: number, i1: number, i2: number;
        if (indices) {
          i0 = indices.getX(faceIdx * 3);
          i1 = indices.getX(faceIdx * 3 + 1);
          i2 = indices.getX(faceIdx * 3 + 2);
        } else {
          i0 = faceIdx * 3;
          i1 = faceIdx * 3 + 1;
          i2 = faceIdx * 3 + 2;
        }
        
        // Get vertices in world space
        const v0 = new THREE.Vector3(
          positionAttr.getX(i0),
          positionAttr.getY(i0),
          positionAttr.getZ(i0)
        ).applyMatrix4(worldMatrix);
        
        const v1 = new THREE.Vector3(
          positionAttr.getX(i1),
          positionAttr.getY(i1),
          positionAttr.getZ(i1)
        ).applyMatrix4(worldMatrix);
        
        const v2 = new THREE.Vector3(
          positionAttr.getX(i2),
          positionAttr.getY(i2),
          positionAttr.getZ(i2)
        ).applyMatrix4(worldMatrix);
        
        // Get face centroid
        const centroid = new THREE.Vector3()
          .add(v0).add(v1).add(v2)
          .divideScalar(3);
        
        // Skip faces touching buildplate
        if (centroid.y <= baseTopY + buildplateTolerance) {
          continue;
        }
        
        // Calculate face normal in world space
        tempTriangle.set(v0, v1, v2);
        tempTriangle.getNormal(tempNormal);
        
        // Check if this is an overhang (normal pointing downward enough)
        if (tempNormal.y < normalThreshold) {
          // Calculate face area
          const area = tempTriangle.getArea();
          
          overhangPoints.push({
            x: centroid.x,
            y: centroid.y,
            z: centroid.z,
            normalY: tempNormal.y,
            area,
          });
        }
      }
    });
  });
  
  return overhangPoints;
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Cluster overhang points using a simple distance-based algorithm
 * Similar to DBSCAN but simpler
 */
function clusterOverhangPoints(
  points: OverhangPoint[],
  clusterDistance: number
): OverhangCluster[] {
  if (points.length === 0) return [];
  
  const used = new Set<number>();
  const clusters: OverhangCluster[] = [];
  
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    
    // Start a new cluster
    const clusterPoints: OverhangPoint[] = [points[i]];
    used.add(i);
    
    // Expand cluster by finding nearby points
    let j = 0;
    while (j < clusterPoints.length) {
      const current = clusterPoints[j];
      
      for (let k = 0; k < points.length; k++) {
        if (used.has(k)) continue;
        
        const candidate = points[k];
        const dist = Math.hypot(
          candidate.x - current.x,
          candidate.z - current.z
        );
        
        if (dist <= clusterDistance) {
          clusterPoints.push(candidate);
          used.add(k);
        }
      }
      j++;
    }
    
    // Calculate cluster properties
    const cluster = analyzeCluster(clusterPoints);
    if (cluster) {
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

/**
 * Analyze a cluster of overhang points
 */
function analyzeCluster(points: OverhangPoint[]): OverhangCluster | null {
  if (points.length === 0) return null;
  
  let sumX = 0, sumZ = 0, totalArea = 0;
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const point of points) {
    // Weight centroid by face area
    sumX += point.x * point.area;
    sumZ += point.z * point.area;
    totalArea += point.area;
    
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  
  // Ensure non-zero dimensions for aspect ratio
  const effectiveWidth = Math.max(width, 1);
  const effectiveDepth = Math.max(depth, 1);
  
  return {
    points,
    centroidX: totalArea > 0 ? sumX / totalArea : (minX + maxX) / 2,
    centroidZ: totalArea > 0 ? sumZ / totalArea : (minZ + maxZ) / 2,
    minY,
    maxY,
    boundingBox: { minX, maxX, minZ, maxZ },
    width,
    depth,
    aspectRatio: effectiveWidth / effectiveDepth,
    totalArea,
  };
}

/**
 * Subdivide a large cluster into multiple smaller clusters using k-means-like approach
 * This ensures large overhang regions get multiple supports
 */
function subdivideCluster(
  cluster: OverhangCluster,
  maxSpan: number
): OverhangCluster[] {
  const { width, depth, points } = cluster;
  const maxDimension = Math.max(width, depth);
  
  // If cluster is small enough, return as-is
  if (maxDimension <= maxSpan) {
    return [cluster];
  }
  
  // Calculate how many subdivisions we need
  const numDivisionsX = Math.max(1, Math.ceil(width / maxSpan));
  const numDivisionsZ = Math.max(1, Math.ceil(depth / maxSpan));
  const totalDivisions = numDivisionsX * numDivisionsZ;
  
  // If only 1 division needed, return as-is
  if (totalDivisions <= 1) {
    return [cluster];
  }
  
  // Create grid cells and assign points to them
  const { minX, maxX, minZ, maxZ } = cluster.boundingBox;
  const cellWidth = width / numDivisionsX;
  const cellDepth = depth / numDivisionsZ;
  
  // Initialize buckets for each cell
  const buckets: OverhangPoint[][] = Array.from({ length: totalDivisions }, () => []);
  
  // Assign points to grid cells
  for (const point of points) {
    const cellX = Math.min(numDivisionsX - 1, Math.floor((point.x - minX) / cellWidth));
    const cellZ = Math.min(numDivisionsZ - 1, Math.floor((point.z - minZ) / cellDepth));
    const bucketIndex = cellZ * numDivisionsX + cellX;
    buckets[bucketIndex].push(point);
  }
  
  // Create sub-clusters from non-empty buckets
  const subClusters: OverhangCluster[] = [];
  for (const bucket of buckets) {
    if (bucket.length > 0) {
      const subCluster = analyzeCluster(bucket);
      if (subCluster) {
        subClusters.push(subCluster);
      }
    }
  }
  
  return subClusters.length > 0 ? subClusters : [cluster];
}

/**
 * Calculate optimal support positions for a cluster
 * For larger clusters, place multiple supports at strategic locations
 */
function calculateSupportPositions(
  cluster: OverhangCluster,
  maxSpan: number,
  minSupportSize: number
): Array<{ x: number; z: number; coverageRadius: number }> {
  const { width, depth, centroidX, centroidZ, boundingBox, points } = cluster;
  const maxDimension = Math.max(width, depth);
  
  // For small clusters, single support at centroid
  if (maxDimension <= maxSpan) {
    return [{
      x: centroidX,
      z: centroidZ,
      coverageRadius: Math.max(width, depth) / 2 + minSupportSize,
    }];
  }
  
  // For larger clusters, calculate number of supports needed
  const numSupportsX = Math.max(1, Math.ceil(width / maxSpan));
  const numSupportsZ = Math.max(1, Math.ceil(depth / maxSpan));
  
  const positions: Array<{ x: number; z: number; coverageRadius: number }> = [];
  
  // Calculate spacing
  const spacingX = width / numSupportsX;
  const spacingZ = depth / numSupportsZ;
  const startX = boundingBox.minX + spacingX / 2;
  const startZ = boundingBox.minZ + spacingZ / 2;
  
  // Place supports in a grid pattern
  for (let iz = 0; iz < numSupportsZ; iz++) {
    for (let ix = 0; ix < numSupportsX; ix++) {
      const x = startX + ix * spacingX;
      const z = startZ + iz * spacingZ;
      
      // Verify there are actual overhang points near this position
      const nearbyPoints = points.filter(p => 
        Math.hypot(p.x - x, p.z - z) < maxSpan / 2
      );
      
      if (nearbyPoints.length > 0) {
        // Use weighted centroid of nearby points for more accurate placement
        let sumX = 0, sumZ = 0, totalArea = 0;
        for (const p of nearbyPoints) {
          sumX += p.x * p.area;
          sumZ += p.z * p.area;
          totalArea += p.area;
        }
        
        positions.push({
          x: totalArea > 0 ? sumX / totalArea : x,
          z: totalArea > 0 ? sumZ / totalArea : z,
          coverageRadius: Math.min(spacingX, spacingZ) / 2,
        });
      }
    }
  }
  
  // If no positions found (shouldn't happen), fall back to centroid
  if (positions.length === 0) {
    return [{
      x: centroidX,
      z: centroidZ,
      coverageRadius: Math.max(width, depth) / 2 + minSupportSize,
    }];
  }
  
  return positions;
}

// ============================================================================
// Support Generation
// ============================================================================

/**
 * Generate a support for a cluster based on its detected shape
 * Uses intelligent shape detection to choose between rectangular, cylindrical, or custom
 */
function generateSupportForCluster(
  cluster: OverhangCluster,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>,
  index: number
): AnySupport {
  const {
    supportPadding,
    minSupportSize,
    maxSupportSize,
    cornerRadius,
    contactOffset,
  } = options;
  
  // Always use custom supports - they follow the actual overhang shape
  return generateCustomSupportForCluster(cluster, baseTopY, options, index);
}

/**
 * Generate a custom polygon support that follows the cluster shape
 */
function generateCustomSupportForCluster(
  cluster: OverhangCluster,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>,
  index: number
): CustomSupport {
  const { supportPadding, cornerRadius, contactOffset, minSupportSize } = options;
  
  const height = Math.max(1, cluster.minY - baseTopY - contactOffset);
  
  // Need at least 3 points for a polygon
  if (cluster.points.length < 3) {
    // Fall back to a simple square polygon
    const size = Math.max(minSupportSize, Math.max(cluster.width, cluster.depth) / 2 + supportPadding);
    const polygon: Array<[number, number]> = [
      [-size, -size],
      [size, -size],
      [size, size],
      [-size, size],
    ];
    
    return {
      id: `sup-overhang-${Date.now()}-${index}`,
      type: 'custom',
      center: new THREE.Vector2(cluster.centroidX, cluster.centroidZ),
      height,
      baseY: baseTopY,
      contactOffset,
      polygon,
      cornerRadius,
    };
  }
  
  // Create convex hull of cluster points (make a copy to avoid mutation)
  const pointsCopy = cluster.points.map(p => ({ x: p.x, z: p.z }));
  const hull = computeConvexHull(pointsCopy);
  
  // Ensure we have a valid hull
  if (hull.length < 3) {
    // Fall back to bounding box
    const halfW = Math.max(minSupportSize, cluster.width / 2 + supportPadding);
    const halfD = Math.max(minSupportSize, cluster.depth / 2 + supportPadding);
    const polygon: Array<[number, number]> = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ];
    
    return {
      id: `sup-overhang-${Date.now()}-${index}`,
      type: 'custom',
      center: new THREE.Vector2(cluster.centroidX, cluster.centroidZ),
      height,
      baseY: baseTopY,
      contactOffset,
      polygon,
      cornerRadius,
    };
  }
  
  // Offset hull outward by padding
  const offsetHull = offsetPolygon(hull, supportPadding);
  
  // Simplify polygon to ensure minimum edge length (5mm)
  const simplifiedHull = simplifyPolygon(offsetHull, 5);
  
  // Convert to local coordinates (relative to centroid)
  const polygon: Array<[number, number]> = simplifiedHull.map(p => [
    p.x - cluster.centroidX,
    p.z - cluster.centroidZ,
  ]);
  
  return {
    id: `sup-overhang-${Date.now()}-${index}`,
    type: 'custom',
    center: new THREE.Vector2(cluster.centroidX, cluster.centroidZ),
    height,
    baseY: baseTopY,
    contactOffset,
    polygon,
    cornerRadius,
  };
}

// ============================================================================
// Geometry Utilities
// ============================================================================

/**
 * Compute convex hull of 2D points using monotone chain algorithm
 * Returns points in counter-clockwise order
 */
/**
 * Compute the actual part silhouette by rendering from above
 * Uses GPU to render the part as black on white, then extracts boundary from pixels
 * This gives the EXACT silhouette as the graphics card naturally projects 3D to 2D
 */
function computeRaycastSilhouette(
  meshes: THREE.Object3D[],
  baseTopY: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): Array<{ x: number; z: number }> {
  const RESOLUTION = 512; // Render resolution
  const PADDING = 5; // mm padding around bounds
  
  debugLog(`[Silhouette] Using render-based silhouette extraction`);
  debugLog(`[Silhouette] Input bounds: minX=${bounds.minX.toFixed(2)}, maxX=${bounds.maxX.toFixed(2)}, minZ=${bounds.minZ.toFixed(2)}, maxZ=${bounds.maxZ.toFixed(2)}`);
  
  const minX = bounds.minX - PADDING;
  const maxX = bounds.maxX + PADDING;
  const minZ = bounds.minZ - PADDING;
  const maxZ = bounds.maxZ + PADDING;
  
  const width = maxX - minX;
  const height = maxZ - minZ;
  
  if (width <= 0 || height <= 0) {
    debugLog(`[Silhouette] Invalid bounds dimensions`);
    return [];
  }
  
  // Create an offscreen renderer
  const renderer = new THREE.WebGLRenderer({ 
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true 
  });
  renderer.setSize(RESOLUTION, RESOLUTION);
  renderer.setClearColor(0xffffff, 1); // White background
  
  // Calculate camera dimensions to fit the bounds
  const maxDim = Math.max(width, height);
  const camera = new THREE.OrthographicCamera(
    -maxDim / 2, maxDim / 2,  // left, right
    maxDim / 2, -maxDim / 2,  // top, bottom (Y points down in our case)
    0.1, 1000
  );
  
  // Position camera above the part looking down
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  // Find max Y for camera position
  let maxY = baseTopY;
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(child);
        maxY = Math.max(maxY, box.max.y);
      }
    });
  });
  
  camera.position.set(centerX, maxY + 100, centerZ);
  camera.lookAt(centerX, baseTopY, centerZ);
  camera.updateProjectionMatrix();
  
  // Create a scene with just the meshes in black
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  
  // Clone meshes with black material
  const blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  
  meshes.forEach(obj => {
    obj.traverse((child) => {
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
  
  // Render
  renderer.render(scene, camera);
  
  // Read pixels
  const gl = renderer.getContext();
  const pixels = new Uint8Array(RESOLUTION * RESOLUTION * 4);
  gl.readPixels(0, 0, RESOLUTION, RESOLUTION, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  
  // Clean up renderer
  renderer.dispose();
  blackMaterial.dispose();
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
  
  // Create binary grid from pixels (true = part, false = background)
  const grid: boolean[][] = [];
  for (let row = 0; row < RESOLUTION; row++) {
    grid.push(new Array(RESOLUTION).fill(false));
  }
  
  let partPixelCount = 0;
  for (let row = 0; row < RESOLUTION; row++) {
    for (let col = 0; col < RESOLUTION; col++) {
      // WebGL has origin at bottom-left, so flip Y
      const pixelIdx = ((RESOLUTION - 1 - row) * RESOLUTION + col) * 4;
      const r = pixels[pixelIdx];
      const g = pixels[pixelIdx + 1];
      const b = pixels[pixelIdx + 2];
      
      // Black pixel = part (threshold for any edge artifacts)
      if (r < 128 && g < 128 && b < 128) {
        grid[row][col] = true;
        partPixelCount++;
      }
    }
  }
  
  debugLog(`[Silhouette] Part pixels: ${partPixelCount}/${RESOLUTION * RESOLUTION} (${(partPixelCount * 100 / (RESOLUTION * RESOLUTION)).toFixed(1)}%)`);
  
  if (partPixelCount === 0) {
    debugLog(`[Silhouette] No part pixels found - render may have failed`);
    return [];
  }
  
  // Convert pixel to world coordinates
  const pixelToWorld = (row: number, col: number): { x: number; z: number } => {
    const u = col / RESOLUTION; // 0 to 1
    const v = row / RESOLUTION; // 0 to 1
    return {
      x: centerX - maxDim / 2 + u * maxDim,
      z: centerZ - maxDim / 2 + v * maxDim
    };
  };
  
  // Use Moore Neighborhood Contour Tracing to get the EXACT boundary
  // This properly handles ALL concave features
  const contour = mooreNeighborhoodTrace(grid, RESOLUTION, pixelToWorld);
  
  debugLog(`[Silhouette] Moore trace contour: ${contour.length} points`);
  
  if (contour.length < 3) {
    debugLog(`[Silhouette] Moore trace failed, falling back to row scan`);
    // Fallback to row scanning
    return rowScanContour(grid, RESOLUTION, pixelToWorld, maxDim);
  }
  
  // Simplify to reduce point count while preserving shape
  const cellSize = maxDim / RESOLUTION;
  const simplified = douglasPeuckerSimplify(contour, cellSize * 1.5);
  
  debugLog(`[Silhouette] Final contour: ${simplified.length} points`);
  
  return simplified;
}

/**
 * Moore Neighborhood Contour Tracing Algorithm
 * Traces the exact boundary of a binary image by walking along edge pixels
 * This preserves ALL concave features unlike row scanning
 */
function mooreNeighborhoodTrace(
  grid: boolean[][],
  resolution: number,
  pixelToWorld: (row: number, col: number) => { x: number; z: number }
): Array<{ x: number; z: number }> {
  // Helper to check if pixel is part (true) or background (false)
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
    debugLog(`[MooreTrace] No start pixel found`);
    return [];
  }
  
  debugLog(`[MooreTrace] Start pixel: row=${startRow}, col=${startCol}`);
  
  // Moore neighborhood: 8 directions, clockwise starting from the pixel to the left
  // When we enter a pixel from direction d, we start scanning from direction (d+1)%8
  // Directions: 0=W, 1=NW, 2=N, 3=NE, 4=E, 5=SE, 6=S, 7=SW
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
  // We entered from the left (West), so backtrack direction is West (0)
  // Start scanning from the next direction clockwise: NW (1)
  let backtrackDir = 0;
  
  const maxIterations = resolution * resolution;
  let iterations = 0;
  
  do {
    const key = `${currentRow},${currentCol}`;
    
    // Add this pixel to contour (only if not already added consecutively)
    const worldPoint = pixelToWorld(currentRow, currentCol);
    if (contour.length === 0 || 
        contour[contour.length - 1].x !== worldPoint.x || 
        contour[contour.length - 1].z !== worldPoint.z) {
      contour.push(worldPoint);
    }
    
    // Mark as visited for loop detection
    if (visited.has(key) && iterations > 8) {
      // We've completed the loop when we return to start
      if (currentRow === startRow && currentCol === startCol) {
        break;
      }
    }
    visited.add(key);
    
    // Scan neighbors in clockwise order starting from backtrack+1
    // Looking for the next boundary pixel
    let found = false;
    const startScan = (backtrackDir + 1) % 8;
    
    for (let i = 0; i < 8; i++) {
      const dirIdx = (startScan + i) % 8;
      const dir = directions[dirIdx];
      const nr = currentRow + dir.dr;
      const nc = currentCol + dir.dc;
      
      if (isPartPixel(nr, nc)) {
        // Found next boundary pixel
        // The backtrack direction is opposite of how we entered
        backtrackDir = (dirIdx + 4) % 8;
        currentRow = nr;
        currentCol = nc;
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Isolated pixel or error
      debugLog(`[MooreTrace] No neighbor found at (${currentRow}, ${currentCol})`);
      break;
    }
    
    iterations++;
    if (iterations > maxIterations) {
      debugLog(`[MooreTrace] Max iterations reached`);
      break;
    }
    
  } while (currentRow !== startRow || currentCol !== startCol || iterations < 8);
  
  debugLog(`[MooreTrace] Traced ${contour.length} points in ${iterations} iterations`);
  
  return contour;
}

/**
 * Fallback row-scan contour extraction
 */
function rowScanContour(
  grid: boolean[][],
  resolution: number,
  pixelToWorld: (row: number, col: number) => { x: number; z: number },
  maxDim: number
): Array<{ x: number; z: number }> {
  const rowMap = new Map<number, { left: number; right: number }>();
  
  for (let row = 0; row < resolution; row++) {
    let leftCol = -1;
    let rightCol = -1;
    
    for (let col = 0; col < resolution; col++) {
      if (grid[row][col]) {
        if (leftCol < 0) leftCol = col;
        rightCol = col;
      }
    }
    
    if (leftCol >= 0) {
      rowMap.set(row, { left: leftCol, right: rightCol });
    }
  }
  
  const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);
  
  if (sortedRows.length < 2) return [];
  
  const leftEdge: Array<{ x: number; z: number }> = [];
  const rightEdge: Array<{ x: number; z: number }> = [];
  
  for (const [row, cols] of sortedRows) {
    leftEdge.push(pixelToWorld(row, cols.left));
    rightEdge.push(pixelToWorld(row, cols.right));
  }
  
  rightEdge.reverse();
  
  const contour = [...leftEdge, ...rightEdge];
  const cellSize = maxDim / resolution;
  return douglasPeuckerSimplify(contour, cellSize * 2);
}

/**
 * Order boundary points by walking along the perimeter
 * Uses nearest-neighbor approach starting from leftmost point
 */
function orderBoundaryPoints(
  points: Array<{ x: number; z: number; gx: number; gz: number }>,
  grid: boolean[][],
  gridW: number,
  gridH: number,
  minX: number,
  minZ: number,
  cellSize: number
): Array<{ x: number; z: number }> {
  if (points.length < 3) return points;
  
  // Create a set for quick lookup
  const pointSet = new Set(points.map(p => `${p.gx},${p.gz}`));
  
  // Start from the leftmost point (lowest x, then lowest z)
  let current = points.reduce((min, p) => 
    p.x < min.x || (p.x === min.x && p.z < min.z) ? p : min
  );
  
  const result: Array<{ x: number; z: number }> = [];
  const visited = new Set<string>();
  
  // Direction vectors for 8-connectivity (clockwise from right)
  const dirs = [
    { dx: 1, dz: 0 },   // right
    { dx: 1, dz: 1 },   // down-right
    { dx: 0, dz: 1 },   // down
    { dx: -1, dz: 1 },  // down-left
    { dx: -1, dz: 0 },  // left
    { dx: -1, dz: -1 }, // up-left
    { dx: 0, dz: -1 },  // up
    { dx: 1, dz: -1 },  // up-right
  ];
  
  let lastDir = 0; // Start looking right
  const maxIter = points.length * 2;
  
  for (let iter = 0; iter < maxIter; iter++) {
    const key = `${current.gx},${current.gz}`;
    
    if (visited.has(key) && result.length > 2) {
      break; // Completed loop
    }
    
    if (!visited.has(key)) {
      visited.add(key);
      result.push({ x: current.x, z: current.z });
    }
    
    // Find next boundary point - look in clockwise order starting from opposite of last direction
    let found = false;
    const startDir = (lastDir + 5) % 8; // Start from backtrack + 1
    
    for (let i = 0; i < 8; i++) {
      const dirIdx = (startDir + i) % 8;
      const dir = dirs[dirIdx];
      const nx = current.gx + dir.dx;
      const nz = current.gz + dir.dz;
      const nkey = `${nx},${nz}`;
      
      if (pointSet.has(nkey) && !visited.has(nkey)) {
        // Find the point object
        const nextPoint = points.find(p => p.gx === nx && p.gz === nz);
        if (nextPoint) {
          current = nextPoint;
          lastDir = dirIdx;
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      // Try to find any unvisited neighbor
      for (let i = 0; i < 8; i++) {
        const dir = dirs[i];
        const nx = current.gx + dir.dx;
        const nz = current.gz + dir.dz;
        const nkey = `${nx},${nz}`;
        
        if (pointSet.has(nkey) && !visited.has(nkey)) {
          const nextPoint = points.find(p => p.gx === nx && p.gz === nz);
          if (nextPoint) {
            current = nextPoint;
            lastDir = i;
            found = true;
            break;
          }
        }
      }
    }
    
    if (!found) break;
  }
  
  return result;
}

/**
 * Compute alpha shape (concave hull) from a set of points
 * Uses row-scanning approach to preserve concave features
 */
function computeAlphaShape(
  points: Array<{ x: number; z: number }>,
  alpha: number
): Array<{ x: number; z: number }> {
  if (points.length < 3) return points;
  
  // Group points by Z (row), then find left and right edges
  const zMap = new Map<number, { minX: number; maxX: number; z: number }>();
  const zPrecision = alpha / 2;
  
  for (const p of points) {
    const zKey = Math.round(p.z / zPrecision) * zPrecision;
    const existing = zMap.get(zKey);
    if (existing) {
      existing.minX = Math.min(existing.minX, p.x);
      existing.maxX = Math.max(existing.maxX, p.x);
    } else {
      zMap.set(zKey, { minX: p.x, maxX: p.x, z: zKey });
    }
  }
  
  // Sort by Z
  const rows = Array.from(zMap.values()).sort((a, b) => a.z - b.z);
  
  if (rows.length < 2) return points;
  
  // Build contour: left edge (bottom to top), then right edge (top to bottom)
  const leftEdge: Array<{ x: number; z: number }> = [];
  const rightEdge: Array<{ x: number; z: number }> = [];
  
  for (const row of rows) {
    leftEdge.push({ x: row.minX, z: row.z });
    rightEdge.push({ x: row.maxX, z: row.z });
  }
  
  // Combine: left edge forward, right edge backward
  rightEdge.reverse();
  
  return [...leftEdge, ...rightEdge];
}

// ============================================================================
// Symmetry Detection and Symmetric Support Placement
// ============================================================================

/**
 * Result of symmetry analysis for a 2D perimeter
 */
interface SymmetryAnalysis {
  /** Is the shape symmetric about the X axis (vertical line through center in XZ view)? */
  isXSymmetric: boolean;
  /** Is the shape symmetric about the Z axis (horizontal line through center in XZ view)? */
  isZSymmetric: boolean;
  /** Center point used for symmetry analysis */
  center: Point2D;
  /** Symmetry score for X axis (0-1, higher = more symmetric) */
  xSymmetryScore: number;
  /** Symmetry score for Z axis (0-1, higher = more symmetric) */
  zSymmetryScore: number;
}

/**
 * Detect if a 2D perimeter is symmetric about the X and/or Z axes
 * Uses point-to-reflected-point distance comparison
 * 
 * @param perimeter The boundary points of the shape
 * @param center The center point for symmetry analysis
 * @param toleranceRatio Tolerance as a ratio of the shape size (default 0.15 = 15%)
 * @returns Symmetry analysis result
 */
function detectSymmetry(
  perimeter: Point2D[],
  center: Point2D,
  toleranceRatio: number = 0.15
): SymmetryAnalysis {
  if (perimeter.length < 4) {
    return {
      isXSymmetric: false,
      isZSymmetric: false,
      center,
      xSymmetryScore: 0,
      zSymmetryScore: 0,
    };
  }

  // Calculate shape bounds for adaptive tolerance
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of perimeter) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const avgSize = (width + depth) / 2;
  const tolerance = avgSize * toleranceRatio;

  debugLog(`[Symmetry] Analyzing ${perimeter.length} points, size=${width.toFixed(1)}x${depth.toFixed(1)}mm, tolerance=${tolerance.toFixed(1)}mm`);

  // Calculate symmetry scores
  const xSymmetryScore = calculateAxisSymmetryScore(perimeter, center, 'x', tolerance);
  const zSymmetryScore = calculateAxisSymmetryScore(perimeter, center, 'z', tolerance);

  // A shape is considered symmetric if score is above threshold
  const SYMMETRY_THRESHOLD = 0.70; // 70% of points must have a matching reflected point

  debugLog(`[Symmetry] X-axis score: ${(xSymmetryScore * 100).toFixed(1)}%, Z-axis score: ${(zSymmetryScore * 100).toFixed(1)}%`);

  return {
    isXSymmetric: xSymmetryScore >= SYMMETRY_THRESHOLD,
    isZSymmetric: zSymmetryScore >= SYMMETRY_THRESHOLD,
    center,
    xSymmetryScore,
    zSymmetryScore,
  };
}

/**
 * Calculate symmetry score for a specific axis
 * Score is the percentage of points that have a matching reflected point within tolerance
 */
function calculateAxisSymmetryScore(
  perimeter: Point2D[],
  center: Point2D,
  axis: 'x' | 'z',
  tolerance: number
): number {
  let matchCount = 0;
  
  for (const point of perimeter) {
    // Reflect point across the axis (through center)
    let reflected: Point2D;
    if (axis === 'x') {
      // Reflect across X axis (vertical line through center) - flip Z coordinate
      reflected = {
        x: point.x,
        z: 2 * center.z - point.z,
      };
    } else {
      // Reflect across Z axis (horizontal line through center) - flip X coordinate
      reflected = {
        x: 2 * center.x - point.x,
        z: point.z,
      };
    }
    
    // Find closest point on perimeter to the reflected point
    let minDist = Infinity;
    for (const other of perimeter) {
      const dist = Math.hypot(reflected.x - other.x, reflected.z - other.z);
      minDist = Math.min(minDist, dist);
    }
    
    // Count as match if within tolerance
    if (minDist <= tolerance) {
      matchCount++;
    }
  }
  
  return matchCount / perimeter.length;
}

/**
 * Generate symmetric support positions along the perimeter
 * Ensures supports are placed symmetrically about detected axes of symmetry
 * 
 * @param perimeter The boundary points
 * @param center Center of the shape
 * @param symmetry Detected symmetry
 * @param supportCount Number of supports to place
 * @returns Array of positions (0-1 normalized along perimeter) for supports
 */
function generateSymmetricSupportPositions(
  perimeter: Point2D[],
  center: Point2D,
  symmetry: SymmetryAnalysis,
  supportCount: number
): number[] {
  const n = perimeter.length;
  if (n < 3 || supportCount < 1) return [];

  // Calculate total perimeter length and edge data
  let totalLength = 0;
  const edgeLengths: number[] = [];
  const edgeCumLengths: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(perimeter[j].x - perimeter[i].x, perimeter[j].z - perimeter[i].z);
    edgeCumLengths.push(totalLength);
    edgeLengths.push(len);
    totalLength += len;
  }

  // If shape is symmetric about X axis (flip over Z)
  if (symmetry.isXSymmetric && !symmetry.isZSymmetric) {
    debugLog(`[Symmetry] Using X-axis symmetric placement`);
    return generateSingleAxisSymmetricPositions(perimeter, center, totalLength, edgeCumLengths, edgeLengths, supportCount, 'x');
  }
  
  // If shape is symmetric about Z axis (flip over X)
  if (symmetry.isZSymmetric && !symmetry.isXSymmetric) {
    debugLog(`[Symmetry] Using Z-axis symmetric placement`);
    return generateSingleAxisSymmetricPositions(perimeter, center, totalLength, edgeCumLengths, edgeLengths, supportCount, 'z');
  }
  
  // If shape is symmetric about both axes (highly symmetric, like circle or rectangle aligned with axes)
  if (symmetry.isXSymmetric && symmetry.isZSymmetric) {
    debugLog(`[Symmetry] Using dual-axis symmetric placement`);
    return generateDualAxisSymmetricPositions(perimeter, center, totalLength, edgeCumLengths, edgeLengths, supportCount);
  }
  
  // Not symmetric - use default evenly spaced positions
  debugLog(`[Symmetry] No symmetry detected, using even spacing`);
  const positions: number[] = [];
  for (let i = 0; i < supportCount; i++) {
    positions.push(i / supportCount);
  }
  return positions;
}

/**
 * Generate support positions for single-axis symmetry
 * Places supports so that each has a mirrored counterpart across the axis
 */
function generateSingleAxisSymmetricPositions(
  perimeter: Point2D[],
  center: Point2D,
  totalLength: number,
  edgeCumLengths: number[],
  edgeLengths: number[],
  supportCount: number,
  axis: 'x' | 'z'
): number[] {
  const n = perimeter.length;
  
  // Find the positions on the perimeter that cross the axis of symmetry
  // These are special "anchor" positions where we can place a support on the axis itself
  const axisCrossings: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const curr = perimeter[i];
    const next = perimeter[(i + 1) % n];
    
    // Check if this edge crosses the axis
    if (axis === 'x') {
      // X-axis symmetry: check if edge crosses the Z = center.z line
      if ((curr.z - center.z) * (next.z - center.z) < 0) {
        // Find interpolation parameter
        const t = (center.z - curr.z) / (next.z - curr.z);
        const edgeStart = edgeCumLengths[i];
        const crossingPos = (edgeStart + t * edgeLengths[i]) / totalLength;
        axisCrossings.push(crossingPos);
      }
    } else {
      // Z-axis symmetry: check if edge crosses the X = center.x line
      if ((curr.x - center.x) * (next.x - center.x) < 0) {
        const t = (center.x - curr.x) / (next.x - curr.x);
        const edgeStart = edgeCumLengths[i];
        const crossingPos = (edgeStart + t * edgeLengths[i]) / totalLength;
        axisCrossings.push(crossingPos);
      }
    }
  }
  
  debugLog(`[Symmetry] Found ${axisCrossings.length} axis crossings for ${axis}-axis`);
  
  // If no crossings found, fall back to even spacing
  if (axisCrossings.length < 2) {
    const positions: number[] = [];
    for (let i = 0; i < supportCount; i++) {
      positions.push(i / supportCount);
    }
    return positions;
  }
  
  // Sort crossings
  axisCrossings.sort((a, b) => a - b);
  
  // We have two "halves" of the perimeter - place supports symmetrically
  // Half the supports go on each half (or closest odd distribution)
  const firstCrossing = axisCrossings[0];
  const secondCrossing = axisCrossings[1] || (firstCrossing + 0.5);
  
  const halfLength1 = secondCrossing - firstCrossing;
  const halfLength2 = 1 - halfLength1;
  
  // Distribute supports, potentially placing one at each crossing if count allows
  const positions: number[] = [];
  
  if (supportCount === 4) {
    // Place 2 supports on each half, centered
    const offset1 = halfLength1 / 4;
    const offset2 = halfLength2 / 4;
    
    positions.push(firstCrossing + offset1);
    positions.push(firstCrossing + halfLength1 - offset1);
    positions.push(secondCrossing + offset2);
    positions.push((secondCrossing + halfLength2 - offset2) % 1);
  } else if (supportCount === 5) {
    // Place 1 on axis, 2 on each half
    positions.push(firstCrossing); // On axis
    
    const offset1 = halfLength1 / 3;
    const offset2 = halfLength2 / 3;
    
    positions.push(firstCrossing + offset1);
    positions.push(firstCrossing + 2 * offset1);
    positions.push(secondCrossing + offset2);
    positions.push(secondCrossing + 2 * offset2);
  } else if (supportCount === 6) {
    // Place 3 on each half
    const offset1 = halfLength1 / 4;
    const offset2 = halfLength2 / 4;
    
    positions.push(firstCrossing + offset1);
    positions.push(firstCrossing + 2 * offset1);
    positions.push(firstCrossing + 3 * offset1);
    positions.push(secondCrossing + offset2);
    positions.push(secondCrossing + 2 * offset2);
    positions.push(secondCrossing + 3 * offset2);
  } else {
    // General case: distribute evenly across half, mirror to other half
    const supportsPerHalf = Math.floor(supportCount / 2);
    const extra = supportCount % 2;
    
    // Place supports on first half
    for (let i = 0; i < supportsPerHalf; i++) {
      const t = (i + 0.5) / supportsPerHalf;
      positions.push(firstCrossing + t * halfLength1);
    }
    
    // Place supports on second half (mirrored)
    for (let i = 0; i < supportsPerHalf; i++) {
      const t = (i + 0.5) / supportsPerHalf;
      positions.push(secondCrossing + t * halfLength2);
    }
    
    // If odd, add one at a crossing
    if (extra > 0) {
      positions.push(firstCrossing);
    }
  }
  
  return positions.map(p => ((p % 1) + 1) % 1).sort((a, b) => a - b);
}

/**
 * Generate support positions for dual-axis symmetry (like circle, square, or rectangle)
 * Places supports in a symmetric pattern about both axes
 */
function generateDualAxisSymmetricPositions(
  perimeter: Point2D[],
  center: Point2D,
  totalLength: number,
  edgeCumLengths: number[],
  edgeLengths: number[],
  supportCount: number
): number[] {
  // For dual-axis symmetry, place supports at angles that maintain symmetry
  // This creates 4-fold symmetry (or as close as possible with the given count)
  
  const positions: number[] = [];
  
  if (supportCount === 4) {
    // Place at 0, 0.25, 0.5, 0.75 (quarters)
    positions.push(0, 0.25, 0.5, 0.75);
  } else if (supportCount === 5) {
    // One at center of each quadrant plus one extra
    // Actually for 5, we can't have perfect 4-fold symmetry
    // Use positions that are as symmetric as possible: corners of a pentagon
    for (let i = 0; i < 5; i++) {
      positions.push(i / 5);
    }
  } else if (supportCount === 6) {
    // Place at 0, 1/6, 2/6, 3/6, 4/6, 5/6
    for (let i = 0; i < 6; i++) {
      positions.push(i / 6);
    }
  } else {
    // General case: evenly spaced
    for (let i = 0; i < supportCount; i++) {
      positions.push(i / supportCount);
    }
  }
  
  // Find the starting position that aligns best with the geometry
  // We want supports to be at "interesting" positions - like corners or midpoints
  const bestOffset = findBestSymmetricOffset(perimeter, center, totalLength, edgeCumLengths, edgeLengths, positions);
  
  return positions.map(p => ((p + bestOffset) % 1 + 1) % 1).sort((a, b) => a - b);
}

/**
 * Find the best offset to align symmetric positions with geometric features
 * Prefers placing supports at positions far from center (corners) rather than near center
 */
function findBestSymmetricOffset(
  perimeter: Point2D[],
  center: Point2D,
  totalLength: number,
  edgeCumLengths: number[],
  edgeLengths: number[],
  basePositions: number[]
): number {
  const n = perimeter.length;
  if (n < 3 || basePositions.length === 0) return 0;
  
  // Sample the perimeter at many points to find distance-from-center profile
  const SAMPLES = 100;
  const distanceProfile: number[] = [];
  
  for (let i = 0; i < SAMPLES; i++) {
    const pos = i / SAMPLES;
    const point = getPointAtNormalizedPosition(perimeter, edgeCumLengths, edgeLengths, totalLength, pos);
    if (point) {
      const dist = Math.hypot(point.x - center.x, point.z - center.z);
      distanceProfile.push(dist);
    } else {
      distanceProfile.push(0);
    }
  }
  
  // Find offset that maximizes sum of distances at support positions
  // (This places supports at corners/far points rather than midpoints)
  let bestOffset = 0;
  let bestScore = -Infinity;
  
  for (let offset = 0; offset < 1; offset += 0.01) {
    let score = 0;
    for (const basePos of basePositions) {
      const adjustedPos = ((basePos + offset) % 1 + 1) % 1;
      const sampleIdx = Math.floor(adjustedPos * SAMPLES) % SAMPLES;
      score += distanceProfile[sampleIdx];
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  
  return bestOffset;
}

/**
 * Get a point at a normalized position (0-1) along the perimeter
 */
function getPointAtNormalizedPosition(
  perimeter: Point2D[],
  edgeCumLengths: number[],
  edgeLengths: number[],
  totalLength: number,
  normalizedPos: number
): Point2D | null {
  const n = perimeter.length;
  if (n < 2) return null;
  
  // Convert normalized position to actual length
  const pos = normalizedPos * totalLength;
  
  // Find which edge this position falls on
  let edgeIdx = 0;
  for (let e = 0; e < n; e++) {
    const nextCum = e < n - 1 ? edgeCumLengths[e + 1] : totalLength;
    if (pos < nextCum || e === n - 1) {
      edgeIdx = e;
      break;
    }
  }
  
  // Interpolate along this edge
  const edgeStart = edgeCumLengths[edgeIdx];
  const edgeLen = edgeLengths[edgeIdx];
  const t = edgeLen > 0 ? (pos - edgeStart) / edgeLen : 0;
  
  const curr = perimeter[edgeIdx];
  const next = perimeter[(edgeIdx + 1) % n];
  
  return {
    x: curr.x + t * (next.x - curr.x),
    z: curr.z + t * (next.z - curr.z),
  };
}

function computeConvexHull(inputPoints: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  if (inputPoints.length < 3) return inputPoints.map(p => ({ x: p.x, z: p.z }));
  
  // Make a copy and remove duplicates
  const uniqueMap = new Map<string, { x: number; z: number }>();
  for (const p of inputPoints) {
    const key = `${p.x.toFixed(6)},${p.z.toFixed(6)}`;
    uniqueMap.set(key, { x: p.x, z: p.z });
  }
  const points = Array.from(uniqueMap.values());
  
  if (points.length < 3) return points;
  
  // Sort lexicographically (by x, then by z)
  points.sort((a, b) => a.x !== b.x ? a.x - b.x : a.z - b.z);
  
  // Cross product of vectors OA and OB where O is origin
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  
  // Build lower hull
  const lower: Array<{ x: number; z: number }> = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  
  // Build upper hull
  const upper: Array<{ x: number; z: number }> = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  
  // Remove last point of each half (it's repeated)
  lower.pop();
  upper.pop();
  
  return [...lower, ...upper];
}

/**
 * Compute alpha shape (concave hull) using marching squares algorithm
 * This follows the actual boundary of the part shadow, not the convex hull
 */
function computeConcaveHull(
  allPoints: Array<{ x: number; z: number }>,
  convexHull: Array<{ x: number; z: number }>
): Array<{ x: number; z: number }> {
  if (allPoints.length < 10 || convexHull.length < 3) {
    return convexHull; // Fall back to convex hull for small point sets
  }
  
  // Calculate bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of allPoints) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  
  if (width < 1 || depth < 1) return convexHull;
  
  // Create a grid for alpha shape extraction
  // Use adaptive resolution based on part size
  const cellSize = Math.max(1.5, Math.min(width, depth) / 60); // Finer resolution for better shape
  const gridW = Math.ceil(width / cellSize) + 4;
  const gridH = Math.ceil(depth / cellSize) + 4;
  
  // Create occupancy grid with padding
  const grid: boolean[][] = Array.from({ length: gridH }, () => new Array(gridW).fill(false));
  
  // Mark cells that contain points
  for (const p of allPoints) {
    const gx = Math.floor((p.x - minX) / cellSize) + 2;
    const gz = Math.floor((p.z - minZ) / cellSize) + 2;
    if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridH) {
      grid[gz][gx] = true;
    }
  }
  
  // Apply morphological closing (dilate then erode) to fill small gaps
  // Dilation
  const dilated: boolean[][] = Array.from({ length: gridH }, () => new Array(gridW).fill(false));
  for (let z = 1; z < gridH - 1; z++) {
    for (let x = 1; x < gridW - 1; x++) {
      if (grid[z][x] || grid[z-1][x] || grid[z+1][x] || grid[z][x-1] || grid[z][x+1]) {
        dilated[z][x] = true;
      }
    }
  }
  
  // Erosion (to restore original size after dilation)
  const closed: boolean[][] = Array.from({ length: gridH }, () => new Array(gridW).fill(false));
  for (let z = 1; z < gridH - 1; z++) {
    for (let x = 1; x < gridW - 1; x++) {
      if (dilated[z][x] && dilated[z-1][x] && dilated[z+1][x] && dilated[z][x-1] && dilated[z][x+1]) {
        closed[z][x] = true;
      }
    }
  }
  
  // Use marching squares to extract boundary contour
  const contour = marchingSquaresContour(closed, gridW, gridH, minX, minZ, cellSize);
  
  if (contour.length < 3) {
    return convexHull;
  }
  
  // Simplify the contour to reduce point count while preserving shape
  const simplified = douglasPeuckerSimplify(contour, cellSize * 0.5);
  
  if (simplified.length < 3) {
    return convexHull;
  }
  
  return simplified;
}

/**
 * Marching squares algorithm to extract boundary contour from binary grid
 */
function marchingSquaresContour(
  grid: boolean[][],
  gridW: number,
  gridH: number,
  minX: number,
  minZ: number,
  cellSize: number
): Array<{ x: number; z: number }> {
  const contour: Array<{ x: number; z: number }> = [];
  
  // Find starting point on boundary
  let startX = -1, startZ = -1;
  outer: for (let z = 0; z < gridH - 1; z++) {
    for (let x = 0; x < gridW - 1; x++) {
      // Look for a cell where there's a transition (boundary)
      const tl = grid[z][x] ? 1 : 0;
      const tr = grid[z][x + 1] ? 1 : 0;
      const bl = grid[z + 1][x] ? 1 : 0;
      const br = grid[z + 1][x + 1] ? 1 : 0;
      const config = (tl << 3) | (tr << 2) | (br << 1) | bl;
      
      // Not all filled or all empty - this is a boundary cell
      if (config !== 0 && config !== 15) {
        startX = x;
        startZ = z;
        break outer;
      }
    }
  }
  
  if (startX < 0) return contour;
  
  // Trace the boundary
  const visited = new Set<string>();
  let x = startX, z = startZ;
  let prevDir = -1; // Previous direction to avoid going back
  
  const maxIterations = gridW * gridH * 2;
  let iterations = 0;
  
  while (iterations++ < maxIterations) {
    const key = `${x},${z}`;
    if (visited.has(key) && contour.length > 3) {
      break; // Completed the loop
    }
    visited.add(key);
    
    // Get cell configuration
    const tl = (z >= 0 && x >= 0 && z < gridH && x < gridW && grid[z][x]) ? 1 : 0;
    const tr = (z >= 0 && x + 1 >= 0 && z < gridH && x + 1 < gridW && grid[z][x + 1]) ? 1 : 0;
    const bl = (z + 1 >= 0 && x >= 0 && z + 1 < gridH && x < gridW && grid[z + 1][x]) ? 1 : 0;
    const br = (z + 1 >= 0 && x + 1 >= 0 && z + 1 < gridH && x + 1 < gridW && grid[z + 1][x + 1]) ? 1 : 0;
    
    const config = (tl << 3) | (tr << 2) | (br << 1) | bl;
    
    if (config === 0 || config === 15) {
      break; // Lost the boundary
    }
    
    // Add interpolated point based on configuration
    const worldX = minX + (x - 2) * cellSize;
    const worldZ = minZ + (z - 2) * cellSize;
    
    // Simplified marching squares - add center of boundary edge
    let px = worldX + cellSize * 0.5;
    let pz = worldZ + cellSize * 0.5;
    
    // Adjust point based on configuration for smoother boundary
    switch (config) {
      case 1: case 14: px = worldX; pz = worldZ + cellSize * 0.5; break;
      case 2: case 13: px = worldX + cellSize * 0.5; pz = worldZ + cellSize; break;
      case 3: case 12: px = worldX; pz = worldZ + cellSize; break;
      case 4: case 11: px = worldX + cellSize; pz = worldZ + cellSize * 0.5; break;
      case 6: case 9: px = worldX + cellSize; pz = worldZ + cellSize; break;
      case 7: case 8: px = worldX + cellSize; pz = worldZ; break;
    }
    
    contour.push({ x: px, z: pz });
    
    // Move to next cell based on configuration
    // Direction: 0=right, 1=down, 2=left, 3=up
    let nextDir = 0;
    switch (config) {
      case 1: case 5: case 13: nextDir = 3; break; // up
      case 2: case 3: case 7: nextDir = 0; break;  // right
      case 4: case 12: case 14: nextDir = 1; break; // down
      case 6: case 9: case 10: nextDir = 0; break;  // right
      case 8: case 11: nextDir = 2; break; // left
      default: nextDir = (prevDir + 1) % 4; break;
    }
    
    // Avoid going back
    if ((nextDir + 2) % 4 === prevDir) {
      nextDir = (nextDir + 1) % 4;
    }
    
    prevDir = nextDir;
    
    switch (nextDir) {
      case 0: x++; break; // right
      case 1: z++; break; // down
      case 2: x--; break; // left
      case 3: z--; break; // up
    }
    
    // Bounds check
    if (x < 0 || x >= gridW - 1 || z < 0 || z >= gridH - 1) {
      break;
    }
  }
  
  return contour;
}

/**
 * Douglas-Peucker line simplification algorithm
 */
function douglasPeuckerSimplify(
  points: Array<{ x: number; z: number }>,
  tolerance: number
): Array<{ x: number; z: number }> {
  if (points.length <= 2) return points;
  
  // Find the point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  
  const first = points[0];
  const last = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = douglasPeuckerSimplify(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeuckerSimplify(points.slice(maxIndex), tolerance);
    
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

/**
 * Calculate perpendicular distance from point to line segment
 */
function perpendicularDistance(
  point: { x: number; z: number },
  lineStart: { x: number; z: number },
  lineEnd: { x: number; z: number }
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

/**
 * Calculate the signed area of a polygon (positive = counter-clockwise)
 */
function polygonSignedArea(points: Array<{ x: number; z: number }>): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].z;
    area -= points[j].x * points[i].z;
  }
  return area / 2;
}

/**
 * Offset a convex polygon outward by inserting arc segments at corners
 * This prevents self-intersection that can occur with simple miter offsets
 */
function offsetPolygon(
  inputPoints: Array<{ x: number; z: number }>,
  offset: number
): Array<{ x: number; z: number }> {
  if (inputPoints.length < 3 || offset === 0) return inputPoints.map(p => ({ x: p.x, z: p.z }));
  
  // Make a copy
  const points = inputPoints.map(p => ({ x: p.x, z: p.z }));
  
  // Ensure counter-clockwise winding
  const signedArea = polygonSignedArea(points);
  if (signedArea < 0) {
    points.reverse();
  }
  
  const result: Array<{ x: number; z: number }> = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Edge vectors
    const dx1 = curr.x - prev.x;
    const dz1 = curr.z - prev.z;
    const len1 = Math.hypot(dx1, dz1);
    
    const dx2 = next.x - curr.x;
    const dz2 = next.z - curr.z;
    const len2 = Math.hypot(dx2, dz2);
    
    // Skip degenerate edges
    if (len1 < 1e-10 || len2 < 1e-10) {
      continue;
    }
    
    // Outward normals for CCW polygon
    // Rotate edge direction 90° CCW to get outward normal
    const n1x = -dz1 / len1;
    const n1z = dx1 / len1;
    
    const n2x = -dz2 / len2;
    const n2z = dx2 / len2;
    
    // Cross product determines if convex (positive) or concave (negative) corner
    const cross = dx1 * dz2 - dz1 * dx2;
    
    if (cross >= 0) {
      // Convex corner - insert arc to round the corner
      const angle1 = Math.atan2(n1z, n1x);
      const angle2 = Math.atan2(n2z, n2x);
      
      // Calculate angular span (always go CCW from angle1 to angle2)
      let angleDiff = angle2 - angle1;
      while (angleDiff < 0) angleDiff += 2 * Math.PI;
      while (angleDiff > 2 * Math.PI) angleDiff -= 2 * Math.PI;
      
      // For convex corners, the angle difference should be < PI
      // If it's >= PI, we have a reflex angle and should go the other way
      if (angleDiff > Math.PI) {
        angleDiff = angleDiff - 2 * Math.PI;
      }
      
      // Number of arc segments (more for sharper corners)
      const numSegments = Math.max(2, Math.ceil(Math.abs(angleDiff) / (Math.PI / 8)));
      
      for (let j = 0; j <= numSegments; j++) {
        const t = j / numSegments;
        const angle = angle1 + angleDiff * t;
        result.push({
          x: curr.x + Math.cos(angle) * offset,
          z: curr.z + Math.sin(angle) * offset,
        });
      }
    } else {
      // Concave corner (shouldn't happen for convex hull, but handle anyway)
      // Use simple miter with limit
      const avgNx = n1x + n2x;
      const avgNz = n1z + n2z;
      const avgLen = Math.hypot(avgNx, avgNz);
      
      if (avgLen > 1e-10) {
        result.push({
          x: curr.x + (avgNx / avgLen) * offset,
          z: curr.z + (avgNz / avgLen) * offset,
        });
      } else {
        result.push({
          x: curr.x + n1x * offset,
          z: curr.z + n1z * offset,
        });
      }
    }
  }
  
  // Take convex hull of result to ensure no self-intersections
  if (result.length >= 3) {
    return computeConvexHull(result);
  }
  
  return result;
}

/**
 * Simplify a polygon by removing vertices that are too close together
 * Ensures minimum edge length between adjacent vertices
 */
function simplifyPolygon(
  points: Array<{ x: number; z: number }>,
  minEdgeLength: number = 5 // 5mm minimum distance between adjacent vertices
): Array<{ x: number; z: number }> {
  if (points.length < 3 || minEdgeLength <= 0) return points.map(p => ({ x: p.x, z: p.z }));
  
  const result: Array<{ x: number; z: number }> = [];
  
  // Start with the first point
  result.push({ x: points[0].x, z: points[0].z });
  
  // Iterate through remaining points
  for (let i = 1; i < points.length; i++) {
    const lastPoint = result[result.length - 1];
    const currPoint = points[i];
    
    // Calculate distance from last added point
    const dist = Math.hypot(currPoint.x - lastPoint.x, currPoint.z - lastPoint.z);
    
    if (dist >= minEdgeLength) {
      result.push({ x: currPoint.x, z: currPoint.z });
    }
  }
  
  // Check if the last point is too close to the first point
  if (result.length > 2) {
    const first = result[0];
    const last = result[result.length - 1];
    const closingDist = Math.hypot(last.x - first.x, last.z - first.z);
    
    if (closingDist < minEdgeLength) {
      // Remove the last point if it's too close to the first
      result.pop();
    }
  }
  
  // Ensure we still have at least 3 points for a valid polygon
  if (result.length < 3) {
    return points.map(p => ({ x: p.x, z: p.z }));
  }
  
  return result;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Fixture-Style Support Placement Algorithm
 * 
 * Creates discrete custom supports around the part boundary:
 * 
 * 1. PERIMETER SUPPORTS: Wedge-shaped supports along the boundary that span from
 *    the expanded shadow (outer edge, 20% outside part) inward to about 20% into
 *    the actual part shadow. This creates supports that touch the part.
 *    - Adjacent supports are merged if they're close together
 *    - Wider gaps between distinct supports
 * 
 * 2. OVERHANG SUPPORTS: Heavily biased supports under visible overhang regions
 *    that penetrate deep into the shadow for proper support. These are prioritized
 *    and inflated significantly to ensure overhanging parts are well supported.
 * 
 * Each support is a custom polygon - trapezoidal shapes along edges.
 */
export function placeOverhangSupports(
  meshes: THREE.Object3D[],
  baseTopY: number,
  options: OverhangPlacementOptions = {}
): OverhangPlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // TARGET: 4-6 supports total per part
  const TARGET_SUPPORT_COUNT = 5; // Target number of supports
  const MIN_SUPPORTS = 4;
  const MAX_SUPPORTS = 6;
  
  const INWARD_PENETRATION = 0.40; // 40% penetration into the part shadow (DEEPER)
  const GAP_BETWEEN_SUPPORTS = 10; // mm - smaller gap between supports
  
  // Overhang support settings
  const OVERHANG_INFLATION = 20; // mm - inflate overhang regions
  const OVERHANG_PENETRATION = 0.60; // 60% - overhangs go deeper into shadow
  const OVERHANG_MIN_CLUSTER_AREA = 30; // mm² - only significant overhangs
  const OVERHANG_CLUSTER_DISTANCE = 80; // mm - large clustering
  
  // Step 1: Compute the part's shadow (2D projection onto XZ plane)
  const shadow = computePartShadow(meshes, baseTopY);
  
  if (shadow.shadowHull.length < 3) {
    return {
      supports: [],
      clusters: [],
      message: 'Could not compute part shadow - model may be too small or below baseplate',
      totalOverhangArea: 0,
    };
  }
  
  debugLog(`[FixtureSupport] Shadow: ${shadow.shadowHull.length} points, expanded: ${shadow.expandedShadow.length} points`);
  debugLog(`[FixtureSupport] Shadow area=${shadow.area.toFixed(1)}mm², center=(${shadow.center.x.toFixed(1)}, ${shadow.center.z.toFixed(1)})`);
  
  // Step 1b: Get ACCURATE perimeter using raycast from above
  // This gives us the true part silhouette, not just vertex projection
  const raycastSilhouette = computeRaycastSilhouette(meshes, baseTopY, shadow.bounds);
  
  // Use raycast silhouette if valid, otherwise fall back to shadow hull
  const actualPerimeter = raycastSilhouette.length >= 3 ? raycastSilhouette : shadow.shadowHull;
  
  debugLog(`[FixtureSupport] Raycast silhouette: ${raycastSilhouette.length} points (using ${raycastSilhouette.length >= 3 ? 'raycast' : 'fallback'})`);
  debugLog(`[FixtureSupport] actualPerimeter has ${actualPerimeter.length} points`);
  if (actualPerimeter.length > 0) {
    debugLog(`[FixtureSupport] First perimeter point: (${actualPerimeter[0].x.toFixed(1)}, ${actualPerimeter[0].z.toFixed(1)})`);
    if (actualPerimeter.length > 1) {
      const last = actualPerimeter[actualPerimeter.length - 1];
      debugLog(`[FixtureSupport] Last perimeter point: (${last.x.toFixed(1)}, ${last.z.toFixed(1)})`);
    }
  }
  // Calculate center from actual perimeter
  let perimeterCenterX = 0, perimeterCenterZ = 0;
  for (const p of actualPerimeter) {
    perimeterCenterX += p.x;
    perimeterCenterZ += p.z;
  }
  perimeterCenterX /= actualPerimeter.length;
  perimeterCenterZ /= actualPerimeter.length;
  const perimeterCenter = { x: perimeterCenterX, z: perimeterCenterZ };
  
  // Step 2: Find ALL overhangs (no undercut filtering - support the full overhang extent)
  const allOverhangs = findAllOverhangs(meshes, baseTopY, opts);
  const totalOverhangArea = allOverhangs.reduce((sum, p) => sum + p.area, 0);
  
  debugLog(`[FixtureSupport] ALL overhangs (60° threshold): ${allOverhangs.length} points, area=${totalOverhangArea.toFixed(1)}mm²`);
  
  // Step 3: Determine support height - use the lowest point of the part
  let lowestY = Infinity;
  meshes.forEach(obj => {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      
      const geometry = child.geometry;
      const positionAttr = geometry.getAttribute('position');
      if (!positionAttr) return;
      
      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld;
      
      for (let i = 0; i < positionAttr.count; i++) {
        const vertex = new THREE.Vector3(
          positionAttr.getX(i),
          positionAttr.getY(i),
          positionAttr.getZ(i)
        ).applyMatrix4(worldMatrix);
        
        if (vertex.y > baseTopY) {
          lowestY = Math.min(lowestY, vertex.y);
        }
      }
    });
  });
  
  if (lowestY === Infinity) {
    lowestY = baseTopY + 10;
  }
  
  const supportHeight = Math.max(1, lowestY - baseTopY - opts.contactOffset);
  
  let supports: CustomSupport[] = [];
  const clusters: OverhangCluster[] = [];
  let supportIndex = 0;
  
  // Step 4: Create supports that STRADDLE the boundary line
  // Each support extends both INSIDE and OUTSIDE the silhouette boundary
  // This ensures the support surrounds/captures the part edge
  
  // Calculate part dimensions to determine inward depth (30-40% of smallest dimension)
  let minPartX = Infinity, maxPartX = -Infinity;
  let minPartZ = Infinity, maxPartZ = -Infinity;
  for (const p of actualPerimeter) {
    minPartX = Math.min(minPartX, p.x);
    maxPartX = Math.max(maxPartX, p.x);
    minPartZ = Math.min(minPartZ, p.z);
    maxPartZ = Math.max(maxPartZ, p.z);
  }
  const partWidth = maxPartX - minPartX;
  const partDepth = maxPartZ - minPartZ;
  const smallestDimension = Math.min(partWidth, partDepth);
  
  // Calculate perimeter length to determine max safe inward depth
  let perimeterLength = 0;
  for (let i = 0; i < actualPerimeter.length; i++) {
    const j = (i + 1) % actualPerimeter.length;
    perimeterLength += Math.hypot(
      actualPerimeter[j].x - actualPerimeter[i].x,
      actualPerimeter[j].z - actualPerimeter[i].z
    );
  }
  
  // Calculate max inward depth to prevent overlapping supports
  // Each support occupies ~40% of its segment, so the support width along perimeter is:
  // supportWidth = (perimeter / supportCount) * 0.40
  // To avoid overlap at the inner edge, the inward depth should not exceed:
  // maxSafeInward = supportWidth / 2 (conservative estimate for curved boundaries)
  const segmentLength = perimeterLength / TARGET_SUPPORT_COUNT;
  const supportWidthAlongPerimeter = segmentLength * 0.40;
  const maxSafeInwardDepth = supportWidthAlongPerimeter * 0.4; // 40% of support width to be safe
  
  // Inward depth: 35% of smallest dimension, but limited to prevent overlap
  const INWARD_DEPTH_RATIO = 0.35; // 35% into the part
  const desiredInwardDepth = smallestDimension * INWARD_DEPTH_RATIO;
  const SUPPORT_INWARD_DEPTH = Math.max(8, Math.min(desiredInwardDepth, maxSafeInwardDepth, 50));
  
  // Outward depth: 10% of smallest dimension
  // Clamped to reasonable min/max values
  const OUTWARD_DEPTH_RATIO = 0.10; // 10% outside the part
  const SUPPORT_OUTWARD_DEPTH = Math.max(5, Math.min(20, smallestDimension * OUTWARD_DEPTH_RATIO));
  
  const MIN_SUPPORT_WIDTH = 15;     // mm - minimum width along the boundary
  const MERGE_DISTANCE = 5;         // mm - merge supports closer than this (reduced from 20)
  
  debugLog(`[FixtureSupport] Part size: ${partWidth.toFixed(1)}x${partDepth.toFixed(1)}mm, smallest=${smallestDimension.toFixed(1)}mm`);
  debugLog(`[FixtureSupport] Perimeter: ${perimeterLength.toFixed(1)}mm, segment=${segmentLength.toFixed(1)}mm`);
  debugLog(`[FixtureSupport] Desired inward: ${desiredInwardDepth.toFixed(1)}mm, max safe: ${maxSafeInwardDepth.toFixed(1)}mm`);
  debugLog(`[FixtureSupport] Calculated inward depth: ${SUPPORT_INWARD_DEPTH.toFixed(1)}mm`);
  debugLog(`[FixtureSupport] Calculated outward depth: ${SUPPORT_OUTWARD_DEPTH.toFixed(1)}mm`);
  
  // Step 5: Create BOUNDARY-STRADDLING supports around the perimeter
  const perimeterSupports = createBoundaryStraddlingSupports(
    actualPerimeter,        // the accurate silhouette boundary
    perimeterCenter,        // center of perimeter
    supportHeight,
    TARGET_SUPPORT_COUNT,
    MIN_SUPPORTS,
    MAX_SUPPORTS,
    SUPPORT_INWARD_DEPTH,
    SUPPORT_OUTWARD_DEPTH,
    MIN_SUPPORT_WIDTH,
    MERGE_DISTANCE,
    baseTopY,
    opts,
    supportIndex
  );
  
  // Check for overlapping supports and merge them
  const mergedPerimeterSupports = mergeOverlappingSupports(perimeterSupports, MERGE_DISTANCE, baseTopY, opts);
  
  for (const sup of mergedPerimeterSupports) {
    supports.push(sup.support);
    clusters.push(sup.cluster);
    supportIndex++;
  }
  
  debugLog(`[FixtureSupport] Created ${perimeterSupports.length} boundary supports, merged to ${mergedPerimeterSupports.length}`);
  
  // Step 6: Check for significant interior overhangs that need additional supports
  // Only add if we have room (haven't hit MAX_SUPPORTS)
  let overhangSupports: CustomSupport[] = [];
  const remainingSlots = MAX_SUPPORTS - supports.length;
  
  if (allOverhangs.length > 0 && remainingSlots > 0) {
    // Cluster overhangs with large distance to combine them
    const overhangClusters = clusterOverhangPoints(allOverhangs, OVERHANG_CLUSTER_DISTANCE);
    // Filter by minimum area - only significant interior overhangs
    const significantClusters = overhangClusters
      .filter(c => c.totalArea >= OVERHANG_MIN_CLUSTER_AREA)
      .sort((a, b) => b.totalArea - a.totalArea); // Sort by area, largest first
    
    debugLog(`[FixtureSupport] ${significantClusters.length} overhang clusters, ${remainingSlots} slots remaining`);
    
    // Calculate the "coverage radius" of perimeter supports - increase buffer to avoid overlap
    const perimeterCoverageRadius = SUPPORT_INWARD_DEPTH + SUPPORT_OUTWARD_DEPTH + 15; // Use actual depths + buffer
    
    // Calculate max size for center support - should be SMALLER than boundary supports
    // Use 60% of the inward depth as max radius for center support
    const maxCenterSupportSize = SUPPORT_INWARD_DEPTH * 0.6;
    const centerInflation = Math.min(OVERHANG_INFLATION * 0.3, maxCenterSupportSize * 0.5); // Reduced inflation
    const centerPenetration = 0.2; // Much less penetration for center support
    
    debugLog(`[FixtureSupport] Center support max size: ${maxCenterSupportSize.toFixed(1)}mm, inflation: ${centerInflation.toFixed(1)}mm`);
    
    let addedOverhangs = 0;
    
    for (const cluster of significantClusters) {
      // Stop if we've hit the max
      if (addedOverhangs >= remainingSlots) break;
      
      // Check distance from overhang centroid to the RAYCAST perimeter boundary
      const distToBoundary = distanceToPolygonBoundary(
        { x: cluster.centroidX, z: cluster.centroidZ },
        actualPerimeter  // Use raycast perimeter, NOT convex hull
      );
      
      // ONLY create interior overhang support if it's FAR from the perimeter
      // Increased minimum distance to prevent overlap with boundary supports
      if (distToBoundary < perimeterCoverageRadius) {
        debugLog(`[FixtureSupport] Skipping overhang near perimeter (dist=${distToBoundary.toFixed(1)}mm < ${perimeterCoverageRadius.toFixed(1)}mm)`);
        continue;
      }
      
      // This is a truly interior overhang - create SMALLER support for it
      debugLog(`[FixtureSupport] Creating interior overhang support (area=${cluster.totalArea.toFixed(1)}mm², dist=${distToBoundary.toFixed(1)}mm)`);
      
      const overhangSupport = createInflatedOverhangSupport(
        cluster,
        perimeterCenter,  // Use raycast perimeter center
        centerInflation,  // Use reduced inflation
        centerPenetration,  // Use reduced penetration
        baseTopY,
        opts,
        supportIndex++,
        maxCenterSupportSize  // Pass max size constraint
      );
      
      overhangSupports.push(overhangSupport);
      clusters.push(cluster);
      addedOverhangs++;
    }
    
    // Add overhang supports to the list
    supports.push(...overhangSupports);
    
    debugLog(`[FixtureSupport] Total supports: ${supports.length}`);
  }
  
  // Filter out any thin supports that slipped through
  const FILTER_MIN_WIDTH = 10; // mm - minimum width in any direction
  const filteredSupports = filterThinSupports(supports, FILTER_MIN_WIDTH);
  
  debugLog(`[FixtureSupport] Filtered: ${supports.length} -> ${filteredSupports.length} supports (removed ${supports.length - filteredSupports.length} thin supports)`);
  
  // Calculate material usage
  const solidVolume = shadow.area * supportHeight;
  const actualVolume = filteredSupports.reduce((sum, s) => {
    const polyArea = calculatePolygonArea(s.polygon);
    return sum + polyArea * s.height;
  }, 0);
  const savingsPercent = solidVolume > 0 ? ((1 - actualVolume / solidVolume) * 100).toFixed(0) : 0;
  
  const perimeterCount = perimeterSupports.length;
  const overhangCount = overhangSupports.length;
  
  const message = overhangCount === 0
    ? `Created ${filteredSupports.length} perimeter supports (~${savingsPercent}% material savings)`
    : `Created ${filteredSupports.length} supports: ${filteredSupports.length - overhangCount} perimeter + ${overhangCount} overhang (~${savingsPercent}% savings)`;
  
  return {
    supports: filteredSupports,
    clusters,
    message,
    totalOverhangArea,
    debugPerimeter: actualPerimeter, // Return the raycast perimeter for visualization
  };
}

/**
 * Check if two support polygons overlap by checking if their bounding boxes overlap
 * and if their centers are within a certain distance
 */
function supportsOverlap(
  sup1: { support: CustomSupport; cluster: OverhangCluster },
  sup2: { support: CustomSupport; cluster: OverhangCluster },
  mergeDistance: number
): boolean {
  const c1 = sup1.support.center;
  const c2 = sup2.support.center;
  
  // Check center distance
  const centerDist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
  
  // Get bounding boxes
  const bb1 = sup1.cluster.boundingBox;
  const bb2 = sup2.cluster.boundingBox;
  
  // Check if bounding boxes overlap (with merge distance buffer)
  const boxesOverlap = !(
    bb1.maxX + mergeDistance < bb2.minX ||
    bb2.maxX + mergeDistance < bb1.minX ||
    bb1.maxZ + mergeDistance < bb2.minZ ||
    bb2.maxZ + mergeDistance < bb1.minZ
  );
  
  // Also check if one polygon point is inside the other
  // Use a simpler heuristic: if center distance is less than sum of "radii"
  const radius1 = Math.max(sup1.cluster.width, sup1.cluster.depth) / 2;
  const radius2 = Math.max(sup2.cluster.width, sup2.cluster.depth) / 2;
  const minSeparation = radius1 + radius2 - mergeDistance;
  
  return boxesOverlap || centerDist < minSeparation;
}

/**
 * Merge overlapping supports into a single support using convex hull
 */
function mergeOverlappingSupports(
  supports: Array<{ support: CustomSupport; cluster: OverhangCluster }>,
  mergeDistance: number,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>
): Array<{ support: CustomSupport; cluster: OverhangCluster }> {
  if (supports.length <= 1) return supports;
  
  // Build adjacency list for overlapping supports
  const n = supports.length;
  const overlaps: boolean[][] = Array(n).fill(null).map(() => Array(n).fill(false));
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (supportsOverlap(supports[i], supports[j], mergeDistance)) {
        overlaps[i][j] = true;
        overlaps[j][i] = true;
      }
    }
  }
  
  // Find connected components (groups of overlapping supports)
  const visited = Array(n).fill(false);
  const groups: number[][] = [];
  
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    
    // BFS to find all connected supports
    const group: number[] = [];
    const queue = [i];
    visited[i] = true;
    
    while (queue.length > 0) {
      const curr = queue.shift()!;
      group.push(curr);
      
      for (let j = 0; j < n; j++) {
        if (!visited[j] && overlaps[curr][j]) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    
    groups.push(group);
  }
  
  debugLog(`[MergeSupports] Found ${groups.length} groups from ${n} supports`);
  
  // Merge each group
  const mergedSupports: Array<{ support: CustomSupport; cluster: OverhangCluster }> = [];
  
  for (const group of groups) {
    if (group.length === 1) {
      // No merge needed
      mergedSupports.push(supports[group[0]]);
    } else {
      // Merge multiple supports
      debugLog(`[MergeSupports] Merging group of ${group.length} supports`);
      
      // Collect all polygon points from all supports in the group
      const allPoints: Point2D[] = [];
      let totalHeight = 0;
      
      for (const idx of group) {
        const sup = supports[idx];
        const center = sup.support.center;
        
        // Convert local polygon points to world coordinates
        for (const [lx, lz] of sup.support.polygon) {
          allPoints.push({
            x: center.x + lx,
            z: center.y + lz,  // Note: center.y is actually Z coordinate
          });
        }
        
        totalHeight = Math.max(totalHeight, sup.support.height);
      }
      
      // Compute convex hull of all points
      const hull = computeConvexHull(allPoints);
      
      // Simplify to max 5mm edge length
      const simplified = simplifyPolygon(hull, 5);
      
      // Calculate new center
      let newCenterX = 0, newCenterZ = 0;
      for (const p of simplified) {
        newCenterX += p.x;
        newCenterZ += p.z;
      }
      newCenterX /= simplified.length;
      newCenterZ /= simplified.length;
      
      // Convert to local coordinates
      const polygon: Array<[number, number]> = simplified.map(p => [
        p.x - newCenterX,
        p.z - newCenterZ,
      ]);
      
      // Create merged support
      const mergedSupport: CustomSupport = {
        id: `sup-merged-${Date.now()}-${mergedSupports.length}`,
        type: 'custom',
        center: new THREE.Vector2(newCenterX, newCenterZ),
        height: totalHeight,
        baseY: baseTopY,
        contactOffset: options.contactOffset,
        polygon,
        cornerRadius: options.cornerRadius,
      };
      
      // Create merged cluster info
      const allX = simplified.map(p => p.x);
      const allZ = simplified.map(p => p.z);
      
      const mergedCluster: OverhangCluster = {
        points: [],
        centroidX: newCenterX,
        centroidZ: newCenterZ,
        minY: baseTopY + totalHeight,
        maxY: baseTopY + totalHeight,
        boundingBox: {
          minX: Math.min(...allX),
          maxX: Math.max(...allX),
          minZ: Math.min(...allZ),
          maxZ: Math.max(...allZ),
        },
        width: Math.max(...allX) - Math.min(...allX),
        depth: Math.max(...allZ) - Math.min(...allZ),
        aspectRatio: 1,
        totalArea: calculatePolygonArea(polygon),
      };
      
      mergedSupports.push({ support: mergedSupport, cluster: mergedCluster });
    }
  }
  
  return mergedSupports;
}

/**
 * Create supports that STRADDLE the boundary line
 * Each support extends both inside and outside the silhouette
 * Uses 8-sided octagons at start and end connected by the boundary line
 * 
 * Now with SYMMETRIC PLACEMENT: Detects if the part is symmetric and places
 * supports symmetrically about the axis of symmetry for better aesthetics
 * and more balanced support of symmetric parts.
 */
function createBoundaryStraddlingSupports(
  boundary: Point2D[],
  center: Point2D,
  height: number,
  targetCount: number,
  minCount: number,
  maxCount: number,
  inwardDepth: number,
  outwardDepth: number,
  minSupportWidth: number,
  mergeDistance: number,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>,
  startIndex: number
): Array<{ support: CustomSupport; cluster: OverhangCluster }> {
  const n = boundary.length;
  if (n < 3) return [];
  
  // Maximum edge length for simplified polygon (5mm)
  const MAX_EDGE_LENGTH = 5;
  
  // Calculate total perimeter length
  let totalLength = 0;
  const edgeLengths: number[] = [];
  const edgeCumLengths: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(boundary[j].x - boundary[i].x, boundary[j].z - boundary[i].z);
    edgeCumLengths.push(totalLength);
    edgeLengths.push(len);
    totalLength += len;
  }
  
  // Determine support count
  const supportCount = Math.max(minCount, Math.min(maxCount, targetCount));
  
  // Each segment: 40% support, 60% gap
  const segmentLength = totalLength / supportCount;
  const supportLength = segmentLength * 0.40;  // 40% of segment is support
  const gapLength = segmentLength * 0.60;      // 60% of segment is gap
  
  debugLog(`[BoundarySupports] Perimeter=${totalLength.toFixed(1)}mm, ${supportCount} supports`);
  debugLog(`[BoundarySupports] Segment=${segmentLength.toFixed(1)}mm (support=${supportLength.toFixed(1)}mm, gap=${gapLength.toFixed(1)}mm)`);
  debugLog(`[BoundarySupports] Depth: inward=${inwardDepth.toFixed(1)}mm, outward=${outwardDepth}mm`);
  
  // SYMMETRY DETECTION: Analyze the boundary for symmetry
  const symmetry = detectSymmetry(boundary, center);
  
  // Generate support positions based on symmetry
  const normalizedPositions = generateSymmetricSupportPositions(
    boundary,
    center,
    symmetry,
    supportCount
  );
  
  debugLog(`[BoundarySupports] Symmetry: X=${symmetry.isXSymmetric}, Z=${symmetry.isZSymmetric}`);
  debugLog(`[BoundarySupports] Support positions: ${normalizedPositions.map(p => (p * 100).toFixed(1) + '%').join(', ')}`);
  
  const supports: Array<{ support: CustomSupport; cluster: OverhangCluster }> = [];
  
  for (let i = 0; i < supportCount; i++) {
    // Use symmetric positions instead of evenly spaced
    const normalizedPos = normalizedPositions[i] || (i / supportCount);
    const supportCenter = normalizedPos * totalLength;
    
    // Support extends supportLength/2 on each side of center position
    const supportStart = supportCenter - supportLength / 2;
    const supportEnd = supportCenter + supportLength / 2;
    
    // Get start and end points on the boundary
    const startPoint = getPointAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, supportStart);
    const endPoint = getPointAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, supportEnd);
    
    if (!startPoint || !endPoint) {
      debugLog(`[BoundarySupports] Support ${i}: couldn't get start/end points`);
      continue;
    }
    
    // Get normals at start and end
    const startNormal = getNormalAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, supportStart, center);
    const endNormal = getNormalAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, supportEnd, center);
    
    if (!startNormal || !endNormal) {
      debugLog(`[BoundarySupports] Support ${i}: couldn't get normals`);
      continue;
    }
    
    // Create a simple 6-point hexagon-like shape at each end
    // This is lower resolution than the 8-sided octagon
    const allPoints: Point2D[] = [];
    
    // START end: 4 key points (simplified from octagon)
    // Outer point
    allPoints.push({
      x: startPoint.x + startNormal.x * outwardDepth,
      z: startPoint.z + startNormal.z * outwardDepth,
    });
    // Inner point
    allPoints.push({
      x: startPoint.x - startNormal.x * inwardDepth,
      z: startPoint.z - startNormal.z * inwardDepth,
    });
    // Left perpendicular point (at boundary)
    const startPerp = { x: -startNormal.z, z: startNormal.x };
    const perpRadius = Math.min(inwardDepth, outwardDepth) * 0.5;
    allPoints.push({
      x: startPoint.x + startPerp.x * perpRadius,
      z: startPoint.z + startPerp.z * perpRadius,
    });
    // Right perpendicular point (at boundary)
    allPoints.push({
      x: startPoint.x - startPerp.x * perpRadius,
      z: startPoint.z - startPerp.z * perpRadius,
    });
    
    // END end: 4 key points (simplified from octagon)
    // Outer point
    allPoints.push({
      x: endPoint.x + endNormal.x * outwardDepth,
      z: endPoint.z + endNormal.z * outwardDepth,
    });
    // Inner point
    allPoints.push({
      x: endPoint.x - endNormal.x * inwardDepth,
      z: endPoint.z - endNormal.z * inwardDepth,
    });
    // Left perpendicular point (at boundary)
    const endPerp = { x: -endNormal.z, z: endNormal.x };
    allPoints.push({
      x: endPoint.x + endPerp.x * perpRadius,
      z: endPoint.z + endPerp.z * perpRadius,
    });
    // Right perpendicular point (at boundary)
    allPoints.push({
      x: endPoint.x - endPerp.x * perpRadius,
      z: endPoint.z - endPerp.z * perpRadius,
    });
    
    // Add sparse samples along the boundary (every 10mm instead of 5mm)
    const SAMPLE_INTERVAL = 10; // mm between samples (reduced resolution)
    const totalSamples = Math.max(1, Math.floor(supportLength / SAMPLE_INTERVAL));
    
    for (let s = 1; s < totalSamples; s++) {
      const pos = supportStart + s * SAMPLE_INTERVAL;
      
      // Skip if too close to start or end
      if (pos <= supportStart + 3 || pos >= supportEnd - 3) continue;
      
      const boundaryPoint = getPointAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, pos);
      const normal = getNormalAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, pos, center);
      
      if (boundaryPoint && normal) {
        // Add outer and inner points only
        allPoints.push({
          x: boundaryPoint.x + normal.x * outwardDepth,
          z: boundaryPoint.z + normal.z * outwardDepth,
        });
        allPoints.push({
          x: boundaryPoint.x - normal.x * inwardDepth,
          z: boundaryPoint.z - normal.z * inwardDepth,
        });
      }
    }
    
    if (allPoints.length < 6) {
      debugLog(`[BoundarySupports] Support ${i}: too few points (${allPoints.length})`);
      continue;
    }
    
    // Compute convex hull of all points
    let hull = computeConvexHull(allPoints);
    
    if (hull.length < 3) {
      debugLog(`[BoundarySupports] Support ${i}: hull too small (${hull.length})`);
      continue;
    }
    
    // Simplify hull to ensure no edge is longer than MAX_EDGE_LENGTH (5mm)
    // This reduces the polygon resolution
    hull = simplifyPolygonToMaxEdge(hull, MAX_EDGE_LENGTH);
    
    // Calculate center of hull
    let centerX = 0, centerZ = 0;
    for (const p of hull) {
      centerX += p.x;
      centerZ += p.z;
    }
    centerX /= hull.length;
    centerZ /= hull.length;
    
    // Convert to local coordinates
    const polygon: Array<[number, number]> = hull.map(p => [
      p.x - centerX,
      p.z - centerZ,
    ]);
    
    // Create support
    const support: CustomSupport = {
      id: `sup-boundary-${Date.now()}-${startIndex + i}`,
      type: 'custom',
      center: new THREE.Vector2(centerX, centerZ),
      height,
      baseY: baseTopY,
      contactOffset: options.contactOffset,
      polygon,
      cornerRadius: options.cornerRadius,
    };
    
    // Create cluster info
    const allX = hull.map(p => p.x);
    const allZ = hull.map(p => p.z);
    
    const cluster: OverhangCluster = {
      points: [],
      centroidX: centerX,
      centroidZ: centerZ,
      minY: baseTopY + height,
      maxY: baseTopY + height,
      boundingBox: {
        minX: Math.min(...allX),
        maxX: Math.max(...allX),
        minZ: Math.min(...allZ),
        maxZ: Math.max(...allZ),
      },
      width: Math.max(...allX) - Math.min(...allX),
      depth: Math.max(...allZ) - Math.min(...allZ),
      aspectRatio: 1,
      totalArea: calculatePolygonArea(polygon),
    };
    
    debugLog(`[BoundarySupports] Support ${i}: ${hull.length} hull points (simplified), area=${cluster.totalArea.toFixed(1)}mm²`);
    
    supports.push({ support, cluster });
  }
  
  debugLog(`[BoundarySupports] Created ${supports.length} supports`);
  
  return supports;
}

/**
 * Simplify a polygon by reducing points while ensuring no edge exceeds maxLength
 * Uses Douglas-Peucker-like simplification but with edge length constraint
 */
function simplifyPolygonToMaxEdge(polygon: Point2D[], maxLength: number): Point2D[] {
  if (polygon.length <= 4) return polygon;
  
  // First pass: remove points that are too close together
  const MIN_POINT_DISTANCE = maxLength * 0.3; // Don't keep points closer than 30% of max edge
  const filtered: Point2D[] = [polygon[0]];
  
  for (let i = 1; i < polygon.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = polygon[i];
    const dist = Math.hypot(curr.x - prev.x, curr.z - prev.z);
    
    if (dist >= MIN_POINT_DISTANCE) {
      filtered.push(curr);
    }
  }
  
  // Ensure we have at least 4 points for a valid polygon
  if (filtered.length < 4) return polygon;
  
  // Second pass: Douglas-Peucker simplification with tolerance based on max edge length
  const tolerance = maxLength * 0.5; // Simplification tolerance
  const simplified = douglasPeuckerSimplify(filtered, tolerance);
  
  // Ensure result has reasonable number of points (not too few, not too many)
  if (simplified.length < 4) return filtered;
  if (simplified.length > 12) {
    // If still too many points, be more aggressive
    return douglasPeuckerSimplify(simplified, tolerance * 1.5);
  }
  
  return simplified;
}

/**
 * Get the outward-pointing normal at a specific position along the boundary
 */
function getNormalAtPosition(
  boundary: Point2D[],
  edgeCumLengths: number[],
  edgeLengths: number[],
  totalLength: number,
  pos: number,
  center: Point2D
): Point2D | null {
  // Get points slightly before and after to calculate tangent
  const posPrev = pos - 1;
  const posNext = pos + 1;
  const prevPoint = getPointAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, posPrev);
  const nextPoint = getPointAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, posNext);
  const currentPoint = getPointAtPosition(boundary, edgeCumLengths, edgeLengths, totalLength, pos);
  
  if (!prevPoint || !nextPoint || !currentPoint) return null;
  
  // Calculate tangent
  const tangentX = nextPoint.x - prevPoint.x;
  const tangentZ = nextPoint.z - prevPoint.z;
  const tangentLen = Math.hypot(tangentX, tangentZ);
  
  if (tangentLen < 0.001) return null;
  
  // Normal perpendicular to tangent
  let normalX = -tangentZ / tangentLen;
  let normalZ = tangentX / tangentLen;
  
  // Ensure normal points OUTWARD (away from center)
  const toCenterX = center.x - currentPoint.x;
  const toCenterZ = center.z - currentPoint.z;
  const dot = normalX * toCenterX + normalZ * toCenterZ;
  
  if (dot > 0) {
    // Normal points toward center, flip it
    normalX = -normalX;
    normalZ = -normalZ;
  }
  
  return { x: normalX, z: normalZ };
}

/**
 * Get a point at a specific position along the boundary perimeter
 */
function getPointAtPosition(
  boundary: Point2D[],
  edgeCumLengths: number[],
  edgeLengths: number[],
  totalLength: number,
  pos: number
): Point2D | null {
  const n = boundary.length;
  if (n < 2) return null;
  
  // Normalize position to [0, totalLength)
  pos = ((pos % totalLength) + totalLength) % totalLength;
  
  // Find which edge this position falls on
  let edgeIdx = 0;
  for (let e = 0; e < n; e++) {
    const nextCum = e < n - 1 ? edgeCumLengths[e + 1] : totalLength;
    if (pos < nextCum || e === n - 1) {
      edgeIdx = e;
      break;
    }
  }
  
  // Interpolate along this edge
  const edgeStart = edgeCumLengths[edgeIdx];
  const t = edgeLengths[edgeIdx] > 0.001 ? (pos - edgeStart) / edgeLengths[edgeIdx] : 0;
  const p1 = boundary[edgeIdx];
  const p2 = boundary[(edgeIdx + 1) % n];
  
  return {
    x: p1.x + t * (p2.x - p1.x),
    z: p1.z + t * (p2.z - p1.z),
  };
}

/**
 * Create exactly 4-6 perimeter supports at strategic positions around the boundary
 * Distributes supports evenly based on perimeter length
 */
function createStrategicPerimeterSupports(
  outerBoundary: Point2D[],
  innerBoundary: Point2D[],
  center: Point2D,
  height: number,
  targetCount: number,
  minCount: number,
  maxCount: number,
  gapSize: number,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>,
  startIndex: number
): Array<{ support: CustomSupport; cluster: OverhangCluster }> {
  const supports: Array<{ support: CustomSupport; cluster: OverhangCluster }> = [];
  const n = outerBoundary.length;
  
  if (n < 3 || innerBoundary.length !== n) return supports;
  
  // Calculate total perimeter length and edge lengths
  const edges: Array<{ index: number; length: number; cumLength: number }> = [];
  let totalLength = 0;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = outerBoundary[j].x - outerBoundary[i].x;
    const dz = outerBoundary[j].z - outerBoundary[i].z;
    const length = Math.hypot(dx, dz);
    edges.push({ index: i, length, cumLength: totalLength });
    totalLength += length;
  }
  
  // Determine actual support count (between min and max)
  const supportCount = Math.max(minCount, Math.min(maxCount, targetCount));
  
  // Calculate even spacing along perimeter
  const spacing = totalLength / supportCount;
  const supportWidth = spacing * 0.70; // Each support covers 70% of its segment (LARGER)
  
  debugLog(`[FixtureSupport] Perimeter=${totalLength.toFixed(1)}mm, creating ${supportCount} supports, width=${supportWidth.toFixed(1)}mm each`);
  
  // Place supports at evenly spaced positions
  for (let i = 0; i < supportCount; i++) {
    // Position along perimeter (center of this support's segment)
    const targetPos = (i + 0.5) * spacing;
    
    // Find which edge this position falls on
    let edgeIdx = 0;
    for (let e = 0; e < edges.length; e++) {
      if (e === edges.length - 1 || edges[e + 1].cumLength > targetPos) {
        edgeIdx = e;
        break;
      }
    }
    
    const edge = edges[edgeIdx];
    const nextIdx = (edgeIdx + 1) % n;
    
    // Position along this edge (0 to 1)
    const posOnEdge = (targetPos - edge.cumLength) / edge.length;
    
    // Calculate the span of this support on the edge
    const halfWidth = (supportWidth / 2) / edge.length;
    const t1 = Math.max(0.05, posOnEdge - halfWidth);
    const t2 = Math.min(0.95, posOnEdge + halfWidth);
    
    // Outer edge points
    const outerP1 = outerBoundary[edgeIdx];
    const outerP2 = outerBoundary[nextIdx];
    const outerDx = outerP2.x - outerP1.x;
    const outerDz = outerP2.z - outerP1.z;
    
    // Inner edge points  
    const innerP1 = innerBoundary[edgeIdx];
    const innerP2 = innerBoundary[nextIdx];
    const innerDx = innerP2.x - innerP1.x;
    const innerDz = innerP2.z - innerP1.z;
    
    // Calculate support corners
    const segOuterP1 = { x: outerP1.x + outerDx * t1, z: outerP1.z + outerDz * t1 };
    const segOuterP2 = { x: outerP1.x + outerDx * t2, z: outerP1.z + outerDz * t2 };
    const segInnerP1 = { x: innerP1.x + innerDx * t1, z: innerP1.z + innerDz * t1 };
    const segInnerP2 = { x: innerP1.x + innerDx * t2, z: innerP1.z + innerDz * t2 };
    
    // Check support dimensions - skip if too thin
    const outerWidth = Math.hypot(segOuterP2.x - segOuterP1.x, segOuterP2.z - segOuterP1.z);
    const depth = Math.hypot(segInnerP1.x - segOuterP1.x, segInnerP1.z - segOuterP1.z);
    const MIN_WIDTH = 3; // mm minimum width along edge
    const MIN_DEPTH = 3; // mm minimum depth into part
    
    if (outerWidth < MIN_WIDTH || depth < MIN_DEPTH) {
      debugLog(`[FixtureSupport] Skipping thin perimeter support: width=${outerWidth.toFixed(1)}mm, depth=${depth.toFixed(1)}mm`);
      continue;
    }
    
    // Calculate center of trapezoid
    const centerX = (segOuterP1.x + segOuterP2.x + segInnerP1.x + segInnerP2.x) / 4;
    const centerZ = (segOuterP1.z + segOuterP2.z + segInnerP1.z + segInnerP2.z) / 4;
    
    // Polygon in local coordinates
    const polygon: Array<[number, number]> = [
      [segOuterP1.x - centerX, segOuterP1.z - centerZ],
      [segOuterP2.x - centerX, segOuterP2.z - centerZ],
      [segInnerP2.x - centerX, segInnerP2.z - centerZ],
      [segInnerP1.x - centerX, segInnerP1.z - centerZ],
    ];
    
    const support: CustomSupport = {
      id: `sup-perimeter-${Date.now()}-${startIndex + i}`,
      type: 'custom',
      center: new THREE.Vector2(centerX, centerZ),
      height,
      baseY: baseTopY,
      contactOffset: options.contactOffset,
      polygon,
      cornerRadius: options.cornerRadius,
    };
    
    const cluster: OverhangCluster = {
      points: [],
      centroidX: centerX,
      centroidZ: centerZ,
      minY: baseTopY + height,
      maxY: baseTopY + height,
      boundingBox: {
        minX: Math.min(segOuterP1.x, segOuterP2.x, segInnerP1.x, segInnerP2.x),
        maxX: Math.max(segOuterP1.x, segOuterP2.x, segInnerP1.x, segInnerP2.x),
        minZ: Math.min(segOuterP1.z, segOuterP2.z, segInnerP1.z, segInnerP2.z),
        maxZ: Math.max(segOuterP1.z, segOuterP2.z, segInnerP1.z, segInnerP2.z),
      },
      width: Math.abs(segOuterP2.x - segOuterP1.x),
      depth: Math.abs(segInnerP1.z - segOuterP1.z),
      aspectRatio: 1,
      totalArea: supportWidth * (edge.length * 0.3), // Approximate
    };
    
    supports.push({ support, cluster });
  }
  
  return supports;
}

/**
 * Create perimeter supports with gaps between them
 * Each edge is divided into segments with spacing between supports
 */
function createPerimeterSupportsWithGaps(
  outerBoundary: Point2D[],
  innerBoundary: Point2D[],
  center: Point2D,
  height: number,
  targetSpacing: number,
  minSupportsPerEdge: number,
  gapSize: number,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>,
  startIndex: number
): Array<{ support: CustomSupport; cluster: OverhangCluster }> {
  const supports: Array<{ support: CustomSupport; cluster: OverhangCluster }> = [];
  const n = outerBoundary.length;
  
  if (n < 3 || innerBoundary.length !== n) return supports;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    
    // Outer edge points
    const outerP1 = outerBoundary[i];
    const outerP2 = outerBoundary[j];
    
    // Corresponding inner edge points
    const innerP1 = innerBoundary[i];
    const innerP2 = innerBoundary[j];
    
    // Edge length (use outer edge)
    const edgeX = outerP2.x - outerP1.x;
    const edgeZ = outerP2.z - outerP1.z;
    const edgeLength = Math.hypot(edgeX, edgeZ);
    
    if (edgeLength < 10) continue; // Skip very short edges
    
    // Calculate number of supports for this edge
    // Account for gaps between supports
    const supportWidth = targetSpacing * 0.6; // 60% of spacing is support, 40% is gap
    const numSupports = Math.max(minSupportsPerEdge, Math.floor(edgeLength / targetSpacing));
    
    // Create supports along the edge with gaps
    for (let k = 0; k < numSupports; k++) {
      // Calculate t values for this segment (along the edge)
      // Leave gaps at the start and end of each segment
      const segmentStart = k / numSupports;
      const segmentEnd = (k + 1) / numSupports;
      const segmentLength = segmentEnd - segmentStart;
      
      // Gap ratio - portion of segment that is gap
      const gapRatio = gapSize / edgeLength;
      const halfGap = Math.min(gapRatio / 2, segmentLength * 0.2); // Gap at each end, max 20% of segment
      
      const t1 = segmentStart + halfGap;
      const t2 = segmentEnd - halfGap;
      
      // Skip if gap is too large
      if (t2 <= t1) continue;
      
      // Outer edge segment points
      const segOuterP1 = {
        x: outerP1.x + edgeX * t1,
        z: outerP1.z + edgeZ * t1,
      };
      const segOuterP2 = {
        x: outerP1.x + edgeX * t2,
        z: outerP1.z + edgeZ * t2,
      };
      
      // Inner edge segment points (interpolate along inner edge)
      const innerEdgeX = innerP2.x - innerP1.x;
      const innerEdgeZ = innerP2.z - innerP1.z;
      const segInnerP1 = {
        x: innerP1.x + innerEdgeX * t1,
        z: innerP1.z + innerEdgeZ * t1,
      };
      const segInnerP2 = {
        x: innerP1.x + innerEdgeX * t2,
        z: innerP1.z + innerEdgeZ * t2,
      };
      
      // Create trapezoidal polygon (4 corners: outer1, outer2, inner2, inner1)
      // Calculate center of this trapezoid
      const centerX = (segOuterP1.x + segOuterP2.x + segInnerP1.x + segInnerP2.x) / 4;
      const centerZ = (segOuterP1.z + segOuterP2.z + segInnerP1.z + segInnerP2.z) / 4;
      
      // Polygon in local coordinates (relative to center)
      const polygon: Array<[number, number]> = [
        [segOuterP1.x - centerX, segOuterP1.z - centerZ],
        [segOuterP2.x - centerX, segOuterP2.z - centerZ],
        [segInnerP2.x - centerX, segInnerP2.z - centerZ],
        [segInnerP1.x - centerX, segInnerP1.z - centerZ],
      ];
      
      const support: CustomSupport = {
        id: `sup-perimeter-${Date.now()}-${startIndex + supports.length}`,
        type: 'custom',
        center: new THREE.Vector2(centerX, centerZ),
        height,
        baseY: baseTopY,
        contactOffset: options.contactOffset,
        polygon,
        cornerRadius: options.cornerRadius,
      };
      
      const cluster: OverhangCluster = {
        points: [],
        centroidX: centerX,
        centroidZ: centerZ,
        minY: baseTopY + height,
        maxY: baseTopY + height,
        boundingBox: {
          minX: Math.min(segOuterP1.x, segOuterP2.x, segInnerP1.x, segInnerP2.x),
          maxX: Math.max(segOuterP1.x, segOuterP2.x, segInnerP1.x, segInnerP2.x),
          minZ: Math.min(segOuterP1.z, segOuterP2.z, segInnerP1.z, segInnerP2.z),
          maxZ: Math.max(segOuterP1.z, segOuterP2.z, segInnerP1.z, segInnerP2.z),
        },
        width: Math.hypot(segOuterP2.x - segOuterP1.x, segOuterP2.z - segOuterP1.z),
        depth: Math.hypot(segInnerP1.x - segOuterP1.x, segInnerP1.z - segOuterP1.z),
        aspectRatio: 1,
        totalArea: calculatePolygonArea(polygon),
      };
      
      supports.push({ support, cluster });
    }
  }
  
  return supports;
}

/**
 * Merge supports that are close together into single larger supports
 * Uses proper transitive clustering - if A is close to B and B is close to C, all three merge
 */
function mergeCloseSupports(
  supports: CustomSupport[],
  mergeDistance: number,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>
): CustomSupport[] {
  if (supports.length < 2) return supports;
  
  // Build adjacency - which supports are close enough to merge?
  const n = supports.length;
  const adjacent: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Check distance between centers
      const dist = Math.hypot(
        supports[i].center.x - supports[j].center.x,
        supports[i].center.y - supports[j].center.y
      );
      
      // Also check if polygons are close/overlapping
      const minPolygonDist = minDistanceBetweenPolygons(supports[i], supports[j]);
      
      if (dist < mergeDistance || minPolygonDist < mergeDistance * 0.5) {
        adjacent[i][j] = true;
        adjacent[j][i] = true;
      }
    }
  }
  
  // Find connected components using BFS
  const visited: boolean[] = new Array(n).fill(false);
  const result: CustomSupport[] = [];
  
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    
    // BFS to find all connected supports
    const group: number[] = [i];
    const queue: number[] = [i];
    visited[i] = true;
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      for (let j = 0; j < n; j++) {
        if (!visited[j] && adjacent[current][j]) {
          visited[j] = true;
          queue.push(j);
          group.push(j);
        }
      }
    }
    
    if (group.length === 1) {
      result.push(supports[i]);
    } else {
      // Merge the group into one support
      const groupSupports = group.map(idx => supports[idx]);
      const mergedSupport = mergeSupportsIntoOne(groupSupports, baseTopY, options);
      result.push(mergedSupport);
    }
  }
  
  return result;
}

/**
 * Calculate minimum distance between two support polygons (in world space)
 */
function minDistanceBetweenPolygons(a: CustomSupport, b: CustomSupport): number {
  let minDist = Infinity;
  
  // Get world coordinates of polygon a
  const polyA = a.polygon.map(([lx, lz]) => ({
    x: a.center.x + lx,
    z: a.center.y + lz, // center.y is Z
  }));
  
  // Get world coordinates of polygon b
  const polyB = b.polygon.map(([lx, lz]) => ({
    x: b.center.x + lx,
    z: b.center.y + lz,
  }));
  
  // Check distance from each vertex of A to each edge of B and vice versa
  for (const pa of polyA) {
    for (let i = 0; i < polyB.length; i++) {
      const j = (i + 1) % polyB.length;
      const dist = distanceToLineSegment(pa, polyB[i], polyB[j]);
      minDist = Math.min(minDist, dist);
    }
  }
  
  for (const pb of polyB) {
    for (let i = 0; i < polyA.length; i++) {
      const j = (i + 1) % polyA.length;
      const dist = distanceToLineSegment(pb, polyA[i], polyA[j]);
      minDist = Math.min(minDist, dist);
    }
  }
  
  return minDist;
}

/**
 * Merge multiple supports into a single larger support
 */
function mergeSupportsIntoOne(
  group: CustomSupport[],
  baseTopY: number,
  options: Required<OverhangPlacementOptions>
): CustomSupport {
  // Collect all polygon points in world coordinates
  const allPoints: Point2D[] = [];
  
  for (const support of group) {
    for (const [localX, localZ] of support.polygon) {
      allPoints.push({
        x: support.center.x + localX,
        z: support.center.y + localZ, // center.y is actually Z coordinate
      });
    }
  }
  
  // Compute convex hull of all points
  const hull = computeConvexHull(allPoints);
  
  // Calculate center
  let centerX = 0, centerZ = 0;
  for (const p of hull) {
    centerX += p.x;
    centerZ += p.z;
  }
  centerX /= hull.length;
  centerZ /= hull.length;
  
  // Convert to local coordinates
  const polygon: Array<[number, number]> = hull.map(p => [
    p.x - centerX,
    p.z - centerZ,
  ]);
  
  // Use the maximum height from the group
  const maxHeight = Math.max(...group.map(s => s.height));
  
  return {
    id: `sup-merged-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'custom',
    center: new THREE.Vector2(centerX, centerZ),
    height: maxHeight,
    baseY: baseTopY,
    contactOffset: options.contactOffset,
    polygon,
    cornerRadius: options.cornerRadius,
  };
}

/**
 * Create an inflated support for an interior overhang cluster
 * Creates a SMALLER support for center regions to avoid overlap with boundary supports
 */
function createInflatedOverhangSupport(
  cluster: OverhangCluster,
  perimeterCenter: Point2D,  // Use raycast perimeter center, NOT shadow
  inflation: number,
  penetrationRatio: number,
  baseTopY: number,
  options: Required<OverhangPlacementOptions>,
  index: number,
  maxSize?: number  // Maximum radius for the support
): CustomSupport {
  const { cornerRadius, contactOffset, minSupportSize } = options;
  
  const height = Math.max(1, cluster.minY - baseTopY - contactOffset);
  
  // Use the bounding box of the cluster for coverage
  const { minX, maxX, minZ, maxZ } = cluster.boundingBox;
  const clusterWidth = maxX - minX;
  const clusterDepth = maxZ - minZ;
  
  // Calculate effective max size - use constraint if provided
  const effectiveMaxSize = maxSize || Math.max(clusterWidth, clusterDepth) + inflation;
  
  // Create convex hull of cluster points
  if (cluster.points.length < 3) {
    // Fall back to circular approximation, respecting max size
    const baseSize = Math.max(clusterWidth, clusterDepth) / 2 + inflation;
    const size = Math.max(minSupportSize, Math.min(baseSize, effectiveMaxSize));
    const segments = 8; // Reduced segments for lower resolution
    const polygon: Array<[number, number]> = [];
    
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      polygon.push([
        Math.cos(angle) * size,
        Math.sin(angle) * size,
      ]);
    }
    
    debugLog(`[CenterSupport] Created circular support, size=${size.toFixed(1)}mm (max=${effectiveMaxSize.toFixed(1)}mm)`);
    
    return {
      id: `sup-overhang-${Date.now()}-${index}`,
      type: 'custom',
      center: new THREE.Vector2(cluster.centroidX, cluster.centroidZ),
      height,
      baseY: baseTopY,
      contactOffset,
      polygon,
      cornerRadius,
    };
  }
  
  // Create convex hull from cluster points
  const pointsCopy = cluster.points.map(p => ({ x: p.x, z: p.z }));
  const hull = computeConvexHull(pointsCopy);
  
  // Inflate the hull moderately (offset outward by inflation amount)
  const inflatedHull = offsetPolygon(hull, inflation);
  
  // Calculate current size of inflated hull
  let inflatedMinX = Infinity, inflatedMaxX = -Infinity;
  let inflatedMinZ = Infinity, inflatedMaxZ = -Infinity;
  for (const p of inflatedHull) {
    inflatedMinX = Math.min(inflatedMinX, p.x);
    inflatedMaxX = Math.max(inflatedMaxX, p.x);
    inflatedMinZ = Math.min(inflatedMinZ, p.z);
    inflatedMaxZ = Math.max(inflatedMaxZ, p.z);
  }
  const inflatedWidth = inflatedMaxX - inflatedMinX;
  const inflatedDepth = inflatedMaxZ - inflatedMinZ;
  const currentSize = Math.max(inflatedWidth, inflatedDepth) / 2;
  
  // Scale down if exceeds max size
  let scaledHull = inflatedHull;
  if (maxSize && currentSize > maxSize) {
    const scale = maxSize / currentSize;
    const hullCenterX = (inflatedMinX + inflatedMaxX) / 2;
    const hullCenterZ = (inflatedMinZ + inflatedMaxZ) / 2;
    
    scaledHull = inflatedHull.map(p => ({
      x: hullCenterX + (p.x - hullCenterX) * scale,
      z: hullCenterZ + (p.z - hullCenterZ) * scale,
    }));
    
    debugLog(`[CenterSupport] Scaled down from ${currentSize.toFixed(1)}mm to ${maxSize.toFixed(1)}mm`);
  }
  
  // Skip the center extension for smaller supports - just use the scaled hull
  // This prevents the support from growing too large
  const simplified = simplifyPolygon(scaledHull, 5);
  
  // Calculate new centroid
  let newCenterX = 0, newCenterZ = 0;
  for (const p of simplified) {
    newCenterX += p.x;
    newCenterZ += p.z;
  }
  newCenterX /= simplified.length;
  newCenterZ /= simplified.length;
  
  // Convert to local coordinates
  const polygon: Array<[number, number]> = simplified.map(p => [
    p.x - newCenterX,
    p.z - newCenterZ,
  ]);
  
  // Calculate final size for logging
  const finalMaxCoord = Math.max(...polygon.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))));
  debugLog(`[CenterSupport] Created polygon support, ${polygon.length} points, radius~${finalMaxCoord.toFixed(1)}mm`);
  
  return {
    id: `sup-overhang-${Date.now()}-${index}`,
    type: 'custom',
    center: new THREE.Vector2(newCenterX, newCenterZ),
    height,
    baseY: baseTopY,
    contactOffset,
    polygon,
    cornerRadius,
  };
}

/**
 * Calculate distance from a point to the nearest edge of a polygon
 */
function distanceToPolygonBoundary(point: Point2D, polygon: Point2D[]): number {
  let minDist = Infinity;
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dist = distanceToLineSegment(point, polygon[i], polygon[j]);
    minDist = Math.min(minDist, dist);
  }
  
  return minDist;
}

/**
 * Calculate distance from point to line segment
 */
function distanceToLineSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  
  if (lengthSq === 0) {
    return Math.hypot(point.x - a.x, point.z - a.z);
  }
  
  let t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  
  const nearestX = a.x + t * dx;
  const nearestZ = a.z + t * dz;
  
  return Math.hypot(point.x - nearestX, point.z - nearestZ);
}

/**
 * Calculate area of a polygon given as [x, z] tuples
 */
function calculatePolygonArea(polygon: Array<[number, number]>): number {
  let area = 0;
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i][0] * polygon[j][1];
    area -= polygon[j][0] * polygon[i][1];
  }
  
  return Math.abs(area) / 2;
}

/**
 * Calculate minimum width of a polygon (narrowest dimension)
 * Uses rotating calipers approximation - checks width in multiple directions
 */
function calculateMinPolygonWidth(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0;
  
  // Get bounding box first
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  
  // Check minimum width by projecting onto multiple angles
  let minWidth = Math.min(width, depth);
  
  // Check at 45 degree angles too for more accurate narrow detection
  const angles = [Math.PI / 4, Math.PI * 3 / 4]; // 45° and 135°
  
  for (const angle of angles) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    let minProj = Infinity, maxProj = -Infinity;
    
    for (const [x, z] of polygon) {
      // Project onto perpendicular axis
      const proj = x * (-sin) + z * cos;
      minProj = Math.min(minProj, proj);
      maxProj = Math.max(maxProj, proj);
    }
    
    minWidth = Math.min(minWidth, maxProj - minProj);
  }
  
  return minWidth;
}

/**
 * Filter out supports that are too thin (below minimum width threshold)
 */
function filterThinSupports(
  supports: CustomSupport[],
  minWidth: number = 8 // mm minimum width in any direction
): CustomSupport[] {
  return supports.filter(support => {
    const width = calculateMinPolygonWidth(support.polygon);
    if (width < minWidth) {
      debugLog(`[FixtureSupport] Filtered out thin support (width=${width.toFixed(1)}mm < ${minWidth}mm)`);
      return false;
    }
    return true;
  });
}

/**
 * Check if a 2D point is inside a polygon using ray casting
 */
function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;
    
    if (((zi > point.z) !== (zj > point.z)) &&
        (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Get overhang analysis options with descriptions
 * Note: These are now internal options - the UI no longer exposes them
 */
export function getOverhangPlacementOptions(): Array<{
  key: keyof OverhangPlacementOptions;
  label: string;
  description: string;
  defaultValue: number | string;
  type: 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}> {
  // Return empty array - all options are now automatic
  return [];
}
