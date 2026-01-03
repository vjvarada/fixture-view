/**
 * App Stores
 * 
 * Re-exports all stores for the fixture design application.
 * 
 * Architecture:
 * - Generic stores from @rapidtool/cad-ui (selection, workflow, transform, ui, history)
 * - App-specific stores from this folder (fixture, cavity, placement, processing, dialog)
 * 
 * @example
 * import { useSelectionStore, useFixtureStore } from '@/stores';
 * 
 * // Generic selection
 * const selected = useSelectionStore(state => state.selected);
 * 
 * // App-specific fixture data
 * const parts = useFixtureStore(state => state.parts);
 */

// Re-export generic stores from cad-ui
export {
  // Selection
  useSelectionStore,
  selectSelected,
  selectTransformTarget,
  selectMultiSelected,
  selectIsMultiSelectMode,
  type SelectionState,
  type SelectionActions,
  type SelectionStore,
  
  // Workflow
  useWorkflowStore,
  selectActiveStep,
  selectCompletedSteps,
  selectSkippedSteps,
  selectActiveAccordion,
  selectSteps,
  type WorkflowConfig,
  type WorkflowState,
  type WorkflowActions,
  type WorkflowStore,
  
  // Transform
  useTransformStore,
  selectMode,
  selectSpace,
  selectIsPivotMode,
  selectSnap,
  selectIsDragging,
  type TransformState,
  type TransformActions,
  type TransformStore,
  
  // UI
  useUIStore,
  selectTheme,
  selectPanels,
  selectViewport,
  selectDebug,
  type UIState,
  type UIActions,
  type UIStore,
  
  // History
  useHistoryStore,
  selectCanUndo,
  selectCanRedo,
  selectUndoStack,
  selectRedoStack,
  type HistoryState,
  type HistoryActions,
  type HistoryStore,
  
  // Types
  type TransformMode,
  type CoordinateSpace,
  type ThemeMode,
  type SelectionItem,
  type WorkflowStep,
  type HistorySnapshot,
} from '@rapidtool/cad-ui';

// App-specific types
export * from './types';

// Fixture store
export {
  useFixtureStore,
  selectParts,
  selectSupports,
  selectClamps,
  selectLabels,
  selectHoles,
  selectBaseplate,
  selectBaseplateVisible,
  type FixtureState,
  type FixtureActions,
  type FixtureStore,
} from './fixtureStore';

// Cavity store
export {
  useCavityStore,
  selectCavitySettings,
  selectCavityIsProcessing,
  selectCavityHasPreview,
  selectCavityIsApplied,
  type CavityState,
  type CavityActions,
  type CavityStore,
} from './cavityStore';

// Placement store
export {
  usePlacementStore,
  selectSupportPlacement,
  selectHolePlacement,
  selectBaseplatePlacement,
  selectIsAnyPlacementActive,
  type PlacementState,
  type PlacementActions,
  type PlacementStore,
} from './placementStore';

// Processing store
export {
  useProcessingStore,
  selectIsProcessing,
  selectFileError,
  selectMeshAnalysis,
  selectMeshProgress,
  selectIsExporting,
  type MeshAnalysisResult,
  type MeshProcessingProgress,
  type ProcessingResult,
  type ProcessingState,
  type ProcessingActions,
  type ProcessingStore,
} from './processingStore';

// Dialog store
export {
  useDialogStore,
  selectUnitsDialogOpen,
  selectOptimizationDialogOpen,
  selectExportDialogOpen,
  selectConfirmDialogOpen,
  type DialogState,
  type DialogActions,
  type DialogStore,
} from './dialogStore';
