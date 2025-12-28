# Critical Systems - Behavior Preservation Guide

## ⚠️ IMPORTANT

This document describes **critical functionality that MUST be preserved during refactoring**. These systems have subtle behaviors that, if changed, will cause bugs.

**READ THIS ENTIRE DOCUMENT BEFORE REFACTORING ANY TRANSFORM, CSG, OR MULTI-BASEPLATE CODE.**

---

## 1. Coordinate System Transforms

### The Problem
The application uses **Z-up** (CAD convention) but Three.js uses **Y-up**.

### Critical Mappings

| Application | Three.js | Description |
|-------------|----------|-------------|
| X | X | Horizontal (left/right) |
| Y | Z | Depth (forward/back) |
| Z | Y | Vertical (up/down) |

### Code Locations to Preserve

#### `src/lib/transformUtils.ts`
```typescript
// CRITICAL: These functions MUST be preserved exactly
export const toCadPosition = (position) => ({
  x: position.x,
  y: position.z,  // CAD Y = Three.js Z
  z: position.y,  // CAD Z = Three.js Y
});

export const toCadRotation = (rotation) => ({
  x: rotation.x,
  y: rotation.z,  // CAD Y = Three.js Z
  z: rotation.y,  // CAD Z = Three.js Y
});

export const cadToThreeAxis = (cadAxis) => {
  switch (cadAxis) {
    case 'y': return 'z';
    case 'z': return 'y';
    default: return 'x';
  }
};
```

### Critical: Euler Order for Rotation Extraction

When extracting "spin" rotation (rotation around vertical axis):

```typescript
// ✅ CORRECT - Use YXZ order for clean Y extraction
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
const spin = tempEuler.y;

// ❌ WRONG - Default order may pollute Y with other rotations
tempEuler.setFromQuaternion(tempQuaternion);
const spin = tempEuler.y;  // NOT RELIABLE!
```

### Affected Components

| Component | Rotation Type | Euler Order |
|-----------|--------------|-------------|
| SupportTransformControls | Y-axis only | `'YXZ'` |
| ClampTransformControls | Y-axis only | `'YXZ'` |
| LabelTransformControls | Y-axis only | `'YXZ'` |
| HoleTransformControls | None | N/A |
| BasePlateTransformControls | None | N/A |
| SelectableTransformControls | Full XYZ | Default `'XYZ'` |

### Testing Checklist
- [ ] Support rotates around vertical axis only
- [ ] Clamp rotates around vertical axis only
- [ ] Part can rotate on all axes
- [ ] Position values in UI match visual position
- [ ] Exported coordinates match visual model

---

## 2. Dynamic 3D Scene Updates During Transform

### The Problem
Transform changes must propagate to:
1. UI panels (position/rotation values)
2. Baseplate sizing (convex hull updates)
3. Support/clamp collision detection
4. CSG preview updates

### Event Flow (MUST PRESERVE)

```
User drags transform gizmo
         ↓
PivotControls.onDrag fires
         ↓
Transform read from anchor mesh
         ↓
Constraints applied (position/rotation locks)
         ↓
Parent component's onTransformChange called
         ↓
window.dispatchEvent('model-transform-updated')
         ↓
├─→ PartPropertiesAccordion updates UI
├─→ 3DScene updates baseplate sizing
├─→ 3DScene checks collision constraints
└─→ CSG preview may update
```

### Critical: Preventing Feedback Loops

The transform controls use a **drag start position lock** pattern to prevent jittering:

```typescript
// In all transform controls (Support, Clamp, Hole, etc.)
const isDraggingRef = useRef(false);
const dragStartPos = useRef<THREE.Vector3 | null>(null);

const handleDragStart = () => {
  isDraggingRef.current = true;
  // LOCK the display position to prevent feedback loop
  dragStartPos.current = new THREE.Vector3(position.x, position.y, position.z);
};

// During drag, use the LOCKED position for display
const displayPos = isDraggingRef.current && dragStartPos.current 
  ? dragStartPos.current 
  : currentPosition;

const handleDragEnd = () => {
  isDraggingRef.current = false;
  dragStartPos.current = null;
  
  // CRITICAL: Reset pivot to identity after drag
  if (pivotRef.current) {
    pivotRef.current.matrix.identity();
    pivotRef.current.position.set(0, 0, 0);
    pivotRef.current.rotation.set(0, 0, 0);
    pivotRef.current.scale.set(1, 1, 1);
    pivotRef.current.updateMatrix();
  }
};
```

### Critical: Orbit Control Disable/Enable

Transform gizmos must disable orbit controls during drag:

```typescript
// On drag start
window.dispatchEvent(
  new CustomEvent('disable-orbit-controls', { detail: { disabled: true } })
);

// On drag end
window.dispatchEvent(
  new CustomEvent('disable-orbit-controls', { detail: { disabled: false } })
);
```

### Testing Checklist
- [ ] No jittering during drag
- [ ] UI values update during drag
- [ ] Camera doesn't move during transform drag
- [ ] Pivot resets after drag (no accumulated transforms)
- [ ] Baseplate updates when part moves

---

## 3. Hole CSG Operations

### The Problem
Mounting holes must be subtracted from the baseplate in a way that:
1. Doesn't freeze the UI (use workers)
2. Handles counter-sink/counter-bore compound geometries
3. Maintains proper depth penetration
4. Updates visualization correctly

### Architecture (MUST PRESERVE)

```
User places hole
       ↓
HolePlacement creates preview geometry
       ↓
PlacedHole added to state (placedHoles array)
       ↓
When baseplate needs updating:
       ↓
createMergedHolesGeometry() combines all holes
       ↓
performHoleCSGInWorker() runs subtraction in background
       ↓
Result geometry replaces baseplate mesh
```

### Critical: Hole Geometry Creation

```typescript
// src/components/MountingHoles/holeGeometry.ts

// CRITICAL: Holes must extend BEYOND the baseplate
const PENETRATION_BUFFER = 4;  // mm

function createThroughHoleGeometry(diameter, depth) {
  const safeDepth = depth + PENETRATION_BUFFER;
  const geometry = new THREE.CylinderGeometry(radius, radius, safeDepth, 32);
  
  // Position so TOP extends above Y=0 and BOTTOM extends below -depth
  const yOffset = -safeDepth / 2 + PENETRATION_BUFFER / 2;
  geometry.translate(0, yOffset, 0);
  
  return geometry;
}
```

### Critical: Worker Communication

```typescript
// The worker expects and returns specific data structures
// DO NOT change these without updating the worker

// Input to worker:
{
  type: 'subtract-holes',
  id: string,
  payload: {
    baseplateGeometryData: {
      positions: Float32Array,
      indices?: Uint32Array,
      normals?: Float32Array,
    },
    holesGeometryData: {
      positions: Float32Array,
      indices?: Uint32Array,
      normals?: Float32Array,
    },
  }
}

// Output from worker:
{
  type: 'hole-csg-result',
  id: string,
  payload: {
    positions: Float32Array,
    indices?: Uint32Array,
    normals?: Float32Array,
  }
}
```

### Critical: CSG Union for Compound Holes

Counter-sink and counter-bore holes are created by CSG union of two geometries:

```typescript
// performCSGUnion() in holeGeometry.ts
// Uses three-bvh-csg ADDITION operation
// Falls back to simple merge if CSG fails

function performCSGUnion(mainGeo, secondaryGeo, label) {
  try {
    const evaluator = new Evaluator();
    const mainBrush = new Brush(mainGeo);
    const secondaryBrush = new Brush(secondaryGeo);
    
    mainBrush.updateMatrixWorld();
    secondaryBrush.updateMatrixWorld();
    
    const result = evaluator.evaluate(mainBrush, secondaryBrush, ADDITION);
    // ... cleanup and return
  } catch (error) {
    // FALLBACK: Simple geometry merge (may have internal faces)
    return mergeBufferGeometries([mainGeo, secondaryGeo]);
  }
}
```

### Testing Checklist
- [ ] Through holes fully penetrate baseplate
- [ ] Counter-sink holes show proper cone shape
- [ ] Counter-bore holes show proper cylindrical recess
- [ ] Multiple holes can be placed
- [ ] Holes update when baseplate size changes
- [ ] UI doesn't freeze during CSG
- [ ] Hole preview shows correct position before placement

---

## 4. Multi-Baseplate Section Movement

### The Problem
Multi-section baseplates have complex behaviors:
1. Sections can be independently moved
2. Overlapping sections automatically merge
3. Sections must maintain minimum size
4. Section bounds stored in XZ coordinates

### Critical: Section Coordinate System

Sections use **XZ plane coordinates** (Three.js convention for floor):

```typescript
interface BasePlateSection {
  id: string;
  minX: number;  // World X
  maxX: number;  // World X
  minZ: number;  // World Z (NOT Y!)
  maxZ: number;  // World Z (NOT Y!)
  originalWidth?: number;
  originalDepth?: number;
}
```

### Critical: Section Merging

```typescript
// src/components/BasePlate/types.ts

// Overlapping sections MUST merge automatically
function sectionsOverlap(a, b) {
  return !(
    a.maxX < b.minX || 
    a.minX > b.maxX || 
    a.maxZ < b.minZ ||  // Note: Z not Y
    a.minZ > b.maxZ
  );
}

function mergeSections(a, b) {
  // CRITICAL: Preserve original dimensions
  const origWidthA = a.originalWidth ?? (a.maxX - a.minX);
  const origWidthB = b.originalWidth ?? (b.maxX - b.minX);
  const originalWidth = Math.max(origWidthA, origWidthB);
  
  return {
    id: `merged-${Date.now()}`,
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
    originalWidth,
    originalDepth,
  };
}
```

### Critical: Transform Controls for Sections

```typescript
// BasePlateTransformControls uses XZ-only translation
// Y is LOCKED (sections stay on ground)

const {FEATURE}_TRANSFORM_CONFIG = {
  constraints: {
    position: {
      lockY: true,  // CRITICAL: Sections stay on ground
    },
    rotation: {
      lockX: true,
      lockY: true,  // No rotation
      lockZ: true,
    },
    scale: { enabled: false }
  }
};
```

### Critical: Bounds Update Flow

```
User drags section
       ↓
BasePlateTransformControls reads world position from anchor
       ↓
calculateSectionBounds() converts position + dimensions to bounds
       ↓
onTransformChange(newBounds) called
       ↓
Parent updates drawnBaseplateSections state
       ↓
mergeOverlappingSections() runs on all sections
       ↓
3DScene re-renders baseplate with new bounds
```

### Testing Checklist
- [ ] Section can be moved in X direction
- [ ] Section can be moved in Z direction
- [ ] Section CANNOT be moved in Y direction
- [ ] Section CANNOT be rotated
- [ ] Overlapping sections merge automatically
- [ ] Merged section bounds are correct
- [ ] Original size is preserved for shrinking
- [ ] Section transform gizmo appears at correct position

---

## 5. Event-Based Communication

### Critical Events (MUST PRESERVE)

| Event | Source | Listeners | Purpose |
|-------|--------|-----------|---------|
| `model-transform-updated` | Transform controls | 3DScene, PartPropertiesAccordion | Sync transforms |
| `set-model-transform` | PartPropertiesAccordion | SelectableTransformControls | Set transform from UI |
| `disable-orbit-controls` | All transform controls | OrbitControls | Prevent camera movement |
| `baseplate-section-updated` | BasePlateTransformControls | AppShell | Update section bounds |
| `mesh-double-click` | ModelMesh | Transform controls | Activate gizmo |
| `session-reset` | AppShell | All components | Clear state |

### Event Data Structures

```typescript
// model-transform-updated
{
  position: THREE.Vector3,
  rotation: THREE.Euler,
  partId: string,
}

// set-model-transform
{
  partId: string,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  respectBaseplate: boolean,  // Whether to enforce baseplate constraint
}

// disable-orbit-controls
{
  disabled: boolean,
}

// baseplate-section-updated
{
  sectionId: string,
  bounds: { minX, maxX, minZ, maxZ },
}
```

---

## 6. Component-Specific PivotControls Configuration

**⚠️ CRITICAL: Each component type has distinct PivotControls behavior. The unified transform system MUST preserve these differences.**

### PivotControls Props by Component

| Component | `activeAxes` | `disableRotations` | `disableSliders` | `autoTransform` | `annotations` |
|-----------|--------------|-------------------|------------------|-----------------|---------------|
| **Supports** | `[true, true, true]` | `false` | `true` | `true` | `false` |
| **Clamps** | `[true, true, true]` | `false` | `true` | `true` | `false` |
| **Holes** | `[true, false, true]` | `true` | `true` | `true` | `false` |
| **Labels** | `[true, true, true]` | `false` | `true` | `true` | `true` |
| **BasePlate** | `[true, false, true]` | `true` | `true` | `true` | `false` |
| **Parts** | `[true, true, true]` | `false` | `false` | `true` | `true` (when active) |

### Output Data Formats (MUST be preserved exactly)

```typescript
// SUPPORTS: XZ center + Y rotation + height
onTransformChange(center: THREE.Vector2, rotationY?: number, height?: number)
onTransformEnd(center: THREE.Vector2, rotationY?: number, height?: number)

// CLAMPS: Full position + rotation in DEGREES
onTransformChange(position: {x: number, y: number, z: number}, rotation: {x: number, y: number, z: number})
onTransformEnd(position: {x: number, y: number, z: number}, rotation: {x: number, y: number, z: number})
// NOTE: Rotation is in DEGREES, not radians! Only Y rotation is used.

// HOLES: XZ position as Vector2 (x=worldX, y=worldZ)
onTransformChange(position: THREE.Vector2)
onTransformEnd(position: THREE.Vector2)

// LABELS: Full position + Euler rotation + depth
onTransformChange(position: THREE.Vector3, rotation: THREE.Euler, depth?: number)
onTransformEnd(position: THREE.Vector3, rotation: THREE.Euler, depth?: number)
// NOTE: Y-axis movement maps to depth change!

// BASEPLATE SECTIONS: Bounding box
onTransformChange(bounds: {minX: number, maxX: number, minZ: number, maxZ: number})
onTransformEnd(bounds: {minX: number, maxX: number, minZ: number, maxZ: number})

// PARTS: Position + Rotation via callbacks
onTransformChange({ position: THREE.Vector3, rotation: THREE.Euler })
onLiveTransformChange({ position, rotation, bounds, pivotClosed?: boolean })
```

### Gizmo Positioning Logic

```typescript
// SUPPORTS: Positioned at TOP of support (supportHeight + 5 above base)
const gizmoY = effectiveBaseY + supportHeight + 5;
const displayPos = new THREE.Vector3(center.x, gizmoY, center.y);

// CLAMPS: Positioned at world position (fixture point)
const displayPos = new THREE.Vector3(position.x, position.y, position.z);

// HOLES: Positioned 5mm above baseplate
const GIZMO_Y_OFFSET = 5;
const displayPos = new THREE.Vector3(holeX, baseTopY + GIZMO_Y_OFFSET, holeZ);

// LABELS: Positioned above label surface (Y + depth + 5)
const gizmoY = labelPosition.y + label.depth + GIZMO_OFFSET_Y;
const displayPos = new THREE.Vector3(labelPosition.x, gizmoY, labelPosition.z);

// BASEPLATE SECTIONS: At center of section, 5mm above ground
const displayPos = new THREE.Vector3(centerX, GIZMO_Y_OFFSET, centerZ);

// PARTS: At mesh world position (baking pattern - see below)
pivot.position.copy(meshWorldPos);
```

### Transform Value Extraction

```typescript
// SUPPORTS: World Y rotation extracted with YXZ Euler order
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
const newRotationY = tempEuler.y;
const newHeight = Math.max(1, tempPosition.y - effectiveBaseY - 5);
return { center: new THREE.Vector2(tempPosition.x, tempPosition.z), rotationY: newRotationY, height: newHeight };

// CLAMPS: Y rotation converted to DEGREES, X/Z rotation LOCKED to 0
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
return {
  position: { x: tempPosition.x, y: tempPosition.y, z: tempPosition.z },
  rotation: { x: 0, y: THREE.MathUtils.radToDeg(tempEuler.y), z: 0 },  // DEGREES!
};

// HOLES: Simple XZ mapping (no rotation)
return new THREE.Vector2(tempPosition.x, tempPosition.z);

// LABELS: Y movement → depth, world Y rotation → label Z rotation
const yDelta = tempPosition.y - dragStateRef.current.anchorY;
const newDepth = clampDepth(dragStateRef.current.depth + yDelta);
return {
  position: new THREE.Vector3(tempPosition.x, labelPosition.y, tempPosition.z),
  rotation: new THREE.Euler(labelRotation.x, labelRotation.y, tempEuler.y),  // Note: tempEuler.y → rotation.z
  depth: newDepth,
};

// BASEPLATE SECTIONS: Position → bounds recalculation
return {
  minX: worldPosition.x - halfWidth,
  maxX: worldPosition.x + halfWidth,
  minZ: worldPosition.z - halfDepth,
  maxZ: worldPosition.z + halfDepth,
};

// PARTS: Full quaternion → Euler conversion
meshRef.current.getWorldQuaternion(worldQuat);
bakedRotation.setFromQuaternion(worldQuat);
```

### Gizmo Scale Calculation

```typescript
// SUPPORTS: Based on support radius/width
const gizmoScale = Math.max((support.radius ?? support.width ?? 10) * 2, 25);

// CLAMPS: Fixed at 40
const scale = 40;

// HOLES: Based on hole diameter × 3
const gizmoScale = Math.max(holeDiameter * 3, 30);

// LABELS: Based on font size × 2
const gizmoScale = Math.max(fontSize * 2, 20);

// BASEPLATE SECTIONS: Based on section size × 0.8
const gizmoScale = Math.max(30, Math.max(width, depth) * 0.8);

// PARTS: Based on bounding box radius × 0.75
const gizmoScale = Math.max(bounds.radius * 0.75, 25);
```

### Activation Patterns

| Component | How to Activate | Visibility |
|-----------|-----------------|------------|
| **Supports** | Click on support | Always visible when selected |
| **Clamps** | Click on clamp | Always visible when selected |
| **Holes** | Click on hole | Always visible when selected |
| **Labels** | Click on label | Always visible when selected |
| **BasePlate** | Click on section | Always visible when selected |
| **Parts** | **DOUBLE-CLICK** on part | Only visible when active (not just selected) |

### Parts-Only: Transform Baking Pattern

Parts use a unique baking pattern not used by other components:

```typescript
// ON ACTIVATE (activateGizmo):
// 1. Pivot goes to mesh world position with world-aligned axes
pivot.position.copy(meshWorldPos);
pivot.rotation.set(0, 0, 0);  // Keep axes world-aligned!
// 2. Mesh goes to origin (relative to pivot), keeps its rotation
mesh.position.set(0, 0, 0);
mesh.rotation.copy(meshWorldEuler);

// ON DEACTIVATE (deactivateGizmo):
// 1. Capture world transform
meshRef.current.getWorldPosition(bakedPosition);
meshRef.current.getWorldQuaternion(worldQuat);
bakedRotation.setFromQuaternion(worldQuat);
// 2. Hide gizmo first
setIsActive(false);
await nextFrame();
// 3. Reset pivot to identity
pivot.matrix.identity(); pivot.position.set(0,0,0); // etc.
// 4. Apply baked transform to mesh
mesh.position.copy(bakedPosition);
mesh.rotation.copy(bakedRotation);
// 5. Emit events
onLiveTransformChange?.({ position, rotation, bounds, pivotClosed: true });
```

### Event Contracts by Component

```typescript
// ALL COMPONENTS: Deselect on escape, click outside, other gizmo activation
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') onDeselect(); });
window.addEventListener('pivot-control-activated', handleOtherActivated);

// ALL COMPONENTS: Disable orbit controls during drag
onDragStart: window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: true } }));
onDragEnd: window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: false } }));

// PARTS ONLY: Additional events
window.dispatchEvent(new CustomEvent('model-transform-updated', { detail: { position, rotation, partId } }));
window.addEventListener('mesh-double-click', handleMeshDoubleClick);
window.addEventListener('set-model-transform', handleSetTransform);
window.addEventListener('baseplate-moved-model', emitTransformUpdate);
window.addEventListener('check-baseplate-collision', handler);

// LABELS: Emits its own ID on activation
window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { labelId: label.id } }));
// Deselects on other label OR support activation
if (detail?.labelId !== label.id || detail?.supportId) onDeselect();

// BASEPLATE SECTIONS: Emits section ID
window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { sectionId: section.id } }));
```

### Click-Outside Deselection Logic

```typescript
// SUPPORTS, CLAMPS: Deselect only on specific UI element clicks
if (target.closest('button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]')) {
  onDeselect();
}

// HOLES, BASEPLATE: Deselect on ANY click outside canvas
if (!gl.domElement.contains(target)) onDeselect();

// LABELS: Same as SUPPORTS/CLAMPS (specific UI elements)

// PARTS: Same as SUPPORTS/CLAMPS (specific UI elements)
```

---

## Refactoring Guidelines

### DO:
1. Preserve all event names exactly
2. Preserve event data structures exactly
3. Preserve coordinate transformation functions
4. Keep drag-start position locking pattern
5. Keep worker-based CSG for holes
6. Preserve Euler order `'YXZ'` for single-axis rotation
7. Test each entity type's transform individually

### DO NOT:
1. Change event names without updating all listeners
2. Swap Y/Z in transform functions
3. Remove the pivot reset on drag end
4. Make hole CSG synchronous
5. Change section bounds to use Y instead of Z
6. Remove the penetration buffer from hole geometry
7. Remove the fallback in CSG operations

### When Extracting Transform System:

```typescript
// The unified transform system MUST support:
interface TransformConfig {
  constraints: {
    position: {
      lockX?: boolean;
      lockY?: boolean;  // CRITICAL for baseplates/holes
      lockZ?: boolean;
    };
    rotation: {
      lockX?: boolean;
      lockY?: boolean;
      lockZ?: boolean;
      eulerOrder?: 'XYZ' | 'YXZ' | 'ZXY';  // CRITICAL
    };
  };
  // Anti-jitter pattern
  useDragStartLock: boolean;  // Should be true for all
  // Pivot reset
  resetPivotOnDragEnd: boolean;  // Should be true for all
}
```

---

## Quick Reference: What Uses What

| Entity | Transform Config | Coordinates | CSG |
|--------|-----------------|-------------|-----|
| Part | Full XYZ | Three.js Y-up | Cavity subtraction |
| Support | Y-rotation, XZ translate | Floor position (X, Z) | Cavity inclusion |
| Clamp | Y-rotation, XYZ translate | Three.js Y-up | Cavity inclusion |
| Hole | XZ translate only | Floor position (X, Z) | Worker subtraction |
| Label | Y-rotation, XZ translate | Floor position + depth | None |
| Baseplate Section | XZ translate only | Floor bounds (minX/maxX/minZ/maxZ) | None |

---

*Last updated: December 2024*
*This document is CRITICAL for refactoring safety.*
