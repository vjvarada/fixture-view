// Clamp type definitions

export type ClampCategory = 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push';

export interface ClampInfo {
  name: string;
  url?: string;
  force?: string;
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
}

export interface ClampsState {
  categories: ClampCategoryGroup[];
  selectedCategory: ClampCategory | null;
  selectedClamp: ClampModel | null;
  placedClamps: PlacedClamp[];
  isLoading: boolean;
}
