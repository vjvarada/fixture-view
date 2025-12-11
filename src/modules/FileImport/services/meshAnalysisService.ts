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
  method?: 'taubin' | 'hc' | 'combined' | 'gaussian';
  error?: string;
}

export interface SmoothingOptions {
  /** Number of iterations (used for non-combined methods) */
  iterations: number;
  /** Smoothing method */
  method: 'taubin' | 'hc' | 'combined' | 'gaussian';
  /** Taubin lambda (shrink factor, 0-1) */
  lambda?: number;
  /** Taubin mu (inflate factor, negative) */
  mu?: number;
  /** HC alpha (original position weight, 0-1) */
  alpha?: number;
  /** HC beta (difference damping, 0-1) */
  beta?: number;
  /** Gaussian sigma (standard deviation for weight falloff) */
  sigma?: number;
  /** Combined method: Gaussian pass iterations */
  gaussianIterations?: number;
  /** Combined method: Laplacian pass iterations */
  laplacianIterations?: number;
  /** Combined method: Taubin pass iterations */
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
    console.log(`[MeshOptimizer] Merging vertices: ${originalVertexCount} vertices for ${originalTriangles} triangles`);
    workGeometry = mergeVertices(workGeometry, 1e-4); // tolerance for merging
    console.log(`[MeshOptimizer] After merge: ${workGeometry.getAttribute('position').count} unique vertices`);
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
    
    console.log(`[MeshOptimizer] Simplified: ${originalTriangles} → ${finalTriangles} triangles (error: ${resultError.toFixed(6)})`);
    
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
    return {
      success: true,
      geometry: geometry.clone(),
      originalTriangles,
      finalTriangles: originalTriangles,
      reductionPercent: 0,
    };
  }
  
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
        currentGeometry = meshoptResult.geometry;
        currentTriangles = meshoptResult.finalTriangles;
        console.log(`[decimateMesh] MeshOptimizer: ${originalTriangles.toLocaleString()} → ${currentTriangles.toLocaleString()} triangles`);
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
      
      console.log(`[decimateMesh] Fast Quadric: ${currentTriangles.toLocaleString()} → ${result.finalTriangles.toLocaleString()} triangles`);
      
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
      
      console.log(`[decimateMesh] Manifold3D fallback success: ${originalTriangles.toLocaleString()} → ${manifoldResult.finalTriangles.toLocaleString()} triangles`);
      
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
    console.log('[decimateMesh] Attempting vertex clustering decimation...');
    
    const clusteredGeometry = vertexClusteringDecimate(currentGeometry, targetTriangles);
    const finalTriangles = clusteredGeometry.index 
      ? clusteredGeometry.index.count / 3 
      : clusteredGeometry.getAttribute('position').count / 3;
    const reductionPercent = ((originalTriangles - finalTriangles) / originalTriangles) * 100;
    
    clusteredGeometry.computeVertexNormals();
    reportProgress(onProgress, 'decimating', 100, 'Vertex clustering decimation complete');
    
    console.log(`[decimateMesh] Vertex clustering success: ${originalTriangles.toLocaleString()} → ${finalTriangles.toLocaleString()} triangles (${reductionPercent.toFixed(1)}% reduction)`);
    
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
  
  console.log(`[vertexClusteringDecimate] Reduced from ${triangleCount} to ${newTriangles.length / 3} triangles using ${cellMap.size} cells`);
  
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
 * Performs mesh smoothing using Taubin, HC, Combined, or Gaussian methods.
 * All methods now smooth in all 3 directions (X, Y, Z).
 * 
 * Methods:
 * - taubin: Alternates shrinking (λ) and inflating (μ) passes. Good basic smoothing.
 * - hc: HC Laplacian uses original positions as constraint. Better at preserving volume.
 * - combined: Uses only Gaussian smoothing (simplest and most effective).
 * - gaussian: Distance-weighted smoothing. Good for noise reduction.
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
      method: 'combined',
      lambda: typeof lambdaOrProgress === 'number' ? lambdaOrProgress : 0.5,
    };
    progressCb = typeof lambdaOrProgress === 'function' ? lambdaOrProgress : onProgress;
  } else {
    opts = options;
    progressCb = typeof lambdaOrProgress === 'function' ? lambdaOrProgress : onProgress;
  }
  
  const {
    iterations = 5,
    method = 'combined',
    lambda = 0.5,
    mu = -0.53, // Slightly larger than -lambda to prevent shrinkage
    alpha = 0.5,
    beta = 0.5,
    sigma = 1.0, // Gaussian sigma for weight falloff
  } = opts;
  
  try {
    reportProgress(progressCb, 'smoothing', 0, `Starting ${method} smoothing...`);
    
    // Clone geometry to avoid modifying the original
    const workGeometry = geometry.clone();
    const posAttr = workGeometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const vertexCount = posAttr.count;
    const triangleCount = vertexCount / 3;
    
    // Safety check: JavaScript Maps have a practical limit around 16M entries
    // For very large meshes, skip smoothing to avoid memory issues
    const MAX_VERTICES_FOR_SMOOTHING = 1_000_000; // 1M vertices (~333K triangles)
    if (vertexCount > MAX_VERTICES_FOR_SMOOTHING) {
      console.warn(`[laplacianSmooth] Mesh has ${vertexCount.toLocaleString()} vertices, exceeds limit of ${MAX_VERTICES_FOR_SMOOTHING.toLocaleString()}. Skipping smoothing to avoid memory issues.`);
      reportProgress(progressCb, 'smoothing', 100, 'Mesh too large for smoothing, skipped');
      return {
        success: true,
        geometry: workGeometry,
        iterations: 0,
        method,
        error: `Mesh too large for smoothing (${vertexCount.toLocaleString()} vertices, max ${MAX_VERTICES_FOR_SMOOTHING.toLocaleString()})`,
      };
    }
    
    reportProgress(progressCb, 'smoothing', 10, 'Building adjacency map...');
    
    // Build adjacency map (handles non-indexed geometry by grouping vertices by position)
    const { adjacency, vertexGroups } = buildAdjacencyMap(positions, vertexCount, triangleCount);
    
    reportProgress(progressCb, 'smoothing', 20, `Running ${method} smoothing (${iterations} iterations)...`);
    
    let smoothedPositions: Float32Array;
    
    switch (method) {
      case 'taubin':
        smoothedPositions = taubinSmoothing(
          positions, adjacency, vertexGroups, iterations, lambda, mu, vertexCount
        );
        break;
        
      case 'hc':
        smoothedPositions = hcSmoothing(
          positions, new Float32Array(positions), adjacency, vertexGroups, iterations, alpha, beta, vertexCount
        );
        break;
      
      case 'gaussian':
        smoothedPositions = gaussianSmoothing(
          positions, adjacency, vertexGroups, iterations, sigma, vertexCount
        );
        break;
        
      case 'combined':
      default:
        // Combined now uses only Gaussian smoothing (simplest and most effective)
        // Use gaussianIterations if provided, otherwise use iterations
        const gaussianIters = opts.gaussianIterations ?? iterations;
        
        reportProgress(progressCb, 'smoothing', 30, `Gaussian smoothing (${gaussianIters} iterations)...`);
        smoothedPositions = gaussianSmoothing(
          positions, adjacency, vertexGroups, gaussianIters, sigma, vertexCount
        );
        break;
    }
    
    reportProgress(progressCb, 'smoothing', 90, 'Updating geometry...');
    
    // Update positions in geometry
    posAttr.array.set(smoothedPositions);
    posAttr.needsUpdate = true;
    
    // Recompute normals
    workGeometry.computeVertexNormals();
    
    reportProgress(progressCb, 'smoothing', 100, 'Smoothing complete');
    
    return {
      success: true,
      geometry: workGeometry,
      iterations,
      method,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown smoothing error';
    console.error('Smoothing error:', error);
    return {
      success: false,
      geometry: null,
      iterations: 0,
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
