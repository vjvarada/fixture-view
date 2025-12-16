/**
 * Label Types and Constants
 *
 * Defines the configuration types and constants for 3D text labels
 * used in fixture design.
 */

import * as THREE from 'three';

/** Available font families for labels */
export type LabelFont = 'helvetiker' | 'roboto' | 'arial';

/** Font configuration with display label and file path */
interface FontOption {
  value: LabelFont;
  label: string;
  file: string;
}

/** Available fonts with their configurations */
export const LABEL_FONTS: readonly FontOption[] = [
  { value: 'helvetiker', label: 'Helvetica Bold', file: '/fonts/helvetiker_bold.typeface.json' },
  { value: 'roboto', label: 'Roboto (Droid Sans)', file: '/fonts/roboto_bold.typeface.json' },
  { value: 'arial', label: 'Arial (Helvetiker)', file: '/fonts/arial_bold.typeface.json' },
] as const;

/** Default font used when none specified */
const DEFAULT_FONT = LABEL_FONTS[0];

/**
 * Returns the font file path for a given font family.
 * Falls back to default font if not found.
 */
export const getFontFile = (font: LabelFont): string => {
  const found = LABEL_FONTS.find((f) => f.value === font);
  return found?.file ?? DEFAULT_FONT.file;
};

/** Label size constraints (in mm) */
export const MIN_FONT_SIZE = 5;
export const MAX_FONT_SIZE = 50;
export const MIN_DEPTH = 0.6;
export const MAX_DEPTH = 5;
export const DEFAULT_DEPTH = 1;
export const DEFAULT_FONT_SIZE = 8;

/** Position type that can be either THREE.Vector3 or plain object */
export type LabelPosition = THREE.Vector3 | { x: number; y: number; z: number };

/** Rotation type that can be either THREE.Euler or plain object */
export type LabelRotation = THREE.Euler | { x: number; y: number; z: number };

/** Configuration for a single 3D text label */
export interface LabelConfig {
  /** Unique identifier */
  id: string;
  /** Text content to display */
  text: string;
  /** Font size in mm (minimum 5mm) */
  fontSize: number;
  /** Emboss/extrusion depth in mm */
  depth: number;
  /** Font family */
  font: LabelFont;
  /** World position */
  position: LabelPosition;
  /** Rotation (primarily Z for surface orientation) */
  rotation: LabelRotation;
  /** Computed text width in mm (set by LabelMesh after rendering) */
  computedWidth?: number;
  /** Computed text height in mm (set by LabelMesh after rendering) */
  computedHeight?: number;
}

/** Default configuration for new labels (excludes id and position) */
export const DEFAULT_LABEL_CONFIG: Omit<LabelConfig, 'id' | 'position'> = {
  text: 'V1.0',
  fontSize: DEFAULT_FONT_SIZE,
  depth: DEFAULT_DEPTH,
  font: 'helvetiker',
  rotation: new THREE.Euler(0, 0, 0),
};

/**
 * Converts a LabelPosition to THREE.Vector3.
 * Returns the same instance if already a Vector3.
 */
export const toVector3 = (pos: LabelPosition): THREE.Vector3 => {
  if (pos instanceof THREE.Vector3) {
    return pos;
  }
  return new THREE.Vector3(pos.x, pos.y, pos.z);
};

/**
 * Converts a LabelRotation to THREE.Euler.
 * Returns the same instance if already an Euler.
 */
export const toEuler = (rot: LabelRotation): THREE.Euler => {
  if (rot instanceof THREE.Euler) {
    return rot;
  }
  return new THREE.Euler(rot.x, rot.y, rot.z);
};

/**
 * Gets a numeric value from a position along a specific axis.
 */
export const getPositionAxis = (pos: LabelPosition, axis: 'x' | 'y' | 'z'): number => {
  if (pos instanceof THREE.Vector3) {
    return pos[axis];
  }
  return pos[axis] ?? 0;
};

/**
 * Gets the Z rotation value from a LabelRotation (in radians).
 */
export const getRotationZ = (rot: LabelRotation): number => {
  if (rot instanceof THREE.Euler) {
    return rot.z;
  }
  return rot.z ?? 0;
};
