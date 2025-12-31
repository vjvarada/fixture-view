/**
 * Export Feature Types
 * 
 * Type definitions for the STL/geometry export functionality.
 */

import * as THREE from 'three';
import type { BasePlateConfig } from '@/features/baseplate';
import type { LabelConfig } from '@/features/labels';
import type { PlacedClamp } from '@/features/clamps';

/**
 * Export quality preset
 * - 'fast': Skip CSG union, minimal processing (best for low-end devices)
 * - 'balanced': CSG union with geometry decimation (good for tablets)
 * - 'high': Full CSG union, no decimation (best quality, needs powerful hardware)
 */
export type ExportQuality = 'fast' | 'balanced' | 'high';

/**
 * Export progress stages
 */
export type ExportStage = 
  | 'preparing'
  | 'decimating'
  | 'manifold'
  | 'exporting'
  | 'complete'
  | 'error';

/**
 * Progress callback for export operations
 */
export interface ExportProgress {
  stage: ExportStage;
  progress: number;
  message: string;
}

/**
 * Progress callback function type
 */
export type ExportProgressCallback = (progress: ExportProgress) => void;

/**
 * Clamp data required for export
 */
export interface ClampExportData {
  id: string;
  supportInfo: {
    polygon: THREE.Vector2[];
    mountSurfaceLocalY: number;
    fixturePointY: number;
  } | null;
  fixtureCutoutsGeometry: THREE.BufferGeometry | null;
  fixturePointTopCenter: THREE.Vector3 | null;
}

/**
 * Collection of geometries for export
 */
export interface ExportGeometryCollection {
  /** Baseplate geometry (with holes if applicable) */
  baseplateGeometry: THREE.BufferGeometry | null;
  /** Support geometries (modified after cavity cut) */
  supportGeometries: THREE.BufferGeometry[];
  /** Clamp support geometries */
  clampSupportGeometries: THREE.BufferGeometry[];
  /** Label geometries */
  labelGeometries: THREE.BufferGeometry[];
  /** Whether baseplate is multi-section */
  isMultiSection: boolean;
  /** Per-section geometries for multi-section baseplates (indexed by section ID) */
  sectionGeometries: Map<string, SectionExportData>;
}

/**
 * Data for a single section in multi-section export
 */
export interface SectionExportData {
  /** Section ID */
  id: string;
  /** Section index (0-based) */
  index: number;
  /** Section baseplate geometry */
  baseplateGeometry: THREE.BufferGeometry;
  /** Support geometries belonging to this section */
  supportGeometries: THREE.BufferGeometry[];
  /** Label geometries belonging to this section */
  labelGeometries: THREE.BufferGeometry[];
  /** Section bounds for filtering */
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Context required for geometry collection
 */
export interface GeometryCollectionContext {
  /** Current baseplate configuration */
  basePlate: BasePlateConfig | null;
  /** Baseplate with holes geometry (if holes exist) */
  baseplateWithHoles: THREE.BufferGeometry | null;
  /** Reference to baseplate mesh */
  basePlateMeshRef: React.RefObject<THREE.Mesh | null>;
  /** Reference to multi-section baseplate group */
  multiSectionBasePlateGroupRef: React.RefObject<THREE.Group | null>;
  /** Cached original baseplate geometry */
  originalBaseplateGeoRef: React.MutableRefObject<THREE.BufferGeometry | null>;
  /** Modified support geometries map (key is support ID) */
  modifiedSupportGeometries: Map<string, THREE.BufferGeometry>;
  /** Supports array for looking up sectionId */
  supports: Array<{ id: string; sectionId?: string }>;
  /** Placed clamps array */
  placedClamps: PlacedClamp[];
  /** Clamp support info map */
  clampSupportInfos: Map<string, { height: number }>;
  /** Loaded clamp data map */
  loadedClampDataRef: React.MutableRefObject<Map<string, ClampExportData>>;
  /** Current labels */
  labels: LabelConfig[];
  /** Top Y position of baseplate */
  baseTopY: number;
}

/**
 * Result of the export operation
 */
export interface ExportResult {
  success: boolean;
  error?: string;
  filename?: string;
  filesExported?: number;
}

/**
 * Export service configuration
 */
export interface ExportServiceConfig {
  /** Export quality preset */
  quality: ExportQuality;
  /** Whether to perform CSG union on overlapping geometries */
  performCSGUnion: boolean;
  /**
   * Whether to use the pre-computed union from cavity step (fallbackGeometry).
   * When true and fallbackGeometry is provided, export will skip redundant CSG 
   * operations and use the already-unioned geometry directly.
   * This significantly speeds up export since cavity step already performs CSG union.
   */
  useCachedUnion: boolean;
  /**
   * Whether to repair the mesh to ensure manifold output before export.
   * Uses Manifold3D to convert the geometry to a proper manifold mesh,
   * fixing non-manifold edges from overlapping supports, fillet intersections, etc.
   * Recommended for 3D printing exports.
   */
  repairManifold: boolean;
  /** Vertex merge tolerance for welding */
  vertexMergeTolerance: number;
  /** Target triangle count for decimation (0 = no decimation) */
  targetTriangleCount: number;
  /** Maximum triangles per CSG batch (lower = less memory, slower) */
  csgBatchSize: number;
  /** Use chunked processing with idle callbacks (better for UI responsiveness) */
  useChunkedProcessing: boolean;
  /** Chunk size for processing (triangles per chunk) */
  chunkSize: number;
}

/**
 * Get export config for a quality preset
 */
export function getExportConfigForQuality(quality: ExportQuality): ExportServiceConfig {
  switch (quality) {
    case 'fast':
      return {
        quality: 'fast',
        performCSGUnion: false, // Skip CSG for speed
        useCachedUnion: true, // Use cavity step's pre-computed union
        repairManifold: false, // Skip manifold repair for speed
        vertexMergeTolerance: 0.01, // Looser tolerance for faster welding
        targetTriangleCount: 50000, // Aggressive decimation
        csgBatchSize: 5,
        useChunkedProcessing: true,
        chunkSize: 5000,
      };
    case 'balanced':
      return {
        quality: 'balanced',
        performCSGUnion: true,
        useCachedUnion: true, // Use cavity step's pre-computed union
        repairManifold: true, // Repair manifold for 3D printing quality
        vertexMergeTolerance: 0.005,
        targetTriangleCount: 100000, // Moderate decimation
        csgBatchSize: 10,
        useChunkedProcessing: true,
        chunkSize: 10000,
      };
    case 'high':
    default:
      return {
        quality: 'high',
        performCSGUnion: true,
        useCachedUnion: true, // Use cavity step's pre-computed union (skip redundant CSG)
        repairManifold: true, // Ensure manifold output for 3D printing
        vertexMergeTolerance: 0.001, // Tight tolerance
        targetTriangleCount: 0, // No decimation
        csgBatchSize: 20,
        useChunkedProcessing: false,
        chunkSize: 50000,
      };
  }
}

/**
 * Default export service configuration
 */
export const DEFAULT_EXPORT_CONFIG: ExportServiceConfig = getExportConfigForQuality('high');
