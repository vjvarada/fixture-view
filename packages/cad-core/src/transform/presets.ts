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
