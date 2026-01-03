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

// Utils - Metrics
export { 
  computeSupportMetrics,
  getSupportFootprintBounds,
  getSupportFootprintPoints,
  type FootprintBounds 
} from './utils/metrics';

// Utils - Auto Placement
export { autoPlaceSupports, type AutoPlacementStrategy } from './utils/autoPlacement';
export { placeOverhangSupports } from './utils/overhangAnalysis';

// Utils - Baseplate Coverage (for multi-section baseplate support filtering)
export {
  filterSupportsByBaseplateCoverage,
  findBestCoveringSectionForSupport,
  getSupportBoundingBox,
  getSupportBaseArea,
  MIN_BASEPLATE_COVERAGE_RATIO,
  type FilteredSupportsResult,
} from './utils/baseplateCoverage';

// Utils - Polygon
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

// Utils - Geometry
export {
  FILLET_RADIUS,
  FILLET_SEGMENTS,
  createCylindricalFilletGeometry,
  createConicalFilletGeometry,
  createRectangularFilletGeometry,
  createPolygonFilletGeometry,
  createBottomCapGeometry,
  createTopCapGeometry,
  createPolygonBottomCapGeometry,
  getConicalFilletHeight,
  removeBottomCapFaces,
  normalizeGeometryForMerge,
} from './utils/geometryUtils';
