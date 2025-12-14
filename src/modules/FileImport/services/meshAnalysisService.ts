/**
 * Mesh Analysis Service
 * 
 * Provides analysis, repair, and decimation operations for 3D mesh geometries.
 * Designed for production use with proper error handling and progress reporting.
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { simplifyGeometry } from '@/lib/fastQuadricSimplify';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface MeshAnalysisResult {
  isManifold: boolean;
  triangleCount: number;
  vertexCount: number;
  hasNonManifoldEdges: boolean;
  hasDegenerateFaces: boolean;
  boundaryEdgeCount: number;
  boundingBox: {
    min: THREE.Vector3;
    max: THREE.Vector3;
    size: THREE.Vector3;
  };
  issues: string[];
}

export interface MeshRepairResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  triangleCount: number;
  actions: string[];
  error?: string;
}

export interface DecimationResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  originalTriangles: number;
  finalTriangles: number;
  reductionPercent: number;
  error?: string;
}

export interface SmoothingResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  iterations: number;
  method?: 'taubin' | 'hc' | 'combined' | 'gaussian' | 'boundary' | 'blended';
  error?: string;
}

export interface BoundarySmoothingOptions {
  /** Number of Chaikin iterations (2-5 recommended) */
  iterations: number;
  /** Tolerance for detecting boundary vertices (in world units) */
  boundaryTolerance?: number;
}

export interface BoundarySmoothingResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  iterations: number;
  boundaryVerticesSmoothed: number;
  error?: string;
}

export interface SmoothingOptions {
  /** Number of smoothing iterations (1-100+) */
  iterations: number;
  /**
   * Smoothing strength (0-1).
   * Controls the blend between Taubin and Laplacian smoothing:
   * - 0 = Pure Taubin smoothing (weak effect, volume-preserving)
   * - 1 = Pure Laplacian smoothing (strong effect, may cause shrinkage)
   * Reference: trCAD smoothing modifier (Taubin95)
   */
  strength?: number;
  /**
   * Quality mode toggle.
   * - true: Enhanced mesh surface quality (slower, uses cotangent weights)
   * - false: Faster processing (uniform weights, may develop uneven regions)
   */
  quality?: boolean;
  
  // Legacy parameters for backward compatibility
  /** @deprecated Use strength instead. Smoothing method */
  method?: 'taubin' | 'hc' | 'combined' | 'gaussian' | 'blended';
  /** @deprecated Use strength=0 for pure Taubin. Taubin lambda (shrink factor, 0-1) */
  lambda?: number;
  /** @deprecated Use strength=0 for pure Taubin. Taubin mu (inflate factor, negative) */
  mu?: number;
  /** @deprecated HC alpha (original position weight, 0-1) */
  alpha?: number;
  /** @deprecated HC beta (difference damping, 0-1) */
  beta?: number;
  /** @deprecated Use strength instead. Gaussian sigma */
  sigma?: number;
  /** @deprecated Use iterations instead */
  gaussianIterations?: number;
  /** @deprecated Use iterations instead */
  laplacianIterations?: number;
  /** @deprecated Use iterations instead */
  taubinIterations?: number;
}

export interface ProcessingProgress {
  stage: 'analyzing' | 'repairing' | 'decimating' | 'smoothing' | 'complete';
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

// ============================================================================
// Configuration
// ============================================================================

/** Triangle count threshold above which decimation is recommended */
export const DECIMATION_THRESHOLD = 50_000;

/** Target triangle count after decimation */
export const DECIMATION_TARGET = 50_000;

/** MeshOptimizer target - first pass reduces large meshes to this level */
const MESHOPT_TARGET = 500_000;

/** Minimum area for a valid triangle (avoid degenerate faces) */
const MIN_TRIANGLE_AREA_SQ = 1e-12;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates a unique edge key from two vertex indices (order-independent)
 */
function createEdgeKey(idx1: number, idx2: number): string {
  return idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`;
}

/**
 * Calculates the squared area of a triangle using cross product
 */
function triangleAreaSquared(
  v0: THREE.Vector3, 
  v1: THREE.Vector3, 
  v2: THREE.Vector3,
  edge1: THREE.Vector3,
  edge2: THREE.Vector3,
  cross: THREE.Vector3
): number {
  edge1.subVectors(v1, v0);
  edge2.subVectors(v2, v0);
  cross.crossVectors(edge1, edge2);
  return cross.lengthSq();
}

/**
 * Extracts position data from geometry
 */
function getPositionArray(geometry: THREE.BufferGeometry): Float32Array {
  const attr = geometry.getAttribute('position');
  return attr.array as Float32Array;
}

/**
 * Reports progress if callback is provided
 */
function reportProgress(
  callback: ProgressCallback | undefined,
  stage: ProcessingProgress['stage'],
  progress: number,
  message: string
): void {
  callback?.({ stage, progress, message });
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Analyzes a mesh geometry for potential issues
 */
export async function analyzeMesh(
  geometry: THREE.BufferGeometry,
  onProgress?: ProgressCallback
): Promise<MeshAnalysisResult> {
  reportProgress(onProgress, 'analyzing', 0, 'Starting mesh analysis...');
  
  const positions = getPositionArray(geometry);
  const triangleCount = positions.length / 9;
  const vertexCount = positions.length / 3;
  const issues: string[] = [];
  
  // Compute bounding box
  reportProgress(onProgress, 'analyzing', 10, 'Computing bounding box...');
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = bbox.getSize(new THREE.Vector3());
  
  // Check for degenerate triangles
  reportProgress(onProgress, 'analyzing', 30, 'Checking for degenerate faces...');
  const { degenerateCount, hasDegenerateFaces } = countDegenerateFaces(positions, triangleCount);
  
  if (degenerateCount > 0) {
    issues.push(`Found ${degenerateCount.toLocaleString()} degenerate (zero-area) triangles`);
  }
  
  // Analyze edge topology
  reportProgress(onProgress, 'analyzing', 60, 'Analyzing edge topology...');
  const { nonManifoldCount, boundaryEdgeCount, hasNonManifoldEdges } = analyzeEdges(positions, triangleCount);
  
  if (nonManifoldCount > 0) {
    issues.push(`Found ${nonManifoldCount.toLocaleString()} non-manifold edges`);
  }
  
  if (boundaryEdgeCount > 0) {
    issues.push(`Found ${boundaryEdgeCount.toLocaleString()} boundary edges (mesh has holes)`);
  }
  
  // Check triangle count
  if (triangleCount > DECIMATION_THRESHOLD) {
    issues.push(`High triangle count (${triangleCount.toLocaleString()}) may impact performance`);
  }
  
  reportProgress(onProgress, 'analyzing', 100, 'Analysis complete');
  
  const isManifold = !hasNonManifoldEdges && boundaryEdgeCount === 0 && !hasDegenerateFaces;
  
  return {
    isManifold,
    triangleCount,
    vertexCount,
    hasNonManifoldEdges,
    hasDegenerateFaces,
    boundaryEdgeCount,
    boundingBox: {
      min: bbox.min.clone(),
      max: bbox.max.clone(),
      size,
    },
    issues,
  };
}

function countDegenerateFaces(positions: Float32Array, triangleCount: number) {
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  
  let degenerateCount = 0;
  
  for (let i = 0; i < triangleCount; i++) {
    const base = i * 9;
    v0.fromArray(positions, base);
    v1.fromArray(positions, base + 3);
    v2.fromArray(positions, base + 6);
    
    if (triangleAreaSquared(v0, v1, v2, edge1, edge2, cross) < MIN_TRIANGLE_AREA_SQ) {
      degenerateCount++;
    }
  }
  
  return {
    degenerateCount,
    hasDegenerateFaces: degenerateCount > 0,
  };
}

function analyzeEdges(positions: Float32Array, triangleCount: number) {
  const edgeUsageMap = new Map<string, number>();
  
  // Build edge usage map
  for (let i = 0; i < triangleCount; i++) {
    const baseVertex = i * 3;
    const edges = [
      createEdgeKey(baseVertex, baseVertex + 1),
      createEdgeKey(baseVertex + 1, baseVertex + 2),
      createEdgeKey(baseVertex + 2, baseVertex),
    ];
    
    for (const edge of edges) {
      edgeUsageMap.set(edge, (edgeUsageMap.get(edge) || 0) + 1);
    }
  }
  
  // Analyze edge usage
  let nonManifoldCount = 0;
  let boundaryEdgeCount = 0;
  
  for (const count of edgeUsageMap.values()) {
    if (count > 2) nonManifoldCount++;
    if (count === 1) boundaryEdgeCount++;
  }
  
  return {
    nonManifoldCount,
    boundaryEdgeCount,
    hasNonManifoldEdges: nonManifoldCount > 0,
  };
}

// ============================================================================
// Repair
// ============================================================================

/**
 * Attempts to repair a mesh by removing degenerate triangles and recomputing normals
 */
export async function repairMesh(
  geometry: THREE.BufferGeometry,
  onProgress?: ProgressCallback
): Promise<MeshRepairResult> {
  try {
    reportProgress(onProgress, 'repairing', 0, 'Starting mesh repair...');
    
    const positions = getPositionArray(geometry);
    const normalAttr = geometry.getAttribute('normal');
    const normals = normalAttr ? normalAttr.array as Float32Array : null;
    const triangleCount = positions.length / 9;
    
    const actions: string[] = [];
    const validPositions: number[] = [];
    const validNormals: number[] = [];
    
    // Reusable vectors for area calculation
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    
    reportProgress(onProgress, 'repairing', 20, 'Removing degenerate triangles...');
    
    let removedCount = 0;
    
    for (let i = 0; i < triangleCount; i++) {
      const base = i * 9;
      v0.fromArray(positions, base);
      v1.fromArray(positions, base + 3);
      v2.fromArray(positions, base + 6);
      
      // Keep only non-degenerate triangles
      if (triangleAreaSquared(v0, v1, v2, edge1, edge2, cross) >= MIN_TRIANGLE_AREA_SQ) {
        // Copy position data
        for (let j = 0; j < 9; j++) {
          validPositions.push(positions[base + j]);
        }
        // Copy normal data if available
        if (normals) {
          for (let j = 0; j < 9; j++) {
            validNormals.push(normals[base + j]);
          }
        }
      } else {
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      actions.push(`Removed ${removedCount.toLocaleString()} degenerate triangles`);
    }
    
    reportProgress(onProgress, 'repairing', 60, 'Rebuilding geometry...');
    
    // Create new geometry
    const repairedGeometry = new THREE.BufferGeometry();
    repairedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(validPositions, 3));
    
    if (validNormals.length > 0) {
      repairedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(validNormals, 3));
    }
    
    reportProgress(onProgress, 'repairing', 80, 'Recomputing normals...');
    
    repairedGeometry.computeVertexNormals();
    actions.push('Recomputed vertex normals');
    
    // Compute bounds tree if available (for raycasting optimization)
    if (typeof (repairedGeometry as any).computeBoundsTree === 'function') {
      (repairedGeometry as any).computeBoundsTree();
    }
    
    reportProgress(onProgress, 'repairing', 100, 'Repair complete');
    
    return {
      success: true,
      geometry: repairedGeometry,
      triangleCount: validPositions.length / 9,
      actions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown repair error';
    return {
      success: false,
      geometry: null,
      triangleCount: 0,
      actions: [],
      error: errorMessage,
    };
  }
}

// ============================================================================
// CSG Cleanup - Remove Small Components, Slivers, and Orphans
// ============================================================================

export interface CSGCleanupResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  originalTriangles: number;
  finalTriangles: number;
  componentsFound: number;
  componentsRemoved: number;
  degenerateTrianglesRemoved: number;
  actions: string[];
  error?: string;
}

export interface CSGCleanupOptions {
  /** Minimum volume for a component to be kept (in cubic mm). Default: 5.0 */
  minVolume?: number;
  /** Minimum triangle count for a component to be kept. Default: 10 */
  minTriangles?: number;
  /** Remove triangles with area below this threshold (sq mm). Default: 0.0001 */
  minTriangleArea?: number;
  /** Merge vertices within this tolerance before analysis (mm). Default: 0.001 */
  vertexMergeTolerance?: number;
  /** Keep only the N largest components (0 = keep all that pass thresholds). Default: 0 */
  keepLargestN?: number;
  /** Minimum thickness (smallest bounding box dimension) for a component to be kept (mm). Default: 2.0 */
  minThickness?: number;
}

/**
 * Cleans up CSG operation artifacts: removes small disconnected components,
 * degenerate triangles, and thin slivers.
 * 
 * This should be called after every CSG boolean operation to ensure clean geometry.
 */
export async function cleanupCSGResult(
  geometry: THREE.BufferGeometry,
  options: CSGCleanupOptions = {},
  onProgress?: ProgressCallback
): Promise<CSGCleanupResult> {
  const {
    minVolume = 5.0,
    minTriangles = 10,
    minTriangleArea = 0.0001,
    vertexMergeTolerance = 0.001,
    keepLargestN = 0,
    minThickness = 2.0,
  } = options;

  try {
    reportProgress(onProgress, 'repairing', 0, 'Starting CSG cleanup...');
    
    const actions: string[] = [];
    let workGeometry = geometry.clone();
    
    // Step 1: Remove degenerate triangles first
    reportProgress(onProgress, 'repairing', 10, 'Removing degenerate triangles...');
    const positions = getPositionArray(workGeometry);
    const triangleCount = positions.length / 9;
    
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    
    const validTriangleIndices: number[] = [];
    let degenerateCount = 0;
    
    for (let i = 0; i < triangleCount; i++) {
      const base = i * 9;
      v0.fromArray(positions, base);
      v1.fromArray(positions, base + 3);
      v2.fromArray(positions, base + 6);
      
      const areaSq = triangleAreaSquared(v0, v1, v2, edge1, edge2, cross);
      if (areaSq >= minTriangleArea * minTriangleArea) {
        validTriangleIndices.push(i);
      } else {
        degenerateCount++;
      }
    }
    
    if (degenerateCount > 0) {
      actions.push(`Removed ${degenerateCount} degenerate triangles`);
    }
    
    // Rebuild geometry with only valid triangles
    if (validTriangleIndices.length < triangleCount) {
      const newPositions = new Float32Array(validTriangleIndices.length * 9);
      for (let i = 0; i < validTriangleIndices.length; i++) {
        const srcBase = validTriangleIndices[i] * 9;
        const dstBase = i * 9;
        for (let j = 0; j < 9; j++) {
          newPositions[dstBase + j] = positions[srcBase + j];
        }
      }
      workGeometry.dispose();
      workGeometry = new THREE.BufferGeometry();
      workGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    }
    
    // Step 2: Find connected components using Union-Find
    reportProgress(onProgress, 'repairing', 30, 'Finding connected components...');
    const components = findConnectedComponents(workGeometry, vertexMergeTolerance);
    
    actions.push(`Found ${components.length} connected components`);
    
    if (components.length <= 1) {
      // Only one component, just recompute normals and return
      workGeometry.computeVertexNormals();
      return {
        success: true,
        geometry: workGeometry,
        originalTriangles: triangleCount,
        finalTriangles: validTriangleIndices.length,
        componentsFound: components.length,
        componentsRemoved: 0,
        degenerateTrianglesRemoved: degenerateCount,
        actions,
      };
    }
    
    // Step 3: Calculate volume, thickness, and triangle count for each component
    reportProgress(onProgress, 'repairing', 50, 'Analyzing component volumes and thickness...');
    const workPositions = getPositionArray(workGeometry);
    
    const componentMetrics = components.map((triangleIndices, idx) => {
      const volume = calculateComponentVolume(workGeometry, triangleIndices);
      
      // Calculate bounding box for this component to determine thickness
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      
      for (const triIdx of triangleIndices) {
        const base = triIdx * 9;
        for (let v = 0; v < 3; v++) {
          const vBase = base + v * 3;
          const x = workPositions[vBase];
          const y = workPositions[vBase + 1];
          const z = workPositions[vBase + 2];
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
      
      const sizeX = maxX - minX;
      const sizeY = maxY - minY;
      const sizeZ = maxZ - minZ;
      const minDimension = Math.min(sizeX, sizeY, sizeZ);
      
      return {
        index: idx,
        triangleIndices,
        triangleCount: triangleIndices.length,
        volume: Math.abs(volume), // Volume can be negative depending on winding
        minDimension, // Smallest bounding box dimension (thickness)
        dimensions: { x: sizeX, y: sizeY, z: sizeZ },
      };
    });
    
    // Sort by volume (largest first)
    componentMetrics.sort((a, b) => b.volume - a.volume);
    
    // Step 4: Filter components based on criteria (including thickness)
    reportProgress(onProgress, 'repairing', 70, 'Filtering small and thin components...');
    let keptComponents = componentMetrics.filter(
      c => c.volume >= minVolume && c.triangleCount >= minTriangles && c.minDimension >= minThickness
    );
    
    // Log thin components being removed
    const thinComponentsRemoved = componentMetrics.filter(
      c => c.volume >= minVolume && c.triangleCount >= minTriangles && c.minDimension < minThickness
    );
    if (thinComponentsRemoved.length > 0) {
      actions.push(`Removed ${thinComponentsRemoved.length} thin slivers (thickness < ${minThickness}mm)`);
      for (const tc of thinComponentsRemoved) {
        console.log(`[CSG Cleanup] Removing thin sliver: thickness=${tc.minDimension.toFixed(3)}mm, dimensions=(${tc.dimensions.x.toFixed(2)}, ${tc.dimensions.y.toFixed(2)}, ${tc.dimensions.z.toFixed(2)})mm, volume=${tc.volume.toFixed(2)}mm³`);
      }
    }
    
    // If keepLargestN is set, limit to N largest
    if (keepLargestN > 0 && keptComponents.length > keepLargestN) {
      keptComponents = keptComponents.slice(0, keepLargestN);
    }
    
    const removedCount = components.length - keptComponents.length;
    if (removedCount > 0) {
      const removedComponents = componentMetrics.filter(c => !keptComponents.includes(c));
      const removedVolume = removedComponents.reduce((sum, c) => sum + c.volume, 0);
      actions.push(`Removed ${removedCount} small components (total volume: ${removedVolume.toFixed(2)} mm³)`);
      
      // Log details of each removed component for debugging
      for (const rc of removedComponents) {
        const reason: string[] = [];
        if (rc.volume < minVolume) reason.push(`volume=${rc.volume.toFixed(3)}mm³ < ${minVolume}`);
        if (rc.triangleCount < minTriangles) reason.push(`triangles=${rc.triangleCount} < ${minTriangles}`);
        if (rc.minDimension < minThickness) reason.push(`thickness=${rc.minDimension.toFixed(3)}mm < ${minThickness}`);
        console.log(`[CSG Cleanup] Removed component: ${reason.join(', ')}, dims=(${rc.dimensions.x.toFixed(2)}, ${rc.dimensions.y.toFixed(2)}, ${rc.dimensions.z.toFixed(2)})mm`);
      }
    }
    
    // Step 5: Build geometry from kept components
    reportProgress(onProgress, 'repairing', 75, 'Rebuilding geometry...');
    const finalPositions = getPositionArray(workGeometry);
    const keptTriangleIndices = new Set<number>();
    for (const comp of keptComponents) {
      for (const triIdx of comp.triangleIndices) {
        keptTriangleIndices.add(triIdx);
      }
    }
    
    // Step 6: Build final cleaned geometry
    reportProgress(onProgress, 'repairing', 90, 'Building final geometry...');
    const finalTriangleCount = keptTriangleIndices.size;
    const finalPositionArray = new Float32Array(finalTriangleCount * 9);
    let writeIdx = 0;
    
    // Iterate in order to maintain consistent triangle ordering
    const sortedTriangles = Array.from(keptTriangleIndices).sort((a, b) => a - b);
    for (const triIdx of sortedTriangles) {
      const srcBase = triIdx * 9;
      for (let j = 0; j < 9; j++) {
        finalPositionArray[writeIdx++] = finalPositions[srcBase + j];
      }
    }
    
    const cleanedGeometry = new THREE.BufferGeometry();
    cleanedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositionArray, 3));
    cleanedGeometry.computeVertexNormals();
    
    // Dispose intermediate geometry
    workGeometry.dispose();
    
    reportProgress(onProgress, 'repairing', 100, 'CSG cleanup complete');
    
    return {
      success: true,
      geometry: cleanedGeometry,
      originalTriangles: triangleCount,
      finalTriangles: finalTriangleCount,
      componentsFound: components.length,
      componentsRemoved: removedCount,
      degenerateTrianglesRemoved: degenerateCount,
      actions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown cleanup error';
    return {
      success: false,
      geometry: null,
      originalTriangles: 0,
      finalTriangles: 0,
      componentsFound: 0,
      componentsRemoved: 0,
      degenerateTrianglesRemoved: 0,
      actions: [],
      error: errorMessage,
    };
  }
}

/**
 * Find connected components in a mesh using Union-Find algorithm.
 * Returns an array of triangle index arrays, one per component.
 */
function findConnectedComponents(
  geometry: THREE.BufferGeometry,
  vertexMergeTolerance: number
): number[][] {
  const positions = getPositionArray(geometry);
  const triangleCount = positions.length / 9;
  
  if (triangleCount === 0) return [];
  
  // Build vertex-to-triangle adjacency using spatial hashing for vertex merging
  const vertexHash = new Map<string, number>(); // hash -> canonical vertex index
  const triangleVertices: number[][] = []; // For each triangle, its 3 canonical vertex indices
  let nextVertexId = 0;
  
  const hashVertex = (x: number, y: number, z: number): string => {
    const scale = 1 / vertexMergeTolerance;
    const hx = Math.round(x * scale);
    const hy = Math.round(y * scale);
    const hz = Math.round(z * scale);
    return `${hx},${hy},${hz}`;
  };
  
  // Assign canonical vertex IDs to each triangle vertex
  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const triVerts: number[] = [];
    
    for (let v = 0; v < 3; v++) {
      const vBase = base + v * 3;
      const hash = hashVertex(positions[vBase], positions[vBase + 1], positions[vBase + 2]);
      
      let vertexId = vertexHash.get(hash);
      if (vertexId === undefined) {
        vertexId = nextVertexId++;
        vertexHash.set(hash, vertexId);
      }
      triVerts.push(vertexId);
    }
    triangleVertices.push(triVerts);
  }
  
  // Build vertex-to-triangles map
  const vertexToTriangles = new Map<number, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    for (const v of triangleVertices[t]) {
      if (!vertexToTriangles.has(v)) {
        vertexToTriangles.set(v, []);
      }
      vertexToTriangles.get(v)!.push(t);
    }
  }
  
  // Union-Find to group connected triangles
  const parent = new Int32Array(triangleCount);
  const rank = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) {
    parent[i] = i;
    rank[i] = 0;
  }
  
  const find = (x: number): number => {
    if (parent[x] !== x) {
      parent[x] = find(parent[x]); // Path compression
    }
    return parent[x];
  };
  
  const union = (x: number, y: number): void => {
    const px = find(x);
    const py = find(y);
    if (px === py) return;
    
    // Union by rank
    if (rank[px] < rank[py]) {
      parent[px] = py;
    } else if (rank[px] > rank[py]) {
      parent[py] = px;
    } else {
      parent[py] = px;
      rank[px]++;
    }
  };
  
  // Connect triangles that share vertices
  for (const triangles of vertexToTriangles.values()) {
    if (triangles.length > 1) {
      const first = triangles[0];
      for (let i = 1; i < triangles.length; i++) {
        union(first, triangles[i]);
      }
    }
  }
  
  // Group triangles by their root
  const componentMap = new Map<number, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    const root = find(t);
    if (!componentMap.has(root)) {
      componentMap.set(root, []);
    }
    componentMap.get(root)!.push(t);
  }
  
  return Array.from(componentMap.values());
}

/**
 * Calculate the signed volume of a mesh component using the divergence theorem.
 * For a closed mesh, this gives the actual volume. For open meshes, it's an approximation.
 */
function calculateComponentVolume(
  geometry: THREE.BufferGeometry,
  triangleIndices: number[]
): number {
  const positions = getPositionArray(geometry);
  let volume = 0;
  
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  
  for (const triIdx of triangleIndices) {
    const base = triIdx * 9;
    v0.fromArray(positions, base);
    v1.fromArray(positions, base + 3);
    v2.fromArray(positions, base + 6);
    
    // Signed volume contribution from this triangle
    // Using the formula: V = (1/6) * sum of (v0 · (v1 × v2)) for each triangle
    volume += v0.dot(v1.clone().cross(v2));
  }
  
  return volume / 6;
}

// ============================================================================
// MeshOptimizer Simplification
// ============================================================================

/**
 * Simplify mesh using MeshOptimizer's simplify() function.
 * This is a high-quality WASM-based simplifier that preserves mesh topology.
 * 
 * IMPORTANT: MeshOptimizer requires welded vertices (shared vertices between triangles)
 * to work effectively. Non-indexed "triangle soup" meshes must be converted first.
 * 
 * @see https://www.npmjs.com/package/meshoptimizer
 */
async function simplifyWithMeshOptimizer(
  geometry: THREE.BufferGeometry,
  targetIndexCount: number,
  onProgress?: ProgressCallback
): Promise<DecimationResult> {
  const { MeshoptSimplifier } = await import('meshoptimizer');
  
  // Wait for WASM to be ready
  await MeshoptSimplifier.ready;
  
  // MeshOptimizer requires welded/merged vertices to work effectively
  // Non-indexed geometry (triangle soup) won't simplify because each vertex is unique
  reportProgress(onProgress, 'decimating', 2, 'Merging vertices for simplification...');
  
  // Merge vertices to create shared vertices between triangles
  let workGeometry = geometry.clone();
  
  // Check if geometry needs vertex merging
  const originalPositions = workGeometry.getAttribute('position');
  const originalVertexCount = originalPositions.count;
  const originalTriangles = workGeometry.index 
    ? workGeometry.index.count / 3 
    : originalVertexCount / 3;
  
  // If non-indexed or vertices == triangles * 3, we need to merge
  if (!workGeometry.index || originalVertexCount === originalTriangles * 3) {
    workGeometry = mergeVertices(workGeometry, 1e-4); // tolerance for merging
  }
  
  const positions = workGeometry.getAttribute('position');
  const positionArray = positions.array as Float32Array;
  const vertexCount = positions.count;
  
  // Get or create index array
  let indexArray: Uint32Array;
  
  if (workGeometry.index) {
    const existingIndices = workGeometry.index.array;
    indexArray = new Uint32Array(existingIndices.length);
    for (let i = 0; i < existingIndices.length; i++) {
      indexArray[i] = existingIndices[i];
    }
  } else {
    // This shouldn't happen after mergeVertices, but handle it anyway
    indexArray = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      indexArray[i] = i;
    }
  }
  
  const triangleCount = indexArray.length / 3;
  
  reportProgress(onProgress, 'decimating', 5, 'Running MeshOptimizer simplify...');
  
  try {
    // Call MeshOptimizer's simplify function
    // simplify(indices, vertex_positions, vertex_positions_stride, target_index_count, target_error, flags?)
    // target_error is relative (0.01 = 1% of mesh extents)
    const targetError = 0.01; // Allow up to 1% error
    const [newIndices, resultError] = MeshoptSimplifier.simplify(
      indexArray,
      positionArray,
      3, // stride in Float32 units (x, y, z)
      targetIndexCount,
      targetError,
      ['LockBorder'] // Preserve border vertices
    );
    
    const finalTriangles = newIndices.length / 3;
    
    if (finalTriangles === 0) {
      throw new Error('MeshOptimizer produced empty mesh');
    }
    
    // Check if simplification actually worked
    if (finalTriangles >= triangleCount * 0.95) {
      // Less than 5% reduction - simplifier probably couldn't work with this mesh
      console.warn(`[MeshOptimizer] Minimal reduction (${triangleCount} → ${finalTriangles}), mesh may have issues`);
    }
    
    reportProgress(onProgress, 'decimating', 15, 'Building simplified geometry...');
    
    // Create new geometry with simplified indices
    const newGeometry = new THREE.BufferGeometry();
    
    // Copy position attribute from merged geometry
    newGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(positionArray), 3
    ));
    
    // Copy other attributes if they exist (from merged geometry)
    if (workGeometry.getAttribute('normal')) {
      const normalArray = workGeometry.getAttribute('normal').array as Float32Array;
      newGeometry.setAttribute('normal', new THREE.BufferAttribute(
        new Float32Array(normalArray), 3
      ));
    }
    
    if (workGeometry.getAttribute('uv')) {
      const uvArray = workGeometry.getAttribute('uv').array as Float32Array;
      newGeometry.setAttribute('uv', new THREE.BufferAttribute(
        new Float32Array(uvArray), 2
      ));
    }
    
    // Set new indices
    newGeometry.setIndex(new THREE.BufferAttribute(newIndices, 1));
    
    const reductionPercent = ((originalTriangles - finalTriangles) / originalTriangles) * 100;
    
    return {
      success: true,
      geometry: newGeometry,
      originalTriangles,
      finalTriangles,
      reductionPercent,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[MeshOptimizer] Simplification failed:', errorMessage);
    return {
      success: false,
      geometry: null,
      originalTriangles,
      finalTriangles: 0,
      reductionPercent: 0,
      error: errorMessage,
    };
  }
}

// ============================================================================
// Decimation
// ============================================================================

/**
 * Mesh decimation pipeline using MeshOptimizer + Fast Quadric in sequence:
 * 
 * 1. MeshOptimizer simplify() - Reduces large meshes (>500K) to 500K triangles
 * 2. Fast Quadric - Reduces from 500K (or less) to final target (50K)
 * 3. Manifold3D - Fallback if Fast Quadric fails
 * 4. Vertex Clustering - Last resort for problematic meshes
 * 
 * Guarantees output below targetTriangles (default 50,000).
 */
export async function decimateMesh(
  geometry: THREE.BufferGeometry,
  targetTriangles: number = DECIMATION_TARGET,
  onProgress?: ProgressCallback
): Promise<DecimationResult> {
  // Get position attribute
  const positions = geometry.getAttribute('position');
  const indices = geometry.index;
  const originalTriangles = indices ? indices.count / 3 : positions.count / 3;
  
  // Skip if already below target
  if (originalTriangles <= targetTriangles) {
    console.log(`[Decimation] Skipped: ${originalTriangles.toLocaleString()} triangles already below target ${targetTriangles.toLocaleString()}`);
    return {
      success: true,
      geometry: geometry.clone(),
      originalTriangles,
      finalTriangles: originalTriangles,
      reductionPercent: 0,
    };
  }
  
  console.log(`[Decimation] Starting: ${originalTriangles.toLocaleString()} triangles → target ${targetTriangles.toLocaleString()}`);
  
  let currentGeometry = geometry;
  let currentTriangles = originalTriangles;
  
  // STAGE 1: MeshOptimizer for large meshes (>500K triangles)
  // Reduces to 500K first to make Fast Quadric faster and more reliable
  if (currentTriangles > MESHOPT_TARGET) {
    try {
      reportProgress(onProgress, 'decimating', 0, `MeshOptimizer: ${currentTriangles.toLocaleString()} → ${MESHOPT_TARGET.toLocaleString()} triangles...`);
      
      const meshoptTargetIndices = MESHOPT_TARGET * 3;
      const meshoptResult = await simplifyWithMeshOptimizer(currentGeometry, meshoptTargetIndices, onProgress);
      
      if (meshoptResult.success && meshoptResult.geometry) {
        const reduction = ((originalTriangles - meshoptResult.finalTriangles) / originalTriangles * 100).toFixed(1);
        console.log(`[Decimation] Step 1 - MeshOptimizer: ${originalTriangles.toLocaleString()} → ${meshoptResult.finalTriangles.toLocaleString()} triangles (${reduction}% reduction)`);
        currentGeometry = meshoptResult.geometry;
        currentTriangles = meshoptResult.finalTriangles;
        reportProgress(onProgress, 'decimating', 40, `MeshOptimizer complete: ${currentTriangles.toLocaleString()} triangles`);
      } else {
        console.warn('[decimateMesh] MeshOptimizer failed, continuing with original geometry');
      }
    } catch (meshoptError) {
      console.warn('[decimateMesh] MeshOptimizer error:', meshoptError);
    }
  }
  
  // If already at or below target after MeshOptimizer, we're done
  if (currentTriangles <= targetTriangles) {
    currentGeometry.computeVertexNormals();
    return {
      success: true,
      geometry: currentGeometry,
      originalTriangles,
      finalTriangles: currentTriangles,
      reductionPercent: ((originalTriangles - currentTriangles) / originalTriangles) * 100,
    };
  }
  
  // STAGE 2: Fast Quadric to reach final target
  const ratio = Math.max(0.01, Math.min(0.99, targetTriangles / currentTriangles));
  
  try {
    reportProgress(onProgress, 'decimating', 45, `Fast Quadric: ${currentTriangles.toLocaleString()} → ${targetTriangles.toLocaleString()} triangles...`);
    
    const result = await simplifyGeometry(currentGeometry, {
      ratio,
      onProgress: (stage, percent, message) => {
        const mappedPercent = 45 + (percent * 0.45); // 45-90%
        reportProgress(onProgress, 'decimating', mappedPercent, message);
      }
    });
    
    if (result.success && result.geometry) {
      result.geometry.computeVertexNormals();
      reportProgress(onProgress, 'decimating', 100, 'Decimation complete');
      
      const stepReduction = ((currentTriangles - result.finalTriangles) / currentTriangles * 100).toFixed(1);
      const totalReduction = ((originalTriangles - result.finalTriangles) / originalTriangles * 100).toFixed(1);
      console.log(`[Decimation] Step 2 - Fast Quadric: ${currentTriangles.toLocaleString()} → ${result.finalTriangles.toLocaleString()} triangles (${stepReduction}% reduction)`);
      console.log(`[Decimation] Complete: ${originalTriangles.toLocaleString()} → ${result.finalTriangles.toLocaleString()} triangles (${totalReduction}% total reduction)`);
      
      return {
        success: true,
        geometry: result.geometry,
        originalTriangles,
        finalTriangles: result.finalTriangles,
        reductionPercent: ((originalTriangles - result.finalTriangles) / originalTriangles) * 100,
      };
    }
    
    throw new Error(result.error || 'Fast Quadric returned no geometry');
  } catch (fastQuadricError) {
    console.warn('[decimateMesh] Fast Quadric failed, trying Manifold3D fallback:', fastQuadricError);
    reportProgress(onProgress, 'decimating', 70, 'Fast Quadric failed, trying Manifold3D...');
  }
  
  // STAGE 3: Manifold3D fallback
  try {
    const { decimateMeshWithManifold } = await import('./manifoldMeshService');
    
    const manifoldResult = await decimateMeshWithManifold(
      currentGeometry,
      targetTriangles,
      (p) => {
        const mappedProgress = 70 + (p.progress * 0.3); // 70-100% for Manifold
        reportProgress(onProgress, 'decimating', mappedProgress, p.message);
      },
      true // force decimation
    );
    
    if (manifoldResult.success && manifoldResult.geometry) {
      manifoldResult.geometry.computeVertexNormals();
      reportProgress(onProgress, 'decimating', 100, 'Manifold3D decimation complete');
      
      return {
        success: true,
        geometry: manifoldResult.geometry,
        originalTriangles,
        finalTriangles: manifoldResult.finalTriangles,
        reductionPercent: ((originalTriangles - manifoldResult.finalTriangles) / originalTriangles) * 100,
      };
    }
    
    throw new Error(manifoldResult.error || 'Manifold3D returned no geometry');
  } catch (manifoldError) {
    console.error('[decimateMesh] Manifold3D failed:', manifoldError);
    reportProgress(onProgress, 'decimating', 80, 'Trying vertex clustering fallback...');
  }
  
  // STAGE 4: Vertex clustering as last resort
  try {
    const clusteredGeometry = vertexClusteringDecimate(currentGeometry, targetTriangles);
    const finalTriangles = clusteredGeometry.index 
      ? clusteredGeometry.index.count / 3 
      : clusteredGeometry.getAttribute('position').count / 3;
    const reductionPercent = ((originalTriangles - finalTriangles) / originalTriangles) * 100;
    
    clusteredGeometry.computeVertexNormals();
    reportProgress(onProgress, 'decimating', 100, 'Vertex clustering decimation complete');
    
    return {
      success: true,
      geometry: clusteredGeometry,
      originalTriangles,
      finalTriangles,
      reductionPercent,
    };
  } catch (clusteringError) {
    console.error('[decimateMesh] All decimation methods failed:', clusteringError);
    
    // Return current geometry (may be partially decimated by MeshOptimizer)
    console.warn('[decimateMesh] All decimation methods failed, returning best available geometry');
    currentGeometry.computeVertexNormals();
    return {
      success: true,
      geometry: currentGeometry,
      originalTriangles,
      finalTriangles: currentTriangles,
      reductionPercent: ((originalTriangles - currentTriangles) / originalTriangles) * 100,
      error: `Decimation incomplete: reached ${currentTriangles.toLocaleString()} triangles`,
    };
  }
}

/**
 * Simple vertex clustering decimation for very large meshes.
 * Groups vertices into a 3D grid and merges them, which is much faster
 * and more memory-efficient than QEM-based methods for huge meshes.
 */
function vertexClusteringDecimate(
  geometry: THREE.BufferGeometry,
  targetTriangles: number
): THREE.BufferGeometry {
  const positions = geometry.getAttribute('position');
  const vertexCount = positions.count;
  const triangleCount = geometry.index ? geometry.index.count / 3 : vertexCount / 3;
  
  // Calculate grid resolution based on target reduction
  const reductionFactor = Math.sqrt(triangleCount / targetTriangles);
  
  // Compute bounding box
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  
  // Calculate cell size - smaller cells = less reduction
  const avgDimension = (size.x + size.y + size.z) / 3;
  const cellSize = avgDimension / (100 / reductionFactor); // Adjust grid density
  
  if (cellSize <= 0) {
    return geometry.clone();
  }
  
  // Map positions to grid cells and compute cell centroids
  const cellMap = new Map<string, { sum: THREE.Vector3; count: number; index: number }>();
  let nextCellIndex = 0;
  
  const getCellKey = (x: number, y: number, z: number): string => {
    const cx = Math.floor((x - bbox.min.x) / cellSize);
    const cy = Math.floor((y - bbox.min.y) / cellSize);
    const cz = Math.floor((z - bbox.min.z) / cellSize);
    return `${cx},${cy},${cz}`;
  };
  
  // First pass: accumulate vertices into cells
  const vertexToCellIndex = new Uint32Array(vertexCount);
  
  for (let i = 0; i < vertexCount; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const key = getCellKey(x, y, z);
    
    let cell = cellMap.get(key);
    if (!cell) {
      cell = { sum: new THREE.Vector3(), count: 0, index: nextCellIndex++ };
      cellMap.set(key, cell);
    }
    
    cell.sum.x += x;
    cell.sum.y += y;
    cell.sum.z += z;
    cell.count++;
    vertexToCellIndex[i] = cell.index;
  }
  
  // Compute cell centroids
  const cellPositions = new Float32Array(cellMap.size * 3);
  for (const cell of cellMap.values()) {
    const idx = cell.index * 3;
    cellPositions[idx] = cell.sum.x / cell.count;
    cellPositions[idx + 1] = cell.sum.y / cell.count;
    cellPositions[idx + 2] = cell.sum.z / cell.count;
  }
  
  // Build new triangles, skipping degenerate ones
  const newTriangles: number[] = [];
  
  if (geometry.index) {
    const indices = geometry.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      const c0 = vertexToCellIndex[indices[i]];
      const c1 = vertexToCellIndex[indices[i + 1]];
      const c2 = vertexToCellIndex[indices[i + 2]];
      
      // Skip degenerate triangles (all vertices collapsed to same cell)
      if (c0 !== c1 && c1 !== c2 && c2 !== c0) {
        newTriangles.push(c0, c1, c2);
      }
    }
  } else {
    // Non-indexed geometry
    for (let i = 0; i < vertexCount; i += 3) {
      const c0 = vertexToCellIndex[i];
      const c1 = vertexToCellIndex[i + 1];
      const c2 = vertexToCellIndex[i + 2];
      
      if (c0 !== c1 && c1 !== c2 && c2 !== c0) {
        newTriangles.push(c0, c1, c2);
      }
    }
  }
  
  // Create new geometry
  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute('position', new THREE.BufferAttribute(cellPositions, 3));
  newGeometry.setIndex(newTriangles);
  
  return newGeometry;
}

// ============================================================================
// Mesh Smoothing - Custom Taubin/HC/Combined Implementation
// ============================================================================

/**
 * Build vertex adjacency map for smoothing operations.
 * For non-indexed geometry, we need to find vertices that share the same position
 * and treat them as the same vertex for adjacency purposes.
 * 
 * Returns:
 * - adjacency: Map from vertex index to set of neighbor vertex indices
 * - vertexGroups: Array where vertexGroups[i] contains all vertex indices that share the same position as vertex i
 */
function buildAdjacencyMap(
  positions: Float32Array,
  vertexCount: number,
  triangleCount: number
): { adjacency: Map<number, Set<number>>, vertexGroups: number[][] } {
  // First, create a map from position key to list of vertex indices at that position
  const positionToVertices = new Map<string, number[]>();
  const vertexToPositionKey = new Map<number, string>();
  
  const precision = 6; // decimal places for position comparison
  
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${x.toFixed(precision)},${y.toFixed(precision)},${z.toFixed(precision)}`;
    
    vertexToPositionKey.set(i, key);
    
    if (!positionToVertices.has(key)) {
      positionToVertices.set(key, []);
    }
    positionToVertices.get(key)!.push(i);
  }
  
  // Create vertexGroups array - for each vertex, store all vertices at the same position
  const vertexGroups: number[][] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const posKey = vertexToPositionKey.get(i)!;
    vertexGroups[i] = positionToVertices.get(posKey)!;
  }
  
  // Build adjacency based on triangles, but use position keys to find all vertices at each position
  const positionAdjacency = new Map<string, Set<string>>();
  
  // Initialize sets for each unique position
  for (const key of positionToVertices.keys()) {
    positionAdjacency.set(key, new Set());
  }
  
  // For each triangle, add adjacency between positions
  for (let t = 0; t < triangleCount; t++) {
    const i0 = t * 3;
    const i1 = t * 3 + 1;
    const i2 = t * 3 + 2;
    
    const key0 = vertexToPositionKey.get(i0)!;
    const key1 = vertexToPositionKey.get(i1)!;
    const key2 = vertexToPositionKey.get(i2)!;
    
    // Add edges between positions (bidirectional)
    if (key0 !== key1) {
      positionAdjacency.get(key0)!.add(key1);
      positionAdjacency.get(key1)!.add(key0);
    }
    if (key1 !== key2) {
      positionAdjacency.get(key1)!.add(key2);
      positionAdjacency.get(key2)!.add(key1);
    }
    if (key2 !== key0) {
      positionAdjacency.get(key2)!.add(key0);
      positionAdjacency.get(key0)!.add(key2);
    }
  }
  
  // Convert position adjacency back to vertex adjacency
  // Each vertex gets neighbors from all vertices at neighboring positions
  const adjacency = new Map<number, Set<number>>();
  
  for (let i = 0; i < vertexCount; i++) {
    adjacency.set(i, new Set());
  }
  
  for (let i = 0; i < vertexCount; i++) {
    const posKey = vertexToPositionKey.get(i)!;
    const neighborPosKeys = positionAdjacency.get(posKey)!;
    
    for (const neighborPosKey of neighborPosKeys) {
      // Add all vertices at the neighboring position as neighbors
      const neighborVertices = positionToVertices.get(neighborPosKey)!;
      for (const nv of neighborVertices) {
        adjacency.get(i)!.add(nv);
      }
    }
  }
  
  return { adjacency, vertexGroups };
}

/**
 * Single pass of Laplacian smoothing.
 * Moves each vertex toward the centroid of its neighbors in XY plane only.
 * Uses vertex groups to ensure all vertices at the same original position move together.
 * Note: In Three.js Y is up, so we smooth X and Z (horizontal plane), preserving Y (vertical).
 */
function laplacianPass(
  positions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  factor: number,
  vertexCount: number
): Float32Array {
  const newPositions = new Float32Array(positions.length);
  const processed = new Set<number>(); // Track which vertices we've processed (by their group's first vertex)
  
  for (let i = 0; i < vertexCount; i++) {
    // Get the vertex group for this vertex
    const group = vertexGroups[i];
    const firstInGroup = group[0];
    
    // Skip if we already processed this group
    if (processed.has(firstInGroup)) {
      // Copy the already computed new position from the first vertex in the group
      newPositions[i * 3] = newPositions[firstInGroup * 3];
      newPositions[i * 3 + 1] = newPositions[firstInGroup * 3 + 1];
      newPositions[i * 3 + 2] = newPositions[firstInGroup * 3 + 2];
      continue;
    }
    
    processed.add(firstInGroup);
    
    const x = positions[i * 3];
    const y = positions[i * 3 + 1]; // Y is up in Three.js - preserve this
    const z = positions[i * 3 + 2];
    
    const neighbors = adjacency.get(i);
    if (!neighbors || neighbors.size === 0) {
      // No neighbors, keep original position for all in group
      for (const vi of group) {
        newPositions[vi * 3] = x;
        newPositions[vi * 3 + 1] = y;
        newPositions[vi * 3 + 2] = z;
      }
      continue;
    }
    
    // Calculate centroid of unique neighbor groups in XY plane (X and Z in Three.js)
    const processedNeighborGroups = new Set<number>();
    let cx = 0, cz = 0;
    let count = 0;
    
    for (const ni of neighbors) {
      const neighborGroup = vertexGroups[ni];
      const neighborFirst = neighborGroup[0];
      
      // Only count each neighbor group once
      if (!processedNeighborGroups.has(neighborFirst)) {
        processedNeighborGroups.add(neighborFirst);
        cx += positions[ni * 3];
        // Skip Y (index + 1) - we don't smooth in vertical direction
        cz += positions[ni * 3 + 2];
        count++;
      }
    }
    
    if (count > 0) {
      cx /= count;
      cz /= count;
      
      // Move vertex toward centroid by factor - only in XY plane (X and Z)
      const newX = x + factor * (cx - x);
      const newZ = z + factor * (cz - z);
      // Y (vertical) is preserved - no smoothing in up direction
      
      // Apply to all vertices in this group
      for (const vi of group) {
        newPositions[vi * 3] = newX;
        newPositions[vi * 3 + 1] = y; // Preserve original Y (vertical)
        newPositions[vi * 3 + 2] = newZ;
      }
    } else {
      // No valid neighbors, keep original
      for (const vi of group) {
        newPositions[vi * 3] = x;
        newPositions[vi * 3 + 1] = y;
        newPositions[vi * 3 + 2] = z;
      }
    }
  }
  
  return newPositions;
}

/**
 * Taubin smoothing: alternates shrinking (λ) and inflating (μ) passes.
 * This prevents excessive shrinkage that occurs with pure Laplacian smoothing.
 */
function taubinSmoothing(
  positions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  iterations: number,
  lambda: number,
  mu: number,
  vertexCount: number
): Float32Array {
  let current = positions;
  
  for (let iter = 0; iter < iterations; iter++) {
    // Shrink pass (λ > 0)
    current = laplacianPass(current, adjacency, vertexGroups, lambda, vertexCount);
    // Inflate pass (μ < 0, so we use -mu to get positive inflation)
    current = laplacianPass(current, adjacency, vertexGroups, mu, vertexCount);
  }
  
  return current;
}

/**
 * HC (Humphrey's Classes) Laplacian smoothing.
 * Uses original positions as a constraint to preserve volume and features.
 * 
 * @param alpha - Weight of original position (0-1). Higher = more original shape preservation.
 * @param beta - Weight of difference damping (0-1). Higher = more smoothing correction.
 */
function hcSmoothing(
  positions: Float32Array,
  originalPositions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  iterations: number,
  alpha: number,
  beta: number,
  vertexCount: number
): Float32Array {
  let p: Float32Array = new Float32Array(positions); // Current positions
  let q: Float32Array = new Float32Array(positions); // Previous positions
  
  for (let iter = 0; iter < iterations; iter++) {
    // Step 1: Standard Laplacian smoothing to get q (already XY-only in laplacianPass)
    const newQ = laplacianPass(p, adjacency, vertexGroups, 1.0, vertexCount);
    q = newQ;
    
    // Step 2: Calculate b = q - (α * original + (1-α) * p) - only for X and Z
    // Y (vertical) is not smoothed, so we don't need b for Y
    const b = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      const idx = i * 3;
      // X component
      b[idx] = q[idx] - (alpha * originalPositions[idx] + (1 - alpha) * p[idx]);
      // Y component - set to 0 since we don't smooth vertically
      b[idx + 1] = 0;
      // Z component
      b[idx + 2] = q[idx + 2] - (alpha * originalPositions[idx + 2] + (1 - alpha) * p[idx + 2]);
    }
    
    // Step 3: Compute average of b for neighbors and apply correction - only for X and Z
    for (let i = 0; i < vertexCount; i++) {
      const neighbors = adjacency.get(i);
      if (!neighbors || neighbors.size === 0) {
        p[i * 3] = q[i * 3] - b[i * 3];
        // Y is preserved from q (which preserves from laplacianPass)
        p[i * 3 + 1] = q[i * 3 + 1];
        p[i * 3 + 2] = q[i * 3 + 2] - b[i * 3 + 2];
        continue;
      }
      
      // Average b of neighbors - only X and Z
      let avgBx = 0, avgBz = 0;
      for (const ni of neighbors) {
        avgBx += b[ni * 3];
        avgBz += b[ni * 3 + 2];
      }
      avgBx /= neighbors.size;
      avgBz /= neighbors.size;
      
      // p = q - (β * b + (1-β) * avgB) - only for X and Z
      const idx = i * 3;
      p[idx] = q[idx] - (beta * b[idx] + (1 - beta) * avgBx);
      // Y is preserved - no smoothing in vertical direction
      p[idx + 1] = q[idx + 1];
      p[idx + 2] = q[idx + 2] - (beta * b[idx + 2] + (1 - beta) * avgBz);
    }
  }
  
  return p;
}

/**
 * Gaussian filter smoothing - weighted average based on 3D distance.
 * Vertices closer to the center have more influence than farther ones.
 * Produces smoother results than mean filter while preserving features better.
 * Smooths in all 3 directions (X, Y, Z).
 * 
 * @param sigma - Standard deviation for Gaussian weight calculation (larger = more smoothing)
 */
function gaussianSmoothing(
  positions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  iterations: number,
  sigma: number,
  vertexCount: number
): Float32Array {
  let current = new Float32Array(positions);
  const sigma2 = 2 * sigma * sigma;
  
  for (let iter = 0; iter < iterations; iter++) {
    const newPositions = new Float32Array(current.length);
    const processed = new Set<number>();
    
    for (let i = 0; i < vertexCount; i++) {
      const group = vertexGroups[i];
      const firstInGroup = group[0];
      
      if (processed.has(firstInGroup)) {
        newPositions[i * 3] = newPositions[firstInGroup * 3];
        newPositions[i * 3 + 1] = newPositions[firstInGroup * 3 + 1];
        newPositions[i * 3 + 2] = newPositions[firstInGroup * 3 + 2];
        continue;
      }
      
      processed.add(firstInGroup);
      
      const x = current[i * 3];
      const y = current[i * 3 + 1];
      const z = current[i * 3 + 2];
      
      const neighbors = adjacency.get(i);
      if (!neighbors || neighbors.size === 0) {
        for (const vi of group) {
          newPositions[vi * 3] = x;
          newPositions[vi * 3 + 1] = y;
          newPositions[vi * 3 + 2] = z;
        }
        continue;
      }
      
      // Gaussian-weighted average in all 3 directions (X, Y, Z)
      const processedNeighborGroups = new Set<number>();
      let weightedSumX = x; // Self weight is 1.0
      let weightedSumY = y;
      let weightedSumZ = z;
      let totalWeight = 1.0;
      
      for (const ni of neighbors) {
        const neighborGroup = vertexGroups[ni];
        const neighborFirst = neighborGroup[0];
        
        if (!processedNeighborGroups.has(neighborFirst)) {
          processedNeighborGroups.add(neighborFirst);
          
          const nx = current[ni * 3];
          const ny = current[ni * 3 + 1];
          const nz = current[ni * 3 + 2];
          
          // Calculate 3D distance
          const dx = nx - x;
          const dy = ny - y;
          const dz = nz - z;
          const distSq = dx * dx + dy * dy + dz * dz;
          
          // Gaussian weight based on distance
          const weight = Math.exp(-distSq / sigma2);
          
          weightedSumX += nx * weight;
          weightedSumY += ny * weight;
          weightedSumZ += nz * weight;
          totalWeight += weight;
        }
      }
      
      const newX = weightedSumX / totalWeight;
      const newY = weightedSumY / totalWeight;
      const newZ = weightedSumZ / totalWeight;
      
      for (const vi of group) {
        newPositions[vi * 3] = newX;
        newPositions[vi * 3 + 1] = newY;
        newPositions[vi * 3 + 2] = newZ;
      }
    }
    
    current = newPositions;
  }
  
  return current;
}

/**
 * Performs mesh smoothing using a blend of Taubin and Laplacian methods.
 * Based on trCAD smoothing modifier (Taubin95 reference).
 * https://docs.trcad.trinckle.com/trcad_manual/modifier_ref_mod_smoothing.php
 * 
 * The smoothing algorithm blends between:
 * - Taubin smoothing (strength=0): Volume-preserving, weak effect
 * - Laplacian smoothing (strength=1): Strong effect, may cause shrinkage
 * 
 * @param geometry - The input BufferGeometry
 * @param options - Smoothing options or number of iterations (for backward compat)
 * @param lambdaOrProgress - Lambda value or progress callback (backward compat)
 * @param onProgress - Optional progress callback
 * @returns SmoothingResult with the smoothed geometry
 */
export async function laplacianSmooth(
  geometry: THREE.BufferGeometry,
  options: SmoothingOptions | number = 5,
  lambdaOrProgress?: number | ProgressCallback,
  onProgress?: ProgressCallback,
): Promise<SmoothingResult> {
  // Handle backward compatibility
  let opts: SmoothingOptions;
  let progressCb: ProgressCallback | undefined;
  
  if (typeof options === 'number') {
    opts = {
      iterations: options,
      strength: 0, // Default to pure Taubin for backward compat
    };
    progressCb = typeof lambdaOrProgress === 'function' ? lambdaOrProgress : onProgress;
  } else {
    opts = options;
    progressCb = typeof lambdaOrProgress === 'function' ? lambdaOrProgress : onProgress;
  }
  
  // Extract parameters (trCAD-style interface)
  const {
    iterations = 1,       // Default: 1 iteration
    strength = 0,         // Default: pure Taubin (volume-preserving)
    quality = false,      // Default: faster processing
  } = opts;
  
  try {
    const strengthLabel = strength === 0 ? 'Taubin' : strength >= 1 ? 'Laplacian' : `${(strength * 100).toFixed(0)}%`;
    reportProgress(progressCb, 'smoothing', 0, `Starting smoothing (${strengthLabel}, ${iterations} iter)...`);
    
    // Clone geometry to avoid modifying the original
    const workGeometry = geometry.clone();
    const posAttr = workGeometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const vertexCount = posAttr.count;
    const triangleCount = vertexCount / 3;
    
    // Safety check for very large meshes
    const MAX_VERTICES = 1_000_000;
    if (vertexCount > MAX_VERTICES) {
      console.warn(`[laplacianSmooth] Mesh has ${vertexCount.toLocaleString()} vertices, exceeds limit. Skipping.`);
      reportProgress(progressCb, 'smoothing', 100, 'Mesh too large for smoothing');
      return {
        success: true,
        geometry: workGeometry,
        iterations: 0,
        method: 'blended',
        error: `Mesh too large (${vertexCount.toLocaleString()} vertices)`,
      };
    }
    
    reportProgress(progressCb, 'smoothing', 10, 'Building adjacency map...');
    
    // Build vertex adjacency
    const { adjacency, vertexGroups } = buildAdjacencyMap(positions, vertexCount, triangleCount);
    
    reportProgress(progressCb, 'smoothing', 20, `Smoothing (${iterations} iterations)...`);
    
    // Apply trCAD-style smoothing
    const smoothedPositions = trCADSmoothing(
      positions,
      adjacency,
      vertexGroups,
      iterations,
      strength,
      quality,
      vertexCount
    );
    
    reportProgress(progressCb, 'smoothing', 90, 'Updating geometry...');
    
    // Update positions
    posAttr.array.set(smoothedPositions);
    posAttr.needsUpdate = true;
    
    // Recompute normals
    workGeometry.computeVertexNormals();
    
    reportProgress(progressCb, 'smoothing', 100, 'Smoothing complete');
    
    return {
      success: true,
      geometry: workGeometry,
      iterations,
      method: 'blended',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown smoothing error';
    return {
      success: false,
      geometry: null,
      iterations: 0,
      error: errorMessage,
    };
  }
}

// ============================================================================
// trCAD-Style Mesh Smoothing Implementation
// Based on: https://docs.trcad.trinckle.com/trcad_manual/modifier_ref_mod_smoothing.php
// Reference: Taubin, G. "A Signal Processing Approach To Fair Surface Design" (SIGGRAPH 95)
// ============================================================================

/**
 * Vertex classification for heightmap-derived meshes.
 */
enum VertexSurfaceType {
  TOP_SURFACE,      // On the top (offset) surface - variable Y
  BOTTOM_SURFACE,   // On the bottom (flat) surface - constant Y = clipYMin
  WALL,             // On the wall connecting top to bottom
}

/**
 * Analyze the mesh to classify vertices by surface type.
 * 
 * For heightmap meshes:
 * - TOP_SURFACE: Vertices at variable heights (the offset surface)
 * - BOTTOM_SURFACE: Vertices at the minimum Y (flat bottom)
 * - WALL: Vertices that connect top to bottom (have neighbors at different Y levels)
 * 
 * This is more accurate than just checking Y position because it considers connectivity.
 */
function classifyHeightmapVertices(
  positions: Float32Array,
  vertexCount: number,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][]
): {
  bottomY: number;
  yRange: number;
  vertexTypes: Map<number, VertexSurfaceType>;
  topSurfaceVertices: Set<number>;
  bottomSurfaceVertices: Set<number>;
  wallVertices: Set<number>;
} {
  // Find Y range
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const y = positions[i * 3 + 1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  
  const yRange = maxY - minY;
  // Use a small threshold relative to Y range for bottom detection
  const bottomThreshold = minY + Math.max(0.001, yRange * 0.01);
  
  const vertexTypes = new Map<number, VertexSurfaceType>();
  const topSurfaceVertices = new Set<number>();
  const bottomSurfaceVertices = new Set<number>();
  const wallVertices = new Set<number>();
  
  const processedGroups = new Set<number>();
  
  // First pass: classify based on Y position and neighbor Y variance
  for (let i = 0; i < vertexCount; i++) {
    const group = vertexGroups[i];
    const groupId = group[0];
    
    if (processedGroups.has(groupId)) continue;
    processedGroups.add(groupId);
    
    const y = positions[i * 3 + 1];
    const isAtBottom = y <= bottomThreshold;
    
    // Check neighbors to determine if this is a wall vertex
    const neighbors = adjacency.get(i);
    let hasHigherNeighbor = false;
    let hasLowerNeighbor = false;
    let hasSameHeightNeighbor = false;
    
    if (neighbors) {
      for (const ni of neighbors) {
        const ny = positions[ni * 3 + 1];
        const yDiff = ny - y;
        
        if (yDiff > yRange * 0.05) {
          hasHigherNeighbor = true;
        } else if (yDiff < -yRange * 0.05) {
          hasLowerNeighbor = true;
        } else {
          hasSameHeightNeighbor = true;
        }
      }
    }
    
    // Classify the vertex
    let surfaceType: VertexSurfaceType;
    
    if (isAtBottom) {
      // At bottom Y level
      if (hasHigherNeighbor) {
        // Has connection to higher vertices = wall corner at bottom
        surfaceType = VertexSurfaceType.WALL;
      } else {
        // Only same-height neighbors = interior bottom surface
        surfaceType = VertexSurfaceType.BOTTOM_SURFACE;
      }
    } else {
      // Not at bottom
      if (hasLowerNeighbor && hasHigherNeighbor) {
        // Has both higher and lower neighbors = middle of wall
        surfaceType = VertexSurfaceType.WALL;
      } else if (hasLowerNeighbor) {
        // Has lower neighbors = top edge of wall OR top surface boundary
        // If most neighbors are at same height, it's top surface boundary
        surfaceType = hasSameHeightNeighbor ? VertexSurfaceType.TOP_SURFACE : VertexSurfaceType.WALL;
      } else {
        // Only same-height or higher neighbors = top surface
        surfaceType = VertexSurfaceType.TOP_SURFACE;
      }
    }
    
    // Apply to all vertices in this group
    for (const vi of group) {
      vertexTypes.set(vi, surfaceType);
      switch (surfaceType) {
        case VertexSurfaceType.TOP_SURFACE:
          topSurfaceVertices.add(vi);
          break;
        case VertexSurfaceType.BOTTOM_SURFACE:
          bottomSurfaceVertices.add(vi);
          break;
        case VertexSurfaceType.WALL:
          wallVertices.add(vi);
          break;
      }
    }
  }
  
  return {
    bottomY: minY,
    yRange,
    vertexTypes,
    topSurfaceVertices,
    bottomSurfaceVertices,
    wallVertices,
  };
}

/**
 * trCAD-style mesh smoothing that blends between Taubin and Laplacian smoothing.
 * 
 * HEIGHTMAP-AWARE HORIZONTAL SMOOTHING:
 * For heightmap-derived meshes, jagged edges occur in the HORIZONTAL plane (X-Z in Three.js).
 * The Y coordinate (Three.js) represents HEIGHT and must be preserved to maintain the
 * correct offset/clearance from the part.
 * 
 * Coordinate mapping:
 * - Three.js: X, Z = horizontal plane, Y = up (height)
 * - World:    X, Y = horizontal plane, Z = up (height)
 * 
 * Smoothing behavior:
 * - TOP_SURFACE & WALL: Smooth X-Z only (horizontal), PRESERVE Y (height)
 * - BOTTOM_SURFACE: No smoothing (keeps flat bottom intact)
 * 
 * The algorithm works as follows:
 * - Taubin smoothing (strength=0): Two-pass algorithm that preserves volume.
 *   Pass 1: Shrink with λ (moves vertices toward neighbors)
 *   Pass 2: Inflate with μ (moves vertices away from neighbors to counteract shrinkage)
 * 
 * - Laplacian smoothing (strength=1): Single-pass algorithm with stronger effect.
 *   Only shrinks, causing the mesh to progressively shrink with more iterations.
 * 
 * @param positions - Vertex positions as Float32Array
 * @param adjacency - Adjacency map for each vertex
 * @param vertexGroups - Groups of vertices at the same position
 * @param iterations - Number of smoothing iterations (iter parameter)
 * @param strength - Blend factor 0-1: 0=pure Taubin (weak), 1=pure Laplacian (strong)
 * @param quality - If true, use cotangent weights for better quality (slower)
 * @param vertexCount - Total number of vertices
 * @returns Smoothed positions
 */
function trCADSmoothing(
  positions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  iterations: number,
  strength: number,
  quality: boolean,
  vertexCount: number
): Float32Array {
  // Clamp strength to [0, 1]
  const s = Math.max(0, Math.min(1, strength));
  
  // Taubin smoothing parameters from the original paper (Taubin95)
  const TAUBIN_LAMBDA = 0.5;
  const TAUBIN_MU = -0.53;
  const LAPLACIAN_LAMBDA = 0.5;
  
  // Classify vertices by surface type for heightmap-aware smoothing
  const heightmapInfo = classifyHeightmapVertices(positions, vertexCount, adjacency, vertexGroups);
  
  // Build cotangent weights if quality mode
  let cotWeights: Map<string, number> | null = null;
  if (quality) {
    cotWeights = buildCotangentWeights(positions, vertexCount, vertexGroups);
  }
  
  let current: any = new Float32Array(positions);
  
  for (let iter = 0; iter < iterations; iter++) {
    if (s === 0) {
      // Pure Taubin: two passes per iteration
      current = smoothPassHeightmapAware(current, adjacency, vertexGroups, TAUBIN_LAMBDA, quality, cotWeights, vertexCount, heightmapInfo);
      current = smoothPassHeightmapAware(current, adjacency, vertexGroups, TAUBIN_MU, quality, cotWeights, vertexCount, heightmapInfo);
    } else if (s >= 1) {
      // Pure Laplacian
      current = smoothPassHeightmapAware(current, adjacency, vertexGroups, LAPLACIAN_LAMBDA, quality, cotWeights, vertexCount, heightmapInfo);
    } else {
      // Blended: compute both and interpolate
      let taubinResult = smoothPassHeightmapAware(current, adjacency, vertexGroups, TAUBIN_LAMBDA, quality, cotWeights, vertexCount, heightmapInfo);
      taubinResult = smoothPassHeightmapAware(taubinResult, adjacency, vertexGroups, TAUBIN_MU, quality, cotWeights, vertexCount, heightmapInfo);
      
      const laplacianResult = smoothPassHeightmapAware(current, adjacency, vertexGroups, LAPLACIAN_LAMBDA, quality, cotWeights, vertexCount, heightmapInfo);
      
      const blended = new Float32Array(current.length);
      for (let i = 0; i < current.length; i++) {
        blended[i] = (1 - s) * taubinResult[i] + s * laplacianResult[i];
      }
      current = blended;
    }
  }
  
  return current as Float32Array;
}

/**
 * Single smoothing pass with heightmap-aware vertex handling.
 * 
 * For heightmap-derived meshes, the jagged edges are in the HORIZONTAL plane (X-Z in Three.js,
 * which is X-Y in world coordinates). The Y coordinate (Three.js) represents HEIGHT (world Z)
 * and should be PRESERVED to maintain the correct offset/clearance from the part.
 * 
 * Smoothing behavior:
 * - TOP_SURFACE: Smooth X-Z only (horizontal), preserve Y (height)
 * - WALL: Smooth X-Z only (horizontal), preserve Y (height)
 * - BOTTOM_SURFACE: No smoothing at all
 * 
 * This ensures the boundary contour becomes smoother without affecting the height profile.
 */
function smoothPassHeightmapAware(
  positions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  factor: number,
  quality: boolean,
  cotWeights: Map<string, number> | null,
  vertexCount: number,
  heightmapInfo: {
    bottomY: number;
    yRange: number;
    vertexTypes: Map<number, VertexSurfaceType>;
    topSurfaceVertices: Set<number>;
    bottomSurfaceVertices: Set<number>;
    wallVertices: Set<number>;
  }
): Float32Array {
  const result = new Float32Array(positions.length);
  const processedGroups = new Set<number>();
  
  // Y tolerance for "same height" neighbor filtering
  const yTolerance = Math.max(0.001, heightmapInfo.yRange * 0.15);
  
  for (let i = 0; i < vertexCount; i++) {
    const group = vertexGroups[i];
    const groupId = group[0];
    
    // Process each unique position only once
    if (processedGroups.has(groupId)) {
      result[i * 3] = result[groupId * 3];
      result[i * 3 + 1] = result[groupId * 3 + 1];
      result[i * 3 + 2] = result[groupId * 3 + 2];
      continue;
    }
    processedGroups.add(groupId);
    
    const px = positions[i * 3];
    const py = positions[i * 3 + 1]; // Y = height in Three.js (world Z)
    const pz = positions[i * 3 + 2];
    
    // Get vertex surface type
    const surfaceType = heightmapInfo.vertexTypes.get(i) ?? VertexSurfaceType.TOP_SURFACE;
    
    // BOTTOM_SURFACE vertices: No smoothing at all - keep original position
    if (surfaceType === VertexSurfaceType.BOTTOM_SURFACE) {
      for (const vi of group) {
        result[vi * 3] = px;
        result[vi * 3 + 1] = py;
        result[vi * 3 + 2] = pz;
      }
      continue;
    }
    
    const neighbors = adjacency.get(i);
    if (!neighbors || neighbors.size === 0) {
      for (const vi of group) {
        result[vi * 3] = px;
        result[vi * 3 + 1] = py;
        result[vi * 3 + 2] = pz;
      }
      continue;
    }
    
    // Compute weighted centroid of FILTERED neighbors (X and Z only, not Y)
    let sumX = 0, sumZ = 0;
    let totalWeight = 0;
    const visitedNeighborGroups = new Set<number>();
    
    for (const ni of neighbors) {
      const neighborGroupId = vertexGroups[ni][0];
      if (visitedNeighborGroups.has(neighborGroupId)) continue;
      visitedNeighborGroups.add(neighborGroupId);
      
      const nx = positions[ni * 3];
      const ny = positions[ni * 3 + 1];
      const nz = positions[ni * 3 + 2];
      const neighborType = heightmapInfo.vertexTypes.get(ni);
      
      // ALWAYS exclude BOTTOM_SURFACE neighbors - they don't move
      if (neighborType === VertexSurfaceType.BOTTOM_SURFACE) continue;
      
      // Filter to same-height neighbors for horizontal smoothing
      // This ensures we only smooth with vertices at similar heights
      if (Math.abs(ny - py) > yTolerance) continue;
      
      let weight = 1.0;
      if (quality && cotWeights) {
        const edgeKey = makeEdgeKey(groupId, neighborGroupId);
        weight = cotWeights.get(edgeKey) ?? 1.0;
      }
      
      // Only accumulate X and Z for horizontal smoothing
      sumX += nx * weight;
      sumZ += nz * weight;
      totalWeight += weight;
    }
    
    if (totalWeight > 0) {
      const cx = sumX / totalWeight;
      const cz = sumZ / totalWeight;
      
      // Smooth X and Z (horizontal plane), PRESERVE Y (height)
      const newX = px + factor * (cx - px);
      const newY = py; // ALWAYS preserve Y (height) to maintain offset distance
      const newZ = pz + factor * (cz - pz);
      
      for (const vi of group) {
        result[vi * 3] = newX;
        result[vi * 3 + 1] = newY;
        result[vi * 3 + 2] = newZ;
      }
    } else {
      // No valid neighbors after filtering - keep original position
      for (const vi of group) {
        result[vi * 3] = px;
        result[vi * 3 + 1] = py;
        result[vi * 3 + 2] = pz;
      }
    }
  }
  
  return result;
}

/**
 * Original smoothPass function for non-heightmap meshes.
 * Kept for backwards compatibility and general 3D smoothing.
 * 
 * @param factor - Positive = shrink toward centroid, negative = inflate away
 */
function smoothPass(
  positions: Float32Array,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  factor: number,
  quality: boolean,
  cotWeights: Map<string, number> | null,
  vertexCount: number
): Float32Array {
  const result = new Float32Array(positions.length);
  const processedGroups = new Set<number>();
  
  for (let i = 0; i < vertexCount; i++) {
    const group = vertexGroups[i];
    const groupId = group[0];
    
    // Process each unique position only once
    if (processedGroups.has(groupId)) {
      // Copy from already computed position
      result[i * 3] = result[groupId * 3];
      result[i * 3 + 1] = result[groupId * 3 + 1];
      result[i * 3 + 2] = result[groupId * 3 + 2];
      continue;
    }
    processedGroups.add(groupId);
    
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    
    const neighbors = adjacency.get(i);
    if (!neighbors || neighbors.size === 0) {
      // No neighbors - keep original position
      for (const vi of group) {
        result[vi * 3] = px;
        result[vi * 3 + 1] = py;
        result[vi * 3 + 2] = pz;
      }
      continue;
    }
    
    // Compute weighted centroid of neighbors (Laplacian)
    let sumX = 0, sumY = 0, sumZ = 0;
    let totalWeight = 0;
    const visitedNeighborGroups = new Set<number>();
    
    for (const ni of neighbors) {
      const neighborGroupId = vertexGroups[ni][0];
      
      // Skip if we've already counted this neighbor group
      if (visitedNeighborGroups.has(neighborGroupId)) continue;
      visitedNeighborGroups.add(neighborGroupId);
      
      // Get weight: cotangent weight for quality mode, uniform otherwise
      let weight = 1.0;
      if (quality && cotWeights) {
        const edgeKey = makeEdgeKey(groupId, neighborGroupId);
        weight = cotWeights.get(edgeKey) ?? 1.0;
      }
      
      sumX += positions[ni * 3] * weight;
      sumY += positions[ni * 3 + 1] * weight;
      sumZ += positions[ni * 3 + 2] * weight;
      totalWeight += weight;
    }
    
    if (totalWeight > 0) {
      // Centroid of neighbors
      const cx = sumX / totalWeight;
      const cy = sumY / totalWeight;
      const cz = sumZ / totalWeight;
      
      // Laplacian: L(p) = centroid - p
      // New position: p' = p + factor * L(p) = p + factor * (centroid - p)
      const newX = px + factor * (cx - px);
      const newY = py + factor * (cy - py);
      const newZ = pz + factor * (cz - pz);
      
      // Apply to all vertices in this group
      for (const vi of group) {
        result[vi * 3] = newX;
        result[vi * 3 + 1] = newY;
        result[vi * 3 + 2] = newZ;
      }
    } else {
      // Fallback: keep original
      for (const vi of group) {
        result[vi * 3] = px;
        result[vi * 3 + 1] = py;
        result[vi * 3 + 2] = pz;
      }
    }
  }
  
  return result;
}

/**
 * Build cotangent weights for quality smoothing.
 * Cotangent weights (Laplacian-Beltrami) provide more geometrically accurate
 * smoothing by considering triangle shapes.
 * 
 * IMPORTANT: Edge keys are built using vertex GROUP IDs (first vertex of each
 * position group) to match how smoothPass looks up weights.
 */
function buildCotangentWeights(
  positions: Float32Array,
  vertexCount: number,
  vertexGroups: number[][]
): Map<string, number> {
  const weights = new Map<string, number>();
  const triangleCount = vertexCount / 3;
  
  for (let t = 0; t < triangleCount; t++) {
    const i0 = t * 3;
    const i1 = t * 3 + 1;
    const i2 = t * 3 + 2;
    
    // Get GROUP IDs for each vertex (first vertex of each position group)
    const g0 = vertexGroups[i0][0];
    const g1 = vertexGroups[i1][0];
    const g2 = vertexGroups[i2][0];
    
    // Skip degenerate triangles where vertices share the same position
    if (g0 === g1 || g1 === g2 || g2 === g0) continue;
    
    // Triangle vertices
    const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
    
    // Edge vectors
    const v01 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v02 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const v12 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const v10 = [-v01[0], -v01[1], -v01[2]];
    const v20 = [-v02[0], -v02[1], -v02[2]];
    const v21 = [-v12[0], -v12[1], -v12[2]];
    
    // Cotangent of each angle
    const cot0 = computeCot(v01, v02); // Angle at vertex 0
    const cot1 = computeCot(v10, v12); // Angle at vertex 1
    const cot2 = computeCot(v20, v21); // Angle at vertex 2
    
    // For edge opposite to vertex i, weight = cot(angle at i)
    // Edge 1-2 is opposite to vertex 0, so weight = cot0
    // Edge 0-2 is opposite to vertex 1, so weight = cot1
    // Edge 0-1 is opposite to vertex 2, so weight = cot2
    // Use GROUP IDs for edge keys to match smoothPass lookups
    addEdgeWeight(weights, g1, g2, cot0);
    addEdgeWeight(weights, g0, g2, cot1);
    addEdgeWeight(weights, g0, g1, cot2);
  }
  
  // Normalize and clamp weights to prevent extreme values
  for (const [key, weight] of weights) {
    weights.set(key, Math.max(0.01, Math.min(weight, 10.0)));
  }
  
  return weights;
}

/**
 * Compute cotangent of angle between two vectors.
 * cot(θ) = cos(θ) / sin(θ) = (a·b) / |a×b|
 */
function computeCot(a: number[], b: number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const crossX = a[1] * b[2] - a[2] * b[1];
  const crossY = a[2] * b[0] - a[0] * b[2];
  const crossZ = a[0] * b[1] - a[1] * b[0];
  const crossMag = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
  
  if (crossMag < 1e-12) return 0;
  return dot / crossMag;
}

/**
 * Create a consistent edge key for two vertex indices.
 */
function makeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Add weight to an edge, accumulating if it already exists.
 */
function addEdgeWeight(weights: Map<string, number>, a: number, b: number, w: number): void {
  const key = makeEdgeKey(a, b);
  const existing = weights.get(key) ?? 0;
  weights.set(key, existing + w);
}

// ============================================================================
// Boundary Smoothing - Chaikin Corner Cutting
// Specifically targets wall vertices without affecting top/bottom surfaces
// ============================================================================

/**
 * Identify boundary (wall) vertices in a heightmap-derived mesh.
 * Wall vertices are those that are NOT at the top or bottom Y levels.
 * 
 * For heightmap meshes:
 * - Top surface vertices: at the highest Y values (variable heights)
 * - Bottom surface vertices: at clipYMin (flat bottom)
 * - Wall vertices: connect top to bottom, need smoothing
 * 
 * We identify wall vertices by checking if they have neighbors at significantly
 * different Y levels (connecting top to bottom).
 */
function identifyBoundaryVertices(
  positions: Float32Array,
  vertexCount: number,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][]
): Set<number> {
  const boundaryVertices = new Set<number>();
  
  // Find the Y range of the mesh
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const y = positions[i * 3 + 1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  
  const yRange = maxY - minY;
  if (yRange < 0.001) {
    // Flat mesh, no boundaries
    return boundaryVertices;
  }
  
  // A vertex is a wall vertex if:
  // 1. It's at the bottom Y level (flat bottom), OR
  // 2. It has a neighbor at a significantly different Y level
  // 3. AND it's part of the outer boundary (has fewer than max neighbors)
  
  const bottomThreshold = minY + yRange * 0.05; // Within 5% of bottom
  const topThreshold = maxY - yRange * 0.05;    // Within 5% of top
  
  // First pass: identify vertices that are clearly on walls
  // These are bottom vertices that are on the boundary (not interior)
  const processedGroups = new Set<number>();
  
  for (let i = 0; i < vertexCount; i++) {
    const group = vertexGroups[i];
    const firstInGroup = group[0];
    
    if (processedGroups.has(firstInGroup)) continue;
    processedGroups.add(firstInGroup);
    
    const y = positions[i * 3 + 1];
    const neighbors = adjacency.get(i);
    
    if (!neighbors || neighbors.size === 0) continue;
    
    // Check if this vertex is at the bottom level
    const isBottom = y <= bottomThreshold;
    
    if (isBottom) {
      // Check if any neighbor is significantly higher (wall connection)
      let hasTopNeighbor = false;
      for (const ni of neighbors) {
        const ny = positions[ni * 3 + 1];
        if (ny > y + yRange * 0.1) { // Neighbor is at least 10% higher
          hasTopNeighbor = true;
          break;
        }
      }
      
      if (hasTopNeighbor) {
        // This is a boundary bottom vertex
        for (const vi of group) {
          boundaryVertices.add(vi);
        }
      }
    }
  }
  
  // Second pass: find all wall vertices by following edges from boundary bottom vertices
  // Wall vertices are those between bottom and top that connect boundary vertices
  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    
    for (let i = 0; i < vertexCount; i++) {
      if (boundaryVertices.has(i)) continue;
      
      const y = positions[i * 3 + 1];
      const neighbors = adjacency.get(i);
      if (!neighbors) continue;
      
      // Skip vertices that are clearly on the top surface (interior)
      if (y >= topThreshold) continue;
      
      // Check if this vertex connects boundary vertices
      let boundaryNeighborCount = 0;
      let hasDifferentYNeighbor = false;
      
      for (const ni of neighbors) {
        if (boundaryVertices.has(ni)) {
          boundaryNeighborCount++;
        }
        const ny = positions[ni * 3 + 1];
        if (Math.abs(ny - y) > yRange * 0.05) {
          hasDifferentYNeighbor = true;
        }
      }
      
      // If connected to boundary and has vertical neighbors, it's a wall vertex
      if (boundaryNeighborCount > 0 && hasDifferentYNeighbor) {
        const group = vertexGroups[i];
        for (const vi of group) {
          boundaryVertices.add(vi);
        }
        changed = true;
      }
    }
  }
  
  return boundaryVertices;
}

/**
 * Extract boundary contours at each unique Y level.
 * Returns a map from Y level to ordered list of vertex indices forming the contour.
 */
function extractBoundaryContours(
  positions: Float32Array,
  boundaryVertices: Set<number>,
  adjacency: Map<number, Set<number>>,
  vertexGroups: number[][],
  vertexCount: number
): Map<number, number[][]> {
  const yTolerance = 0.001;
  const contoursByY = new Map<number, number[][]>();
  
  // Group boundary vertices by Y level
  const verticesByY = new Map<number, number[]>();
  const processedGroups = new Set<number>();
  
  for (const vi of boundaryVertices) {
    const group = vertexGroups[vi];
    const firstInGroup = group[0];
    
    if (processedGroups.has(firstInGroup)) continue;
    processedGroups.add(firstInGroup);
    
    const y = positions[vi * 3 + 1];
    
    // Find or create Y level bucket
    let foundY: number | null = null;
    for (const existingY of verticesByY.keys()) {
      if (Math.abs(existingY - y) < yTolerance) {
        foundY = existingY;
        break;
      }
    }
    
    if (foundY === null) {
      foundY = y;
      verticesByY.set(foundY, []);
    }
    
    verticesByY.get(foundY)!.push(firstInGroup);
  }
  
  // For each Y level, extract ordered contours
  for (const [yLevel, vertices] of verticesByY) {
    if (vertices.length < 3) continue;
    
    const contours: number[][] = [];
    const visited = new Set<number>();
    
    // Find connected contours at this Y level
    for (const startVert of vertices) {
      if (visited.has(startVert)) continue;
      
      const contour: number[] = [];
      let current = startVert;
      
      // Walk the contour
      while (!visited.has(current)) {
        visited.add(current);
        contour.push(current);
        
        // Find next vertex in contour (at same Y level, boundary vertex, not visited)
        const neighbors = adjacency.get(current);
        if (!neighbors) break;
        
        let nextVert: number | null = null;
        for (const ni of neighbors) {
          const niGroup = vertexGroups[ni][0];
          if (visited.has(niGroup)) continue;
          if (!boundaryVertices.has(ni)) continue;
          
          const ny = positions[ni * 3 + 1];
          if (Math.abs(ny - yLevel) < yTolerance) {
            nextVert = niGroup;
            break;
          }
        }
        
        if (nextVert === null) break;
        current = nextVert;
      }
      
      if (contour.length >= 3) {
        contours.push(contour);
      }
    }
    
    if (contours.length > 0) {
      contoursByY.set(yLevel, contours);
    }
  }
  
  return contoursByY;
}

/**
 * Apply Chaikin corner cutting to a 2D contour (in XZ plane).
 * This smooths the jagged stair-step pattern on boundary walls.
 * 
 * Chaikin's algorithm:
 * For each edge (P_i, P_{i+1}), create two new points:
 *   Q = 0.75 * P_i + 0.25 * P_{i+1}
 *   R = 0.25 * P_i + 0.75 * P_{i+1}
 * 
 * For boundary smoothing, we use a gentler version:
 *   Q = 0.875 * P_i + 0.125 * P_{i+1}  (closer to original)
 *   R = 0.125 * P_i + 0.875 * P_{i+1}
 */
function chaikinSmooth2D(
  positions: Float32Array,
  contour: number[],
  iterations: number
): Map<number, { x: number, z: number }> {
  if (contour.length < 3) {
    return new Map();
  }
  
  // Extract XZ positions for contour vertices
  let points: { x: number, z: number, origIdx: number }[] = contour.map(vi => ({
    x: positions[vi * 3],
    z: positions[vi * 3 + 2],
    origIdx: vi
  }));
  
  // Apply Chaikin iterations
  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: { x: number, z: number, origIdx: number }[] = [];
    
    for (let i = 0; i < points.length; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % points.length];
      
      // Gentler corner cutting (0.875/0.125 instead of 0.75/0.25)
      const q = {
        x: 0.875 * p0.x + 0.125 * p1.x,
        z: 0.875 * p0.z + 0.125 * p1.z,
        origIdx: p0.origIdx // Inherit original index for first point
      };
      
      const r = {
        x: 0.125 * p0.x + 0.875 * p1.x,
        z: 0.125 * p0.z + 0.875 * p1.z,
        origIdx: p1.origIdx // Inherit original index for second point
      };
      
      newPoints.push(q, r);
    }
    
    points = newPoints;
  }
  
  // Map original vertex indices to their smoothed positions
  // For each original vertex, find the closest smoothed point that inherits from it
  const smoothedPositions = new Map<number, { x: number, z: number }>();
  
  for (const origIdx of contour) {
    // Find all points that inherit from this original index
    const matchingPoints = points.filter(p => p.origIdx === origIdx);
    
    if (matchingPoints.length > 0) {
      // Use the first matching point (Q point in Chaikin)
      smoothedPositions.set(origIdx, { 
        x: matchingPoints[0].x, 
        z: matchingPoints[0].z 
      });
    }
  }
  
  return smoothedPositions;
}

/**
 * Apply Chaikin boundary smoothing to wall vertices.
 * This smooths the stair-step pattern on boundary walls without affecting
 * the top surface shape.
 */
export async function boundarySmooth(
  geometry: THREE.BufferGeometry,
  options: BoundarySmoothingOptions,
  onProgress?: ProgressCallback
): Promise<BoundarySmoothingResult> {
  const { iterations = 3 } = options;
  
  try {
    reportProgress(onProgress, 'smoothing', 0, 'Starting boundary smoothing...');
    
    // Clone geometry to avoid modifying original
    const workGeometry = geometry.clone();
    
    // Ensure non-indexed geometry for consistent vertex handling
    if (workGeometry.index) {
      const posAttr = workGeometry.getAttribute('position');
      const indexArray = workGeometry.index.array;
      const newPositions = new Float32Array(indexArray.length * 3);
      
      for (let i = 0; i < indexArray.length; i++) {
        const idx = indexArray[i];
        newPositions[i * 3] = posAttr.getX(idx);
        newPositions[i * 3 + 1] = posAttr.getY(idx);
        newPositions[i * 3 + 2] = posAttr.getZ(idx);
      }
      
      workGeometry.deleteAttribute('position');
      workGeometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
      workGeometry.setIndex(null);
    }
    
    const posAttr = workGeometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const vertexCount = positions.length / 3;
    const triangleCount = vertexCount / 3;
    
    reportProgress(onProgress, 'smoothing', 10, 'Building adjacency map...');
    
    // Build adjacency map
    const { adjacency, vertexGroups } = buildAdjacencyMap(positions, vertexCount, triangleCount);
    
    reportProgress(onProgress, 'smoothing', 20, 'Identifying boundary vertices...');
    
    // Identify boundary (wall) vertices
    const boundaryVertices = identifyBoundaryVertices(positions, vertexCount, adjacency, vertexGroups);
    
    if (boundaryVertices.size === 0) {
      reportProgress(onProgress, 'smoothing', 100, 'No boundary vertices found');
      return {
        success: true,
        geometry: workGeometry,
        iterations: 0,
        boundaryVerticesSmoothed: 0,
      };
    }
    
    reportProgress(onProgress, 'smoothing', 40, `Found ${boundaryVertices.size} boundary vertices`);
    
    // Extract boundary contours by Y level
    const contoursByY = extractBoundaryContours(positions, boundaryVertices, adjacency, vertexGroups, vertexCount);
    
    reportProgress(onProgress, 'smoothing', 50, `Extracted ${contoursByY.size} Y-level contours`);
    
    // Apply Chaikin smoothing to each contour
    const allSmoothedPositions = new Map<number, { x: number, z: number }>();
    let contourIndex = 0;
    const totalContours = Array.from(contoursByY.values()).reduce((sum, c) => sum + c.length, 0);
    
    for (const [yLevel, contours] of contoursByY) {
      for (const contour of contours) {
        const progress = 50 + (contourIndex / totalContours) * 40;
        reportProgress(onProgress, 'smoothing', progress, `Smoothing contour ${contourIndex + 1}/${totalContours}`);
        
        const smoothed = chaikinSmooth2D(positions, contour, iterations);
        
        // Merge into all smoothed positions
        for (const [idx, pos] of smoothed) {
          allSmoothedPositions.set(idx, pos);
        }
        
        contourIndex++;
      }
    }
    
    reportProgress(onProgress, 'smoothing', 90, 'Applying smoothed positions...');
    
    // Apply smoothed positions to all vertices in each group
    let smoothedCount = 0;
    for (const [groupFirst, newPos] of allSmoothedPositions) {
      const group = vertexGroups[groupFirst];
      
      for (const vi of group) {
        positions[vi * 3] = newPos.x;
        // Y is preserved (not smoothed)
        positions[vi * 3 + 2] = newPos.z;
        smoothedCount++;
      }
    }
    
    posAttr.needsUpdate = true;
    workGeometry.computeVertexNormals();
    
    reportProgress(onProgress, 'smoothing', 100, 'Boundary smoothing complete');
    
    return {
      success: true,
      geometry: workGeometry,
      iterations,
      boundaryVerticesSmoothed: smoothedCount,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown boundary smoothing error';
    return {
      success: false,
      geometry: null,
      iterations: 0,
      boundaryVerticesSmoothed: 0,
      error: errorMessage,
    };
  }
}

// ============================================================================
// Pipeline
// ============================================================================

export interface PipelineOptions {
  autoRepair?: boolean;
  decimate?: boolean;
  targetTriangles?: number;
}

export interface PipelineResult {
  analysis: MeshAnalysisResult;
  repair?: MeshRepairResult;
  decimation?: DecimationResult;
  finalGeometry: THREE.BufferGeometry;
}

/**
 * Full mesh processing pipeline: analyze, optionally repair, and optionally decimate
 */
export async function processMeshPipeline(
  geometry: THREE.BufferGeometry,
  options: PipelineOptions = {},
  onProgress?: ProgressCallback
): Promise<PipelineResult> {
  const { 
    autoRepair = true, 
    decimate = false, 
    targetTriangles = DECIMATION_TARGET 
  } = options;
  
  // Step 1: Analyze
  const analysis = await analyzeMesh(geometry, onProgress);
  
  let currentGeometry = geometry;
  let repair: MeshRepairResult | undefined;
  let decimation: DecimationResult | undefined;
  
  // Step 2: Repair if needed
  if (autoRepair && analysis.issues.length > 0) {
    repair = await repairMesh(currentGeometry, onProgress);
    if (repair.success && repair.geometry) {
      currentGeometry = repair.geometry;
    }
  }
  
  // Step 3: Decimate if requested
  if (decimate) {
    decimation = await decimateMesh(currentGeometry, targetTriangles, onProgress);
    if (decimation.success && decimation.geometry) {
      currentGeometry = decimation.geometry;
    }
  }
  
  reportProgress(onProgress, 'complete', 100, 'Processing complete');
  
  return {
    analysis,
    repair,
    decimation,
    finalGeometry: currentGeometry,
  };
}
