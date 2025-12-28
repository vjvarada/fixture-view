# Feature Module Template

## Overview

This template defines the standard structure for feature modules in the fixture-view application.

---

## Directory Structure

```
src/features/{feature-name}/
├── index.ts                    # Public exports
├── types.ts                    # TypeScript interfaces
├── constants.ts                # Feature constants
├── components/
│   ├── index.ts               # Component exports
│   ├── {Feature}Renderer.tsx  # 3D rendering component
│   ├── {Feature}Panel.tsx     # UI panel component
│   ├── {Feature}Item.tsx      # Individual item component
│   └── {Feature}Controls.tsx  # Transform/interaction controls
├── hooks/
│   ├── index.ts               # Hook exports
│   ├── use{Feature}.ts        # Main feature hook
│   ├── use{Feature}State.ts   # State management
│   └── use{Feature}Actions.ts # Action handlers
├── utils/
│   ├── index.ts               # Utility exports
│   ├── geometry.ts            # Geometry helpers
│   └── validation.ts          # Validation helpers
└── services/
    ├── index.ts               # Service exports
    └── {feature}Service.ts    # Business logic
```

---

## File Templates

### index.ts (Feature Root)

```typescript
// Public API for the feature
export * from './types';
export * from './constants';

// Components
export { default as {Feature}Renderer } from './components/{Feature}Renderer';
export { default as {Feature}Panel } from './components/{Feature}Panel';

// Hooks
export { use{Feature} } from './hooks/use{Feature}';
export { use{Feature}State } from './hooks/use{Feature}State';

// Services
export { {Feature}Service } from './services/{feature}Service';
```

### types.ts

```typescript
import * as THREE from 'three';

/**
 * Configuration for a single {feature} entity
 */
export interface {Feature}Config {
  id: string;
  // ... feature-specific properties
}

/**
 * State of a placed {feature}
 */
export interface Placed{Feature} extends {Feature}Config {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  mesh?: THREE.Mesh;
}

/**
 * Actions available for {feature} management
 */
export interface {Feature}Actions {
  add: (config: {Feature}Config) => string;
  remove: (id: string) => void;
  update: (id: string, updates: Partial<{Feature}Config>) => void;
  select: (id: string | null) => void;
}

/**
 * State of the {feature} system
 */
export interface {Feature}State {
  items: Map<string, Placed{Feature}>;
  selectedId: string | null;
  isPlacing: boolean;
}
```

### constants.ts

```typescript
/**
 * Default configuration for new {feature} instances
 */
export const DEFAULT_{FEATURE}_CONFIG: Partial<{Feature}Config> = {
  // ... defaults
};

/**
 * Transform configuration for {feature} entities
 */
export const {FEATURE}_TRANSFORM_CONFIG = {
  constraints: {
    position: {
      // ... position constraints
    },
    rotation: {
      // ... rotation constraints
    },
    scale: {
      enabled: false
    }
  },
  pivotMode: 'center' as const,
  activationMode: 'double-click' as const,
  deactivationMode: 'escape' as const
};
```

### components/{Feature}Renderer.tsx

```typescript
import React, { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { use{Feature}State } from '../hooks/use{Feature}State';
import { Placed{Feature} } from '../types';
import {Feature}Item from './{Feature}Item';

interface {Feature}RendererProps {
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
}

/**
 * Renders all {feature} entities in the 3D scene
 */
const {Feature}Renderer: React.FC<{Feature}RendererProps> = ({
  onSelect,
  selectedId
}) => {
  const { items } = use{Feature}State();
  
  const itemsArray = useMemo(
    () => Array.from(items.values()),
    [items]
  );
  
  return (
    <group name="{feature}-container">
      {itemsArray.map((item) => (
        <{Feature}Item
          key={item.id}
          item={item}
          isSelected={item.id === selectedId}
          onSelect={() => onSelect?.(item.id)}
        />
      ))}
    </group>
  );
};

export default {Feature}Renderer;
```

### components/{Feature}Item.tsx

```typescript
import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { PivotGizmo } from '@rapidtool/cad-ui';
import { {FEATURE}_TRANSFORM_CONFIG } from '../constants';
import { Placed{Feature} } from '../types';

interface {Feature}ItemProps {
  item: Placed{Feature};
  isSelected: boolean;
  onSelect: () => void;
  onTransformChange?: (transform: TransformData) => void;
  onTransformEnd?: (transform: TransformData) => void;
}

/**
 * Renders a single {feature} with optional transform controls
 */
const {Feature}Item: React.FC<{Feature}ItemProps> = ({
  item,
  isSelected,
  onSelect,
  onTransformChange,
  onTransformEnd
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Generate geometry
  const geometry = useMemo(() => {
    // Create feature geometry based on item config
    return new THREE.BoxGeometry(10, 10, 10);
  }, [item]);
  
  // Generate material
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: isSelected ? '#ff6600' : '#666666',
      metalness: 0.2,
      roughness: 0.7
    });
  }, [isSelected]);
  
  return (
    <PivotGizmo
      meshRef={meshRef}
      config={{FEATURE}_TRANSFORM_CONFIG}
      enabled={isSelected}
      onTransformChange={onTransformChange}
      onTransformEnd={onTransformEnd}
    >
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        position={item.position}
        rotation={item.rotation}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        castShadow
        receiveShadow
      />
    </PivotGizmo>
  );
};

export default {Feature}Item;
```

### hooks/use{Feature}State.ts

```typescript
import { create } from 'zustand';
import { {Feature}State, Placed{Feature} } from '../types';

interface {Feature}Store extends {Feature}State {
  // Actions
  add: (item: Placed{Feature}) => void;
  remove: (id: string) => void;
  update: (id: string, updates: Partial<Placed{Feature}>) => void;
  select: (id: string | null) => void;
  setPlacing: (isPlacing: boolean) => void;
  reset: () => void;
}

const initialState: {Feature}State = {
  items: new Map(),
  selectedId: null,
  isPlacing: false
};

export const use{Feature}State = create<{Feature}Store>((set) => ({
  ...initialState,
  
  add: (item) => set((state) => {
    const newItems = new Map(state.items);
    newItems.set(item.id, item);
    return { items: newItems };
  }),
  
  remove: (id) => set((state) => {
    const newItems = new Map(state.items);
    newItems.delete(id);
    return { 
      items: newItems,
      selectedId: state.selectedId === id ? null : state.selectedId
    };
  }),
  
  update: (id, updates) => set((state) => {
    const existing = state.items.get(id);
    if (!existing) return state;
    
    const newItems = new Map(state.items);
    newItems.set(id, { ...existing, ...updates });
    return { items: newItems };
  }),
  
  select: (id) => set({ selectedId: id }),
  
  setPlacing: (isPlacing) => set({ isPlacing }),
  
  reset: () => set(initialState)
}));
```

### hooks/use{Feature}.ts

```typescript
import { useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import * as THREE from 'three';
import { use{Feature}State } from './use{Feature}State';
import { {Feature}Config, Placed{Feature} } from '../types';
import { DEFAULT_{FEATURE}_CONFIG } from '../constants';

/**
 * Main hook for {feature} management
 */
export function use{Feature}() {
  const store = use{Feature}State();
  
  const add = useCallback((config: Partial<{Feature}Config> = {}) => {
    const id = uuid();
    const item: Placed{Feature} = {
      id,
      ...DEFAULT_{FEATURE}_CONFIG,
      ...config,
      position: new THREE.Vector3(),
      rotation: new THREE.Euler()
    };
    
    store.add(item);
    return id;
  }, [store]);
  
  const updateTransform = useCallback((
    id: string, 
    position: THREE.Vector3, 
    rotation?: THREE.Euler
  ) => {
    store.update(id, { position, ...(rotation && { rotation }) });
  }, [store]);
  
  const remove = useCallback((id: string) => {
    store.remove(id);
  }, [store]);
  
  const select = useCallback((id: string | null) => {
    store.select(id);
  }, [store]);
  
  return {
    // State
    items: store.items,
    selectedId: store.selectedId,
    isPlacing: store.isPlacing,
    
    // Actions
    add,
    remove,
    select,
    updateTransform,
    setPlacing: store.setPlacing,
    reset: store.reset
  };
}
```

---

## Usage Example

```typescript
// In SceneComposer.tsx
import { SupportsRenderer } from '@/features/supports';
import { ClampsRenderer } from '@/features/clamps';
import { HolesRenderer } from '@/features/holes';
import { LabelsRenderer } from '@/features/labels';

const SceneComposer: React.FC = () => {
  return (
    <>
      <SupportsRenderer />
      <ClampsRenderer />
      <HolesRenderer />
      <LabelsRenderer />
    </>
  );
};
```

```typescript
// In step component
import { useSupports } from '@/features/supports';

const SupportsStep: React.FC = () => {
  const { items, add, remove, select, selectedId } = useSupports();
  
  return (
    <div>
      <button onClick={() => add({ type: 'cylindrical' })}>
        Add Support
      </button>
      
      {Array.from(items.values()).map(item => (
        <div key={item.id}>
          {item.id}
          <button onClick={() => remove(item.id)}>Remove</button>
        </div>
      ))}
    </div>
  );
};
```

---

## Migration Checklist

When creating a new feature module:

- [ ] Create directory structure
- [ ] Define types in `types.ts`
- [ ] Define constants in `constants.ts`
- [ ] Implement state hook (`use{Feature}State.ts`)
- [ ] Implement main hook (`use{Feature}.ts`)
- [ ] Create renderer component
- [ ] Create item component with transform support
- [ ] Create panel component for UI
- [ ] Export from `index.ts`
- [ ] Update scene composer to include renderer
- [ ] Update workflow step to use feature
- [ ] Test all functionality
- [ ] Delete old component files
