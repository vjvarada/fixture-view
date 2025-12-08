/**
 * useFileProcessing Hook
 * 
 * Handles file upload, parsing, and processing for 3D model files.
 * Supports STL format with extensible architecture for additional formats.
 */

import { useState, useCallback } from 'react';
import * as THREE from 'three';
import { ProcessedFile, FileMetadata, SUPPORTED_FORMATS } from '../types';
import { parseSTL, validateSTLBuffer } from '../services/stlParser';

// ============================================================================
// Types
// ============================================================================

interface UseFileProcessingReturn {
  processFile: (file: File, units?: string) => Promise<ProcessedFile | undefined>;
  isProcessing: boolean;
  error: string | null;
  clearError: () => void;
}

// ============================================================================
// Configuration
// ============================================================================

/** Maximum allowed file size (100MB) */
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/** Files larger than this will be automatically optimized (5MB) */
export const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

const UNIT_SCALES: Record<string, number> = {
  mm: 1,
  cm: 10,
  inch: 25.4,
};

const DEFAULT_MATERIAL_CONFIG = {
  color: 0xb0b0b0,
  roughness: 0.6,
  metalness: 0.0,
  side: THREE.DoubleSide,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? `.${parts.pop()!.toLowerCase()}` : '';
}

function validateFile(file: File): void {
  const extension = getFileExtension(file.name);
  
  if (!SUPPORTED_FORMATS.includes(extension)) {
    throw new Error(
      `Unsupported format: ${extension}. Supported: ${SUPPORTED_FORMATS.join(', ')}`
    );
  }
  
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }
}

function computeMetadata(
  geometry: THREE.BufferGeometry,
  file: File,
  processingTimeMs: number,
  units: string
): FileMetadata {
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox!;
  
  const dimensions = boundingBox.getSize(new THREE.Vector3());
  const center = boundingBox.getCenter(new THREE.Vector3());
  
  const positionAttr = geometry.getAttribute('position');
  const triangles = Math.floor(positionAttr.count / 3);
  
  return {
    name: file.name,
    size: file.size,
    triangles,
    boundingBox,
    dimensions,
    center,
    processingTime: processingTimeMs,
    units,
  };
}

function createMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: DEFAULT_MATERIAL_CONFIG.color,
    roughness: DEFAULT_MATERIAL_CONFIG.roughness,
    metalness: DEFAULT_MATERIAL_CONFIG.metalness,
    side: DEFAULT_MATERIAL_CONFIG.side,
  });
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useFileProcessing(): UseFileProcessingReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const processFile = useCallback(async (
    file: File, 
    units: string = 'mm'
  ): Promise<ProcessedFile | undefined> => {
    const startTime = performance.now();
    
    try {
      setIsProcessing(true);
      setError(null);
      
      // Validate file
      validateFile(file);
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Parse geometry based on file type
      const extension = getFileExtension(file.name);
      let geometry: THREE.BufferGeometry;
      
      switch (extension) {
        case '.stl': {
          const validation = validateSTLBuffer(arrayBuffer);
          if (!validation.valid) {
            throw new Error(validation.error || 'Invalid STL file');
          }
          const result = parseSTL(arrayBuffer);
          geometry = result.geometry;
          break;
        }
        default:
          throw new Error(`Parser for ${extension} not implemented`);
      }
      
      // Apply coordinate system transformation (STL typically uses Z-up, Three.js uses Y-up)
      geometry.rotateX(-Math.PI / 2);
      
      // Ensure normals exist
      if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
      }
      
      // Compute BVH for raycasting optimization (if available)
      if (typeof (geometry as any).computeBoundsTree === 'function') {
        (geometry as any).computeBoundsTree();
      }
      
      // Create mesh
      const material = createMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      // Compute metadata
      const processingTime = performance.now() - startTime;
      const metadata = computeMetadata(geometry, file, processingTime, units);
      
      return { mesh, metadata };
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('[useFileProcessing] Error:', err);
      return undefined;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    processFile,
    isProcessing,
    error,
    clearError,
  };
}

export default useFileProcessing;
