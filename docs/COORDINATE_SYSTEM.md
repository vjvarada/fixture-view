# Coordinate System Reference

This document explains how coordinate systems work in this application and provides patterns for implementing transforms, gizmos, and object placement consistently.

## Overview

**This application presents a Z-up coordinate system to users** for its domain logic (fixture design, CNC machining conventions), but **Three.js uses Y-up internally**.

### User-Facing Coordinate System (Z-up)

The user sees and interacts with a **Z-up coordinate system**:
- **X** = Horizontal (left/right)
- **Y** = Depth (forward/backward on ground plane)
- **Z** = Vertical (height/up)

This matches CAD/CNC machining conventions where the ground plane is the XY plane.

### Internal Coordinate System (Y-up)

Three.js internally uses **Y-up**:
- **X** = Horizontal (left/right) - same as user
- **Y** = Vertical (height/up) - displayed as **Z** to user
- **Z** = Depth (forward/backward) - displayed as **Y** to user

### UI Label Mapping

When displaying position values in the Properties panel:

| Internal (Three.js) | Display Label | User Meaning |
|---------------------|---------------|--------------|
| `position.x` | **X** | Horizontal position |
| `position.y` | **Z** | Height (vertical) |
| `position.z` | **Y** | Depth (ground plane) |

**Important for developers:** When adding position inputs in the UI:
- The internal Y value should be labeled "Z" (height)
- The internal Z value should be labeled "Y" (depth on ground)
- Colors: Red = X, Green = Z (height), Blue = Y (depth)

This mismatch requires careful handling when:
- Placing gizmos (PivotControls, TransformControls)
- Extracting rotation values from quaternions
- Converting between world space and logical space
- Importing OBJ models (which may be authored in different coordinate systems)
- **Displaying position/rotation values in the UI**

---

## Coordinate System Mapping

| Concept | User Sees (Z-up) | Internal Three.js (Y-up) | Notes |
|---------|------------------|--------------------------|-------|
| **Vertical axis** | Z | Y | "Height" is Y in Three.js but shown as Z |
| **Horizontal plane** | XY plane | XZ plane | Where objects rest on baseplate |
| **"Spin" rotation** | Around Z | Around Y | Rotating object on the floor |
| **Position on floor** | (X, Y) | (X, Z) | 2D coordinates on baseplate |
| **Height value** | Z | Y | Vertical distance from ground |

### Ground Plane Positions (2D)

For components that only have ground plane positions (supports, labels, baseplate sections):
- Display **X** and **Y** labels
- Internally: X maps to X, Y maps to Z

### Full 3D Positions

For components with full 3D positioning (clamps, parts):
- Display **X**, **Y**, **Z** labels
- Internally: X→X, Y→Z (depth), Z→Y (height)
- User's Z (height) = internal Y
- User's Y (depth) = internal Z

---

## UI Implementation Guidelines

### Properties Panel Position Inputs

When creating position inputs in accordion panels, follow these conventions:

#### For Ground Plane Only (2D) - Supports, Labels, Baseplate Sections

```tsx
// User sees X and Y for ground plane position
<div className="grid grid-cols-2 gap-2">
  <div className="space-y-1">
    <Label className="text-red-500">X</Label>
    <Input value={internalPosition.x} onChange={...} />
  </div>
  <div className="space-y-1">
    <Label className="text-green-500">Y</Label>  {/* User's Y = internal Z */}
    <Input value={internalPosition.z} onChange={...} />
  </div>
</div>
```

#### For Full 3D Position - Clamps, Parts

```tsx
// User sees X, Y (depth), Z (height)
<div className="grid grid-cols-3 gap-2">
  <div className="space-y-1">
    <Label className="text-red-500">X</Label>
    <Input value={position.x} onChange={(v) => handleChange('x', v)} />
  </div>
  <div className="space-y-1">
    <Label className="text-green-500">Z</Label>  {/* User's Z (height) = internal Y */}
    <Input value={position.y} onChange={(v) => handleChange('y', v)} />
  </div>
  <div className="space-y-1">
    <Label className="text-blue-500">Y</Label>   {/* User's Y (depth) = internal Z */}
    <Input value={position.z} onChange={(v) => handleChange('z', v)} />
  </div>
</div>
```

### Color Conventions

| User Axis | Color | Internal Axis |
|-----------|-------|---------------|
| X | Red (`text-red-500`) | X |
| Y (depth) | Blue (`text-blue-500`) | Z |
| Z (height) | Green (`text-green-500`) | Y |

### Files Following These Conventions

- `src/features/baseplate/components/BaseplateAccordion.tsx` - X, Y labels for section position
- `src/features/supports/components/SupportsAccordion.tsx` - X, Y labels for support position
- `src/features/labels/components/LabelsAccordion.tsx` - X, Y labels for label position
- `src/features/clamps/components/ClampsAccordion.tsx` - X, Y, Z labels for clamp 3D position
- `src/components/PartItemAccordion.tsx` - X, Y, Z labels for part 3D position
- `src/components/MountingHolesAccordion.tsx` - X, Y labels for hole position

---

## Project Name

The application has a centralized project name stored in the fixture store (`src/stores/fixtureStore.ts`).

### Usage

- **Title Bar**: Displays the project name in the center. Double-click to edit.
- **Default Label Text**: Labels use the format `{projectName} V1.0` by default.
- **STL Export**: The project name is used as the default export filename.

### Implementation

```tsx
// Get and set project name from store
import { useProjectName } from '@/hooks/useFixture';

const [projectName, setProjectName] = useProjectName();
// projectName defaults to 'Untitled'
```

### Files Using Project Name

- `src/stores/fixtureStore.ts` - State and actions
- `src/hooks/useFixture.ts` - `useProjectName` hook
- `src/layout/AppShell.tsx` - Editable title bar display
- `src/components/ContextOptionsPanel/steps/LabelsStepContent.tsx` - Default label text
- `src/components/ContextOptionsPanel/steps/ExportStepContent.tsx` - Default export filename

---

## Implementation Patterns

### 1. Supports & Clamps (Recommended Pattern)

These use `PivotControls` with a single-axis rotation (spinning on the floor).

**Key implementation details:**

```tsx
// Position: Application Z maps to Three.js Y
const displayPos = new THREE.Vector3(
  center.x,      // X stays X
  gizmoY,        // Application Z (height) → Three.js Y
  center.y       // Application Y → Three.js Z
);

// Rotation: Only allow "spin" rotation (around vertical axis)
// In Three.js this is Y rotation
const displayRotY = THREE.MathUtils.degToRad(rotation.y);

// Group setup - only Y rotation allowed
<group position={[displayPos.x, displayPos.y, displayPos.z]} rotation={[0, displayRotY, 0]}>
  <PivotControls activeAxes={[true, true, true]} ... />
</group>

// Extracting rotation from quaternion - use 'YXZ' order to get clean Y rotation
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
const newRotationY = tempEuler.y; // This is the "spin" rotation
```

**Files using this pattern:**
- [SupportTransformControls.tsx](../src/components/Supports/SupportTransformControls.tsx)
- [ClampTransformControls.tsx](../src/components/Clamps/ClampTransformControls.tsx)
- [LabelTransformControls.tsx](../src/components/Labels/LabelTransformControls.tsx)

### 2. Parts (Full 3-Axis Rotation)

Parts use full transform controls with all rotation axes.

**Key implementation details:**

```tsx
// Position extraction
meshRef.current.getWorldPosition(tempPosition);
meshRef.current.getWorldQuaternion(tempQuaternion);
tempEuler.setFromQuaternion(tempQuaternion); // Default XYZ order is fine for full rotation

// Parts store rotation in degrees as { x, y, z }
// Convert using THREE.MathUtils.degToRad() / radToDeg()
```

**Files using this pattern:**
- [SelectableTransformControls.tsx](../src/components/SelectableTransformControls.tsx)
- [ModelTransformControls.tsx](../src/components/ModelTransformControls.tsx)

---

## Euler Order Reference

When extracting rotation from a quaternion, the euler order matters:

| Euler Order | Best For | Extracts Cleanly |
|-------------|----------|------------------|
| `'YXZ'` | Single Y-axis rotation (spin) | `euler.y` |
| `'ZXY'` | Single Z-axis rotation | `euler.z` |
| `'XYZ'` | Full rotation (default) | All axes |

**Rule:** Use `'YXZ'` order when you only care about vertical-axis rotation (the "spin").

```tsx
// Good - cleanly extracts Y rotation for spinning objects
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
const spin = tempEuler.y;

// Bad - Y component may be polluted by other rotations
tempEuler.setFromQuaternion(tempQuaternion, 'XYZ');
const spin = tempEuler.y; // May not be accurate
```

---

## PivotControls Configuration

### For Floor Objects (Supports, Clamps)

```tsx
<PivotControls
  activeAxes={[true, true, true]}  // All translation axes
  disableScaling={true}            // Usually don't want scaling
  disableSliders={true}            // Cleaner UI
  // ... other props
>
```

The outer `<group>` handles rotation, PivotControls handles translation.

### Gizmo Colors

Standard Three.js axis colors:
- **Red** = X axis
- **Green** = Y axis (vertical in Three.js, rotation = spin on floor)
- **Blue** = Z axis

```tsx
axisColors={['#ff4060', '#40ff60', '#4080ff']} // R, G, B for X, Y, Z
```

---

## Position Conversion Helpers

### Application (Z-up) → Three.js (Y-up)

```tsx
// 2D floor position to 3D
function toThreePosition(appX: number, appY: number, height: number): THREE.Vector3 {
  return new THREE.Vector3(appX, height, appY);
}

// Full 3D conversion
function appToThree(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(pos.x, pos.z, pos.y);
}
```

### Three.js (Y-up) → Application (Z-up)

```tsx
// 3D to floor position
function fromThreePosition(threePos: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: threePos.x, y: threePos.z, z: threePos.y };
}
```

---

## OBJ Model Import

OBJ models may be authored in different coordinate systems. When loading:

1. **Check the model orientation** - does it look correct?
2. **Apply rotation if needed** - typically -90° around X to convert Y-up to Z-up
3. **Document the expected orientation** in the model's folder

Example from clamp loader:
```tsx
// OBJ files are typically Y-up, rotate to Z-up if needed
clampGroup.rotation.x = -Math.PI / 2; // Only if model needs it
```

---

## Common Pitfalls

### 1. Wrong Euler Order
```tsx
// ❌ Wrong - default order may not extract Y cleanly
tempEuler.setFromQuaternion(quaternion);
const spin = tempEuler.y;

// ✅ Correct - YXZ order for clean Y extraction
tempEuler.setFromQuaternion(quaternion, 'YXZ');
const spin = tempEuler.y;
```

### 2. Mixing Coordinate Systems
```tsx
// ❌ Wrong - mixing app and Three.js coordinates
group.position.set(appPos.x, appPos.y, appPos.z);

// ✅ Correct - convert app Z to Three.js Y
group.position.set(appPos.x, appPos.z, appPos.y);
```

### 3. Forgetting Degrees vs Radians
```tsx
// ❌ Wrong - storing radians when UI expects degrees
rotation.y = tempEuler.y;

// ✅ Correct - convert for storage
rotation.y = THREE.MathUtils.radToDeg(tempEuler.y);
```

### 4. Wrong Rotation Axis
```tsx
// In Three.js Y-up world:
// - Spinning on floor = Y rotation (green gizmo)
// - NOT Z rotation (blue gizmo)

// ❌ Wrong for "spin" rotation
<group rotation={[0, 0, rotZ]}>

// ✅ Correct for "spin" rotation  
<group rotation={[0, rotY, 0]}>
```

---

## Quick Reference Table

| Task | Three.js Code |
|------|---------------|
| Set floor position | `pos.set(x, height, y)` |
| Get floor position | `{ x: pos.x, y: pos.z }` |
| Get height | `pos.y` |
| Spin rotation only | `rotation={[0, rotY, 0]}` |
| Extract spin from quaternion | `euler.setFromQuaternion(quat, 'YXZ'); spin = euler.y` |
| Spin in degrees | `THREE.MathUtils.radToDeg(euler.y)` |

---

## File Reference

| Component | Coordinate Handling | Rotation Type |
|-----------|--------------------| --------------|
| `SupportTransformControls` | Floor position (X, Z→Y) | Y-axis spin only |
| `ClampTransformControls` | Full 3D position | Y-axis spin only |
| `LabelTransformControls` | Floor position + depth | Y-axis spin only |
| `SelectableTransformControls` | Full 3D | Full XYZ rotation |
| `ModelTransformControls` | Full 3D | Full XYZ rotation |

---

*Last updated: January 2026*
