/**
 * Mesh Analysis Service
 * 
 * Provides analysis, repair, and decimation operations for 3D mesh geometries.
 * Designed for production use with proper error handling and progress reporting.
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { simplifyGeometry } from '@/lib/fastQuadricSimplify';
// @ts-ignore - taubin-smooth doesn't have types
import taubinSmooth from 'taubin-smooth';

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
  method?: 'taubin' | 'hc' | 'combined';
  error?: string;
}

export interface SmoothingOptions {
  /** Number of iterations */
  iterations: number;
  /** Smoothing method - note: taubin-smooth library only supports Taubin method */
  method: 'taubin' | 'hc' | 'combined';
  /** Pass band frequency (0-1, lower = smoother, default 0.1) */
  passBand?: number;
  /** Taubin lambda (shrink factor, 0-1) - legacy, use passBand instead */
  lambda?: number;
  /** Taubin mu (inflate factor, negative) - legacy, use passBand instead */
  mu?: number;
  /** HC alpha (original position weight, 0-1) - legacy, use passBand instead */
  alpha?: number;
  /** HC beta (difference damping, 0-1) - legacy, use passBand instead */
  beta?: number;
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
export const DECIMATION_THRESHOLD = 500_000;

/** Target triangle count after decimation */
export const DECIMATION_TARGET = 500_000;

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
// Decimation
// ============================================================================

/**
 * Decimates a mesh using vertex clustering to reduce triangle count
 */
/**
 * Mesh decimation using Fast Quadric Mesh Simplification (WASM).
 * 
 * Uses the WASM build of Fast-Quadric-Mesh-Simplification which implements
 * the Garland & Heckbert QEM algorithm. This produces high-quality results
 * without self-intersections or sawtooth patterns.
 * 
 * @see https://github.com/MyMiniFactory/Fast-Quadric-Mesh-Simplification
 */
export async function decimateMesh(
  geometry: THREE.BufferGeometry,
  targetTriangles: number = DECIMATION_TARGET,
  onProgress?: ProgressCallback
): Promise<DecimationResult> {
  try {
    reportProgress(onProgress, 'decimating', 0, 'Starting mesh simplification...');
    
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
    
    // Calculate target ratio
    const ratio = Math.max(0.01, Math.min(0.99, targetTriangles / originalTriangles));
    
    reportProgress(onProgress, 'decimating', 10, 'Running Fast Quadric simplification...');
    
    // Use Fast Quadric Mesh Simplification WASM
    const result = await simplifyGeometry(geometry, {
      ratio,
      onProgress: (stage, percent, message) => {
        // Map internal progress to our 10-100 range
        const mappedPercent = 10 + (percent * 0.9);
        reportProgress(onProgress, 'decimating', mappedPercent, message);
      }
    });
    
    if (!result.success || !result.geometry) {
      throw new Error(result.error || 'Simplification failed');
    }
    
    // Compute vertex normals for the result
    result.geometry.computeVertexNormals();
    
    reportProgress(onProgress, 'decimating', 100, 'Decimation complete');
    
    return {
      success: true,
      geometry: result.geometry,
      originalTriangles: result.originalTriangles,
      finalTriangles: result.finalTriangles,
      reductionPercent: result.reductionPercent,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown decimation error';
    console.error('Decimation error:', error);
    return {
      success: false,
      geometry: null,
      originalTriangles: 0,
      finalTriangles: 0,
      reductionPercent: 0,
      error: errorMessage,
    };
  }
}

// ============================================================================
// Mesh Smoothing using taubin-smooth library
// ============================================================================

/**
 * Performs mesh smoothing using the taubin-smooth library.
 * 
 * This uses Mikola Lysenko's implementation of Taubin's mesh smoothing algorithm
 * which is fast, well-tested, and produces high-quality results.
 * 
 * @param geometry - The input BufferGeometry
 * @param options - Smoothing options or number of iterations (for backward compat)
 * @param lambdaOrProgress - Progress callback (backward compat)
 * @param onProgress - Optional progress callback
 * @returns SmoothingResult with the smoothed geometry
 * 
 * @see https://github.com/mikolalysenko/taubin-smooth
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
      method: 'taubin',
    };
    progressCb = typeof lambdaOrProgress === 'function' ? lambdaOrProgress : onProgress;
  } else {
    opts = options;
    progressCb = typeof lambdaOrProgress === 'function' ? lambdaOrProgress : onProgress;
  }
  
  const {
    iterations = 5,
    passBand = 0.1, // taubin-smooth's passBand parameter (0-1, lower = more smoothing)
  } = opts;
  
  try {
    reportProgress(progressCb, 'smoothing', 0, 'Starting Taubin smoothing...');
    
    // Clone geometry to avoid modifying the original
    let workGeometry = geometry.clone();
    
    // Convert to indexed geometry if not already
    if (!workGeometry.index) {
      workGeometry = mergeVertices(workGeometry);
    }
    
    // If still no index, create one manually
    if (!workGeometry.index) {
      const posAttr = workGeometry.getAttribute('position');
      const vertexCount = posAttr.count;
      
      const vertexMap = new Map<string, number>();
      const uniquePositions: number[] = [];
      const indexMap: number[] = [];
      
      for (let i = 0; i < vertexCount; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const z = posAttr.getZ(i);
        const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
        
        if (vertexMap.has(key)) {
          indexMap.push(vertexMap.get(key)!);
        } else {
          const newIndex = uniquePositions.length / 3;
          uniquePositions.push(x, y, z);
          vertexMap.set(key, newIndex);
          indexMap.push(newIndex);
        }
      }
      
      const indexedGeometry = new THREE.BufferGeometry();
      indexedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(uniquePositions, 3));
      indexedGeometry.setIndex(indexMap);
      workGeometry.dispose();
      workGeometry = indexedGeometry;
    }
    
    reportProgress(progressCb, 'smoothing', 10, 'Converting to taubin-smooth format...');
    
    const posAttr = workGeometry.getAttribute('position') as THREE.BufferAttribute;
    const indexAttr = workGeometry.index!;
    const vertexCount = posAttr.count;
    const triangleCount = indexAttr.count / 3;
    
    // Convert to taubin-smooth format
    // positions: [[x,y,z], [x,y,z], ...]
    // cells: [[i0,i1,i2], [i0,i1,i2], ...]
    const positions: [number, number, number][] = [];
    for (let i = 0; i < vertexCount; i++) {
      positions.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
    }
    
    const cells: [number, number, number][] = [];
    for (let i = 0; i < triangleCount; i++) {
      cells.push([
        indexAttr.getX(i * 3),
        indexAttr.getX(i * 3 + 1),
        indexAttr.getX(i * 3 + 2)
      ]);
    }
    
    reportProgress(progressCb, 'smoothing', 20, `Running ${iterations} Taubin iterations...`);
    
    // Run taubin-smooth
    // The library modifies positions in-place and returns them
    const smoothedPositions = taubinSmooth(cells, positions, {
      iters: iterations,
      passBand: passBand,
    });
    
    reportProgress(progressCb, 'smoothing', 80, 'Creating smoothed geometry...');
    
    // Convert back to THREE.js geometry
    const newPositions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      newPositions[i * 3] = smoothedPositions[i][0];
      newPositions[i * 3 + 1] = smoothedPositions[i][1];
      newPositions[i * 3 + 2] = smoothedPositions[i][2];
    }
    
    // Update positions in geometry
    posAttr.array.set(newPositions);
    posAttr.needsUpdate = true;
    
    // Recompute normals
    workGeometry.computeVertexNormals();
    
    // Convert back to non-indexed for compatibility
    const finalGeometry = workGeometry.toNonIndexed();
    workGeometry.dispose();
    
    reportProgress(progressCb, 'smoothing', 100, 'Smoothing complete');
    
    return {
      success: true,
      geometry: finalGeometry,
      iterations,
      method: 'taubin',
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
