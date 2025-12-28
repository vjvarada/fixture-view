/**
 * Transform Utilities
 *
 * Shared utilities for position/rotation transformations between
 * UI (CAD convention) and Three.js coordinate systems.
 * 
 * ⚠️ CRITICAL: Do not modify coordinate conversion functions without
 * reading docs/refactoring/09_CRITICAL_SYSTEMS.md
 */

import * as THREE from 'three';
import { EVENTS } from '@/core/events';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Transform3D {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable THREE Objects (avoid allocations in render loop)
// ─────────────────────────────────────────────────────────────────────────────

export const tempPosition = new THREE.Vector3();
export const tempQuaternion = new THREE.Quaternion();
export const tempEuler = new THREE.Euler();
export const tempBox = new THREE.Box3();
export const tempCenter = new THREE.Vector3();
export const tempSize = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// Safe Number Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely parses a number with a fallback default.
 * Used throughout transform controls to handle undefined values.
 */
export function safeNum(value: number | undefined | null, defaultValue: number): number {
  const num = Number(value);
  return Number.isNaN(num) ? defaultValue : num;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit Control Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches event to enable/disable orbit controls.
 * Use during drag operations to prevent camera movement.
 */
export function setOrbitControlsEnabled(enabled: boolean): void {
  window.dispatchEvent(
    new CustomEvent(EVENTS.DISABLE_ORBIT_CONTROLS, { 
      detail: { disabled: !enabled } 
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pivot/Group Transform Reset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resets a THREE.js group's transform to identity.
 * CRITICAL: Must be called after drag ends to prevent accumulated transforms.
 * This is the anti-jitter pattern used in all transform controls.
 */
export function resetGroupTransform(group: THREE.Group | null): void {
  if (!group) return;
  group.matrix.identity();
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  group.updateMatrix();
}

// ─────────────────────────────────────────────────────────────────────────────
// World Transform Extraction
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TRANSFORM: Transform3D = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversion Functions
// ─────────────────────────────────────────────────────────────────────────────

/** Converts radians to degrees */
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Converts degrees to radians */
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Maps CAD axis to Three.js axis
 * CAD Convention: X = horizontal, Y = depth, Z = vertical
 * Three.js: X = horizontal, Y = vertical, Z = depth
 */
export const cadToThreeAxis = (cadAxis: 'x' | 'y' | 'z'): 'x' | 'y' | 'z' => {
  switch (cadAxis) {
    case 'y':
      return 'z';
    case 'z':
      return 'y';
    default:
      return 'x';
  }
};

/**
 * Converts Three.js position to CAD-style position for display
 * Swaps Y and Z axes
 */
export const toCadPosition = (position: { x: number; y: number; z: number }) => ({
  x: position.x,
  y: position.z, // CAD Y = Three.js Z
  z: position.y, // CAD Z = Three.js Y
});

/**
 * Converts Three.js rotation to CAD-style rotation for display
 * Swaps Y and Z axes
 */
export const toCadRotation = (rotation: { x: number; y: number; z: number }) => ({
  x: rotation.x,
  y: rotation.z, // CAD Y = Three.js Z
  z: rotation.y, // CAD Z = Three.js Y
});

// ─────────────────────────────────────────────────────────────────────────────
// Event Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Dispatches transform change event to 3D scene */
export const dispatchTransformChange = (
  partId: string,
  transform: Transform3D
): void => {
  window.dispatchEvent(
    new CustomEvent(EVENTS.SET_MODEL_TRANSFORM, {
      detail: {
        partId,
        position: new THREE.Vector3(
          transform.position.x,
          transform.position.y,
          transform.position.z
        ),
        rotation: new THREE.Euler(
          degToRad(transform.rotation.x),
          degToRad(transform.rotation.y),
          degToRad(transform.rotation.z)
        ),
        respectBaseplate: true,
      },
    })
  );
};

/** Requests transform data from 3D scene for a part */
export const requestPartTransform = (partId: string): void => {
  window.dispatchEvent(
    new CustomEvent(EVENTS.REQUEST_MODEL_TRANSFORM, {
      detail: { partId },
    })
  );
};

/** Dispatches event to set part on baseplate */
export const dispatchSetToBaseplate = (partId: string): void => {
  window.dispatchEvent(
    new CustomEvent(EVENTS.SET_PART_TO_BASEPLATE, {
      detail: { partId },
    })
  );
};
