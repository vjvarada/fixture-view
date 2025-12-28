# Refactoring Checklist

## Pre-Flight Checks

- [ ] Git repository is clean (no uncommitted changes)
- [ ] Backup branch created: `git checkout -b refactor/backup-$(date +%Y%m%d)`
- [ ] Development environment working: `npm run dev`
- [ ] Build passes: `npm run build`
- [ ] **⚠️ READ [09_CRITICAL_SYSTEMS.md](./09_CRITICAL_SYSTEMS.md) COMPLETELY**

---

## Critical Behavior Baseline Tests

**Run these tests BEFORE refactoring and AFTER each phase to ensure functionality is preserved.**

### Transform System Tests
- [ ] **Part Transform**: Double-click part → gizmo appears → drag on all axes → position updates in UI
- [ ] **Support Transform**: Double-click support → only Y-rotation and XZ translate work → no jittering
- [ ] **Clamp Transform**: Double-click clamp → Y-rotation works → fixture point stays on surface
- [ ] **Hole Transform**: Double-click hole → only XZ translate works → Y locked
- [ ] **Baseplate Section**: Double-click section → only XZ translate works → sections merge when overlapping

### Coordinate System Tests
- [ ] Position values in UI match visual position (CAD convention: Z=up)
- [ ] Euler order `'YXZ'` used for single-axis rotation extraction
- [ ] Floor position uses (X, Z) not (X, Y)

### CSG Tests
- [ ] Hole CSG runs in worker (no UI freeze)
- [ ] Through holes fully penetrate baseplate (check bottom)
- [ ] Counter-sink holes have proper cone shape
- [ ] Cavity subtraction includes all supports/clamps

### Multi-Baseplate Tests
- [ ] Sections can be drawn
- [ ] Sections can be moved
- [ ] Overlapping sections merge automatically
- [ ] Merged sections have correct combined bounds

---

## Phase 1: Cleanup (Est. 2-4 hours)

### 1.1 Empty Directory Removal
- [ ] Delete `src/components/replicad/`
- [ ] Verify build: `npm run build`
- [ ] Commit: `chore: remove empty replicad directory`

### 1.2 Deprecated Code Removal
- [ ] Remove `@deprecated` parameters from `meshAnalysisService.ts`
- [ ] Update callers if any
- [ ] Verify build: `npm run build`
- [ ] Commit: `refactor: remove deprecated mesh analysis params`

### 1.3 Unused Component Audit
For each potential unused component:
- [ ] Search for imports: `grep -r "ComponentName" src/`
- [ ] If unused, move to `src/_deprecated/`
- [ ] Verify build after each
- [ ] Commit after batch

Components to audit:
- [ ] `STLEditor.tsx`
- [ ] `BooleanOperations.tsx`
- [ ] `BooleanOperationsPanel.tsx`
- [ ] `BaseplateConfigModal.tsx`
- [ ] `BaseplateDialog.tsx`
- [ ] `EnhancedComponentLibrary.tsx`

---

## Phase 2: Core Package Creation (Est. 4-6 hours)

### 2.1 Package Setup
- [ ] Create `packages/` directory
- [ ] Create `packages/cad-core/package.json`
- [ ] Create `packages/cad-core/tsconfig.json`
- [ ] Update root `package.json` with workspaces
- [ ] Run `npm install`
- [ ] Commit: `feat: initialize cad-core package structure`

### 2.2 Transform System
- [ ] Create `packages/cad-core/src/transform/types.ts`
- [ ] Create `packages/cad-core/src/transform/TransformController.ts`
- [ ] Create `packages/cad-core/src/transform/presets.ts`
- [ ] Create `packages/cad-core/src/transform/index.ts`
- [ ] Export from main `index.ts`
- [ ] Verify build: `npm run build`
- [ ] Commit: `feat(core): add transform controller system`

### 2.3 CSG Engine
- [ ] Create `packages/cad-core/src/csg/types.ts`
- [ ] Copy and refactor `csgEngine.ts` → `packages/cad-core/src/csg/CSGEngine.ts`
- [ ] Create `packages/cad-core/src/csg/presets.ts`
- [ ] Create `packages/cad-core/src/csg/index.ts`
- [ ] Verify build: `npm run build`
- [ ] Commit: `feat(core): add unified CSG engine`

### 2.4 Geometry Utilities
- [ ] Create `packages/cad-core/src/geometry/types.ts`
- [ ] Migrate mesh analysis functions
- [ ] Migrate mesh repair functions
- [ ] Create `packages/cad-core/src/geometry/index.ts`
- [ ] Verify build: `npm run build`
- [ ] Commit: `feat(core): add geometry utilities`

---

## Phase 3: UI Package Creation (Est. 4-6 hours)

### 3.1 Package Setup
- [ ] Create `packages/cad-ui/package.json`
- [ ] Create `packages/cad-ui/tsconfig.json`
- [ ] Run `npm install`
- [ ] Commit: `feat: initialize cad-ui package structure`

### 3.2 Viewport Components
- [ ] Create `packages/cad-ui/src/viewport/Viewport.tsx`
- [ ] Migrate `ViewCube.tsx`
- [ ] Create `packages/cad-ui/src/viewport/GridSystem.tsx`
- [ ] Create `packages/cad-ui/src/viewport/index.ts`
- [ ] Verify rendering works
- [ ] Commit: `feat(ui): add viewport components`

### 3.3 PivotGizmo Component
- [ ] Create `packages/cad-ui/src/transform/PivotGizmo.tsx`
- [ ] Use `TransformController` from core
- [ ] Create `packages/cad-ui/src/transform/TransformOverlay.tsx`
- [ ] Create `packages/cad-ui/src/transform/index.ts`
- [ ] Verify build: `npm run build`
- [ ] Commit: `feat(ui): add unified PivotGizmo component`

### 3.4 Wizard System
- [ ] Create `packages/cad-ui/src/wizard/types.ts`
- [ ] Create `packages/cad-ui/src/wizard/WizardProvider.tsx`
- [ ] Create `packages/cad-ui/src/wizard/StepIndicator.tsx`
- [ ] Create `packages/cad-ui/src/wizard/index.ts`
- [ ] Verify build: `npm run build`
- [ ] Commit: `feat(ui): add wizard workflow system`

---

## Phase 4: Feature Migration (Est. 6-8 hours)

### 4.1 Feature Directory Structure
- [ ] Create `src/features/import/`
- [ ] Create `src/features/baseplate/`
- [ ] Create `src/features/supports/`
- [ ] Create `src/features/clamps/`
- [ ] Create `src/features/holes/`
- [ ] Create `src/features/labels/`
- [ ] Create `src/features/cavity/`
- [ ] Create `src/features/export/`
- [ ] Commit: `feat: create feature-based directory structure`

### 4.2 Supports Feature Migration
- [ ] Move `src/components/Supports/*` → `src/features/supports/components/`
- [ ] Create `src/features/supports/types.ts`
- [ ] Create `src/features/supports/hooks/useSupportState.ts`
- [ ] Create `src/features/supports/hooks/useSupports.ts`
- [ ] Create `src/features/supports/index.ts`
- [ ] Update all imports in codebase
- [ ] Verify support functionality works
- [ ] Commit: `refactor: migrate supports to feature module`

### 4.3 Clamps Feature Migration
- [ ] Move `src/components/Clamps/*` → `src/features/clamps/components/`
- [ ] Create `src/features/clamps/types.ts`
- [ ] Create `src/features/clamps/hooks/useClampState.ts`
- [ ] Create `src/features/clamps/hooks/useClamps.ts`
- [ ] Create `src/features/clamps/index.ts`
- [ ] Update all imports in codebase
- [ ] Verify clamp functionality works
- [ ] Commit: `refactor: migrate clamps to feature module`

### 4.4 Holes Feature Migration
- [ ] Move `src/components/MountingHoles/*` → `src/features/holes/components/`
- [ ] Create `src/features/holes/types.ts`
- [ ] Create `src/features/holes/hooks/useHoleState.ts`
- [ ] Create `src/features/holes/hooks/useHoles.ts`
- [ ] Create `src/features/holes/index.ts`
- [ ] Update all imports in codebase
- [ ] Verify hole functionality works
- [ ] Commit: `refactor: migrate holes to feature module`

### 4.5 Labels Feature Migration
- [ ] Move `src/components/Labels/*` → `src/features/labels/components/`
- [ ] Create feature structure (types, hooks, index)
- [ ] Update imports
- [ ] Verify functionality
- [ ] Commit: `refactor: migrate labels to feature module`

### 4.6 BasePlate Feature Migration
- [ ] Move `src/components/BasePlate/*` → `src/features/baseplate/components/`
- [ ] Create feature structure
- [ ] Update imports
- [ ] Verify functionality
- [ ] Commit: `refactor: migrate baseplate to feature module`

---

## Phase 5: Transform Migration (Est. 4-6 hours)

### 5.1 Support Transform Migration
- [ ] Update `SupportMesh.tsx` to use `PivotGizmo`
- [ ] Use `SUPPORT_TRANSFORM_CONFIG` preset
- [ ] Verify transforms work correctly
- [ ] Delete old `SupportTransformControls.tsx`
- [ ] Commit: `refactor: migrate support transforms to unified system`

### 5.2 Clamp Transform Migration
- [ ] Update clamp rendering to use `PivotGizmo`
- [ ] Use `CLAMP_TRANSFORM_CONFIG` preset
- [ ] Verify transforms work correctly
- [ ] Delete old `ClampTransformControls.tsx`
- [ ] Commit: `refactor: migrate clamp transforms to unified system`

### 5.3 Hole Transform Migration
- [ ] Update hole rendering to use `PivotGizmo`
- [ ] Use `HOLE_TRANSFORM_CONFIG` preset
- [ ] Verify transforms work correctly
- [ ] Delete old `HoleTransformControls.tsx`
- [ ] Commit: `refactor: migrate hole transforms to unified system`

### 5.4 BasePlate Transform Migration
- [ ] Update baseplate section rendering to use `PivotGizmo`
- [ ] Use `BASEPLATE_SECTION_TRANSFORM_CONFIG` preset
- [ ] Verify transforms work correctly
- [ ] Delete old `BasePlateTransformControls.tsx`
- [ ] Commit: `refactor: migrate baseplate transforms to unified system`

### 5.5 Part Transform Migration
- [ ] Update part rendering to use `PivotGizmo`
- [ ] Use `PART_TRANSFORM_CONFIG` preset
- [ ] Verify transforms work correctly
- [ ] Delete old `SelectableTransformControls.tsx`
- [ ] Commit: `refactor: migrate part transforms to unified system`

### 5.6 Cleanup Legacy Transform Files
- [ ] Delete `ModelTransformControls.tsx`
- [ ] Delete `TransformGizmo.tsx`
- [ ] Delete `TransformControlsUI.tsx`
- [ ] Verify no broken imports
- [ ] Commit: `chore: remove legacy transform controls`

---

## Phase 6: 3DScene Decomposition (Est. 6-8 hours)

### 6.1 Create Scene Composer
- [ ] Create `src/components/SceneComposer.tsx`
- [ ] Import feature renderers
- [ ] Compose feature renderers
- [ ] Commit: `feat: add SceneComposer for feature composition`

### 6.2 Extract Rendering Logic
- [ ] Extract support rendering from `3DScene.tsx`
- [ ] Extract clamp rendering from `3DScene.tsx`
- [ ] Extract hole rendering from `3DScene.tsx`
- [ ] Extract label rendering from `3DScene.tsx`
- [ ] Extract baseplate rendering from `3DScene.tsx`
- [ ] Verify each extraction works
- [ ] Commit after each extraction

### 6.3 Update 3DScene
- [ ] Update `3DScene.tsx` to use `SceneComposer`
- [ ] Remove extracted code
- [ ] Verify all rendering works
- [ ] File should be < 1000 lines now
- [ ] Commit: `refactor: simplify 3DScene using SceneComposer`

---

## Phase 7: Final Cleanup (Est. 2-4 hours)

### 7.1 AppShell Decomposition
- [ ] Extract step state to `useWorkflowState.ts`
- [ ] Extract toolbar logic
- [ ] Reduce `AppShell.tsx` size
- [ ] Commit: `refactor: decompose AppShell`

### 7.2 Final Verification
- [ ] Run full build: `npm run build`
- [ ] Run lint: `npm run lint`
- [ ] Manual test all features:
  - [ ] File import
  - [ ] Baseplate configuration
  - [ ] Support placement and transform
  - [ ] Clamp placement and transform
  - [ ] Hole placement and transform
  - [ ] Label placement
  - [ ] Cavity generation
  - [ ] Export functionality

### 7.3 Documentation
- [ ] Update README.md with new structure
- [ ] Add package README files
- [ ] Document public APIs
- [ ] Commit: `docs: update documentation for new architecture`

---

## Post-Refactoring Verification

### Code Quality Checks
- [ ] No file > 500 lines (except historical)
- [ ] All TypeScript strict mode passes
- [ ] No circular dependencies
- [ ] All exports documented

### Functionality Checks
- [ ] File import works
- [ ] All transforms work per entity type
- [ ] CSG operations work
- [ ] Export generates correct file
- [ ] UI responsive and functional

### Performance Checks
- [ ] Initial load time acceptable
- [ ] Transform operations smooth
- [ ] CSG operations don't freeze UI
- [ ] Memory usage reasonable

---

## Rollback Points

Create tags at each major milestone:
- `refactor/phase-1-cleanup`
- `refactor/phase-2-core`
- `refactor/phase-3-ui`
- `refactor/phase-4-features`
- `refactor/phase-5-transforms`
- `refactor/phase-6-scene`
- `refactor/complete`

To rollback to any point:
```bash
git checkout refactor/phase-X-name
```
