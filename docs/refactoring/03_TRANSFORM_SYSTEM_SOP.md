# Transform System - Standard Operating Procedure

## Overview

This SOP defines how to implement the unified transform system that replaces all individual transform control implementations.

---

## Current Problem

We have **7+ transform control implementations** with similar patterns but different constraint configurations:

| Component | Constraints | Axes | Features |
|-----------|-------------|------|----------|
| ModelTransformControls | None | All | Snap to grid |
| SelectableTransformControls | None | All | Double-click activation |
| ClampTransformControls | Y-rotation only | XYZ translate | Contact point pivot |
| SupportTransformControls | XZ translate, Y-rotate | Partial | Height adjustment |
| HoleTransformControls | XZ translate only | XZ | Baseplate surface |
| BasePlateTransformControls | XZ translate only | XZ | Section bounds |
| TransformGizmo | None | All | Generic wrapper |

---

## Target Architecture

### Core Transform Controller

```typescript
// packages/cad-core/src/transform/TransformController.ts

export interface TransformConstraints {
  // Position constraints
  position: {
    lockX?: boolean;
    lockY?: boolean;
    lockZ?: boolean;
    minY?: number;
    maxY?: number;
    snapToSurface?: boolean;
    snapGrid?: number;
  };
  
  // Rotation constraints
  rotation: {
    lockX?: boolean;
    lockY?: boolean;
    lockZ?: boolean;
    snapDegrees?: number;
  };
  
  // Scale constraints
  scale: {
    enabled: boolean;
    uniform?: boolean;
    lockX?: boolean;
    lockY?: boolean;
    lockZ?: boolean;
  };
}

export interface TransformConfig {
  constraints: TransformConstraints;
  pivotMode: 'center' | 'origin' | 'custom';
  customPivot?: THREE.Vector3;
  gizmoScale?: number | 'auto';
  activationMode: 'always' | 'double-click' | 'selection';
  deactivationMode: 'escape' | 'click-outside' | 'manual';
}

export class TransformController {
  private config: TransformConfig;
  private mesh: THREE.Object3D;
  private callbacks: TransformCallbacks;
  
  constructor(mesh: THREE.Object3D, config: TransformConfig) {
    this.mesh = mesh;
    this.config = config;
    this.applyConstraints();
  }
  
  // Apply constraints to transform delta
  applyConstraints(delta: TransformDelta): TransformDelta {
    const { constraints } = this.config;
    const result = { ...delta };
    
    // Position constraints
    if (constraints.position.lockX) result.position.x = 0;
    if (constraints.position.lockY) result.position.y = 0;
    if (constraints.position.lockZ) result.position.z = 0;
    
    if (constraints.position.snapGrid) {
      result.position.x = Math.round(result.position.x / constraints.position.snapGrid) * constraints.position.snapGrid;
      result.position.z = Math.round(result.position.z / constraints.position.snapGrid) * constraints.position.snapGrid;
    }
    
    // Rotation constraints
    if (constraints.rotation.lockX) result.rotation.x = 0;
    if (constraints.rotation.lockY) result.rotation.y = 0;
    if (constraints.rotation.lockZ) result.rotation.z = 0;
    
    if (constraints.rotation.snapDegrees) {
      const snap = THREE.MathUtils.degToRad(constraints.rotation.snapDegrees);
      result.rotation.y = Math.round(result.rotation.y / snap) * snap;
    }
    
    return result;
  }
}
```

---

## Preset Configurations

### For Supports

```typescript
export const SUPPORT_TRANSFORM_CONFIG: TransformConfig = {
  constraints: {
    position: {
      lockY: false,  // Allow height adjustment
      snapToSurface: true,
    },
    rotation: {
      lockX: true,
      lockY: false,  // Allow Y rotation
      lockZ: true,
    },
    scale: { enabled: false }
  },
  pivotMode: 'custom',
  activationMode: 'double-click',
  deactivationMode: 'escape'
};
```

### For Clamps

```typescript
export const CLAMP_TRANSFORM_CONFIG: TransformConfig = {
  constraints: {
    position: {
      lockY: false,  // Allow height adjustment along arm
    },
    rotation: {
      lockX: true,
      lockY: false,  // Allow rotation around Y
      lockZ: true,
    },
    scale: { enabled: false }
  },
  pivotMode: 'custom',  // Pivot at fixture point
  activationMode: 'double-click',
  deactivationMode: 'escape'
};
```

### For Mounting Holes

```typescript
export const HOLE_TRANSFORM_CONFIG: TransformConfig = {
  constraints: {
    position: {
      lockY: true,  // Holes stay on baseplate surface
    },
    rotation: {
      lockX: true,
      lockY: true,
      lockZ: true,
    },
    scale: { enabled: false }
  },
  pivotMode: 'center',
  activationMode: 'double-click',
  deactivationMode: 'escape'
};
```

### For Baseplate Sections

```typescript
export const BASEPLATE_SECTION_TRANSFORM_CONFIG: TransformConfig = {
  constraints: {
    position: {
      lockY: true,  // Sections stay on ground plane
    },
    rotation: {
      lockX: true,
      lockY: true,
      lockZ: true,
    },
    scale: { enabled: false }
  },
  pivotMode: 'center',
  activationMode: 'double-click',
  deactivationMode: 'escape'
};
```

### For Parts (Full Freedom)

```typescript
export const PART_TRANSFORM_CONFIG: TransformConfig = {
  constraints: {
    position: {
      snapGrid: 5,  // Optional grid snapping
    },
    rotation: {
      snapDegrees: 15,  // 15-degree rotation snap
    },
    scale: { enabled: true, uniform: true }
  },
  pivotMode: 'center',
  activationMode: 'double-click',  // CRITICAL: Only parts use double-click
  deactivationMode: 'escape'
};
```

### For Labels

```typescript
export const LABEL_TRANSFORM_CONFIG: TransformConfig = {
  constraints: {
    position: {
      lockY: false,  // Y movement maps to depth change
    },
    rotation: {
      lockX: true,
      lockY: false,  // Y rotation (becomes Z rotation on flat label)
      lockZ: true,
    },
    scale: { enabled: false }
  },
  pivotMode: 'custom',
  activationMode: 'selection',  // Single click, not double-click
  deactivationMode: 'escape'
};
```

---

## ⚠️ CRITICAL: Component-Specific Behaviors

**The unified transform system MUST preserve these component-specific behaviors:**

### Output Format Differences

| Component | Output Type | Notes |
|-----------|-------------|-------|
| Supports | `(center: Vector2, rotationY, height)` | Height derived from Y delta |
| Clamps | `({x,y,z}, {x,y,z})` | Rotation in **DEGREES**, X/Z locked to 0 |
| Holes | `(position: Vector2)` | `position.x = worldX, position.y = worldZ` |
| Labels | `(Vector3, Euler, depth)` | Y movement → depth, world Y rot → label Z rot |
| BasePlate | `({minX, maxX, minZ, maxZ})` | Bounds recalculated from center |
| Parts | `({position: Vector3, rotation: Euler})` | Full transform with baking |

### Gizmo Positioning

```typescript
// Each component has DIFFERENT gizmo Y positioning logic
const getGizmoPosition = (component: ComponentType, data: any): THREE.Vector3 => {
  switch (component) {
    case 'support':
      // At TOP of support
      return new THREE.Vector3(center.x, baseY + height + 5, center.y);
    case 'clamp':
      // At fixture point world position
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    case 'hole':
      // Above baseplate surface
      return new THREE.Vector3(holeX, baseTopY + 5, holeZ);
    case 'label':
      // Above label (label.y + depth + 5)
      return new THREE.Vector3(labelPos.x, labelPos.y + depth + 5, labelPos.z);
    case 'baseplate':
      // Above ground at section center
      return new THREE.Vector3(centerX, 5, centerZ);
    case 'part':
      // At mesh world position (via baking)
      return meshWorldPos.clone();
  }
};
```

### Gizmo Scale Calculation

```typescript
const getGizmoScale = (component: ComponentType, data: any): number => {
  switch (component) {
    case 'support': return Math.max((data.radius ?? data.width ?? 10) * 2, 25);
    case 'clamp': return 40; // Fixed
    case 'hole': return Math.max(data.diameter * 3, 30);
    case 'label': return Math.max(data.fontSize * 2, 20);
    case 'baseplate': return Math.max(Math.max(data.width, data.depth) * 0.8, 30);
    case 'part': return Math.max((data.boundingRadius ?? 50) * 0.75, 25);
  }
};
```

### Parts-Only: Transform Baking

Parts use a unique pattern where transforms are "baked" into the mesh:

```typescript
// ON ACTIVATE:
// 1. Move pivot to mesh world position
pivot.position.copy(meshWorldPos);
pivot.rotation.set(0, 0, 0);  // Keep world-aligned axes
// 2. Move mesh to pivot origin, keep rotation
mesh.position.set(0, 0, 0);
mesh.rotation.copy(meshWorldEuler);

// ON DEACTIVATE:
// 1. Capture world transform
mesh.getWorldPosition(bakedPos);
mesh.getWorldQuaternion(worldQuat);
// 2. Reset pivot, apply to mesh
pivot.matrix.identity();
mesh.position.copy(bakedPos);
mesh.rotation.setFromQuaternion(worldQuat);
```

### Click-Outside Deselection Differences

```typescript
// HOLES, BASEPLATE: Deselect on ANY click outside canvas
if (!canvasElement.contains(target)) onDeselect();

// SUPPORTS, CLAMPS, LABELS, PARTS: Only on specific UI clicks
if (target.closest('button, input, select, [role="button"], ...')) onDeselect();
```

---

## React Component Wrapper

```typescript
// packages/cad-ui/src/transform/PivotGizmo.tsx

import { TransformController, TransformConfig } from '@rapidtool/cad-core';

interface PivotGizmoProps {
  meshRef: React.RefObject<THREE.Mesh>;
  config: TransformConfig;
  enabled: boolean;
  onTransformChange?: (transform: TransformData) => void;
  onTransformEnd?: (transform: TransformData) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
  children?: React.ReactNode;
}

export const PivotGizmo: React.FC<PivotGizmoProps> = ({
  meshRef,
  config,
  enabled,
  onTransformChange,
  onTransformEnd,
  onActivate,
  onDeactivate,
  children
}) => {
  const [isActive, setIsActive] = useState(false);
  const controller = useRef<TransformController | null>(null);
  
  // Initialize controller
  useEffect(() => {
    if (meshRef.current) {
      controller.current = new TransformController(meshRef.current, config);
    }
  }, [meshRef.current, config]);
  
  // Handle drag
  const handleDrag = useCallback(() => {
    if (!controller.current) return;
    
    const rawTransform = getTransformFromPivot();
    const constrained = controller.current.applyConstraints(rawTransform);
    
    onTransformChange?.(constrained);
  }, [onTransformChange]);
  
  // Determine active axes from config
  const activeAxes = useMemo(() => [
    !config.constraints.position.lockX,
    !config.constraints.position.lockY,
    !config.constraints.position.lockZ
  ], [config]);
  
  return (
    <PivotControls
      activeAxes={activeAxes}
      disableRotations={!hasAnyRotation(config)}
      disableScaling={!config.constraints.scale.enabled}
      onDrag={handleDrag}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
    </PivotControls>
  );
};
```

---

## Migration Steps

### Step 1: Create Core Module

1. Create `packages/cad-core/src/transform/` directory
2. Implement `TransformController.ts`
3. Implement `ConstrainedTransform.ts`
4. Create preset configurations
5. Export from package index

### Step 2: Create UI Component

1. Create `packages/cad-ui/src/transform/` directory
2. Implement `PivotGizmo.tsx` wrapper
3. Implement `TransformOverlay.tsx` for close button
4. Export from package index

### Step 3: Migrate Each Entity Type

For each transform control:

1. Import `PivotGizmo` from `@rapidtool/cad-ui`
2. Use appropriate preset config
3. Connect callbacks
4. Test functionality
5. Delete old implementation

### Step 4: Cleanup

1. Delete all old transform control files
2. Update imports throughout codebase
3. Run tests
4. Document migration

---

## Testing Checklist

For each entity type:

- [ ] Transform activates on double-click
- [ ] Transform deactivates on Escape
- [ ] Transform deactivates on click outside
- [ ] Position constraints work correctly
- [ ] Rotation constraints work correctly
- [ ] Scale constraints work correctly (if enabled)
- [ ] Grid snapping works (if enabled)
- [ ] Callbacks fire correctly
- [ ] No jittering during drag
- [ ] Performance is acceptable

---

## Common Patterns to Preserve

### ⚠️ CRITICAL: Anti-Jitter Pattern

**ALL transform controls MUST implement this pattern to prevent jittering during drag:**

```typescript
// Store refs for drag state
const isDraggingRef = useRef(false);
const dragStartPos = useRef<THREE.Vector3 | null>(null);
const dragStartRot = useRef<THREE.Euler | null>(null);

// On drag START - lock the display position
const handleDragStart = () => {
  isDraggingRef.current = true;
  // CRITICAL: Save current position to prevent feedback loop
  dragStartPos.current = new THREE.Vector3(position.x, position.y, position.z);
  dragStartRot.current = new THREE.Euler(rotation.x, rotation.y, rotation.z);
};

// Use LOCKED position for display during drag
const displayPos = isDraggingRef.current && dragStartPos.current 
  ? dragStartPos.current 
  : currentPosition;

// On drag END - reset everything
const handleDragEnd = () => {
  isDraggingRef.current = false;
  dragStartPos.current = null;
  dragStartRot.current = null;
  
  // CRITICAL: Reset pivot to identity
  if (pivotRef.current) {
    pivotRef.current.matrix.identity();
    pivotRef.current.position.set(0, 0, 0);
    pivotRef.current.rotation.set(0, 0, 0);
    pivotRef.current.scale.set(1, 1, 1);
    pivotRef.current.updateMatrix();
  }
};
```

**Why this is necessary:**
- PivotControls applies transforms cumulatively
- If you update the group position based on the anchor's world position during drag, you get a feedback loop
- The display position must stay "locked" to where the group started
- Only the final position is applied when drag ends

### ⚠️ CRITICAL: Euler Order for Rotation Extraction

```typescript
// For single-axis rotation (supports, clamps, labels):
// Use 'YXZ' order to cleanly extract Y rotation
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
const rotationY = tempEuler.y;  // Clean Y value

// For full rotation (parts):
// Use default 'XYZ' order
tempEuler.setFromQuaternion(tempQuaternion);  // or 'XYZ'
```

### 1. Orbit Control Disabling

```typescript
// Always disable orbit controls during drag
window.dispatchEvent(
  new CustomEvent('disable-orbit-controls', { detail: { disabled: true } })
);
```

### 2. Cursor Feedback

```typescript
gl.domElement.style.cursor = isDragging ? 'grabbing' : 'auto';
```

### 3. Pivot Reset After Drag

```typescript
// Reset pivot to identity after drag ends
pivotRef.current.matrix.identity();
pivotRef.current.position.set(0, 0, 0);
pivotRef.current.rotation.set(0, 0, 0);
pivotRef.current.scale.set(1, 1, 1);
pivotRef.current.updateMatrix();
```

### 4. World Transform Reading

```typescript
mesh.updateMatrixWorld(true);
mesh.getWorldPosition(tempPosition);
mesh.getWorldQuaternion(tempQuaternion);
tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
```
