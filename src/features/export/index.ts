/**
 * Export Feature Module
 * 
 * Handles STL/geometry export functionality for fixture designs.
 * 
 * Features:
 * - CSG union of overlapping geometries (baseplate + supports)
 * - Proper manifold mesh generation
 * - Multi-section baseplate export
 * - Label geometry embedding
 * - **Performance optimization for low-end devices**
 *   - Geometry decimation
 *   - Chunked processing
 *   - Quality presets (fast/balanced/high)
 * 
 * @example
 * ```typescript
 * import { useExport, getExportConfigForQuality } from '@/features/export';
 * 
 * // In your component - use quality preset for low-end devices
 * useExport({
 *   mergedFixtureMesh,
 *   basePlate,
 *   // ... other params
 *   exportQuality: 'fast', // 'fast' | 'balanced' | 'high'
 * });
 * ```
 */

// Types
export * from './types';

// Services
export { exportFixture } from './services/exportService';

// Utilities
export {
  createBaseplateGeometryFromConfig,
  collectBaseplateGeometry,
  collectSupportGeometries,
  buildClampSupportWithCutouts,
  prepareGeometryForCSG,
  buildLabelGeometries,
  collectAllGeometries,
} from './utils/geometryCollector';

// Optimization utilities
export {
  yieldToMain,
  processInChunks,
  getTriangleCount,
  getTotalTriangleCount,
  decimateGeometry,
  optimizeGeometriesForExport,
  estimateExportTime,
  disposeGeometries,
} from './utils/geometryOptimizer';

// Hooks
export { useExport, default as useExportHook } from './hooks/useExport';
export type { UseExportParams } from './hooks/useExport';
