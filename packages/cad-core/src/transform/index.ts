// Types
export type {
  PositionConstraints,
  RotationConstraints,
  ScaleConstraints,
  TransformConstraints,
  TransformConfig,
  TransformDelta,
  TransformOutput,
  TransformCallbacks,
  PivotMode,
  ActivationMode,
  DeactivationMode,
  TransformComponentType,
} from './types';

// Controller
export { TransformController } from './TransformController';

// Presets
export {
  SUPPORT_TRANSFORM_CONFIG,
  CLAMP_TRANSFORM_CONFIG,
  HOLE_TRANSFORM_CONFIG,
  LABEL_TRANSFORM_CONFIG,
  BASEPLATE_TRANSFORM_CONFIG,
  PART_TRANSFORM_CONFIG,
  getPresetConfig,
} from './presets';

// Utilities
export {
  calculateGizmoScale,
  calculateGizmoPosition,
  setOrbitControlsEnabled,
  dispatchTransformUpdate,
  resetPivotMatrix,
} from './utils';

// Note: React hooks (useTransformControl, etc.) are not part of cad-core.
// They live in the app at src/core/transform/hooks/ and will be moved to cad-ui later.
