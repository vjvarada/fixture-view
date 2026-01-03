/**
 * Transform Utilities
 *
 * App-specific transform utilities and event dispatchers.
 * Pure transform functions are re-exported from @rapidtool/cad-core.
 * 
 * ⚠️ CRITICAL: Do not modify coordinate conversion functions without
 * reading docs/refactoring/09_CRITICAL_SYSTEMS.md
 */

import * as THREE from 'three';
import { EVENTS } from '@/core/events';

// Re-export pure transform utilities from cad-core
export {
  type Transform3D,
  safeNum,
  resetGroupTransform,
  getWorldTransform,
  cadToThreeAxis,
  tempPosition,
  tempQuaternion,
  tempEuler,
} from '@rapidtool/cad-core';

// ─────────────────────────────────────────────────────────────────────────────
// App-specific Types (simplified version without scale)
// ─────────────────────────────────────────────────────────────────────────────

/** Simple transform without scale - used by UI components */
export interface SimpleTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional Reusable Objects
// ─────────────────────────────────────────────────────────────────────────────

export const tempBox = new THREE.Box3();
export const tempCenter = new THREE.Vector3();
export const tempSize = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// Orbit Control Management (App-specific event dispatching)
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
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TRANSFORM: SimpleTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Conversion Functions
// ─────────────────────────────────────────────────────────────────────────────

/** Converts radians to degrees */
export const radToDeg = THREE.MathUtils.radToDeg;

/** Converts degrees to radians */
export const degToRad = THREE.MathUtils.degToRad;

/**
 * Converts Three.js position to CAD-style position for display
 * Swaps Y and Z axes (Three.js Y-up -> CAD Z-up)
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
// Event Helpers (App-specific)
// ─────────────────────────────────────────────────────────────────────────────

/** Dispatches transform change event to 3D scene */
export const dispatchTransformChange = (
  partId: string,
  transform: SimpleTransform
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
