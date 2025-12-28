/**
 * State hooks for 3DScene decomposition
 * Export all state management hooks from a single entry point
 */

export { useSupportState } from './useSupportState';
export type { SupportPlacingState, UseSupportStateReturn } from './useSupportState';

export { useClampState } from './useClampState';
export type { 
  ClampPlacementModeState, 
  ClampDebugPointsState, 
  ClampSupportInfo, 
  LoadedClampData,
  UseClampStateReturn 
} from './useClampState';

export { useLabelState } from './useLabelState';
export type { UseLabelStateReturn } from './useLabelState';

export { useHoleState } from './useHoleState';
export type { HolePlacementModeState, UseHoleStateReturn } from './useHoleState';

export { useBaseplateState } from './useBaseplateState';
export type { UseBaseplateStateReturn } from './useBaseplateState';

export { useSceneState } from './useSceneState';
export type { 
  ViewOrientation, 
  ModelTransformState, 
  LiveTransformState, 
  UseSceneStateReturn 
} from './useSceneState';
