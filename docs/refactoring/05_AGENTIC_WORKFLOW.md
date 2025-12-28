# Agentic Workflow - Refactoring Execution Guide

## Overview

This document provides step-by-step instructions for an AI agent to execute the refactoring systematically without breaking functionality.

---

## ⚠️ CRITICAL: Before Starting

**YOU MUST READ [09_CRITICAL_SYSTEMS.md](./09_CRITICAL_SYSTEMS.md) FIRST.**

That document contains:
- Coordinate system transformation rules (CAD Z-up ↔ Three.js Y-up)
- Anti-jitter patterns for transform controls
- Euler order requirements (`'YXZ'` for single-axis rotation)
- Hole CSG worker communication protocol
- Multi-baseplate section coordinate system
- Event-based communication contracts

**Breaking any of these patterns will cause subtle, hard-to-debug issues.**

---

## Pre-Requisites

Before starting any refactoring:

1. **Ensure tests pass** (if any exist)
2. **Create a backup branch**: `git checkout -b refactor/backup-main`
3. **Document current behavior** for critical features
4. **Set up local development**: `npm install && npm run dev`

---

## Agentic Workflow Phases

### Phase 1: Cleanup Phase

**Goal**: Remove unused code without breaking anything

**Steps**:

```
PHASE_1_CLEANUP:
  
  STEP_1.1: Delete empty directories
    - DELETE: src/components/replicad/
    - VERIFY: npm run build passes
    - COMMIT: "chore: remove empty replicad directory"
  
  STEP_1.2: Audit unused components
    FOR EACH file IN [STLEditor.tsx, BooleanOperations.tsx, BooleanOperationsPanel.tsx]:
      - SEARCH: grep -r "import.*{ComponentName}" src/
      - IF no_imports_found:
        - BACKUP: Move to src/_deprecated/
        - VERIFY: npm run build passes
      - COMMIT: "chore: deprecate unused {ComponentName}"
  
  STEP_1.3: Remove deprecated parameters
    - FILE: src/modules/FileImport/services/meshAnalysisService.ts
    - REMOVE: All @deprecated marked parameters
    - UPDATE: Callers to use new parameters
    - VERIFY: npm run build passes
    - COMMIT: "refactor: remove deprecated mesh analysis params"
```

---

### Phase 2: Core Module Extraction

**Goal**: Extract reusable core functionality into packages

**Steps**:

```
PHASE_2_CORE_EXTRACTION:

  STEP_2.1: Create package structure
    - CREATE: packages/cad-core/package.json
    - CREATE: packages/cad-core/tsconfig.json
    - CREATE: packages/cad-core/src/index.ts
    - UPDATE: Root package.json with workspace config
    - VERIFY: npm install works
    - COMMIT: "feat: initialize @rapidtool/cad-core package"

  STEP_2.2: Extract Transform System
    - CREATE: packages/cad-core/src/transform/TransformController.ts
    - CREATE: packages/cad-core/src/transform/types.ts
    - CREATE: packages/cad-core/src/transform/presets.ts
    - EXPORT: From packages/cad-core/src/index.ts
    - VERIFY: npm run build passes
    - COMMIT: "feat(core): add transform controller system"

  STEP_2.3: Extract CSG Engine
    - COPY: src/lib/csgEngine.ts → packages/cad-core/src/csg/CSGEngine.ts
    - REFACTOR: Make class more modular
    - CREATE: packages/cad-core/src/csg/types.ts
    - CREATE: packages/cad-core/src/csg/presets.ts
    - EXPORT: From packages/cad-core/src/index.ts
    - VERIFY: npm run build passes
    - COMMIT: "feat(core): add unified CSG engine"

  STEP_2.4: Extract Geometry Utilities
    - CREATE: packages/cad-core/src/geometry/MeshAnalysis.ts
    - CREATE: packages/cad-core/src/geometry/MeshRepair.ts
    - MIGRATE: Functions from meshAnalysisService.ts
    - VERIFY: npm run build passes
    - COMMIT: "feat(core): add geometry utilities"
```

---

### Phase 3: UI Component Library

**Goal**: Create reusable UI components

**Steps**:

```
PHASE_3_UI_LIBRARY:

  STEP_3.1: Create UI package structure
    - CREATE: packages/cad-ui/package.json
    - CREATE: packages/cad-ui/tsconfig.json
    - CREATE: packages/cad-ui/src/index.ts
    - VERIFY: npm install works
    - COMMIT: "feat: initialize @rapidtool/cad-ui package"

  STEP_3.2: Extract Viewport Components
    - CREATE: packages/cad-ui/src/viewport/Viewport.tsx
    - CREATE: packages/cad-ui/src/viewport/ViewCube.tsx
    - CREATE: packages/cad-ui/src/viewport/GridSystem.tsx
    - MIGRATE: From src/components/
    - VERIFY: Application still renders correctly
    - COMMIT: "feat(ui): add viewport components"

  STEP_3.3: Create PivotGizmo Component
    - CREATE: packages/cad-ui/src/transform/PivotGizmo.tsx
    - USE: TransformController from @rapidtool/cad-core
    - CREATE: packages/cad-ui/src/transform/TransformOverlay.tsx
    - VERIFY: npm run build passes
    - COMMIT: "feat(ui): add unified PivotGizmo component"

  STEP_3.4: Create Wizard System
    - CREATE: packages/cad-ui/src/wizard/WizardProvider.tsx
    - CREATE: packages/cad-ui/src/wizard/WizardStep.tsx
    - CREATE: packages/cad-ui/src/wizard/StepIndicator.tsx
    - MIGRATE: Logic from ContextOptionsPanel
    - VERIFY: Workflow still functions
    - COMMIT: "feat(ui): add wizard/workflow system"
```

---

### Phase 4: Feature Restructuring

**Goal**: Decompose monolithic components into features

**Steps**:

```
PHASE_4_FEATURE_RESTRUCTURING:

  STEP_4.1: Create Feature Structure
    - CREATE: src/features/import/
    - CREATE: src/features/baseplate/
    - CREATE: src/features/supports/
    - CREATE: src/features/clamps/
    - CREATE: src/features/holes/
    - CREATE: src/features/labels/
    - CREATE: src/features/cavity/
    - CREATE: src/features/export/
    - COMMIT: "feat: create feature-based directory structure"

  STEP_4.2: Migrate Supports Feature
    - MOVE: src/components/Supports/* → src/features/supports/components/
    - CREATE: src/features/supports/hooks/
    - CREATE: src/features/supports/types.ts
    - CREATE: src/features/supports/index.ts
    - UPDATE: Imports throughout codebase
    - VERIFY: Support functionality works
    - COMMIT: "refactor: migrate supports to feature module"

  STEP_4.3: Migrate Clamps Feature
    - MOVE: src/components/Clamps/* → src/features/clamps/components/
    - CREATE: src/features/clamps/hooks/
    - CREATE: src/features/clamps/types.ts
    - CREATE: src/features/clamps/index.ts
    - UPDATE: Imports throughout codebase
    - VERIFY: Clamp functionality works
    - COMMIT: "refactor: migrate clamps to feature module"

  STEP_4.4: Decompose 3DScene.tsx
    - EXTRACT: Support rendering logic → src/features/supports/components/SupportRenderer.tsx
    - EXTRACT: Clamp rendering logic → src/features/clamps/components/ClampRenderer.tsx
    - EXTRACT: Hole rendering logic → src/features/holes/components/HoleRenderer.tsx
    - EXTRACT: Label rendering logic → src/features/labels/components/LabelRenderer.tsx
    - EXTRACT: Baseplate logic → src/features/baseplate/components/BaseplateRenderer.tsx
    - CREATE: src/components/SceneComposer.tsx (orchestrates feature renderers)
    - UPDATE: 3DScene.tsx to use SceneComposer
    - VERIFY: All rendering works correctly
    - COMMIT: "refactor: decompose 3DScene into feature renderers"

  STEP_4.5: Decompose AppShell.tsx
    - EXTRACT: Step state management → src/app/hooks/useWorkflowState.ts
    - EXTRACT: File import logic → src/features/import/hooks/useFileImport.ts
    - EXTRACT: Toolbar logic → src/app/components/Toolbar.tsx
    - UPDATE: AppShell.tsx to use extracted modules
    - VERIFY: All shell functionality works
    - COMMIT: "refactor: decompose AppShell into modular components"
```

---

### Phase 5: Transform System Migration

**Goal**: Replace all transform controls with unified system

**Steps**:

```
PHASE_5_TRANSFORM_MIGRATION:

  STEP_5.1: Migrate Support Transform
    - REPLACE: SupportTransformControls.tsx with PivotGizmo
    - USE: SUPPORT_TRANSFORM_CONFIG preset
    - VERIFY: Support transforms work correctly
    - DELETE: Old SupportTransformControls.tsx
    - COMMIT: "refactor: migrate support transforms to unified system"

  STEP_5.2: Migrate Clamp Transform
    - REPLACE: ClampTransformControls.tsx with PivotGizmo
    - USE: CLAMP_TRANSFORM_CONFIG preset
    - VERIFY: Clamp transforms work correctly
    - DELETE: Old ClampTransformControls.tsx
    - COMMIT: "refactor: migrate clamp transforms to unified system"

  STEP_5.3: Migrate Hole Transform
    - REPLACE: HoleTransformControls.tsx with PivotGizmo
    - USE: HOLE_TRANSFORM_CONFIG preset
    - VERIFY: Hole transforms work correctly
    - DELETE: Old HoleTransformControls.tsx
    - COMMIT: "refactor: migrate hole transforms to unified system"

  STEP_5.4: Migrate Baseplate Transform
    - REPLACE: BasePlateTransformControls.tsx with PivotGizmo
    - USE: BASEPLATE_SECTION_TRANSFORM_CONFIG preset
    - VERIFY: Baseplate section transforms work
    - DELETE: Old BasePlateTransformControls.tsx
    - COMMIT: "refactor: migrate baseplate transforms to unified system"

  STEP_5.5: Migrate Part Transform
    - REPLACE: SelectableTransformControls.tsx with PivotGizmo
    - USE: PART_TRANSFORM_CONFIG preset
    - VERIFY: Part transforms work correctly
    - DELETE: Old transform control files
    - COMMIT: "refactor: migrate part transforms to unified system"

  STEP_5.6: Cleanup Old Transform Files
    - DELETE: src/components/ModelTransformControls.tsx
    - DELETE: src/components/TransformGizmo.tsx
    - DELETE: src/components/TransformControlsUI.tsx
    - VERIFY: No broken imports
    - COMMIT: "chore: remove legacy transform controls"
```

---

## Verification Protocol

After each step:

```
VERIFICATION_PROTOCOL:

  1. BUILD_CHECK:
     - RUN: npm run build
     - EXPECT: No TypeScript errors
     - EXPECT: No build warnings related to changed files

  2. LINT_CHECK:
     - RUN: npm run lint
     - EXPECT: No new lint errors

  3. FUNCTIONAL_CHECK:
     - RUN: npm run dev
     - VERIFY: Application loads
     - VERIFY: Changed feature works as before

  4. REGRESSION_CHECK:
     - TEST: File import still works
     - TEST: Transform controls respond
     - TEST: CSG operations complete
     - TEST: Export functionality works
```

---

## Rollback Procedure

If something breaks:

```
ROLLBACK_PROCEDURE:

  1. IDENTIFY: Which step broke functionality
  2. REVERT: git revert <commit-hash>
  3. ANALYZE: What went wrong
  4. FIX: Address the issue
  5. RETRY: Re-attempt the step with fix
```

---

## Success Criteria Per Phase

### Phase 1 Success
- [ ] No build errors
- [ ] Application runs
- [ ] No unused code warnings

### Phase 2 Success
- [ ] Core package builds independently
- [ ] Application uses core package
- [ ] All CSG operations work

### Phase 3 Success
- [ ] UI package builds independently
- [ ] Components render correctly
- [ ] Wizard workflow functions

### Phase 4 Success
- [ ] No file > 500 lines (except legacy)
- [ ] Features properly isolated
- [ ] Clean import paths

### Phase 5 Success
- [ ] All transform controls use unified system
- [ ] No duplicate transform implementations
- [ ] All entity types can transform

---

## Agent Instructions

When executing this workflow:

1. **Work incrementally** - One step at a time
2. **Verify constantly** - Run build after each change
3. **Commit frequently** - Small, atomic commits
4. **Document decisions** - Note any deviations from plan
5. **Ask if unsure** - Don't guess on breaking changes
6. **Preserve behavior** - Functionality over style
7. **Test manually** - Automated tests may not exist

---

## Critical Files (Handle with Care)

These files are central to application functionality:

1. `src/components/3DScene.tsx` - Main rendering
2. `src/layout/AppShell.tsx` - Application shell
3. `src/modules/FileImport/index.tsx` - File processing
4. `src/lib/csgEngine.ts` - CSG operations
5. `src/components/ContextOptionsPanel/index.tsx` - Workflow
6. `src/lib/transformUtils.ts` - **CRITICAL: Coordinate transforms**
7. `src/components/BasePlate/types.ts` - **CRITICAL: Section merging logic**
8. `src/components/MountingHoles/holeGeometry.ts` - **CRITICAL: Hole CSG geometry**
9. `src/lib/workers/workerManager.ts` - **CRITICAL: Hole CSG worker**

Always maintain working versions of these until replacements are fully tested.

---

## Critical Behavior Preservation

### 1. Transform Controls - Anti-Jitter Pattern

ALL transform controls MUST use this pattern:

```typescript
// Lock position at drag start to prevent feedback loop
const isDraggingRef = useRef(false);
const dragStartPos = useRef<THREE.Vector3 | null>(null);

const handleDragStart = () => {
  isDraggingRef.current = true;
  dragStartPos.current = currentPosition.clone();  // LOCK HERE
};

const displayPos = isDraggingRef.current && dragStartPos.current 
  ? dragStartPos.current  // Use locked position during drag
  : currentPosition;

const handleDragEnd = () => {
  isDraggingRef.current = false;
  dragStartPos.current = null;
  
  // CRITICAL: Reset pivot to identity
  pivotRef.current.matrix.identity();
  pivotRef.current.position.set(0, 0, 0);
  pivotRef.current.rotation.set(0, 0, 0);
  pivotRef.current.scale.set(1, 1, 1);
  pivotRef.current.updateMatrix();
};
```

### 2. Rotation Extraction - Euler Order

For entities with single-axis rotation (supports, clamps, labels):

```typescript
// CORRECT - Clean Y extraction
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
const spin = tempEuler.y;

// WRONG - Y may be polluted
tempEuler.setFromQuaternion(tempQuaternion);  // Default XYZ
const spin = tempEuler.y;  // NOT RELIABLE
```

### 3. Coordinate Transforms

```typescript
// Floor position (2D on baseplate)
// App (X, Y) → Three.js (X, Z)
new THREE.Vector3(center.x, height, center.y);  // Note: app Y → three Z

// CAD display conversion
const cadPos = toCadPosition(threePos);  // Swaps Y↔Z
```

### 4. Hole Geometry

```typescript
// Holes MUST penetrate through baseplate
const PENETRATION_BUFFER = 4;  // mm extra depth
const safeDepth = depth + PENETRATION_BUFFER;

// Position so top is above Y=0, bottom below -depth
geometry.translate(0, -safeDepth/2 + PENETRATION_BUFFER/2, 0);
```

### 5. Section Coordinates

```typescript
// Sections use XZ plane (NOT XY)
interface BasePlateSection {
  minX: number;  // World X
  maxX: number;  // World X
  minZ: number;  // World Z (NOT Y!)
  maxZ: number;  // World Z (NOT Y!)
}
```
