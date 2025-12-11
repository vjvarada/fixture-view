// ============================================
// Offset Mesh Processor Types
// ============================================

import * as THREE from 'three';

export interface OffsetMeshOptions {
  /** Offset distance in world units */
  offsetDistance: number;
  /** Resolution (pixels per unit) */
  pixelsPerUnit: number;
  /** Tile size for large heightmaps (default: 2048) */
  tileSize?: number;
  /** Rotation around Y axis in degrees (XZ plane) */
  rotationXZ?: number;
  /** Rotation around X axis in degrees (YZ plane, inverted: 180-input) */
  rotationYZ?: number;
  /** Fill holes in input mesh before heightmap generation */
  fillHoles?: boolean;
  /** Progress callback (current, total, stage) */
  progressCallback?: ((current: number, total: number, stage: string) => void) | null;
}

export interface OffsetMeshMetadata {
  offsetDistance: number;
  pixelsPerUnit: number;
  resolution: number;
  vertexCount: number;
  triangleCount: number;
  processingTime: number;
  originalTriangleCount: number;
  geometryCreationTime: number;
  holesFilled: number;
  holesCapTriangles: number;
  /** Number of internal holes filled in heightmap */
  internalHolesFilled?: number;
  /** Number of pixels filled for internal holes */
  internalHolesPixels?: number;
}

export interface HeightmapResult {
  heightMap: Float32Array;
  scale: number;
  center: THREE.Vector3;
  usesIndexedDB?: boolean;
  tileKeys?: string[];
  tileResolution?: number;
  tilesPerSide?: number;
}

export interface OffsetMeshResult {
  heightmapResult: HeightmapResult | null;
  geometry: THREE.BufferGeometry | null;
  metadata: OffsetMeshMetadata;
}

export interface CavitySettings {
  /** Enable cavity creation */
  enabled: boolean;
  /** Offset distance for the cavity (clearance from part) in mm */
  offsetDistance: number;
  /** Resolution - pixels per unit for heightmap generation */
  pixelsPerUnit: number;
  /** Rotation around Y axis in degrees (XZ plane) - derived from part */
  rotationXZ: number;
  /** Rotation around X axis in degrees (YZ plane) - derived from part */
  rotationYZ: number;
  /** Fill holes in input mesh before heightmap generation */
  fillHoles: boolean;
  /** Show cavity preview mesh */
  showPreview: boolean;
  /** Preview mesh opacity (0-1) */
  previewOpacity: number;
  /** Enable mesh decimation to reduce triangle count */
  enableDecimation: boolean;
  /** Enable Taubin smoothing to remove jagged edges */
  enableSmoothing: boolean;
  /** Number of smoothing iterations (for non-combined methods) */
  smoothingIterations: number;
  /** Smoothing method: 'taubin', 'hc', 'combined', or 'gaussian' */
  smoothingMethod: 'taubin' | 'hc' | 'combined' | 'gaussian';
  /** HC smoothing alpha parameter (0-1, higher = more original shape preservation) */
  smoothingAlpha: number;
  /** HC smoothing beta parameter (0-1, higher = more smoothing) */
  smoothingBeta: number;
  /** Combined method: Gaussian pass iterations */
  combinedGaussianIterations: number;
  /** Combined method: Laplacian pass iterations */
  combinedLaplacianIterations: number;
  /** Combined method: Taubin pass iterations */
  combinedTaubinIterations: number;
}

/**
 * Calculate adaptive pixels per unit based on part diagonal size.
 * Larger parts (600mm+) use 2 px/mm for performance.
 * Smaller parts (100mm-) use 6 px/mm for detail.
 * Parts in between use discrete integers 2-6.
 * 
 * @param diagonal - Part diagonal in mm
 * @returns pixelsPerUnit value (2-6)
 */
export function getAdaptivePixelsPerUnit(diagonal: number): number {
  // Define the range: 100mm -> 6px/mm, 600mm -> 2px/mm
  const minDiagonal = 100;
  const maxDiagonal = 600;
  const maxPPU = 6;
  const minPPU = 2;
  
  if (diagonal <= minDiagonal) {
    return maxPPU; // 6 px/mm for small parts
  }
  
  if (diagonal >= maxDiagonal) {
    return minPPU; // 2 px/mm for large parts
  }
  
  // Linear interpolation between the ranges, then round to integer
  const t = (diagonal - minDiagonal) / (maxDiagonal - minDiagonal);
  const ppu = maxPPU - t * (maxPPU - minPPU);
  
  // Round to nearest integer (2, 3, 4, 5, or 6)
  return Math.round(ppu);
}

export const DEFAULT_CAVITY_SETTINGS: CavitySettings = {
  enabled: true,
  offsetDistance: 0.5,
  pixelsPerUnit: 6, // Default, will be overridden by adaptive calculation
  rotationXZ: 0,
  rotationYZ: 0,
  fillHoles: true,
  showPreview: true,
  previewOpacity: 0.3,
  enableDecimation: true, // Uses Fast Quadric with Manifold3D fallback
  enableSmoothing: true,
  smoothingIterations: 5,
  smoothingMethod: 'combined',
  smoothingAlpha: 0.5,
  smoothingBeta: 0.5,
  combinedGaussianIterations: 6,
  combinedLaplacianIterations: 2,
  combinedTaubinIterations: 2,
};
