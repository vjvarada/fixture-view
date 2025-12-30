# State Migration Strategy - Phase 7

## Overview

AppShell.tsx currently has 47 useState calls and 80+ event dispatches. This document tracks the incremental migration to Zustand stores.

## Migration Phases

### Phase 7a: Selection State (Low Risk)
**Goal**: Replace selection-related useState with `useSelectionStore`

Current useState calls to replace:
- `selectedPartId` → `selectionStore.select('part', id)`
- `selectedSupportId` → `selectionStore.select('support', id)`
- `selectedClampId` → `selectionStore.select('clamp', id)`
- `selectedLabelId` → `selectionStore.select('label', id)`
- `selectedHoleId` → `selectionStore.select('hole', id)`
- `selectedBasePlateSectionId` → `selectionStore.select('baseplate-section', id)`

### Phase 7b: Fixture Data (Medium Risk)
**Goal**: Replace entity arrays with `useFixtureStore`

Current useState calls to replace:
- `importedParts` → `fixtureStore.parts`
- `supports` → `fixtureStore.supports`
- `clamps` → `fixtureStore.clamps`
- `labels` → `fixtureStore.labels`
- `mountingHoles` → `fixtureStore.holes`
- `currentBaseplate` → `fixtureStore.baseplate`
- `partVisibility` → `fixtureStore.partVisibility`
- `modelColors` → `fixtureStore.partColors`
- `baseplateVisible` → `fixtureStore.baseplateVisible`

### Phase 7c: Workflow State (Low Risk)
**Goal**: Replace workflow useState with `useWorkflowStore`

Current useState calls to replace:
- `activeStep` → `workflowStore.currentStepId`
- `completedSteps` → `workflowStore.completedSteps`
- `skippedSteps` → `workflowStore.skippedSteps`

### Phase 7d: Placement Modes (Medium Risk)
**Goal**: Replace placement modes with `usePlacementStore`

Current useState calls to replace:
- `isPlacementMode` (support) → `placementStore.supportMode.isActive`
- `selectedSupportType` → `placementStore.supportMode.config`
- `isHolePlacementMode` → `placementStore.holeMode.isActive`
- `pendingHoleConfig` → `placementStore.holeMode.config`
- `isBaseplateDrawingMode` → `placementStore.baseplateMode.isActive`
- `drawnBaseplateSections` → `placementStore.baseplateMode.drawnSections`
- `currentBaseplateParams` → `placementStore.baseplateMode.params`

### Phase 7e: Processing State (Low Risk)
**Goal**: Replace processing flags with `useProcessingStore`

Current useState calls to replace:
- `isProcessing` → `processingStore.isProcessing`
- `meshProgress` → `processingStore.meshProgress`
- `isMeshProcessing` → `processingStore.isMeshProcessing`
- `meshAnalysis` → `processingStore.meshAnalysis`
- `isExporting` → `processingStore.isExporting`
- `fileError` → `processingStore.error`
- `pendingProcessedFile` → `processingStore.pendingFile`
- `processingResult` → `processingStore.result`

### Phase 7f: Dialog State (Low Risk)
**Goal**: Replace dialog open states with `useDialogStore`

Current useState calls to replace:
- `isUnitsDialogOpen` → `dialogStore.unitsDialogOpen`
- `isOptimizationDialogOpen` → `dialogStore.optimizationDialogOpen`

### Phase 7g: Cavity State (Medium Risk)
**Goal**: Replace cavity state with `useCavityStore`

Current useState calls to replace:
- `cavityClearance` → `cavityStore.clearance`
- `cavitySettings` → `cavityStore.settings`
- `isCavityProcessing` → `cavityStore.isProcessing`
- `isApplyingCavity` → `cavityStore.isApplying`
- `hasCavityPreview` → `cavityStore.hasPreview`
- `isCavityApplied` → `cavityStore.isApplied`

### Phase 7h: UI State (Low Risk)
**Goal**: Replace UI panel state with `useUiStore`

Current useState calls to replace:
- `isContextPanelCollapsed` → `uiStore.panels.contextPanel`
- `isPropertiesCollapsed` → `uiStore.panels.propertiesPanel`
- `undoStack/redoStack` → `historyStore`

## Event System Migration

Events to be replaced by Zustand subscriptions:

### Selection Events (Phase 7a)
- `part-selected` → Direct store subscription
- `support-selected` → Direct store subscription
- `clamp-selected` → Direct store subscription
- `label-selected` → Direct store subscription
- `hole-selected` → Direct store subscription
- `hole-select-request` → Direct store action
- `baseplate-section-selected` → Direct store subscription

### Entity Events (Phase 7b)
- `part-imported` → `fixtureStore.addPart()` + subscription
- `part-removed` → `fixtureStore.removePart()`
- `support-created` → `fixtureStore.addSupport()`
- `support-updated` → `fixtureStore.updateSupport()`
- `support-delete` → `fixtureStore.removeSupport()`
- `clamp-placed` → `fixtureStore.addClamp()`
- `clamp-update` → `fixtureStore.updateClamp()`
- `clamp-delete` → `fixtureStore.removeClamp()`
- `label-added` → `fixtureStore.addLabel()`
- `label-update` → `fixtureStore.updateLabel()`
- `label-delete` → `fixtureStore.removeLabel()`
- `hole-placed` → `fixtureStore.addHole()`
- `hole-updated` → `fixtureStore.updateHole()`
- `holes-updated` → Direct subscription
- `create-baseplate` → `fixtureStore.setBaseplate()`
- `update-baseplate` → `fixtureStore.updateBaseplate()`
- `remove-baseplate` → `fixtureStore.setBaseplate(null)`

### Workflow Events (Phase 7c)
- `workflow-step-changed` → `workflowStore.goToStep()`
- `highlight-component` → Direct store action

### Placement Events (Phase 7d)
- `supports-cancel-placement` → `placementStore.cancelSupportPlacement()`
- `hole-start-placement` → `placementStore.startHolePlacement()`
- `hole-cancel-placement` → `placementStore.cancelHolePlacement()`
- `baseplate-drawing-mode-changed` → `placementStore.setBaseplateDrawing()`

## Migration Order (Recommended)

1. **Phase 7a** - Selection (cleanest, most reusable)
2. **Phase 7c** - Workflow (needed for step navigation)
3. **Phase 7h** - UI (simple panel states)
4. **Phase 7f** - Dialogs (simple boolean states)
5. **Phase 7e** - Processing (isolated, no cross-dependencies)
6. **Phase 7d** - Placement modes (depends on selection)
7. **Phase 7g** - Cavity (depends on processing)
8. **Phase 7b** - Fixture data (largest, affects most components)

## Testing Strategy

After each phase:
1. Run `npm run build` - verify compilation
2. Manual test affected features
3. Commit working state
4. Document any regressions
