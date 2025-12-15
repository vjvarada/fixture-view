// Clamp data definitions
// This file provides the static clamp library data based on what's in public/clamps folder
//
// Industry-standard folder structure:
// public/clamps/
//   {category-kebab-case}/     e.g., toggle-clamps-vertical, toggle-clamps-side-push
//     {MODEL-ID}/              e.g., C-LD-101A
//       {MODEL-ID}.obj         Main 3D model
//       {MODEL-ID}.mtl         Material file (optional)
//       info.json              Clamp metadata (name, force, url)
//       image.jpg              Thumbnail image
//       fixture_point.obj      Clamping contact point
//       fixture_mount_surface.obj  Mounting surface geometry
//       fixture_cutouts.obj    Cutout geometry for boolean operations

import { ClampModel, ClampCategory, ClampCategoryGroup } from './types';

// Base path for clamp models (served from public folder)
const CLAMPS_BASE_PATH = '/clamps';

// Category folder mapping
const CATEGORY_FOLDERS: Record<ClampCategory, string> = {
  'Toggle Clamps Vertical': 'toggle-clamps-vertical',
  'Toggle Clamps Side Push': 'toggle-clamps-side-push',
};

// Helper to build clamp paths
function buildClampPaths(category: ClampCategory, modelId: string) {
  const categoryFolder = CATEGORY_FOLDERS[category];
  const basePath = `${CLAMPS_BASE_PATH}/${categoryFolder}/${modelId}`;
  
  return {
    modelPath: `${basePath}/${modelId}.obj`,
    mtlPath: `${basePath}/${modelId}.mtl`,
    imagePath: `${basePath}/image.jpg`,
    fixturePointPath: `${basePath}/fixture_point.obj`,
    fixtureMountSurfacePath: `${basePath}/fixture_mount_surface.obj`,
    fixtureCutoutsPath: `${basePath}/fixture_cutouts.obj`,
  };
}

// Define all available clamps organized by category
// When adding new clamps, add them to this registry
const CLAMP_REGISTRY: ClampModel[] = [
  // Toggle Clamps Vertical
  {
    id: 'c-ld-101a-vertical',
    name: 'C-LD-101A',
    category: 'Toggle Clamps Vertical',
    info: {
      name: 'C-LD-101A',
      url: 'https://in.misumi-ec.com/vona2/detail/110310216449?HissuCode=C-LD-101A',
      force: '441N'
    },
    ...buildClampPaths('Toggle Clamps Vertical', 'C-LD-101A'),
  },
  // Toggle Clamps Side Push
  // Add side push clamps here when available
];

// Get all clamp categories with their clamps
export function getClampCategories(): ClampCategoryGroup[] {
  const categories: ClampCategory[] = ['Toggle Clamps Vertical', 'Toggle Clamps Side Push'];
  
  return categories.map(category => ({
    category,
    clamps: CLAMP_REGISTRY.filter(clamp => clamp.category === category)
  }));
}

// Get clamps by category
export function getClampsByCategory(category: ClampCategory): ClampModel[] {
  return CLAMP_REGISTRY.filter(clamp => clamp.category === category);
}

// Get a single clamp by ID
export function getClampById(id: string): ClampModel | undefined {
  return CLAMP_REGISTRY.find(clamp => clamp.id === id);
}

// Get all clamps
export function getAllClamps(): ClampModel[] {
  return [...CLAMP_REGISTRY];
}

// Category display info
export const CATEGORY_INFO: Record<ClampCategory, { description: string; icon: string }> = {
  'Toggle Clamps Vertical': {
    description: 'Vertical action toggle clamps for top-down clamping',
    icon: '↓'
  },
  'Toggle Clamps Side Push': {
    description: 'Side push toggle clamps for horizontal clamping',
    icon: '→'
  }
};
