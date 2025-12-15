import * as THREE from 'three';

/**
 * Types of baseplates available for fixture design
 */
export type BasePlateType = 
  | 'rectangular' 
  | 'convex-hull' 
  | 'perforated-panel' 
  | 'metal-wooden-plate';

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
