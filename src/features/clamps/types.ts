// Clamp type definitions

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Double-click detection threshold in milliseconds */
export const DOUBLE_CLICK_THRESHOLD_MS = 300;

/** Selection highlight color (blue) */
export const SELECTION_COLOR = 0x3b82f6;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ClampCategory = 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push';

export interface ClampInfo {
  name: string;
  url?: string;
  force?: string;
  feature?: string;
  type?: string;
}

export interface ClampModel {
  id: string;
  name: string;
  category: ClampCategory;
  info: ClampInfo;
  // Paths to model files (relative to clamp folder)
  modelPath: string;
  mtlPath?: string;
  imagePath?: string;
  // Additional component files
  fixturePointPath?: string;
  fixtureMountSurfacePath?: string;
  fixtureCutoutsPath?: string;
}

export interface ClampCategoryGroup {
  category: ClampCategory;
  clamps: ClampModel[];
}

export interface PlacedClamp {
  id: string;
  clampModelId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  /** Whether the clamp body is visible (supports remain visible) */
  visible?: boolean;
  /** ID of the baseplate section this clamp belongs to (for multi-section baseplates) */
  sectionId?: string;
}

export interface ClampsState {
  categories: ClampCategoryGroup[];
  selectedCategory: ClampCategory | null;
  selectedClamp: ClampModel | null;
  placedClamps: PlacedClamp[];
  isLoading: boolean;
}
