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

export { usePartManagement } from './usePartManagement';
export type { UsePartManagementProps, UsePartManagementReturn } from './usePartManagement';

export { useCameraControls } from './useCameraControls';
export type { ViewOrientation as CameraViewOrientation, UseCameraControlsProps, UseCameraControlsReturn } from './useCameraControls';

export { useModelTransform } from './useModelTransform';
export type { LiveTransformData, UseModelTransformProps, UseModelTransformReturn } from './useModelTransform';

export { useBaseplateHandlers } from './useBaseplateHandlers';
export type { UseBaseplateHandlersProps, UseBaseplateHandlersReturn } from './useBaseplateHandlers';

export { useBaseplateEffects } from './useBaseplateEffects';
export type { UseBaseplateEffectsParams, UseBaseplateEffectsReturn } from './useBaseplateEffects';

export { useMultiSectionSelection } from './useMultiSectionSelection';
export type { UseMultiSectionSelectionParams, UseMultiSectionSelectionReturn } from './useMultiSectionSelection';

export { useSupportHandlers } from './useSupportHandlers';
export type { UseSupportHandlersParams } from './useSupportHandlers';

export { useHoleHandlers } from './useHoleHandlers';
export type { UseHoleHandlersParams } from './useHoleHandlers';

export { useClampHandlers } from './useClampHandlers';
export type { UseClampHandlersParams } from './useClampHandlers';

export { useLabelHandlers } from './useLabelHandlers';
export type { UseLabelHandlersParams } from './useLabelHandlers';

export { useClampPlacement } from './useClampPlacement';
export type { UseClampPlacementParams, UseClampPlacementReturn } from './useClampPlacement';

export { useCavityOperations } from './useCavityOperations';
export type { UseCavityOperationsParams, UseCavityOperationsReturn } from './useCavityOperations';

export { useOffsetMeshPreview } from './useOffsetMeshPreview';
export type { UseOffsetMeshPreviewParams, UseOffsetMeshPreviewReturn } from './useOffsetMeshPreview';

export { useSupportTrimPreview } from './useSupportTrimPreview';
export type { UseSupportTrimPreviewParams, UseSupportTrimPreviewReturn } from './useSupportTrimPreview';

export { useBaseplateOperations } from './useBaseplateOperations';
export type { UseBaseplateOperationsProps, UseBaseplateOperationsReturn } from './useBaseplateOperations';

export { useHoleCSG } from './useHoleCSG';
export type { UseHoleCSGProps, UseHoleCSGReturn } from './useHoleCSG';

export { useSceneReset } from './useSceneReset';
export type { UseSceneResetParams } from './useSceneReset';
