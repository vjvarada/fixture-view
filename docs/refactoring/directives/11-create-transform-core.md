# Directive 11: Create Transform Core System

## Priority: HIGH
## Estimated Time: 2 hours
## Risk Level: 🔴 HIGH

---

## Objective

Create the unified transform controller system in `src/core/transform/` that will replace all 7+ individual transform control implementations.

---

## Pre-Execution Checklist

- [ ] Phase 3 complete (all feature modules migrated)
- [ ] Branch created: `phase-4-transform`
- [ ] Build passes on current branch
- [ ] Read `docs/refactoring/09_CRITICAL_SYSTEMS.md` sections 1-2
- [ ] Read `docs/refactoring/03_TRANSFORM_SYSTEM_SOP.md`

---

## Context

### Current Problem

We have **7 transform control implementations** with ~1,500+ lines of duplicated code:

| Component | Location | Lines | Constraints |
|-----------|----------|-------|-------------|
| SupportTransformControls | `@/features/supports` | ~227 | XZ translate, Y-rotate |
| ClampTransformControls | `@/features/clamps` | ~206 | Y-rotate, XYZ translate |
| HoleTransformControls | `@/features/holes` | ~247 | XZ translate only |
| LabelTransformControls | `@/features/labels` | ~180 | Y-rotate, XYZ translate |
| BasePlateTransformControls | `@/features/baseplate` | ~320 | XZ translate only |
| SelectableTransformControls | `src/components` | ~448 | Full XYZ |
| ModelTransformControls | `src/components` | ~194 | Full XYZ (unused?) |

### Target Architecture

```
src/core/transform/
├── index.ts                    # Barrel export
├── types.ts                    # TransformConfig, TransformConstraints, etc.
├── TransformController.ts      # Core constraint application logic
├── presets.ts                  # SUPPORT_CONFIG, CLAMP_CONFIG, etc.
├── utils.ts                    # Shared utilities (gizmo scale, position calc)
└── hooks/
    ├── useTransformGizmo.ts    # Main hook for PivotControls integration
    ├── useDragState.ts         # Drag start/end state management
    └── useGizmoPosition.ts     # Gizmo positioning per component type
```

---

## Actions

### Step 1: Create Directory Structure

```powershell
New-Item -ItemType Directory -Path "src/core/transform" -Force
New-Item -ItemType Directory -Path "src/core/transform/hooks" -Force
```

### Step 2: Create Types (`src/core/transform/types.ts`)

```typescript
import * as THREE from 'three';

/**
 * Position constraint configuration
 */
export interface PositionConstraints {
  lockX?: boolean;
  lockY?: boolean;
  lockZ?: boolean;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minZ?: number;
  maxZ?: number;
  snapGrid?: number;
  snapToSurface?: boolean;
}

/**
 * Rotation constraint configuration
 */
export interface RotationConstraints {
  lockX?: boolean;
  lockY?: boolean;
  lockZ?: boolean;
  snapDegrees?: number;
}

/**
 * Scale constraint configuration
 */
export interface ScaleConstraints {
  enabled: boolean;
  uniform?: boolean;
  lockX?: boolean;
  lockY?: boolean;
  lockZ?: boolean;
  minScale?: number;
  maxScale?: number;
}

/**
 * Full transform constraints configuration
 */
export interface TransformConstraints {
  position: PositionConstraints;
  rotation: RotationConstraints;
  scale: ScaleConstraints;
}

/**
 * Pivot mode for gizmo positioning
 */
export type PivotMode = 'center' | 'origin' | 'custom' | 'world';

/**
 * How the transform control is activated
 */
export type ActivationMode = 'always' | 'double-click' | 'selection';

/**
 * How the transform control is deactivated
 */
export type DeactivationMode = 'escape' | 'click-outside' | 'manual' | 'ui-click';

/**
 * Component type for determining specific behaviors
 */
export type TransformComponentType = 
  | 'support' 
  | 'clamp' 
  | 'hole' 
  | 'label' 
  | 'baseplate' 
  | 'part';

/**
 * Full transform configuration
 */
export interface TransformConfig {
  componentType: TransformComponentType;
  constraints: TransformConstraints;
  pivotMode: PivotMode;
  customPivot?: THREE.Vector3;
  gizmoScale?: number | 'auto';
  activationMode: ActivationMode;
  deactivationMode: DeactivationMode;
  /** Whether to use 'YXZ' euler order for clean Y extraction */
  useYXZEulerOrder?: boolean;
  /** Whether to disable orbit controls during drag */
  disableOrbitOnDrag?: boolean;
}

/**
 * Transform delta from gizmo interaction
 */
export interface TransformDelta {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

/**
 * Output transform data after constraint application
 */
export interface TransformOutput {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  /** For supports/clamps: rotation in radians around Y */
  rotationY?: number;
  /** For supports: height value */
  height?: number;
  /** For labels: depth value */
  depth?: number;
  /** For baseplate: bounds */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Callbacks for transform events
 */
export interface TransformCallbacks {
  onTransformStart?: () => void;
  onTransformChange?: (output: TransformOutput) => void;
  onTransformEnd?: (output: TransformOutput) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
}
```

### Step 3: Create Presets (`src/core/transform/presets.ts`)

```typescript
import type { TransformConfig } from './types';

/**
 * Transform config for supports
 * - XZ translation allowed
 * - Y rotation allowed (spin around vertical)
 * - Y position adjustable (height)
 */
export const SUPPORT_TRANSFORM_CONFIG: TransformConfig = {
  componentType: 'support',
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
  gizmoScale: 'auto',
  activationMode: 'double-click',
  deactivationMode: 'ui-click',
  useYXZEulerOrder: true,
  disableOrbitOnDrag: true,
};

/**
 * Transform config for clamps
 * - Full XYZ translation allowed
 * - Y rotation allowed
 */
export const CLAMP_TRANSFORM_CONFIG: TransformConfig = {
  componentType: 'clamp',
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
  gizmoScale: 40,
  activationMode: 'double-click',
  deactivationMode: 'ui-click',
  useYXZEulerOrder: true,
  disableOrbitOnDrag: true,
};

/**
 * Transform config for mounting holes
 * - XZ translation only (stay on baseplate surface)
 * - No rotation
 */
export const HOLE_TRANSFORM_CONFIG: TransformConfig = {
  componentType: 'hole',
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
  gizmoScale: 'auto',
  activationMode: 'double-click',
  deactivationMode: 'click-outside',
  disableOrbitOnDrag: true,
};

/**
 * Transform config for labels
 * - XYZ translation (Y maps to depth)
 * - Y rotation allowed
 */
export const LABEL_TRANSFORM_CONFIG: TransformConfig = {
  componentType: 'label',
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
  gizmoScale: 'auto',
  activationMode: 'selection',  // Single click, not double-click
  deactivationMode: 'ui-click',
  useYXZEulerOrder: true,
  disableOrbitOnDrag: true,
};

/**
 * Transform config for baseplate sections
 * - XZ translation only (sections stay on ground)
 * - No rotation
 */
export const BASEPLATE_TRANSFORM_CONFIG: TransformConfig = {
  componentType: 'baseplate',
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
  gizmoScale: 'auto',
  activationMode: 'double-click',
  deactivationMode: 'click-outside',
  disableOrbitOnDrag: true,
};

/**
 * Transform config for parts (full freedom)
 * - Full XYZ translation with optional snap
 * - Full XYZ rotation with optional snap
 * - Scale enabled
 */
export const PART_TRANSFORM_CONFIG: TransformConfig = {
  componentType: 'part',
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
  gizmoScale: 'auto',
  activationMode: 'double-click',
  deactivationMode: 'escape',
  disableOrbitOnDrag: true,
};

/**
 * Get preset config by component type
 */
export function getPresetConfig(type: TransformConfig['componentType']): TransformConfig {
  switch (type) {
    case 'support': return { ...SUPPORT_TRANSFORM_CONFIG };
    case 'clamp': return { ...CLAMP_TRANSFORM_CONFIG };
    case 'hole': return { ...HOLE_TRANSFORM_CONFIG };
    case 'label': return { ...LABEL_TRANSFORM_CONFIG };
    case 'baseplate': return { ...BASEPLATE_TRANSFORM_CONFIG };
    case 'part': return { ...PART_TRANSFORM_CONFIG };
  }
}
```

### Step 4: Create Transform Controller (`src/core/transform/TransformController.ts`)

```typescript
import * as THREE from 'three';
import type { TransformConfig, TransformDelta, TransformOutput } from './types';

/**
 * Core transform controller that applies constraints to transform deltas.
 * This is the main logic extracted from all individual transform controls.
 */
export class TransformController {
  private config: TransformConfig;
  private tempEuler = new THREE.Euler();
  private tempQuaternion = new THREE.Quaternion();
  
  constructor(config: TransformConfig) {
    this.config = config;
  }
  
  /**
   * Apply all constraints to a raw transform delta
   */
  applyConstraints(delta: TransformDelta): TransformDelta {
    const result: TransformDelta = {
      position: delta.position.clone(),
      rotation: delta.rotation.clone(),
      scale: delta.scale.clone(),
    };
    
    this.applyPositionConstraints(result);
    this.applyRotationConstraints(result);
    this.applyScaleConstraints(result);
    
    return result;
  }
  
  /**
   * Apply position constraints
   */
  private applyPositionConstraints(delta: TransformDelta): void {
    const { position } = this.config.constraints;
    
    // Lock axes
    if (position.lockX) delta.position.x = 0;
    if (position.lockY) delta.position.y = 0;
    if (position.lockZ) delta.position.z = 0;
    
    // Clamp to bounds
    if (position.minX !== undefined) delta.position.x = Math.max(delta.position.x, position.minX);
    if (position.maxX !== undefined) delta.position.x = Math.min(delta.position.x, position.maxX);
    if (position.minY !== undefined) delta.position.y = Math.max(delta.position.y, position.minY);
    if (position.maxY !== undefined) delta.position.y = Math.min(delta.position.y, position.maxY);
    if (position.minZ !== undefined) delta.position.z = Math.max(delta.position.z, position.minZ);
    if (position.maxZ !== undefined) delta.position.z = Math.min(delta.position.z, position.maxZ);
    
    // Snap to grid
    if (position.snapGrid) {
      const grid = position.snapGrid;
      delta.position.x = Math.round(delta.position.x / grid) * grid;
      delta.position.y = Math.round(delta.position.y / grid) * grid;
      delta.position.z = Math.round(delta.position.z / grid) * grid;
    }
  }
  
  /**
   * Apply rotation constraints
   */
  private applyRotationConstraints(delta: TransformDelta): void {
    const { rotation } = this.config.constraints;
    
    // For clean Y extraction, convert through quaternion with YXZ order
    if (this.config.useYXZEulerOrder) {
      this.tempQuaternion.setFromEuler(delta.rotation);
      this.tempEuler.setFromQuaternion(this.tempQuaternion, 'YXZ');
      delta.rotation.copy(this.tempEuler);
    }
    
    // Lock axes
    if (rotation.lockX) delta.rotation.x = 0;
    if (rotation.lockY) delta.rotation.y = 0;
    if (rotation.lockZ) delta.rotation.z = 0;
    
    // Snap to degrees
    if (rotation.snapDegrees) {
      const snap = THREE.MathUtils.degToRad(rotation.snapDegrees);
      delta.rotation.x = Math.round(delta.rotation.x / snap) * snap;
      delta.rotation.y = Math.round(delta.rotation.y / snap) * snap;
      delta.rotation.z = Math.round(delta.rotation.z / snap) * snap;
    }
  }
  
  /**
   * Apply scale constraints
   */
  private applyScaleConstraints(delta: TransformDelta): void {
    const { scale } = this.config.constraints;
    
    if (!scale.enabled) {
      delta.scale.set(1, 1, 1);
      return;
    }
    
    // Uniform scaling
    if (scale.uniform) {
      const avg = (delta.scale.x + delta.scale.y + delta.scale.z) / 3;
      delta.scale.set(avg, avg, avg);
    }
    
    // Lock axes
    if (scale.lockX) delta.scale.x = 1;
    if (scale.lockY) delta.scale.y = 1;
    if (scale.lockZ) delta.scale.z = 1;
    
    // Clamp scale
    if (scale.minScale !== undefined) {
      delta.scale.x = Math.max(delta.scale.x, scale.minScale);
      delta.scale.y = Math.max(delta.scale.y, scale.minScale);
      delta.scale.z = Math.max(delta.scale.z, scale.minScale);
    }
    if (scale.maxScale !== undefined) {
      delta.scale.x = Math.min(delta.scale.x, scale.maxScale);
      delta.scale.y = Math.min(delta.scale.y, scale.maxScale);
      delta.scale.z = Math.min(delta.scale.z, scale.maxScale);
    }
  }
  
  /**
   * Extract Y rotation (spin) from euler in a reliable way
   * CRITICAL: Use 'YXZ' order for clean Y extraction
   */
  extractYRotation(euler: THREE.Euler): number {
    this.tempQuaternion.setFromEuler(euler);
    this.tempEuler.setFromQuaternion(this.tempQuaternion, 'YXZ');
    return this.tempEuler.y;
  }
  
  /**
   * Get active axes for PivotControls
   */
  getActiveAxes(): [boolean, boolean, boolean] {
    const { position } = this.config.constraints;
    return [
      !position.lockX,
      !position.lockY,
      !position.lockZ
    ];
  }
  
  /**
   * Check if any rotation is allowed
   */
  hasRotation(): boolean {
    const { rotation } = this.config.constraints;
    return !rotation.lockX || !rotation.lockY || !rotation.lockZ;
  }
  
  /**
   * Check if scaling is allowed
   */
  hasScale(): boolean {
    return this.config.constraints.scale.enabled;
  }
  
  /**
   * Get the config
   */
  getConfig(): TransformConfig {
    return this.config;
  }
  
  /**
   * Update config
   */
  updateConfig(config: Partial<TransformConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
```

### Step 5: Create Utility Functions (`src/core/transform/utils.ts`)

```typescript
import * as THREE from 'three';
import type { TransformComponentType } from './types';

/**
 * Calculate gizmo scale based on component type and data
 */
export function calculateGizmoScale(
  componentType: TransformComponentType,
  data: Record<string, any>
): number {
  switch (componentType) {
    case 'support':
      return Math.max((data.radius ?? data.width ?? 10) * 2, 25);
    case 'clamp':
      return 40; // Fixed size
    case 'hole':
      return Math.max((data.diameter ?? 10) * 3, 30);
    case 'label':
      return Math.max((data.fontSize ?? 10) * 2, 20);
    case 'baseplate':
      return Math.max(Math.max(data.width ?? 100, data.depth ?? 100) * 0.8, 30);
    case 'part':
      return Math.max((data.boundingRadius ?? 50) * 0.75, 25);
    default:
      return 30;
  }
}

/**
 * Calculate gizmo position based on component type and data
 */
export function calculateGizmoPosition(
  componentType: TransformComponentType,
  data: Record<string, any>
): THREE.Vector3 {
  switch (componentType) {
    case 'support': {
      // At TOP of support
      const center = data.center ?? { x: 0, y: 0 };
      const baseY = data.baseY ?? 0;
      const height = data.height ?? 10;
      return new THREE.Vector3(center.x, baseY + height + 5, center.y);
    }
    case 'clamp': {
      // At fixture point world position
      const pos = data.position ?? { x: 0, y: 0, z: 0 };
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    }
    case 'hole': {
      // Above baseplate surface
      const holeX = data.x ?? 0;
      const holeZ = data.z ?? 0;
      const baseTopY = data.baseTopY ?? 0;
      return new THREE.Vector3(holeX, baseTopY + 5, holeZ);
    }
    case 'label': {
      // Above label
      const labelPos = data.position ?? { x: 0, y: 0, z: 0 };
      const depth = data.depth ?? 0;
      return new THREE.Vector3(labelPos.x, labelPos.y + depth + 5, labelPos.z);
    }
    case 'baseplate': {
      // Above ground at section center
      const centerX = ((data.minX ?? 0) + (data.maxX ?? 100)) / 2;
      const centerZ = ((data.minZ ?? 0) + (data.maxZ ?? 100)) / 2;
      return new THREE.Vector3(centerX, 5, centerZ);
    }
    case 'part': {
      // At mesh world position
      const pos = data.worldPosition ?? { x: 0, y: 0, z: 0 };
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    }
    default:
      return new THREE.Vector3(0, 5, 0);
  }
}

/**
 * Dispatch orbit control disable event
 */
export function setOrbitControlsEnabled(enabled: boolean): void {
  window.dispatchEvent(
    new CustomEvent('disable-orbit-controls', { detail: { disabled: !enabled } })
  );
}

/**
 * Dispatch transform update event
 */
export function dispatchTransformUpdate(componentType: TransformComponentType, id: string): void {
  window.dispatchEvent(
    new CustomEvent('model-transform-updated', { 
      detail: { componentType, id } 
    })
  );
}

/**
 * Reset a pivot/group matrix to identity
 */
export function resetPivotMatrix(pivot: THREE.Object3D): void {
  pivot.matrix.identity();
  pivot.position.set(0, 0, 0);
  pivot.rotation.set(0, 0, 0);
  pivot.scale.set(1, 1, 1);
  pivot.updateMatrix();
}
```

### Step 6: Create Index Barrel Export (`src/core/transform/index.ts`)

```typescript
// Types
export type {
  PositionConstraints,
  RotationConstraints,
  ScaleConstraints,
  TransformConstraints,
  TransformConfig,
  TransformDelta,
  TransformOutput,
  TransformCallbacks,
  PivotMode,
  ActivationMode,
  DeactivationMode,
  TransformComponentType,
} from './types';

// Controller
export { TransformController } from './TransformController';

// Presets
export {
  SUPPORT_TRANSFORM_CONFIG,
  CLAMP_TRANSFORM_CONFIG,
  HOLE_TRANSFORM_CONFIG,
  LABEL_TRANSFORM_CONFIG,
  BASEPLATE_TRANSFORM_CONFIG,
  PART_TRANSFORM_CONFIG,
  getPresetConfig,
} from './presets';

// Utilities
export {
  calculateGizmoScale,
  calculateGizmoPosition,
  setOrbitControlsEnabled,
  dispatchTransformUpdate,
  resetPivotMatrix,
} from './utils';
```

### Step 7: Update Core Index (`src/core/index.ts`)

Add export for transform module:

```typescript
// Add to existing exports
export * from './transform';
```

---

## Validation

### Build Check
```powershell
npm run build
# Must pass with no errors
```

### Type Check
```powershell
npx tsc --noEmit
# Must pass with no errors
```

### Import Test
Create a temporary test to verify imports work:

```typescript
// Test in any file
import { 
  TransformController, 
  SUPPORT_TRANSFORM_CONFIG,
  calculateGizmoScale 
} from '@/core/transform';

const controller = new TransformController(SUPPORT_TRANSFORM_CONFIG);
console.log(controller.getActiveAxes());
```

---

## Post-Execution Checklist

- [ ] `src/core/transform/` directory created with all files
- [ ] All types exported from index.ts
- [ ] Build passes
- [ ] No TypeScript errors
- [ ] Transform presets match documented constraints

---

## Next Directive

After this directive completes, proceed to `12-create-transform-hooks.md` to create the React hooks that use this core system.

---

## Rollback

If issues occur:
```powershell
# Remove the transform directory
Remove-Item -Recurse -Force "src/core/transform"

# Restore core index if modified
git checkout -- src/core/index.ts
```
