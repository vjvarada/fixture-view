# Directive 06: Extract Shared Hooks

**Phase:** 2 - Consolidation  
**Risk Level:** 🟡 MEDIUM  
**Effort:** 🟡 MEDIUM (1.5 hours)  
**Dependencies:** Directive 05 completed

---

## Objective

Extract common React hook patterns used across transform controls into reusable hooks.

---

## Pre-Execution Checklist

- [ ] Directive 05 completed successfully
- [ ] Application builds and runs correctly
- [ ] All transform operations tested

---

## Problem Statement

Transform controls share these patterns that could be hooks:

1. **Escape key handling** - `useEscapeDeselect`
2. **Click outside detection** - `useClickOutsideDeselect`
3. **Pivot conflict detection** - `usePivotConflictDeselect`
4. **Cursor management** - `useTransformCursor`
5. **Orbit control management** - `useOrbitControlLock`

---

## Actions

### Step 1: Create Hooks Directory

```powershell
New-Item -ItemType Directory -Force -Path "src/hooks/transform"
```

### Step 2: Create Deselection Hooks

Create `src/hooks/transform/useDeselection.ts`:

```typescript
/**
 * Deselection Hooks
 * 
 * Shared hooks for handling transform control deselection.
 */

import { useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';

// ============================================================================
// Escape Key Hook
// ============================================================================

/**
 * Calls onDeselect when Escape key is pressed.
 */
export function useEscapeDeselect(onDeselect: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDeselect();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeselect]);
}

// ============================================================================
// Click Outside Hooks
// ============================================================================

/** UI selectors that should trigger deselection */
const UI_CLICK_SELECTORS =
  'button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]';

/**
 * Deselects when clicking on specific UI elements outside canvas.
 * Used by: Supports, Clamps, Labels, Parts
 */
export function useUIClickDeselect(onDeselect: () => void): void {
  const { gl } = useThree();
  
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;

      // Ignore clicks on canvas (for camera controls)
      if (gl.domElement.contains(target) || gl.domElement === target) return;

      // Deselect only on specific UI element clicks
      if (target.closest(UI_CLICK_SELECTORS)) {
        onDeselect();
      }
    };

    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [gl.domElement, onDeselect]);
}

/**
 * Deselects when clicking anywhere outside canvas.
 * Used by: Holes, Baseplate sections
 */
export function useAnyClickOutsideDeselect(onDeselect: () => void): void {
  const { gl } = useThree();
  
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;

      // Allow clicks on canvas (for camera controls) - don't deselect
      if (gl.domElement.contains(target) || gl.domElement === target) return;

      // Any click outside canvas should deselect
      onDeselect();
    };

    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [gl.domElement, onDeselect]);
}

// ============================================================================
// Pivot Conflict Hook
// ============================================================================

interface PivotConflictOptions {
  /** Current entity ID (for comparison) */
  entityId?: string;
  /** Entity type for filtering */
  entityType: 'part' | 'support' | 'clamp' | 'hole' | 'label' | 'section';
}

/**
 * Deselects when another pivot control is activated.
 */
export function usePivotConflictDeselect(
  onDeselect: () => void,
  options: PivotConflictOptions
): void {
  const { entityId, entityType } = options;
  
  useEffect(() => {
    const handleOtherActivated = (e: Event): void => {
      const detail = (e as CustomEvent).detail;
      
      // Determine if this event is for a different entity
      let isDifferent = false;
      
      switch (entityType) {
        case 'part':
          isDifferent = detail?.partId && detail.partId !== entityId;
          break;
        case 'label':
          isDifferent = (detail?.labelId && detail.labelId !== entityId) || detail?.supportId;
          break;
        case 'section':
          isDifferent = detail?.partId || (detail?.sectionId && detail.sectionId !== entityId);
          break;
        default:
          isDifferent = detail?.partId !== undefined;
      }
      
      if (isDifferent) {
        onDeselect();
      }
    };

    window.addEventListener('pivot-control-activated', handleOtherActivated);
    return () => window.removeEventListener('pivot-control-activated', handleOtherActivated);
  }, [entityId, entityType, onDeselect]);
}
```

### Step 3: Create Transform State Hook

Create `src/hooks/transform/useTransformDrag.ts`:

```typescript
/**
 * Transform Drag State Hook
 * 
 * Manages drag state for transform controls, including the
 * anti-jitter pattern (drag start position lock).
 */

import { useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { setOrbitControlsEnabled, resetGroupTransform } from '@/core/utils/transform';

interface DragState<T> {
  isDragging: boolean;
  startPosition: THREE.Vector3 | null;
  startRotation: THREE.Euler | null;
  customData: T | null;
}

interface UseTransformDragOptions<T> {
  /** Called when drag starts */
  onDragStart?: () => void;
  /** Called when drag ends */
  onDragEnd?: () => void;
  /** Initial custom data factory */
  createCustomData?: () => T;
}

interface UseTransformDragReturn<T> {
  /** Is currently dragging */
  isDraggingRef: React.MutableRefObject<boolean>;
  /** Drag state ref */
  dragStateRef: React.MutableRefObject<DragState<T>>;
  /** Pivot ref to reset */
  pivotRef: React.MutableRefObject<THREE.Group | null>;
  /** Handle drag start */
  handleDragStart: (position: THREE.Vector3, rotation?: THREE.Euler) => void;
  /** Handle drag end */
  handleDragEnd: () => void;
  /** Get display position (locked during drag) */
  getDisplayPosition: (currentPosition: THREE.Vector3) => THREE.Vector3;
}

/**
 * Hook to manage transform drag state with anti-jitter pattern.
 */
export function useTransformDrag<T = undefined>(
  options: UseTransformDragOptions<T> = {}
): UseTransformDragReturn<T> {
  const { gl } = useThree();
  const { onDragStart, onDragEnd, createCustomData } = options;
  
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState<T>>({
    isDragging: false,
    startPosition: null,
    startRotation: null,
    customData: null,
  });
  const pivotRef = useRef<THREE.Group | null>(null);
  
  const handleDragStart = useCallback((position: THREE.Vector3, rotation?: THREE.Euler) => {
    isDraggingRef.current = true;
    dragStateRef.current = {
      isDragging: true,
      startPosition: position.clone(),
      startRotation: rotation?.clone() ?? null,
      customData: createCustomData?.() ?? null,
    };
    
    setOrbitControlsEnabled(false);
    gl.domElement.style.cursor = 'grabbing';
    onDragStart?.();
  }, [gl, onDragStart, createCustomData]);
  
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    dragStateRef.current = {
      isDragging: false,
      startPosition: null,
      startRotation: null,
      customData: null,
    };
    
    setOrbitControlsEnabled(true);
    gl.domElement.style.cursor = 'auto';
    
    // CRITICAL: Reset pivot to prevent accumulated transforms
    resetGroupTransform(pivotRef.current);
    
    onDragEnd?.();
  }, [gl, onDragEnd]);
  
  const getDisplayPosition = useCallback((currentPosition: THREE.Vector3): THREE.Vector3 => {
    // Anti-jitter: Use locked position during drag
    if (isDraggingRef.current && dragStateRef.current.startPosition) {
      return dragStateRef.current.startPosition;
    }
    return currentPosition;
  }, []);
  
  return {
    isDraggingRef,
    dragStateRef,
    pivotRef,
    handleDragStart,
    handleDragEnd,
    getDisplayPosition,
  };
}
```

### Step 4: Create Index Export

Create `src/hooks/transform/index.ts`:

```typescript
export * from './useDeselection';
export * from './useTransformDrag';
```

### Step 5: Update One Transform Control as Proof of Concept

Update `HoleTransformControls.tsx` to use the new hooks:

```typescript
// Before: ~100 lines of boilerplate
// After:
import { 
  useEscapeDeselect, 
  useAnyClickOutsideDeselect,
  useTransformDrag 
} from '@/hooks/transform';

const HoleTransformControls = ({ ... }) => {
  const { 
    isDraggingRef, 
    pivotRef, 
    handleDragStart, 
    handleDragEnd,
    getDisplayPosition 
  } = useTransformDrag();
  
  useEscapeDeselect(onDeselect);
  useAnyClickOutsideDeselect(onDeselect);
  
  // ... rest of component, now much cleaner
};
```

### Step 6: Migrate Remaining Transform Controls

After proof of concept works:
1. `BasePlateTransformControls.tsx`
2. `SupportTransformControls.tsx`
3. `ClampTransformControls.tsx`
4. `LabelTransformControls.tsx`
5. `SelectableTransformControls.tsx`

**Test after each migration!**

---

## Validation

```bash
node docs/refactoring/execution/tests/02-test-consolidation.js
```

### Manual Tests

For each migrated component:
- [ ] Transform gizmo appears on selection
- [ ] Dragging works without jitter
- [ ] Escape key closes gizmo
- [ ] Click outside closes gizmo
- [ ] Other gizmo activation closes this one
- [ ] Cursor changes during drag
- [ ] Camera doesn't move during drag

---

## Success Criteria

- [ ] All shared hooks created
- [ ] At least one transform control migrated
- [ ] Build passes
- [ ] All tests pass
- [ ] No behavior regression

---

## Phase 2 Complete Checkpoint

After completing Directive 06, run the full phase 2 test:

```bash
node docs/refactoring/execution/tests/phase-2-complete.js
```

Commit Phase 2:
```bash
git add -A
git commit -m "refactor(phase-2): consolidate events, utilities, and hooks"
git checkout main
git merge refactor/phase-2-consolidation
```

---

## Next Directive

After successful completion, proceed to: `07-create-feature-folders.md`
