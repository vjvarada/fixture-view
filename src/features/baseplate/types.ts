import * as THREE from 'three';

/**
 * Types of baseplates available for fixture design
 */
export type BasePlateType = 
  | 'rectangular' 
  | 'convex-hull' 
  | 'perforated-panel' 
  | 'metal-wooden-plate'
  | 'multi-section';

/**
 * A single section/region in a multi-section baseplate
 */
export interface BasePlateSection {
  id: string;
  /** Min X coordinate in world space (mm) */
  minX: number;
  /** Max X coordinate in world space (mm) */
  maxX: number;
  /** Min Z coordinate in world space (mm) */
  minZ: number;
  /** Max Z coordinate in world space (mm) */
  maxZ: number;
  /** Original size when first created (for maintaining minimum size) */
  originalWidth?: number;
  originalDepth?: number;
  /** Original center position (for shrinking back to original position when items are removed) */
  originalCenterX?: number;
  originalCenterZ?: number;
}

/**
 * Material options for baseplates
 */
export type BasePlateMaterial = 'metal' | 'wood' | 'plastic';

/**
 * Configuration for a baseplate in the fixture design
 */
export interface BasePlateConfig {
  /** Type of baseplate geometry */
  type: BasePlateType;
  /** Width in X direction (mm) */
  width?: number;
  /** Height/length in Z direction (mm) */
  height?: number;
  /** Thickness in Y direction (mm) */
  depth?: number;
  /** Position in world space */
  position?: THREE.Vector3;
  /** Material appearance */
  material?: BasePlateMaterial;
  /** Unique identifier */
  id?: string;
  /** Extra margin for convex hull (mm per side) */
  oversizeXY?: number;
  /** Hole spacing for perforated panels (mm) */
  pitch?: number;
  /** Hole diameter for perforated/mounting panels (mm) */
  holeDiameter?: number;
  /** Corner radius for convex hull (mm) - rounds off sharp vertices */
  cornerRadius?: number;
  /** Sections for multi-section baseplate */
  sections?: BasePlateSection[];
  /** Whether multi-section drawing mode is active */
  isDrawingMode?: boolean;
}

/**
 * Model geometry info for convex hull calculation
 */
export interface ModelGeometryInfo {
  geometry: THREE.BufferGeometry;
  matrixWorld: THREE.Matrix4;
}

/**
 * Props for the BasePlate component
 */
export interface BasePlateProps {
  type: BasePlateType;
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  position?: THREE.Vector3;
  material?: BasePlateMaterial;
  onSelect?: () => void;
  selected?: boolean;
  /** Model geometry for convex hull calculation (single model, for backward compatibility) */
  modelGeometry?: THREE.BufferGeometry;
  /** World transform of model for accurate hull (single model) */
  modelMatrixWorld?: THREE.Matrix4;
  /** Multiple model geometries for convex hull calculation */
  modelGeometries?: ModelGeometryInfo[];
  /** Model world position for hull reference */
  modelOrigin?: THREE.Vector3;
  /** Extra margin on XZ for convex hull (mm) */
  oversizeXY?: number;
  /** Perforated panel hole spacing (mm) */
  pitch?: number;
  /** Perforated/mounting panel hole diameter (mm) */
  holeDiameter?: number;
  /** Pointer event handlers for interactive placement */
  onPointerDown?: (e: unknown) => void;
  onPointerMove?: (e: unknown) => void;
  onPointerUp?: (e: unknown) => void;
  /** External mesh ref for parent access */
  meshRef?: React.RefObject<THREE.Mesh>;
  /** Additional points for convex hull (e.g., from supports) */
  additionalHullPoints?: Array<{ x: number; z: number }>;
  /** Live position delta during pivot transform */
  livePositionDelta?: { x: number; z: number } | null;
  /** Corner radius for convex hull (mm) - rounds off sharp vertices */
  cornerRadius?: number;
}

/**
 * Checks if two baseplate sections overlap
 */
export function sectionsOverlap(a: BasePlateSection, b: BasePlateSection): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

/**
 * Merges two overlapping sections into one larger section
 */
export function mergeSections(a: BasePlateSection, b: BasePlateSection): BasePlateSection {
  // Validate inputs to prevent NaN propagation
  const minX = Math.min(a.minX, b.minX);
  const maxX = Math.max(a.maxX, b.maxX);
  const minZ = Math.min(a.minZ, b.minZ);
  const maxZ = Math.max(a.maxZ, b.maxZ);
  
  // Calculate original dimensions from first section's original values or current size
  const origWidthA = a.originalWidth ?? (a.maxX - a.minX);
  const origDepthA = a.originalDepth ?? (a.maxZ - a.minZ);
  const origWidthB = b.originalWidth ?? (b.maxX - b.minX);
  const origDepthB = b.originalDepth ?? (b.maxZ - b.minZ);
  
  // Use the larger original size to ensure we don't shrink below either section's original size
  const originalWidth = Math.max(origWidthA, origWidthB);
  const originalDepth = Math.max(origDepthA, origDepthB);
  
  // Log error if any value is NaN
  if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minZ) || !isFinite(maxZ) ||
      !isFinite(originalWidth) || !isFinite(originalDepth)) {
    console.error('[mergeSections] Invalid section bounds detected:', { 
      a: { minX: a.minX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ, originalWidth: a.originalWidth, originalDepth: a.originalDepth },
      b: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, originalWidth: b.originalWidth, originalDepth: b.originalDepth },
      result: { minX, maxX, minZ, maxZ, originalWidth, originalDepth }
    });
  }
  
  return {
    id: `merged-${Date.now()}`,
    minX,
    maxX,
    minZ,
    maxZ,
    originalWidth,
    originalDepth,
  };
}

/**
 * Merges all overlapping sections in an array
 * Returns a new array with overlapping sections combined
 */
export function mergeOverlappingSections(sections: BasePlateSection[]): BasePlateSection[] {
  if (sections.length <= 1) return sections;
  
  let merged = [...sections];
  let didMerge = true;
  
  // Keep merging until no more overlaps are found
  while (didMerge) {
    didMerge = false;
    const newMerged: BasePlateSection[] = [];
    const used = new Set<number>();
    
    for (let i = 0; i < merged.length; i++) {
      if (used.has(i)) continue;
      
      let current = merged[i];
      let mergedWithAny = false;
      
      for (let j = i + 1; j < merged.length; j++) {
        if (used.has(j)) continue;
        
        if (sectionsOverlap(current, merged[j])) {
          current = mergeSections(current, merged[j]);
          used.add(j);
          mergedWithAny = true;
          didMerge = true;
        }
      }
      
      newMerged.push(current);
      used.add(i);
    }
    
    merged = newMerged;
  }
  
  return merged;
}
