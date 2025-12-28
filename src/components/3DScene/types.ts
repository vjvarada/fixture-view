/**
 * Types for 3DScene component and its subcomponents
 */

import * as THREE from 'three';
import { ProcessedFile, ViewOrientation } from '@/modules/FileImport/types';

// =============================================================================
// Component Props
// =============================================================================

export interface ThreeDSceneProps {
  /** Array of imported model files */
  importedParts: ProcessedFile[];
  /** ID of the currently selected part */
  selectedPartId: string | null;
  /** Callback when a part is selected */
  onPartSelected: (partId: string | null) => void;
  /** Callback when a model color is assigned */
  onModelColorAssigned?: (modelId: string, color: string) => void;
  /** Map of part IDs to visibility state */
  partVisibility?: Map<string, boolean>;
  /** Callback when part visibility changes */
  onPartVisibilityChange?: (partId: string, visible: boolean) => void;
  /** Whether the baseplate is visible */
  baseplateVisible?: boolean;
  /** Whether dark mode is enabled */
  isDarkMode?: boolean;
  /** ID of the currently selected support */
  selectedSupportId?: string | null;
  /** Callback when a support is selected */
  onSupportSelect?: (supportId: string | null) => void;
}

// =============================================================================
// Transform Data Types
// =============================================================================

export interface TransformData {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

export interface LiveTransformData extends TransformData {
  bounds: THREE.Box3;
  pivotClosed?: boolean;
}

// =============================================================================
// Bounds Types
// =============================================================================

export interface BoundsSummary {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
  unitsScale?: number;
}

// =============================================================================
// Grid Configuration
// =============================================================================

export interface GridConfig {
  size: number;
  divisions: number;
  majorDivisions: number;
  cellSize?: number;
}

// =============================================================================
// View Orientation
// =============================================================================

export interface OrientationConfig {
  direction: THREE.Vector3;
  up: THREE.Vector3;
}

export type OrientationConfigMap = Record<ViewOrientation, OrientationConfig>;

// =============================================================================
// Model Mesh Props
// =============================================================================

export interface ModelMeshProps {
  file: ProcessedFile;
  meshRef?: React.RefObject<THREE.Mesh>;
  dimensions?: { x?: number; y?: number; z?: number };
  colorsMap?: Map<string, string>;
  setColorsMap?: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  onBoundsChange?: (bounds: BoundsSummary) => void;
  disableDoubleClick?: boolean;
  onDoubleClick?: () => void;
  initialOffset?: THREE.Vector3;
}

// =============================================================================
// Fixture Component Props (placeholder for future)
// =============================================================================

export interface FixtureComponentProps {
  component: { geometry: THREE.BufferGeometry; material: THREE.Material };
  position: THREE.Vector3;
  onSelect?: () => void;
}

// =============================================================================
// Debug Props
// =============================================================================

export interface DebugPerimeterLineProps {
  perimeter: Array<{ x: number; z: number }>;
  y: number;
}

export interface DebugSilhouetteLineProps {
  silhouette: Array<{ x: number; z: number }>;
  y: number;
  color?: number;
}

// =============================================================================
// Footprint Metrics
// =============================================================================

export interface FootprintMetrics {
  radius: number;
  padding: number;
  halfLength: number;
}

// =============================================================================
// Projected Size (for camera calculations)
// =============================================================================

export interface ProjectedSize {
  horizontal: number;
  vertical: number;
}
