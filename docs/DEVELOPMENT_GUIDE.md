# Development Guide for AI Coding Agents

> **Purpose:** Instructions for AI agents developing new features, fixing bugs, and maintaining this codebase.
> 
> **Read First:** [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview.

---

## 1. Before You Start

### Mandatory Reading

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Understand the layer structure
2. **[COORDINATE_SYSTEM.md](./COORDINATE_SYSTEM.md)** - If working with 3D transforms

### Pre-Development Checklist

- [ ] Run `npm run build` to verify current state
- [ ] Identify which layer(s) your change affects
- [ ] Check if a hook already exists for your use case
- [ ] Review related files in the feature module

---

## 2. Adding New Features

### Step 1: Create Feature Module (if new domain)

```
src/features/{feature-name}/
├── components/           # UI components
│   └── FeaturePanel.tsx
├── hooks/                # Feature-specific hooks
│   └── useFeature.ts
├── utils/                # Helper functions
│   └── featureUtils.ts
├── types.ts              # TypeScript interfaces
└── index.ts              # Public API exports
```

### Step 2: Add State Management

**Option A: Local State (3DScene-only)**

Create a hook in `src/components/3DScene/hooks/`:

```typescript
// src/components/3DScene/hooks/useFeatureState.ts
export function useFeatureState(): UseFeatureStateReturn {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState({ active: false });
  
  return {
    items,
    setItems,
    selectedId,
    setSelectedId,
    placementMode,
    setPlacementMode,
  };
}
```

**Option B: Global State (cross-component)**

Add to existing store or create new store:

```typescript
// src/stores/featureStore.ts
export const useFeatureStore = create<FeatureState>()(
  immer((set) => ({
    items: [],
    addItem: (item) => set((state) => { state.items.push(item); }),
    removeItem: (id) => set((state) => { 
      state.items = state.items.filter(i => i.id !== id);
    }),
  }))
);
```

### Step 3: Add Event Handlers

Create handler hook in `src/components/3DScene/hooks/`:

```typescript
// src/components/3DScene/hooks/useFeatureHandlers.ts
export function useFeatureHandlers(params: UseFeatureHandlersParams) {
  const { items, setItems, onItemAdded } = params;
  
  useEffect(() => {
    const handleAdd = (e: CustomEvent) => {
      const newItem = e.detail;
      setItems(prev => [...prev, newItem]);
      onItemAdded?.(newItem);
    };
    
    window.addEventListener('feature-add', handleAdd);
    return () => window.removeEventListener('feature-add', handleAdd);
  }, [setItems, onItemAdded]);
}
```

### Step 4: Wire to 3DScene

```typescript
// In 3DScene.tsx
import { useFeatureState, useFeatureHandlers } from './3DScene/hooks';

const ThreeDScene = (props) => {
  // Add state hook
  const featureState = useFeatureState();
  
  // Wire handlers
  useFeatureHandlers({
    ...featureState,
    onItemAdded: props.onFeatureItemAdded,
  });
  
  // Add to render
  return (
    <>
      {/* existing components */}
      <FeatureRenderer items={featureState.items} />
    </>
  );
};
```

### Step 5: Export from Index

```typescript
// src/components/3DScene/hooks/index.ts
export { useFeatureState } from './useFeatureState';
export { useFeatureHandlers } from './useFeatureHandlers';
```

---

## 3. Modifying Existing Features

### State Changes

1. **Find the state hook** in `src/components/3DScene/hooks/`
2. **Add new state** with setter
3. **Update the return interface**
4. **Update handler hooks** if events need new data

### Adding New Events

1. **Define event in handler hook**
2. **Dispatch from UI** (AppShell or Panel)
3. **Handle in 3DScene** via handler hook

```typescript
// Dispatch from UI
window.dispatchEvent(new CustomEvent('feature-update', { 
  detail: { id, changes } 
}));

// Handle in hook
useEffect(() => {
  const handleUpdate = (e: CustomEvent) => {
    const { id, changes } = e.detail;
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, ...changes } : item
    ));
  };
  window.addEventListener('feature-update', handleUpdate);
  return () => window.removeEventListener('feature-update', handleUpdate);
}, [setItems]);
```

---

## 4. State Management with Zustand + Immer

### Overview

We use **Zustand** for global state with **Immer middleware** for immutable updates:

| Library | Purpose |
|---------|---------|
| `zustand` | Lightweight state management (no Provider, no boilerplate) |
| `zustand/middleware/immer` | Write mutable-looking code, get immutable updates |
| `devtools` | Redux DevTools integration for debugging |
| `subscribeWithSelector` | Subscribe to specific state slices |

### Creating a New Store

```typescript
// src/stores/myFeatureStore.ts
import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// 1. Define state interface
export interface MyFeatureState {
  items: Item[];
  selectedId: string | null;
  isProcessing: boolean;
}

// 2. Define actions interface
export interface MyFeatureActions {
  addItem: (item: Item) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, changes: Partial<Item>) => void;
  setSelectedId: (id: string | null) => void;
  reset: () => void;
}

// 3. Initial state (for reset)
const initialState: MyFeatureState = {
  items: [],
  selectedId: null,
  isProcessing: false,
};

// 4. Create store with all middlewares
export const useMyFeatureStore = create<MyFeatureState & MyFeatureActions>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        ...initialState,
        
        // With Immer, you can "mutate" directly
        addItem: (item) => set((state) => {
          state.items.push(item);
        }),
        
        removeItem: (id) => set((state) => {
          state.items = state.items.filter(i => i.id !== id);
        }),
        
        updateItem: (id, changes) => set((state) => {
          const item = state.items.find(i => i.id === id);
          if (item) {
            Object.assign(item, changes);
          }
        }),
        
        setSelectedId: (id) => set({ selectedId: id }),
        
        reset: () => set(initialState),
      }))
    ),
    { name: 'my-feature-store' }
  )
);
```

### Using Stores in Components

```typescript
// ✅ CORRECT: Select only what you need (prevents unnecessary rerenders)
const items = useMyFeatureStore(state => state.items);
const addItem = useMyFeatureStore(state => state.addItem);

// ✅ CORRECT: Multiple selectors
const { selectedId, setSelectedId } = useMyFeatureStore(
  state => ({ selectedId: state.selectedId, setSelectedId: state.setSelectedId })
);

// ❌ WRONG: Selecting entire store causes rerenders on ANY state change
const store = useMyFeatureStore();  // Don't do this!

// ✅ CORRECT: Outside React (event handlers, utilities)
const currentItems = useMyFeatureStore.getState().items;
useMyFeatureStore.getState().addItem(newItem);
```

### Subscribing to Store Changes

```typescript
// Subscribe to changes outside React
const unsubscribe = useMyFeatureStore.subscribe(
  (state) => state.items,
  (items, prevItems) => {
    console.log('Items changed:', items);
  }
);

// Cleanup
unsubscribe();
```

### When to Use Each State Type

| Use Case | State Type | Example |
|----------|------------|---------|
| **Persisted entities** | Zustand Store | Parts, supports, clamps, holes |
| **App-wide selection** | Zustand Store | `selectionStore` |
| **UI preferences** | Zustand Store | Theme, panel states |
| **Workflow state** | Zustand Store | Current step, mode |
| **3D scene transient state** | React useState | Drag preview, hover highlight |
| **Three.js object refs** | React useRef | Mesh refs, control refs |
| **Derived values** | Computed (no store) | Filtered lists, calculations |

### Existing Stores Reference

| Store | Location | Contents |
|-------|----------|----------|
| `fixtureStore` | `src/stores/` | Parts, supports, clamps, labels, holes, baseplate |
| `cavityStore` | `src/stores/` | Cavity settings, offset values, processing state |
| `placementStore` | `src/stores/` | Placement modes for supports, holes, baseplate |
| `processingStore` | `src/stores/` | File processing, mesh analysis state |
| `dialogStore` | `src/stores/` | Modal dialog open/close state |
| `selectionStore` | `cad-ui` | Selection by category { category, id } |
| `workflowStore` | `cad-ui` | Workflow step, accordion sync |
| `uiStore` | `cad-ui` | Theme, UI preferences |
| `historyStore` | `cad-ui` | Undo/redo stacks |
| `transformStore` | `cad-ui` | Active transform mode |

### Common Immer Patterns

```typescript
// Push to array
set((state) => { state.items.push(newItem); });

// Remove from array
set((state) => { state.items = state.items.filter(i => i.id !== id); });

// Update array item
set((state) => {
  const item = state.items.find(i => i.id === id);
  if (item) item.name = 'New Name';
});

// Update nested object
set((state) => {
  state.settings.display.showGrid = true;
});

// Replace entire array
set((state) => { state.items = newItems; });

// Spread doesn't work inside Immer - do direct assignment
set((state) => {
  // ❌ WRONG
  state.item = { ...state.item, name: 'New' };
  
  // ✅ CORRECT
  state.item.name = 'New';
});
```

---

## 5. Working with 3D Scene

### Adding 3D Objects

```typescript
// 1. Add state for the object
const [mesh, setMesh] = useState<THREE.Mesh | null>(null);

// 2. Create geometry/material
const geometry = new THREE.BoxGeometry(10, 10, 10);
const material = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });

// 3. Clean up on unmount or state change
useEffect(() => {
  return () => {
    mesh?.geometry?.dispose();
    if (mesh?.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  };
}, [mesh]);
```

### Transform Controls Pattern

```typescript
// ALWAYS use anti-jitter pattern
const isDraggingRef = useRef(false);
const startPosition = useRef<THREE.Vector3 | null>(null);

const handleDragStart = () => {
  isDraggingRef.current = true;
  startPosition.current = currentPosition.clone();
};

const handleDrag = (newPosition: THREE.Vector3) => {
  // Use startPosition for calculations, not live position
  if (!startPosition.current) return;
  // ... update logic
};

const handleDragEnd = () => {
  isDraggingRef.current = false;
  startPosition.current = null;
  // Reset pivot matrix
  pivotRef.current?.matrix.identity();
};
```

### Coordinate System

```typescript
// Three.js to CAD (for export/storage)
const cadPosition = {
  x: threePosition.x,
  y: threePosition.z,  // Swap Y and Z
  z: threePosition.y,
};

// CAD to Three.js (for rendering)
const threePosition = {
  x: cadPosition.x,
  y: cadPosition.z,  // Swap Y and Z
  z: cadPosition.y,
};
```

---

## 6. Code Style Guidelines

### Hook Naming

```typescript
// State hooks: use{Entity}State
useSupportState()
useClampState()

// Handler hooks: use{Entity}Handlers
useSupportHandlers()
useClampHandlers()

// Operation hooks: use{Operation}
useCavityOperations()
useOffsetMeshPreview()
```

### Type Definitions

```typescript
// Always define return type interface
export interface UseFeatureStateReturn {
  // State
  items: Item[];
  selectedId: string | null;
  
  // Setters
  setItems: React.Dispatch<React.SetStateAction<Item[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Refs (if needed)
  isDraggingRef: React.MutableRefObject<boolean>;
}

export function useFeatureState(): UseFeatureStateReturn {
  // ...
}
```

### Event Naming

```typescript
// Pattern: {entity}-{action}
'support-add'
'support-update'
'support-delete'
'clamp-placement-start'
'hole-csg-complete'
'viewer-reset'
'session-reset'
```

---

## 7. Common Patterns

### Selection Pattern

```typescript
// Using selection store
const [selectedId, setSelectedId] = useSelectedSupport();

// Clear selection
setSelectedId(null);

// Select item
setSelectedId(item.id);
```

### Placement Mode Pattern

```typescript
interface PlacementMode {
  active: boolean;
  config: Config | null;
}

const [placementMode, setPlacementMode] = useState<PlacementMode>({
  active: false,
  config: null,
});

// Start placement
setPlacementMode({ active: true, config: userConfig });

// End placement
setPlacementMode({ active: false, config: null });
```

### CSG Operation Pattern

```typescript
// 1. Show processing indicator
setIsProcessing(true);

// 2. Perform CSG in try/catch
try {
  const result = await performCSG(geometry1, geometry2);
  setResultGeometry(result);
} catch (error) {
  console.error('CSG failed:', error);
  // Handle error gracefully
} finally {
  setIsProcessing(false);
}
```

---

## 8. Testing Your Changes

### Build Verification

```bash
# Always run after changes
npm run build
```

### Manual Testing Checklist

- [ ] Feature works in happy path
- [ ] Reset clears all state (`viewer-reset` event)
- [ ] No console errors
- [ ] Memory is cleaned up (check Three.js objects)
- [ ] Selection/deselection works
- [ ] Undo/redo doesn't break (if applicable)

---

## 9. Common Mistakes to Avoid

### ❌ Direct State Mutation

```typescript
// WRONG - Immer state is frozen
state.items.push(newItem);

// CORRECT - Use setter
setItems(prev => [...prev, newItem]);
```

### ❌ Missing Cleanup

```typescript
// WRONG - Memory leak
useEffect(() => {
  const geometry = new THREE.BoxGeometry();
  // ... use geometry
}, []);

// CORRECT - Dispose on cleanup
useEffect(() => {
  const geometry = new THREE.BoxGeometry();
  return () => geometry.dispose();
}, []);
```

### ❌ Wrong Coordinate System

```typescript
// WRONG - Using Three.js Y as height
const height = position.y;

// CORRECT - Three.js Y is depth, Z is height
const height = position.z;  // For baseplate/supports
```

### ❌ Accessing Store Directly

```typescript
// WRONG - Bypasses reactivity
const id = useSelectionStore.getState().selectedIds.part;

// CORRECT - Use hook wrapper
const [selectedId] = useSelectedPart();
```

---

## 10. File Locations Quick Reference

| Need to... | Look in... |
|------------|------------|
| Add 3DScene state | `src/components/3DScene/hooks/use{Entity}State.ts` |
| Add event handlers | `src/components/3DScene/hooks/use{Entity}Handlers.ts` |
| Add global state | `src/stores/{entity}Store.ts` |
| Add hook wrapper | `src/hooks/use{Entity}.ts` |
| Add UI panel | `src/features/{feature}/components/` |
| Add feature logic | `src/features/{feature}/utils/` |
| Add CAD operations | `packages/cad-core/src/` |

---

## 11. Quick Commands

```bash
# Build
npm run build

# Dev server
npm run dev

# Lint
npm run lint

# Type check
npx tsc --noEmit
```

---

*End of Development Guide*
