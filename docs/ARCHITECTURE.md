# RapidTool Fixture View - Architecture Guide

> **Purpose:** Single source of truth for AI agents and developers working on this codebase.
> 
> **Last Updated:** January 1, 2026  
> **Version:** 3.0 (Post-Refactoring)

---

## 1. Application Overview

### What This Application Does

RapidTool Fixture View is a **browser-based 3D CAD application** for designing manufacturing fixtures. Users follow a step-wise workflow:

```
Import Part → Configure Baseplate → Add Supports → Place Clamps → Add Labels → Drill Holes → Create Cavity → Export
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| **UI Framework** | React 18 + TypeScript |
| **3D Rendering** | Three.js via React Three Fiber |
| **State Management** | Zustand + Immer (stores) + React hooks (3DScene) |
| **Styling** | Tailwind CSS + shadcn/ui |
| **CSG Operations** | Manifold 3D (WASM) |
| **Build Tool** | Vite |
| **Monorepo** | npm workspaces |

---

## 2. Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                              │
│                       (fixture-view)                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  src/features/     - Feature modules (supports, clamps...)  │   │
│  │  src/layout/       - AppShell orchestration                 │   │
│  │  src/stores/       - App-specific Zustand stores            │   │
│  │  src/hooks/        - App-specific hook wrappers             │   │
│  │  src/components/   - 3DScene + UI components                │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                       UI COMPONENT LAYER                            │
│                      (@rapidtool/cad-ui)                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  stores/       - Generic stores (selection, workflow, UI)   │   │
│  │  viewport/     - 3D viewport components                     │   │
│  │  panels/       - Accordion, properties panels               │   │
│  │  navigation/   - Step navigation, workflow types            │   │
│  │  primitives/   - Base UI components (from shadcn)           │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                        CORE LOGIC LAYER                             │
│                      (@rapidtool/cad-core)                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  mesh/         - Mesh analysis, repair, decimation          │   │
│  │  offset/       - Cavity/heightmap generation                │   │
│  │  csg/          - CSG operations with Manifold               │   │
│  │  transform/    - Coordinate transforms                      │   │
│  │  parsers/      - STL parser                                 │   │
│  │  workers/      - Web Worker pool management                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Directory Structure

### `packages/cad-core/` - Pure Logic (No React)

```
cad-core/
├── src/
│   ├── mesh/                 # Mesh processing
│   │   ├── meshAnalysis.ts       # Geometry analysis
│   │   ├── manifoldMeshService.ts # Manifold integration
│   │   └── index.ts
│   ├── offset/               # Cavity generation
│   │   ├── offsetHeightmap.ts    # Heightmap-based offset
│   │   ├── offsetMeshProcessor.ts # GPU-based mesh offset
│   │   ├── types.ts              # CavitySettings, etc.
│   │   └── index.ts
│   ├── csg/                  # Boolean operations
│   │   └── csgEngine.ts          # Manifold wrapper
│   ├── transform/            # Coordinate systems
│   │   └── coordinateUtils.ts    # CAD ↔ Three.js
│   ├── parsers/              # File parsers
│   │   └── stlParser.ts
│   └── workers/              # Worker management
│       └── workerManager.ts
```

### `packages/cad-ui/` - Reusable React Components

```
cad-ui/
├── src/
│   ├── stores/               # Generic Zustand stores
│   │   ├── selectionStore.ts     # Selection state
│   │   ├── workflowStore.ts      # Workflow steps
│   │   ├── uiStore.ts            # UI preferences
│   │   └── historyStore.ts       # Undo/redo
│   ├── viewport/             # 3D viewport
│   │   └── ViewCube.tsx
│   ├── navigation/           # Workflow navigation
│   │   └── types.ts              # WorkflowStep, ComponentCategory
│   └── primitives/           # Base UI (shadcn)
```

### `src/` - Application Code

```
src/
├── features/                 # Feature modules (domain logic)
│   ├── supports/             # Support placement
│   ├── clamps/               # Clamp placement  
│   ├── holes/                # Mounting holes
│   ├── labels/               # Labels
│   ├── baseplate/            # Baseplate config
│   └── export/               # Export functionality
│
├── stores/                   # App-specific Zustand stores
│   ├── fixtureStore.ts       # Parts, supports, clamps, labels, holes
│   ├── cavityStore.ts        # Cavity operations
│   ├── placementStore.ts     # Placement modes
│   └── processingStore.ts    # File processing state
│
├── hooks/                    # App-level hook wrappers
│   ├── useSelection.ts       # Selection hooks
│   ├── useWorkflow.ts        # Workflow hooks
│   ├── useFixture.ts         # Fixture entity hooks
│   └── useCavity.ts          # Cavity hooks
│
├── layout/                   # Layout orchestration
│   └── AppShell.tsx          # Main orchestration
│
├── components/               # UI & 3D components
│   ├── 3DScene/              # 3D scene (DECOMPOSED)
│   │   ├── hooks/            # Scene-specific hooks (see below)
│   │   ├── renderers/        # Render components
│   │   └── index.ts          # Public API
│   ├── 3DScene.tsx           # Main scene component
│   ├── ContextOptionsPanel/  # Workflow step panels
│   └── ui/                   # shadcn components
│
└── utils/                    # Utilities
    ├── performanceSettings.ts
    └── memoryMonitor.ts
```

---

## 4. 3DScene Hook Architecture

The 3DScene component is decomposed into specialized hooks following separation of concerns:

### State Hooks (Local State Management)

| Hook | Purpose |
|------|---------|
| `useSupportState` | Support placement state (placing, supports, trim preview) |
| `useClampState` | Clamp placement state (placedClamps, placement mode) |
| `useLabelState` | Label state (labels, selection, pending config) |
| `useHoleState` | Hole state (mountingHoles, placement mode, CSG) |
| `useBaseplateState` | Baseplate config (sections, drawing mode) |
| `useSceneState` | General scene state (transforms, bounds, CSG previews) |

### Handler Hooks (Event Processing)

| Hook | Purpose |
|------|---------|
| `useSupportHandlers` | Support add/update/delete events |
| `useClampHandlers` | Clamp placement and update events |
| `useLabelHandlers` | Label add/update/delete events |
| `useHoleHandlers` | Hole placement and CSG events |
| `useBaseplateHandlers` | Baseplate creation and modification |

### Operation Hooks (Complex Operations)

| Hook | Purpose |
|------|---------|
| `useCavityOperations` | Cavity subtraction CSG operations |
| `useOffsetMeshPreview` | Heightmap-based offset mesh generation |
| `useSupportTrimPreview` | Support trim preview generation |
| `useBaseplateOperations` | Baseplate expansion calculations |
| `useHoleCSG` | Hole CSG operations on baseplate |
| `useSceneReset` | Scene reset with Three.js memory cleanup |

### Control Hooks (Camera & Transform)

| Hook | Purpose |
|------|---------|
| `useCameraControls` | Camera positioning and orientation |
| `useModelTransform` | Part transform with live updates |
| `usePartManagement` | Part bounds and visibility |

### Pattern Example

```typescript
// In 3DScene.tsx - orchestration only
const ThreeDScene: React.FC<Props> = (props) => {
  // 1. State hooks
  const supportState = useSupportState();
  const clampState = useClampState();
  
  // 2. Handler hooks (wire events)
  useSupportHandlers({ ...supportState, ...props });
  useClampHandlers({ ...clampState, ...props });
  
  // 3. Operation hooks
  useCavityOperations({ ... });
  useSceneReset({ ... });
  
  // 4. Render
  return (
    <>
      <SupportsRenderer supports={supportState.supports} />
      <ClampsRenderer clamps={clampState.placedClamps} />
    </>
  );
};
```

---

## 5. State Management

### Technology: Zustand + Immer

We use **Zustand** with **Immer middleware** for global state management:

```typescript
// Standard store creation pattern
import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export const useFeatureStore = create<FeatureState & FeatureActions>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        // State
        items: [],
        selectedId: null,
        
        // Actions - Immer allows direct mutation
        addItem: (item) => set((state) => {
          state.items.push(item);  // Direct push OK with Immer
        }),
        
        removeItem: (id) => set((state) => {
          state.items = state.items.filter(i => i.id !== id);
        }),
        
        updateItem: (id, changes) => set((state) => {
          const item = state.items.find(i => i.id === id);
          if (item) Object.assign(item, changes);  // Direct assign OK
        }),
      }))
    ),
    { name: 'feature-store' }  // DevTools name
  )
);
```

### When to Use Global Store vs Local State

| Scenario | Use | Location |
|----------|-----|----------|
| **Persisted entity data** (parts, supports, clamps) | Zustand Store | `src/stores/` |
| **Cross-component selection** | Zustand Store | `selectionStore` |
| **3D-only transient state** (drag preview, hover) | React useState | 3DScene hooks |
| **Placement mode flags** | Zustand Store | `placementStore` |
| **UI-only state** (accordion open, panel visible) | Zustand Store | `uiStore` |
| **Three.js refs** (meshes, controls) | useRef | Component |

### Store Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GENERIC STORES (cad-ui)                      │
│                   Workflow-agnostic, reusable                   │
├─────────────────────────────────────────────────────────────────┤
│ selectionStore    │ { category, id } selection pattern          │
│ workflowStore     │ Active step, accordion sync                 │
│ uiStore           │ Theme, panel states, settings               │
│ historyStore      │ Undo/redo stacks                            │
│ transformStore    │ Active transform mode (translate/rotate)    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  APP-SPECIFIC STORES (src/stores)               │
│                   Fixture workflow specific                     │
├─────────────────────────────────────────────────────────────────┤
│ fixtureStore      │ Parts, supports, clamps, labels, holes      │
│ cavityStore       │ Cavity settings, processing state           │
│ placementStore    │ Support/hole/baseplate placement modes      │
│ processingStore   │ File processing, mesh analysis              │
│ dialogStore       │ Modal dialogs state                         │
└─────────────────────────────────────────────────────────────────┘
```

### Hook Wrapper Pattern

Stores expose backward-compatible hooks:

```typescript
// In src/hooks/useSelection.ts
export function useSelectedPart() {
  const partId = useSelectionStore(state => state.selectedIds.part);
  const select = useSelectionStore(state => state.select);
  
  const setSelectedPartId = useCallback((id: string | null) => {
    select('part', id);
  }, [select]);
  
  return [partId, setSelectedPartId] as const;
}

// Usage - same interface as useState
const [selectedPartId, setSelectedPartId] = useSelectedPart();
```

### Custom Events (Cross-Boundary Communication)

These events remain for operations spanning component boundaries:

| Event | Purpose | Direction |
|-------|---------|-----------|
| `generate-offset-mesh-preview` | Trigger cavity preview | AppShell → 3DScene |
| `execute-cavity-subtraction` | Apply cavity to baseplate | AppShell → 3DScene |
| `export-fixture` | Export merged mesh | AppShell → 3DScene |
| `viewer-reset` | Reset viewer state | Utils → 3DScene |
| `session-reset` | Reset entire session | Utils → All |

---

## 6. Critical Systems

### ⚠️ DO NOT MODIFY WITHOUT UNDERSTANDING

#### 6.1 Coordinate System Transform

**Problem:** CAD uses Z-up, Three.js uses Y-up.

```typescript
// packages/cad-core/src/transform/coordinateUtils.ts
export const toCadPosition = (position) => ({
  x: position.x,
  y: position.z,  // CAD Y = Three.js Z
  z: position.y,  // CAD Z = Three.js Y
});
```

| Application | Three.js | Description |
|-------------|----------|-------------|
| X | X | Horizontal |
| Y | Z | Depth |
| Z | Y | Vertical |

#### 6.2 Euler Order for Rotation

```typescript
// ✅ CORRECT - Use YXZ for clean Y-axis extraction
tempEuler.setFromQuaternion(quaternion, 'YXZ');
const spin = tempEuler.y;

// ❌ WRONG - Default order pollutes Y
tempEuler.setFromQuaternion(quaternion);
```

#### 6.3 Transform Anti-Jitter Pattern

```typescript
// Required in all transform controls
const isDraggingRef = useRef(false);
const dragStartPos = useRef<THREE.Vector3 | null>(null);

const handleDragStart = () => {
  isDraggingRef.current = true;
  dragStartPos.current = position.clone();  // LOCK position
};

// During drag, use LOCKED position for display
const displayPos = isDraggingRef.current ? dragStartPos.current : currentPosition;

const handleDragEnd = () => {
  isDraggingRef.current = false;
  dragStartPos.current = null;
  // CRITICAL: Reset pivot to identity
  pivotRef.current.matrix.identity();
};
```

#### 6.4 Immer Frozen State

Zustand with Immer produces **frozen state**. Never mutate directly:

```typescript
// ❌ WRONG - Will throw "Cannot assign to read only property"
updates.position.y = newValue;

// ✅ CORRECT - Create mutable copy
const mutableUpdates = { ...updates };
mutableUpdates.position = { ...mutableUpdates.position };
mutableUpdates.position.y = newValue;
```

#### 6.5 Three.js Memory Management

Always dispose geometries and materials when removing objects:

```typescript
// In useSceneReset.ts - proper cleanup pattern
setMergedFixtureMesh(prev => {
  if (prev) {
    prev.geometry?.dispose();
    if (Array.isArray(prev.material)) {
      prev.material.forEach(m => m.dispose());
    } else {
      prev.material?.dispose();
    }
  }
  return null;
});
```

---

## 7. File Reference

### Critical Files (Handle with Care)

| File | Lines | Purpose | Risk |
|------|-------|---------|------|
| `src/components/3DScene.tsx` | ~2,400 | Main 3D scene | 🔴 HIGH |
| `src/layout/AppShell.tsx` | ~2,100 | App orchestration | 🔴 HIGH |
| `packages/cad-core/src/mesh/meshAnalysis.ts` | ~3,300 | Mesh processing | 🔴 HIGH |
| `packages/cad-core/src/offset/offsetHeightmap.ts` | ~1,200 | Cavity generation | 🔴 HIGH |

### 3DScene Hooks

| File | Purpose |
|------|---------|
| `src/components/3DScene/hooks/useSupportState.ts` | Support state |
| `src/components/3DScene/hooks/useClampState.ts` | Clamp state |
| `src/components/3DScene/hooks/useLabelState.ts` | Label state |
| `src/components/3DScene/hooks/useHoleState.ts` | Hole state |
| `src/components/3DScene/hooks/useBaseplateState.ts` | Baseplate state |
| `src/components/3DScene/hooks/useSceneState.ts` | Scene state |
| `src/components/3DScene/hooks/useSceneReset.ts` | Reset & cleanup |
| `src/components/3DScene/hooks/useCavityOperations.ts` | Cavity CSG |
| `src/components/3DScene/hooks/useOffsetMeshPreview.ts` | Offset preview |

### Feature Modules

| Directory | Purpose |
|-----------|---------|
| `src/features/supports/` | Support placement logic |
| `src/features/clamps/` | Clamp placement logic |
| `src/features/holes/` | Mounting hole logic |
| `src/features/labels/` | Label system |
| `src/features/baseplate/` | Baseplate configuration |
| `src/features/export/` | Export functionality |

---

## 8. Appendix: Type Definitions

### Core Types

```typescript
// CavitySettings - packages/cad-core/src/offset/types.ts
interface CavitySettings {
  enabled: boolean;
  offsetDistance: number;      // Clearance (0 = exact fit)
  pixelsPerUnit: number;
  rotationXZ: number;
  rotationYZ: number;
  fillHoles: boolean;
  showPreview: boolean;
}

// BasePlateConfig - src/features/baseplate/types.ts
interface BasePlateConfig {
  type: 'single' | 'multi-section';
  dimensions: { width: number; height: number; depth: number };
  padding: number;
  sections?: BasePlateSection[];
}
```

### Selection Types

```typescript
// packages/cad-ui/src/stores/selectionStore.ts
interface SelectionState {
  selectedIds: {
    part: string | null;
    support: string | null;
    clamp: string | null;
    label: string | null;
    hole: string | null;
    baseplate: string | null;
  };
}
```

---

*End of Architecture Document*
