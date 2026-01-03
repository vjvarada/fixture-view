/**
 * Clamps Feature Module
 * 
 * Handles clamp placement, transforms, and CSG operations for fixture design.
 * Supports toggle clamps and other clamping mechanisms.
 * 
 * @example
 * `typescript
 * import { ClampMesh, ClampTransformControls, PlacedClamp } from '@/features/clamps';
 * `
 */

// Types
export * from './types';

// Components
export { default as ClampsStepContent } from './components/ClampsStepContent';
export { default as ClampsAccordion } from './components/ClampsAccordion';
export { default as ClampMesh, usePlacedClamps } from './components/ClampMesh';
export { default as ClampTransformControls } from './components/ClampTransformControls';
export { default as ClampSupportMesh } from './components/ClampSupportMesh';
export { default as ClampWithSupport } from './components/ClampWithSupport';

// Utils
export * from './utils/clampData';
export * from './utils/clampLoader';
export * from './utils/clampSupportUtils';
export * from './utils/clampPlacement';
