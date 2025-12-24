/**
 * Mounting Holes Types
 * 
 * Type definitions for mounting hole configuration and placement.
 */

import * as THREE from 'three';

export type HoleType = 'through' | 'countersink' | 'counterbore';

/**
 * Base hole configuration (from DrillStepContent)
 */
export interface HoleConfig {
  id: string;
  type: HoleType;
  diameter: number;
  // Counter sink specific
  countersinkAngle?: number;
  countersinkDiameter?: number;
  // Counter bore specific
  counterboreDiameter?: number;
  counterboreDepth?: number;
}

/**
 * Placed hole with position on baseplate
 */
export interface PlacedHole extends HoleConfig {
  /** Position on the baseplate XZ plane (center of hole) */
  position: THREE.Vector2;
  /** Depth of the hole (for through holes, this is baseplate height) */
  depth: number;
  /** Optional rotation around Y axis (radians) - useful for patterns */
  rotationY?: number;
}

/**
 * Hole placement mode state
 */
export interface HolePlacementState {
  /** Whether placement mode is active */
  isActive: boolean;
  /** The hole configuration being placed */
  config: HoleConfig | null;
  /** Preview position while hovering */
  previewPosition: THREE.Vector2 | null;
}

/**
 * CSG operation status for a hole
 */
export interface HoleCSGStatus {
  holeId: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress?: number;
  error?: string;
}

/**
 * Serialized geometry for web worker transfer
 */
export interface SerializedHoleGeometry {
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
}

/**
 * Standard countersink dimensions for flat head screws (90° metric)
 */
export const COUNTERSINK_STANDARDS: Record<number, { diameter: number; angle: number }> = {
  3: { diameter: 6.5, angle: 90 },
  4: { diameter: 8.4, angle: 90 },
  5: { diameter: 10.4, angle: 90 },
  6: { diameter: 12.6, angle: 90 },
  8: { diameter: 16.6, angle: 90 },
  10: { diameter: 20, angle: 90 },
  12: { diameter: 24, angle: 90 },
};

/**
 * Standard counterbore dimensions for socket head cap screws (SHCS)
 */
export const COUNTERBORE_STANDARDS: Record<number, { diameter: number; depth: number }> = {
  3: { diameter: 5.5, depth: 3 },
  4: { diameter: 7, depth: 4 },
  5: { diameter: 8.5, depth: 5 },
  6: { diameter: 10, depth: 6 },
  8: { diameter: 13, depth: 8 },
  10: { diameter: 16, depth: 10 },
  12: { diameter: 18, depth: 12 },
};
