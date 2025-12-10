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
  /** Number of smoothing iterations */
  smoothingIterations: number;
  /** Smoothing method: 'taubin', 'hc', or 'combined' */
  smoothingMethod: 'taubin' | 'hc' | 'combined';
  /** Taubin pass band frequency (0-1, lower = smoother) */
  smoothingPassBand: number;
  /** HC smoothing alpha parameter (0-1, higher = more original shape preservation) - legacy */
  smoothingAlpha: number;
  /** HC smoothing beta parameter (0-1, higher = more smoothing) - legacy */
  smoothingBeta: number;
}

export const DEFAULT_CAVITY_SETTINGS: CavitySettings = {
  enabled: true,
  offsetDistance: 0.5,
  pixelsPerUnit: 6,
  rotationXZ: 0,
  rotationYZ: 0,
  fillHoles: true,
  showPreview: true,
  previewOpacity: 0.3,
  enableDecimation: true,
  enableSmoothing: true,
  smoothingIterations: 10,
  smoothingMethod: 'taubin',
  smoothingPassBand: 0.1,
  smoothingAlpha: 0.5,
  smoothingBeta: 0.5,
};
