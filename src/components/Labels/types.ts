import * as THREE from 'three';

// Available fonts for labels
export type LabelFont = 'helvetiker' | 'roboto' | 'arial';

export const LABEL_FONTS: { value: LabelFont; label: string; file: string }[] = [
  { value: 'helvetiker', label: 'Helvetica Bold', file: '/fonts/helvetiker_bold.typeface.json' },
  { value: 'roboto', label: 'Roboto (Droid Sans)', file: '/fonts/roboto_bold.typeface.json' },
  { value: 'arial', label: 'Arial (Helvetiker)', file: '/fonts/arial_bold.typeface.json' },
];

export const getFontFile = (font: LabelFont): string => {
  return LABEL_FONTS.find(f => f.value === font)?.file || LABEL_FONTS[0].file;
};

export interface LabelConfig {
  id: string;
  text: string;
  fontSize: number;      // mm, minimum 5mm
  depth: number;         // mm, emboss height (default 1mm)
  font: LabelFont;       // font family
  position: THREE.Vector3;  // world position
  rotation: THREE.Euler;    // rotation (primarily Y for orientation on surface)
  // Computed bounds from actual rendered geometry (set by LabelMesh)
  computedWidth?: number;   // actual text width in mm
  computedHeight?: number;  // actual text height in mm
}

export const DEFAULT_LABEL_CONFIG: Omit<LabelConfig, 'id' | 'position'> = {
  text: 'V1.0',
  fontSize: 8,          // 8mm default, 5mm minimum
  depth: 1,             // 1mm default emboss height
  font: 'helvetiker',   // default font
  rotation: new THREE.Euler(0, 0, 0),
};

export const MIN_FONT_SIZE = 5;  // mm
export const MAX_FONT_SIZE = 50; // mm
export const MIN_DEPTH = 0.3;    // mm
export const MAX_DEPTH = 5;      // mm
export const DEFAULT_DEPTH = 1;  // mm
