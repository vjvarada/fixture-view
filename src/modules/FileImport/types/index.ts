import * as THREE from 'three';

export interface ProcessedFile {
  id: string;  // Unique identifier for multi-part support
  mesh: THREE.Mesh;
  metadata: FileMetadata;
}

export interface FileMetadata {
  name: string;
  size: number;
  triangles: number;
  boundingBox: THREE.Box3;
  dimensions: THREE.Vector3;
  center: THREE.Vector3;
  processingTime: number;
  units: string;
}

export interface ViewerConfig {
  backgroundColor: number;
  gridSize: number;
  showGrid: boolean;
  showAxes: boolean;
  enableOrbitControls: boolean;
  pixelRatio: number;
  antialias: boolean;
  cameraType?: 'perspective' | 'orthographic';
}

export const DEFAULT_VIEWER_CONFIG: ViewerConfig = {
  backgroundColor: 0xf3f4f6, // Light gray
  gridSize: 10,
  showGrid: false,
  showAxes: false,
  enableOrbitControls: true,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  antialias: true,
  cameraType: 'orthographic',
};

// Supported import formats used by FileDropzone and file input accept attribute
export const SUPPORTED_FORMATS = ['.stl'];


export type ViewOrientation = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export interface ViewerHandle {
  addMesh: (mesh: THREE.Mesh) => void;
  removeMesh: (mesh?: THREE.Mesh) => void;
  resetView: () => void;
  setOrientation: (orientation: ViewOrientation) => void;
  fitToView: () => void;
  dispose: () => void;
  createOrUpdateBaseplate: (extraXY: number, height: number) => void;
  clearBaseplate: () => void;
}