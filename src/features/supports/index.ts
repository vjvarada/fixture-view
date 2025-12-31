/**
 * Supports Feature Module
 * 
 * Handles support placement, geometry, and transforms for fixture design.
 * 
 * Supports can be:
 * - Cylindrical (round supports)
 * - Rectangular (block supports)
 * - Conical (tapered supports)
 * - Custom (polygon-based supports)
 * 
 * @example
 * `typescript
 * import { SupportMesh, SupportPlacement, AnySupport } from '@/features/supports';
 * `
 */

// Types
export * from './types';

// Components
export { default as SupportMesh, buildFullSupportGeometry } from './components/SupportMeshes';
export { default as SupportPlacement } from './components/SupportPlacement';
export { default as SupportTransformControls } from './components/SupportTransformControls';
export { default as SupportsAccordion } from './components/SupportsAccordion';
export { default as SupportsPanel } from './components/SupportsPanel';
export { default as SupportEditOverlay } from './components/SupportEditOverlay';

// Utils
export { 
  computeSupportMetrics,
  getSupportFootprintBounds,
  getSupportFootprintPoints,
  type FootprintBounds 
} from './utils/metrics';
export { autoPlaceSupports, type AutoPlacementStrategy } from './utils/autoPlacement';
export { placeOverhangSupports } from './utils/overhangAnalysis';
export {
  polygonSignedArea2D,
  isPolygonClockwiseXZ,
  computePolygonWindingCW,
  ensureClockwiseWindingXZ,
  preparePolygonForGeometry,
  computeEdgeNormal,
  isPolygonSimple,
  simplifyPolygonVertices,
  validateAndPreparePolygon,
} from './utils/polygonUtils';
