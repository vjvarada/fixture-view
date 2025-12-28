# Directive 05: Consolidate Utility Functions

**Phase:** 2 - Consolidation  
**Risk Level:** 🟡 LOW-MEDIUM  
**Effort:** 🟡 MEDIUM (1 hour)  
**Dependencies:** Directive 04 completed

---

## Objective

Identify and consolidate duplicate utility functions into a single source of truth.

---

## Pre-Execution Checklist

- [ ] Directive 04 completed successfully
- [ ] Application builds and runs correctly
- [ ] On branch: `refactor/phase-2-consolidation`

---

## Problem Statement

Several utility patterns are duplicated across files:

1. **Coordinate transforms** - `toCadPosition`, `toCadRotation` in multiple files
2. **Safe number parsing** - `safeNum()` duplicated in transform controls
3. **Orbit control toggling** - `setOrbitControlsEnabled()` duplicated
4. **Pivot reset** - `resetPivotTransform()` / `resetGroupTransform()` duplicated
5. **Reusable THREE objects** - `tempPosition`, `tempQuaternion`, etc.

---

## Actions

### Step 1: Audit Duplicate Functions

```powershell
# Find safeNum duplicates
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "function safeNum|const safeNum" -Recurse

# Find setOrbitControlsEnabled duplicates
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "setOrbitControlsEnabled" -Recurse

# Find toCadPosition usage
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "toCadPosition|toCadRotation" -Recurse
```

### Step 2: Create Consolidated Utilities

Create or update `src/core/utils/transform.ts`:

```typescript
/**
 * Transform Utilities
 * 
 * Shared utilities for transform operations.
 * ⚠️ CRITICAL: Do not modify coordinate conversion functions without
 * reading docs/refactoring/09_CRITICAL_SYSTEMS.md
 */

import * as THREE from 'three';
import { EVENTS, dispatchCustomEvent, DisableOrbitControlsPayload } from '../events';

// ============================================================================
// Reusable THREE Objects (avoid allocations in render loop)
// ============================================================================

export const tempPosition = new THREE.Vector3();
export const tempQuaternion = new THREE.Quaternion();
export const tempEuler = new THREE.Euler();
export const tempBox = new THREE.Box3();
export const tempCenter = new THREE.Vector3();
export const tempSize = new THREE.Vector3();

// ============================================================================
// Safe Number Parsing
// ============================================================================

/**
 * Safely parses a number with a fallback default.
 */
export function safeNum(value: number | undefined | null, defaultValue: number): number {
  const num = Number(value);
  return Number.isNaN(num) ? defaultValue : num;
}

// ============================================================================
// Orbit Control Management
// ============================================================================

/**
 * Dispatches event to enable/disable orbit controls.
 * Use during drag operations to prevent camera movement.
 */
export function setOrbitControlsEnabled(enabled: boolean): void {
  dispatchCustomEvent<DisableOrbitControlsPayload>(
    EVENTS.DISABLE_ORBIT_CONTROLS, 
    { disabled: !enabled }
  );
}

// ============================================================================
// Pivot/Group Reset
// ============================================================================

/**
 * Resets a THREE.js group's transform to identity.
 * CRITICAL: Must be called after drag ends to prevent accumulated transforms.
 */
export function resetGroupTransform(group: THREE.Group | null): void {
  if (!group) return;
  group.matrix.identity();
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  group.updateMatrix();
}

// ============================================================================
// World Transform Extraction
// ============================================================================

/**
 * Extracts world position and rotation from a mesh.
 * Uses YXZ Euler order for clean Y-axis rotation extraction.
 */
export function getWorldTransform(mesh: THREE.Object3D): {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  quaternion: THREE.Quaternion;
} {
  mesh.updateMatrixWorld(true);
  mesh.getWorldPosition(tempPosition);
  mesh.getWorldQuaternion(tempQuaternion);
  tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
  
  return {
    position: tempPosition.clone(),
    rotation: tempEuler.clone(),
    quaternion: tempQuaternion.clone(),
  };
}

// ============================================================================
// Coordinate System Conversion
// ============================================================================

// ⚠️ CRITICAL: These functions handle CAD Z-up ↔ Three.js Y-up conversion
// See docs/COORDINATE_SYSTEM.md and docs/refactoring/09_CRITICAL_SYSTEMS.md

/**
 * Converts Three.js position to CAD coordinates.
 * Three.js Y-up → CAD Z-up (swaps Y and Z)
 */
export function toCadPosition(threePos: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: threePos.x,
    y: threePos.z,  // Three.js Z → CAD Y
    z: threePos.y,  // Three.js Y → CAD Z
  };
}

/**
 * Converts Three.js rotation to CAD rotation.
 * Handles axis swap for coordinate system conversion.
 */
export function toCadRotation(threeRot: THREE.Euler): { x: number; y: number; z: number } {
  return {
    x: THREE.MathUtils.radToDeg(threeRot.x),
    y: THREE.MathUtils.radToDeg(threeRot.z),  // Three.js Z rot → CAD Y rot
    z: THREE.MathUtils.radToDeg(threeRot.y),  // Three.js Y rot → CAD Z rot
  };
}

/**
 * Converts CAD coordinates to Three.js position.
 * CAD Z-up → Three.js Y-up (swaps Y and Z)
 */
export function fromCadPosition(cadPos: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(
    cadPos.x,
    cadPos.z,  // CAD Z → Three.js Y
    cadPos.y   // CAD Y → Three.js Z
  );
}

/**
 * Maps axis name between coordinate systems.
 */
export function cadToThreeAxis(cadAxis: 'x' | 'y' | 'z'): 'x' | 'y' | 'z' {
  switch (cadAxis) {
    case 'x': return 'x';
    case 'y': return 'z';  // CAD Y → Three.js Z
    case 'z': return 'y';  // CAD Z → Three.js Y
  }
}
```

### Step 3: Update Imports

For each file using these utilities:

```typescript
// Before (duplicate definition)
const tempPosition = new THREE.Vector3();
function safeNum(value, defaultValue) { ... }

// After (import from core)
import { tempPosition, safeNum, setOrbitControlsEnabled } from '@/core/utils/transform';
```

### Step 4: Migration Order

1. Create the utility file
2. Update `HoleTransformControls.tsx` (uses most utilities)
3. Update `BasePlateTransformControls.tsx`
4. Update `SupportTransformControls.tsx`
5. Update `ClampTransformControls.tsx`
6. Update `LabelTransformControls.tsx`
7. Update `SelectableTransformControls.tsx`
8. Update `src/lib/transformUtils.ts` (consolidate with new file)

**Test after each file!**

---

## ⚠️ Critical Warning

DO NOT modify the coordinate conversion logic (`toCadPosition`, `toCadRotation`, etc.) without:
1. Reading `docs/COORDINATE_SYSTEM.md`
2. Reading `docs/refactoring/09_CRITICAL_SYSTEMS.md`
3. Testing all transform operations manually

---

## Validation

```bash
node docs/refactoring/execution/tests/02-test-consolidation.js
```

### Manual Tests

After each file update:
- [ ] The specific component's transform controls work
- [ ] Position values are correct in UI
- [ ] No coordinate swapping issues

---

## Success Criteria

- [ ] No duplicate utility function definitions
- [ ] All imports from centralized location
- [ ] Build passes
- [ ] All transform operations work identically to before

---

## Next Directive

After successful completion, proceed to: `06-extract-shared-hooks.md`
