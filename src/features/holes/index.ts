/**
 * Holes Feature Module
 *
 * Components and utilities for mounting hole placement and visualization.
 *
 * @example
 * ```typescript
 * import { HoleMesh, HolePlacement, MountingHolesAccordion, PlacedHole } from '@/features/holes';
 * ```
 */

// Types
export type {
  HoleType,
  HoleConfig,
  PlacedHole,
  HolePlacementState,
  HoleCSGStatus,
  SerializedHoleGeometry,
} from './types';

// Constants
export { COUNTERSINK_STANDARDS, COUNTERBORE_STANDARDS } from './types';

// Components
export { default as HoleMesh } from './components/HoleMesh';
export { default as HolePlacement } from './components/HolePlacement';
export { default as HoleTransformControls } from './components/HoleTransformControls';
export { default as MountingHolesAccordion } from './components/MountingHolesAccordion';

// Geometry utilities
export {
  createThroughHoleGeometry,
  createCountersinkGeometry,
  createCounterboreGeometry,
  createHoleGeometry,
  positionHoleGeometry,
  createMergedHolesGeometry,
  serializeGeometry,
  deserializeGeometry,
} from './utils/holeGeometry';
