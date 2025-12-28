# Directive 12: Create Transform Hooks

## Priority: HIGH
## Estimated Time: 2 hours
## Risk Level: 🔴 HIGH

---

## Objective

Create React hooks in `src/core/transform/hooks/` that wrap the TransformController for use with drei's PivotControls. These hooks will be shared by all feature transform components.

---

## Pre-Execution Checklist

- [ ] Directive 11 complete (core transform system exists)
- [ ] `src/core/transform/` has types.ts, TransformController.ts, presets.ts, utils.ts
- [ ] Build passes

---

## Context

### Hook Responsibilities

| Hook | Purpose |
|------|---------|
| `useDragState` | Manages drag start/end state, prevents feedback loops |
| `useGizmoPosition` | Calculates gizmo position per component type |
| `useTransformGizmo` | Main hook combining all logic for PivotControls |
| `useDeselection` | Handles click-outside deselection (already in hooks/transform/) |

---

## Actions

### Step 1: Create useDragState Hook (`src/core/transform/hooks/useDragState.ts`)

```typescript
import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { setOrbitControlsEnabled, resetPivotMatrix } from '../utils';

export interface DragState {
  isDragging: boolean;
  dragStartPosition: THREE.Vector3 | null;
}

export interface UseDragStateOptions {
  disableOrbitOnDrag?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export interface UseDragStateReturn {
  isDraggingRef: React.MutableRefObject<boolean>;
  dragStartPosRef: React.MutableRefObject<THREE.Vector3 | null>;
  handleDragStart: (currentPosition: THREE.Vector3) => void;
  handleDragEnd: (pivotRef: React.RefObject<THREE.Object3D>) => void;
  getDisplayPosition: (currentPosition: THREE.Vector3) => THREE.Vector3;
}

/**
 * Hook to manage drag state for transform controls.
 * 
 * CRITICAL: This implements the "drag start position lock" pattern
 * that prevents jittering during drag operations.
 * 
 * Pattern:
 * 1. On drag start: Lock the display position
 * 2. During drag: Use locked position for display (prevents feedback loop)
 * 3. On drag end: Reset pivot matrix to identity
 */
export function useDragState(options: UseDragStateOptions = {}): UseDragStateReturn {
  const { disableOrbitOnDrag = true, onDragStart, onDragEnd } = options;
  
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<THREE.Vector3 | null>(null);
  
  const handleDragStart = useCallback((currentPosition: THREE.Vector3) => {
    isDraggingRef.current = true;
    // LOCK the display position to prevent feedback loop
    dragStartPosRef.current = currentPosition.clone();
    
    if (disableOrbitOnDrag) {
      setOrbitControlsEnabled(false);
    }
    
    onDragStart?.();
  }, [disableOrbitOnDrag, onDragStart]);
  
  const handleDragEnd = useCallback((pivotRef: React.RefObject<THREE.Object3D>) => {
    isDraggingRef.current = false;
    dragStartPosRef.current = null;
    
    // CRITICAL: Reset pivot to identity after drag
    if (pivotRef.current) {
      resetPivotMatrix(pivotRef.current);
    }
    
    if (disableOrbitOnDrag) {
      setOrbitControlsEnabled(true);
    }
    
    onDragEnd?.();
  }, [disableOrbitOnDrag, onDragEnd]);
  
  const getDisplayPosition = useCallback((currentPosition: THREE.Vector3): THREE.Vector3 => {
    // During drag, use the LOCKED position for display
    if (isDraggingRef.current && dragStartPosRef.current) {
      return dragStartPosRef.current;
    }
    return currentPosition;
  }, []);
  
  return {
    isDraggingRef,
    dragStartPosRef,
    handleDragStart,
    handleDragEnd,
    getDisplayPosition,
  };
}
```

### Step 2: Create useGizmoPosition Hook (`src/core/transform/hooks/useGizmoPosition.ts`)

```typescript
import { useMemo } from 'react';
import * as THREE from 'three';
import type { TransformComponentType } from '../types';
import { calculateGizmoPosition, calculateGizmoScale } from '../utils';

export interface UseGizmoPositionOptions {
  componentType: TransformComponentType;
  data: Record<string, any>;
  customScale?: number | 'auto';
}

export interface UseGizmoPositionReturn {
  gizmoPosition: THREE.Vector3;
  gizmoScale: number;
}

/**
 * Hook to calculate gizmo position and scale based on component type.
 * 
 * Each component type has specific positioning logic:
 * - Support: At TOP of support mesh
 * - Clamp: At fixture point world position
 * - Hole: Above baseplate surface
 * - Label: Above label mesh
 * - Baseplate: Above ground at section center
 * - Part: At mesh world position
 */
export function useGizmoPosition(options: UseGizmoPositionOptions): UseGizmoPositionReturn {
  const { componentType, data, customScale } = options;
  
  const gizmoPosition = useMemo(() => {
    return calculateGizmoPosition(componentType, data);
  }, [componentType, data]);
  
  const gizmoScale = useMemo(() => {
    if (customScale !== undefined && customScale !== 'auto') {
      return customScale;
    }
    return calculateGizmoScale(componentType, data);
  }, [componentType, data, customScale]);
  
  return {
    gizmoPosition,
    gizmoScale,
  };
}
```

### Step 3: Create useTransformGizmo Hook (`src/core/transform/hooks/useTransformGizmo.ts`)

```typescript
import { useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { TransformConfig, TransformDelta, TransformOutput, TransformCallbacks } from '../types';
import { TransformController } from '../TransformController';
import { useDragState } from './useDragState';
import { useGizmoPosition } from './useGizmoPosition';
import { dispatchTransformUpdate } from '../utils';

export interface UseTransformGizmoOptions extends TransformCallbacks {
  config: TransformConfig;
  /** Data for gizmo positioning (component-specific) */
  componentData: Record<string, any>;
  /** Current position in world space */
  currentPosition: THREE.Vector3;
  /** Current rotation */
  currentRotation?: THREE.Euler;
  /** Unique ID for this component instance */
  instanceId?: string;
  /** Whether the gizmo is currently active/visible */
  isActive?: boolean;
}

export interface UseTransformGizmoReturn {
  // Refs
  pivotRef: React.RefObject<THREE.Group>;
  anchorRef: React.RefObject<THREE.Mesh>;
  controllerRef: React.RefObject<TransformController>;
  
  // State
  isDragging: boolean;
  
  // Gizmo config
  gizmoPosition: THREE.Vector3;
  gizmoScale: number;
  activeAxes: [boolean, boolean, boolean];
  disableRotations: boolean;
  disableScaling: boolean;
  
  // Handlers
  handleDrag: () => void;
  handleDragStart: () => void;
  handleDragEnd: () => void;
  
  // Display
  displayPosition: THREE.Vector3;
}

/**
 * Main hook for transform gizmo functionality.
 * 
 * This hook:
 * 1. Creates and manages a TransformController
 * 2. Handles drag state with feedback loop prevention
 * 3. Calculates gizmo position/scale per component type
 * 4. Applies constraints during drag
 * 5. Dispatches transform events
 */
export function useTransformGizmo(options: UseTransformGizmoOptions): UseTransformGizmoReturn {
  const {
    config,
    componentData,
    currentPosition,
    currentRotation,
    instanceId,
    isActive = true,
    onTransformStart,
    onTransformChange,
    onTransformEnd,
    onActivate,
    onDeactivate,
  } = options;
  
  // Refs
  const pivotRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Mesh>(null);
  const controllerRef = useRef<TransformController | null>(null);
  
  // Initialize controller
  useEffect(() => {
    controllerRef.current = new TransformController(config);
    return () => {
      controllerRef.current = null;
    };
  }, [config]);
  
  // Drag state management
  const {
    isDraggingRef,
    handleDragStart: onDragStart,
    handleDragEnd: onDragEnd,
    getDisplayPosition,
  } = useDragState({
    disableOrbitOnDrag: config.disableOrbitOnDrag,
    onDragStart: onTransformStart,
    onDragEnd: () => {
      // Dispatch global transform event
      if (instanceId) {
        dispatchTransformUpdate(config.componentType, instanceId);
      }
    },
  });
  
  // Gizmo positioning
  const { gizmoPosition, gizmoScale } = useGizmoPosition({
    componentType: config.componentType,
    data: componentData,
    customScale: config.gizmoScale,
  });
  
  // Calculate active axes from config
  const activeAxes = useMemo((): [boolean, boolean, boolean] => {
    return controllerRef.current?.getActiveAxes() ?? [true, true, true];
  }, [config]);
  
  const disableRotations = useMemo(() => {
    return !(controllerRef.current?.hasRotation() ?? false);
  }, [config]);
  
  const disableScaling = useMemo(() => {
    return !(controllerRef.current?.hasScale() ?? false);
  }, [config]);
  
  // Drag handlers
  const handleDragStart = useCallback(() => {
    onDragStart(currentPosition);
    onActivate?.();
  }, [currentPosition, onDragStart, onActivate]);
  
  const handleDragEnd = useCallback(() => {
    if (!anchorRef.current || !controllerRef.current) return;
    
    // Get final transform from anchor
    const anchor = anchorRef.current;
    const finalDelta: TransformDelta = {
      position: anchor.position.clone(),
      rotation: anchor.rotation.clone(),
      scale: anchor.scale.clone(),
    };
    
    // Apply constraints
    const constrained = controllerRef.current.applyConstraints(finalDelta);
    
    // Create output
    const output: TransformOutput = {
      position: constrained.position,
      rotation: constrained.rotation,
      scale: constrained.scale,
    };
    
    // Add component-specific fields
    if (config.componentType === 'support' || config.componentType === 'clamp' || config.componentType === 'label') {
      output.rotationY = controllerRef.current.extractYRotation(constrained.rotation);
    }
    
    onTransformEnd?.(output);
    onDragEnd(pivotRef);
    onDeactivate?.();
  }, [config.componentType, onTransformEnd, onDragEnd, onDeactivate]);
  
  const handleDrag = useCallback(() => {
    if (!anchorRef.current || !controllerRef.current) return;
    
    // Get current transform from anchor
    const anchor = anchorRef.current;
    const delta: TransformDelta = {
      position: anchor.position.clone(),
      rotation: anchor.rotation.clone(),
      scale: anchor.scale.clone(),
    };
    
    // Apply constraints
    const constrained = controllerRef.current.applyConstraints(delta);
    
    // Create output
    const output: TransformOutput = {
      position: constrained.position,
      rotation: constrained.rotation,
      scale: constrained.scale,
    };
    
    onTransformChange?.(output);
  }, [onTransformChange]);
  
  // Display position (locked during drag)
  const displayPosition = useMemo(() => {
    return getDisplayPosition(currentPosition);
  }, [currentPosition, getDisplayPosition]);
  
  return {
    pivotRef,
    anchorRef,
    controllerRef,
    isDragging: isDraggingRef.current,
    gizmoPosition,
    gizmoScale,
    activeAxes,
    disableRotations,
    disableScaling,
    handleDrag,
    handleDragStart,
    handleDragEnd,
    displayPosition,
  };
}
```

### Step 4: Create Hooks Index (`src/core/transform/hooks/index.ts`)

```typescript
export { useDragState } from './useDragState';
export type { UseDragStateOptions, UseDragStateReturn, DragState } from './useDragState';

export { useGizmoPosition } from './useGizmoPosition';
export type { UseGizmoPositionOptions, UseGizmoPositionReturn } from './useGizmoPosition';

export { useTransformGizmo } from './useTransformGizmo';
export type { UseTransformGizmoOptions, UseTransformGizmoReturn } from './useTransformGizmo';
```

### Step 5: Update Transform Index (`src/core/transform/index.ts`)

Add hooks export:

```typescript
// Add to existing exports
export * from './hooks';
```

---

## Validation

### Build Check
```powershell
npm run build
```

### Type Check
```powershell
npx tsc --noEmit
```

### Integration Test
Test hook usage in a component:

```typescript
import { useTransformGizmo, SUPPORT_TRANSFORM_CONFIG } from '@/core/transform';

// In a component:
const {
  pivotRef,
  anchorRef,
  gizmoPosition,
  gizmoScale,
  activeAxes,
  handleDrag,
  handleDragStart,
  handleDragEnd,
} = useTransformGizmo({
  config: SUPPORT_TRANSFORM_CONFIG,
  componentData: { center: { x: 0, y: 0 }, height: 20, radius: 5 },
  currentPosition: new THREE.Vector3(0, 0, 0),
});
```

---

## Post-Execution Checklist

- [ ] All hooks created in `src/core/transform/hooks/`
- [ ] Hooks exported from index.ts
- [ ] Build passes
- [ ] No TypeScript errors
- [ ] Hooks can be imported from `@/core/transform`

---

## Next Directive

After this directive completes, proceed to `13-migrate-transform-controls.md` to migrate all feature transform controls to use the new hooks.

---

## Rollback

```powershell
Remove-Item -Recurse -Force "src/core/transform/hooks"
# Restore transform index
git checkout -- src/core/transform/index.ts
```
