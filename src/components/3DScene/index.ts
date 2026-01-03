/**
 * 3DScene component module
 * Exports all types, hooks, utilities, and renderers for the 3D scene
 */

// Types
export * from './types';

// Hooks
export * from './hooks';

// Utilities
export { calculateGridConfig, computeDominantUpQuaternion, getActualMinYFromMesh, getFootprintMetrics, ORIENTATION_CONFIG, getProjectedSizeForOrientation } from './utils/geometryUtils';
export { MODEL_COLOR_PALETTE, getModelColor, getNextAvailableColor, hexToRgb } from './utils/colorUtils';
export { buildClampSupportGeometryAtOrigin, buildLabelGeometry } from './utils/csgUtils';

// Renderers
export * from './renderers';

// Container and Context
export {
  useScene3DState,
  Scene3DContext,
  useScene3DContext,
  Scene3DProvider,
} from './Scene3DContainer';
export type { Scene3DState } from './Scene3DContainer';
