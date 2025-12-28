# Directive 13: Migrate Transform Controls

## Priority: HIGH
## Estimated Time: 3 hours
## Risk Level: 🔴 HIGH

---

## Objective

Migrate all feature transform controls to use the unified transform system from `@/core/transform`. This is the high-risk phase where we replace working code with the new abstraction.

---

## Pre-Execution Checklist

- [ ] Directive 11 complete (transform core)
- [ ] Directive 12 complete (transform hooks)
- [ ] Build passes
- [ ] Manual test: All transform controls currently work

---

## ⚠️ CRITICAL WARNINGS

### Before You Start

1. **READ `docs/refactoring/09_CRITICAL_SYSTEMS.md`** - Sections 1-2 completely
2. **Each migration must be tested manually** before moving to next
3. **If ANY feature breaks, STOP and rollback**

### Component-Specific Behaviors to Preserve

| Component | Output Format | Special Logic |
|-----------|---------------|---------------|
| Support | `(center, rotationY, height)` | Height from Y delta |
| Clamp | `({x,y,z}, {x,y,z})` | Rotation in DEGREES |
| Hole | `(position: {x, y})` | `y = worldZ` |
| Label | `(Vector3, Euler, depth)` | Y → depth |
| Baseplate | `({minX, maxX, minZ, maxZ})` | Bounds recalc |
| Part | `(position, rotation)` | Transform baking |

---

## Migration Strategy

### Order of Migration (Safest to Riskiest)

1. **HoleTransformControls** - Simplest (XZ only, no rotation)
2. **BasePlateTransformControls** - Simple (XZ only, no rotation)
3. **SupportTransformControls** - Medium (Y rotation, height)
4. **LabelTransformControls** - Medium (Y rotation, depth)
5. **ClampTransformControls** - Complex (rotation output in degrees)
6. **SelectableTransformControls** - Most complex (full transform, baking)

### Approach: Parallel Implementation

Instead of replacing, we'll:
1. Create new `*TransformControlsV2.tsx` using hooks
2. Test V2 works identically to V1
3. Replace V1 with V2 in parent components
4. Delete V1

---

## Actions

### Step 1: Migrate HoleTransformControls

**Location:** `src/features/holes/components/HoleTransformControls.tsx`

#### 1.1 Create V2 Version

Create `src/features/holes/components/HoleTransformControlsV2.tsx`:

```typescript
import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { 
  useTransformGizmo, 
  HOLE_TRANSFORM_CONFIG,
  TransformOutput 
} from '@/core/transform';
import { useDeselection } from '@/hooks/transform';
import type { PlacedHole } from '../types';

interface HoleTransformControlsV2Props {
  hole: PlacedHole;
  baseplateHeight: number;
  onTransformChange: (position: { x: number; y: number }) => void;
  onDeselect: () => void;
  enabled?: boolean;
}

export const HoleTransformControlsV2: React.FC<HoleTransformControlsV2Props> = ({
  hole,
  baseplateHeight,
  onTransformChange,
  onDeselect,
  enabled = true,
}) => {
  const baseTopY = baseplateHeight;
  
  // Current position in world space
  const currentPosition = useMemo(() => 
    new THREE.Vector3(hole.position.x, baseTopY, hole.position.y),
    [hole.position.x, hole.position.y, baseTopY]
  );
  
  // Handle transform output
  const handleTransformChange = useCallback((output: TransformOutput) => {
    // Holes use (x, y) where y = worldZ
    onTransformChange({
      x: currentPosition.x + output.position.x,
      y: currentPosition.z + output.position.z, // worldZ → output.y
    });
  }, [currentPosition, onTransformChange]);
  
  // Use unified transform gizmo
  const {
    pivotRef,
    anchorRef,
    gizmoPosition,
    gizmoScale,
    activeAxes,
    handleDrag,
    handleDragStart,
    handleDragEnd,
    displayPosition,
  } = useTransformGizmo({
    config: HOLE_TRANSFORM_CONFIG,
    componentData: { 
      x: hole.position.x, 
      z: hole.position.y,
      baseTopY,
      diameter: hole.diameter,
    },
    currentPosition,
    instanceId: hole.id,
    onTransformChange: handleTransformChange,
  });
  
  // Handle deselection (click outside)
  useDeselection({
    enabled,
    deactivationMode: 'click-outside',
    onDeselect,
  });
  
  if (!enabled) return null;
  
  return (
    <group position={gizmoPosition}>
      <PivotControls
        ref={pivotRef}
        scale={gizmoScale}
        activeAxes={activeAxes}
        disableRotations={true}
        disableScaling={true}
        onDrag={handleDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        depthTest={false}
      >
        <mesh ref={anchorRef} visible={false}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
        </mesh>
      </PivotControls>
      
      {/* Position label */}
      <Html position={[0, 15, 0]} center>
        <div className="bg-background/80 px-2 py-1 rounded text-xs whitespace-nowrap">
          X: {displayPosition.x.toFixed(1)} Z: {displayPosition.z.toFixed(1)}
        </div>
      </Html>
    </group>
  );
};
```

#### 1.2 Test V2

1. Temporarily import V2 in `HolePlacement.tsx`
2. Test:
   - [ ] Gizmo appears at correct position
   - [ ] XZ movement works (not Y)
   - [ ] Position updates in UI
   - [ ] Click outside deselects
   - [ ] No jittering

#### 1.3 Replace V1 with V2

Once tested, rename V2 to replace V1:
```powershell
Remove-Item "src/features/holes/components/HoleTransformControls.tsx"
Rename-Item "src/features/holes/components/HoleTransformControlsV2.tsx" "HoleTransformControls.tsx"
```

---

### Step 2: Migrate BasePlateTransformControls

**Location:** `src/features/baseplate/components/BasePlateTransformControls.tsx`

Similar pattern - create V2, test, replace.

Key differences:
- Output is bounds `{minX, maxX, minZ, maxZ}`
- Section size must be preserved during move
- Uses click-outside deselection

---

### Step 3: Migrate SupportTransformControls

**Location:** `src/features/supports/components/SupportTransformControls.tsx`

Key differences:
- Y rotation allowed (use `extractYRotation`)
- Height adjustment from Y delta
- Output: `(center, rotationY, height)`
- Uses UI-click deselection

---

### Step 4: Migrate LabelTransformControls

**Location:** `src/features/labels/components/LabelTransformControls.tsx`

Key differences:
- Y movement maps to depth change
- Y rotation maps to label Z rotation
- Output: `(position, rotation, depth)`

---

### Step 5: Migrate ClampTransformControls

**Location:** `src/features/clamps/components/ClampTransformControls.tsx`

Key differences:
- Rotation output in **DEGREES** (not radians!)
- Pivot at fixture point
- Complex output format

---

### Step 6: Migrate SelectableTransformControls

**Location:** `src/components/SelectableTransformControls.tsx`

Key differences:
- Full XYZ transform
- Transform baking pattern (CRITICAL)
- Double-click activation
- This is the most complex migration

---

## Validation Per Migration

After each component migration:

```powershell
npm run build
npm run dev
```

### Manual Test Checklist

- [ ] Gizmo appears at correct position
- [ ] Correct axes are enabled
- [ ] Transform applies correctly
- [ ] Values update in UI panel
- [ ] Click-outside/escape deselects
- [ ] No jittering during drag
- [ ] Orbit controls disabled during drag
- [ ] Pivot resets after drag

---

## Post-Execution Checklist

- [ ] All 6 transform controls migrated
- [ ] All manual tests pass
- [ ] Build passes
- [ ] No TypeScript errors
- [ ] Old V1 files deleted

---

## Rollback Per Component

If a migration fails:
```powershell
git checkout -- src/features/[feature]/components/[Component]TransformControls.tsx
```

## Full Rollback

If multiple migrations fail:
```powershell
git checkout -- src/features/
git checkout -- src/components/SelectableTransformControls.tsx
```
