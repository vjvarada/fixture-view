# Directive 04: Consolidate Event Constants

**Phase:** 2 - Consolidation  
**Risk Level:** 🟡 LOW-MEDIUM  
**Effort:** 🟡 MEDIUM (1 hour)  
**Dependencies:** Phase 1 completed

---

## Objective

Create a centralized event constants file to replace hardcoded event strings scattered throughout the codebase.

---

## Pre-Execution Checklist

- [ ] Phase 1 completed and tested
- [ ] Application builds successfully
- [ ] Git working directory is clean
- [ ] Created branch: `git checkout -b refactor/phase-2-consolidation`

---

## Problem Statement

Event names are hardcoded as strings throughout the codebase:

```typescript
// Scattered across many files
window.dispatchEvent(new CustomEvent('model-transform-updated', ...));
window.dispatchEvent(new CustomEvent('disable-orbit-controls', ...));
window.addEventListener('pivot-control-activated', ...);
```

This leads to:
- Typos causing silent failures
- No IDE autocomplete
- Difficult to track all event usage

---

## Actions

### Step 1: Create Event Constants File

Create `src/core/events.ts`:

```typescript
/**
 * Centralized Event Constants
 * 
 * All custom events used in the application should be defined here.
 * This provides type safety and prevents typos in event names.
 */

// ============================================================================
// Event Names
// ============================================================================

export const EVENTS = {
  // Transform Events
  MODEL_TRANSFORM_UPDATED: 'model-transform-updated',
  SET_MODEL_TRANSFORM: 'set-model-transform',
  CHECK_BASEPLATE_COLLISION: 'check-baseplate-collision',
  BASEPLATE_MOVED_MODEL: 'baseplate-moved-model',
  
  // Control Events
  DISABLE_ORBIT_CONTROLS: 'disable-orbit-controls',
  PIVOT_CONTROL_ACTIVATED: 'pivot-control-activated',
  MESH_DOUBLE_CLICK: 'mesh-double-click',
  
  // Session Events
  SESSION_RESET: 'session-reset',
  
  // Baseplate Events
  BASEPLATE_SECTION_UPDATED: 'baseplate-section-updated',
  
  // CSG Events
  HOLE_CSG_COMPLETE: 'hole-csg-complete',
  CSG_OPERATION_START: 'csg-operation-start',
  CSG_OPERATION_END: 'csg-operation-end',
} as const;

// ============================================================================
// Event Payload Types
// ============================================================================

export interface ModelTransformPayload {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  partId?: string;
}

export interface SetModelTransformPayload {
  partId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  respectBaseplate?: boolean;
}

export interface DisableOrbitControlsPayload {
  disabled: boolean;
}

export interface PivotControlActivatedPayload {
  partId?: string;
  sectionId?: string;
  labelId?: string;
  supportId?: string;
}

export interface BaseplateSectionPayload {
  sectionId: string;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

// ============================================================================
// Type-Safe Event Dispatcher
// ============================================================================

export function dispatchCustomEvent<T>(eventName: string, payload: T): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
}

// ============================================================================
// Type-Safe Event Listener
// ============================================================================

export function addCustomEventListener<T>(
  eventName: string,
  handler: (payload: T) => void
): () => void {
  const wrappedHandler = (e: Event) => {
    handler((e as CustomEvent<T>).detail);
  };
  window.addEventListener(eventName, wrappedHandler);
  return () => window.removeEventListener(eventName, wrappedHandler);
}
```

### Step 2: Update Imports Incrementally

Do NOT replace all at once. Update one file at a time:

```typescript
// Before
window.dispatchEvent(new CustomEvent('model-transform-updated', { detail: data }));

// After
import { EVENTS, dispatchCustomEvent, ModelTransformPayload } from '@/core/events';
dispatchCustomEvent<ModelTransformPayload>(EVENTS.MODEL_TRANSFORM_UPDATED, data);
```

### Step 3: Migration Order

Update files in this order (lowest risk first):

1. `src/components/SelectableTransformControls.tsx`
2. `src/components/Supports/SupportTransformControls.tsx`
3. `src/components/Clamps/ClampTransformControls.tsx`
4. `src/components/MountingHoles/HoleTransformControls.tsx`
5. `src/components/Labels/LabelTransformControls.tsx`
6. `src/components/BasePlate/BasePlateTransformControls.tsx`
7. `src/components/3DScene.tsx`
8. `src/layout/AppShell.tsx`

**Test after each file update!**

---

## Validation

### After Each File

```powershell
npm run build
npm run dev
# Test the specific feature that was updated
```

### After All Files

Run the test script:
```bash
node docs/refactoring/execution/tests/02-test-events.js
```

---

## Search Commands for Verification

```powershell
# Find all remaining hardcoded event strings
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "'model-transform-updated'|'disable-orbit-controls'|'pivot-control-activated'" -Recurse

# Should only find the constants file after migration
```

---

## Success Criteria

- [ ] All event names use EVENTS constants
- [ ] No hardcoded event strings remain
- [ ] Build passes
- [ ] All transform controls work
- [ ] All events fire correctly

---

## Rollback

```powershell
# Revert to before the changes
git checkout -- src/
```

---

## Next Directive

After successful completion, proceed to: `05-consolidate-utilities.md`
