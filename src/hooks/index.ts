/**
 * Fixture App Hooks
 * 
 * Re-exports all custom hooks for the fixture design app.
 * These hooks provide backward-compatible interfaces for migrating
 * from useState to Zustand stores.
 */

// Selection hooks (Phase 7a)
export {
  useSelectedPart,
  useSelectedSupport,
  useSelectedClamp,
  useSelectedLabel,
  useSelectedHole,
  useSelectedBaseplateSection,
  useSelectedId,
  useSelectionType,
  useClearSelection,
  useSelection,
  SELECTION_CATEGORIES,
} from './useSelection';

// Workflow hooks (Phase 7c)
export {
  useInitializeFixtureWorkflow,
  useWorkflowStep,
  useCompletedSteps,
  useSkippedSteps,
  useWorkflowNavigation,
  useWorkflow,
  FIXTURE_WORKFLOW_STEPS,
  type FixtureWorkflowStep,
} from './useWorkflow';

// UI hooks (Phase 7h)
export {
  useContextPanelCollapsed,
  usePropertiesPanelCollapsed,
  useViewportOptions,
  useUI,
} from './useUI';

// Dialog hooks (Phase 7f)
export {
  useUnitsDialog,
  useOptimizationDialog,
  useExportDialog,
  useBaseplateConfigDialog,
  useConfirmDialog,
  useDialogs,
} from './useDialogs';

// Placement hooks (Phase 7d)
export {
  useSupportPlacementMode,
  useSelectedSupportType,
  useHolePlacementMode,
  usePendingHoleConfig,
  useBaseplateDrawingMode,
  useDrawnBaseplateSections,
  useBaseplateParams,
  useIsAnyPlacementActive,
  usePlacement,
} from './usePlacement';

// Processing hooks (Phase 7e)
export {
  useIsProcessing,
  useFileError,
  useIsMeshProcessing,
  useMeshAnalysis,
  useMeshProgress,
  usePendingFile,
  useProcessingResult,
  useIsExporting,
  useClearProcessing,
  useProcessing,
} from './useProcessing';

// Cavity hooks (Phase 7g)
export {
  useCavityClearance,
  useCavitySettings,
  useIsCavityProcessing,
  useIsApplyingCavity,
  useHasCavityPreview,
  useIsCavityApplied,
  useResetCavity,
  useCavity,
} from './useCavity';

// Fixture data hooks (Phase 7b)
export {
  useImportedParts,
  usePartVisibility,
  useModelColors,
  useBaseplateVisible,
  useSupports,
  useLabels,
  useClamps,
  useMountingHoles,
  useCurrentBaseplate,
  useResetFixture,
  useFixtureSnapshot,
  useFixture,
} from './useFixture';

// History hooks
export {
  useUndoStack,
  useRedoStack,
  useUndoRedo,
  useHistory,
} from './useHistory';

// Existing hooks
export { useDragDrop } from './useDragDrop';
export { useLoadingManager } from './useLoadingManager';
export { useMobile } from './use-mobile';
export { useToast } from './use-toast';
