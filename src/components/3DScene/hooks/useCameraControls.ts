/**
 * useCameraControls - Hook for managing camera orientation and framing
 * Extracted from 3DScene.tsx for modularity
 * 
 * Phase 5.6.2 extraction
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { BoundsSummary } from '../types';
import { 
  ORIENTATION_CONFIG, 
  getFootprintMetrics, 
  getProjectedSizeForOrientation 
} from '../utils/geometryUtils';

// Re-export ViewOrientation type for convenience
export type ViewOrientation = 'iso' | 'top' | 'front' | 'right' | 'left' | 'back' | 'bottom';

export interface UseCameraControlsProps {
  camera: THREE.Camera;
  size: { width: number; height: number };
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  modelBounds: BoundsSummary | null;
  importedPartsLength: number;
  setModelBounds: React.Dispatch<React.SetStateAction<BoundsSummary | null>>;
  setPartBounds: React.Dispatch<React.SetStateAction<Map<string, BoundsSummary>>>;
}

export interface UseCameraControlsReturn {
  // State
  currentOrientation: ViewOrientation;
  setCurrentOrientation: React.Dispatch<React.SetStateAction<ViewOrientation>>;
  orbitControlsEnabled: boolean;
  setOrbitControlsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Refs
  prevOrientationRef: React.MutableRefObject<ViewOrientation>;
  shouldReframeCameraRef: React.MutableRefObject<boolean>;
  
  // Callbacks
  updateCamera: (orientation: ViewOrientation, bounds: BoundsSummary | null) => void;
}

/**
 * Hook to manage camera orientation, framing, and orbit controls state
 */
export function useCameraControls({
  camera,
  size,
  controlsRef,
  modelBounds,
  importedPartsLength,
  setModelBounds,
  setPartBounds,
}: UseCameraControlsProps): UseCameraControlsReturn {
  // State
  const [currentOrientation, setCurrentOrientation] = useState<ViewOrientation>('iso');
  const [orbitControlsEnabled, setOrbitControlsEnabled] = useState(true);
  
  // Refs
  const prevOrientationRef = useRef<ViewOrientation>('iso');
  const shouldReframeCameraRef = useRef<boolean>(true);
  const lastOrientationRef = useRef<ViewOrientation>(currentOrientation);

  // Update camera position and framing based on orientation and bounds
  const updateCamera = useCallback((orientation: ViewOrientation, bounds: BoundsSummary | null) => {
    const orthoCam = camera as THREE.OrthographicCamera;
    const { direction, up } = ORIENTATION_CONFIG[orientation] || ORIENTATION_CONFIG.iso;
    const targetY = bounds ? bounds.center.y : 0;
    const target = new THREE.Vector3(0, targetY, 0);
    const normalizedDirection = direction.clone().normalize();

    const footprint = getFootprintMetrics(bounds);
    const footprintRadius = footprint.radius;
    const footprintPadding = footprint.padding;
    const crossHalfLength = footprint.halfLength;
    const radius = bounds?.radius ? Math.max(bounds.radius * (bounds.unitsScale ?? 1), footprintRadius) : footprintRadius;
    const crossSpan = crossHalfLength * 2;
    const horizontalSpan = bounds
      ? Math.max(bounds.size.x, bounds.size.z, crossSpan / (bounds.unitsScale ?? 1)) * (bounds.unitsScale ?? 1)
      : crossSpan;
    const verticalSpan = bounds ? bounds.size.y * (bounds.unitsScale ?? 1) : crossSpan * 0.6;
    const isIsoView = orientation === 'iso';
    const padding = bounds
      ? isIsoView
        ? Math.max(footprintPadding, 5)
        : Math.max(footprintPadding * 0.6, 2)
      : footprintPadding;

    const distance = bounds
      ? Math.max(
          radius * 3.0,
          crossSpan * 2.1,
          (horizontalSpan + padding * 2) * 1.05,
          (verticalSpan + padding * 2) * 1.15
        )
      : crossSpan * 2.1;

    const position = target.clone().add(normalizedDirection.multiplyScalar(distance));
    orthoCam.position.copy(position);
    orthoCam.up.copy(up.clone().normalize());
    orthoCam.lookAt(target);

    const dims = bounds ? getProjectedSizeForOrientation(bounds, orientation) : { horizontal: crossSpan, vertical: crossSpan };
    const spanHorizontal = Math.max(dims.horizontal * (bounds?.unitsScale ?? 1), crossSpan);
    const spanVertical = Math.max(dims.vertical * (bounds?.unitsScale ?? 1), verticalSpan);

    let halfWidth = spanHorizontal / 2 + padding;
    let halfHeight = spanVertical / 2 + Math.max(padding, 4);

    const aspect = size.width / size.height;
    if (halfWidth / halfHeight > aspect) {
      halfHeight = halfWidth / aspect;
    } else {
      halfWidth = halfHeight * aspect;
    }

    const framingScale = isIsoView ? 1.22 : 1.05;
    halfWidth *= framingScale;
    halfHeight *= framingScale;

    orthoCam.left = -halfWidth;
    orthoCam.right = halfWidth;
    orthoCam.top = halfHeight;
    orthoCam.bottom = -halfHeight;
    orthoCam.near = 0.1;
    orthoCam.far = Math.max(distance * 4, 2000);
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();

    if (controlsRef.current) {
      const c = controlsRef.current;
      c.target.copy(target);
      c.update();
    }
  }, [camera, size.width, size.height, controlsRef]);

  // Update camera when orientation changes or on first part load
  useEffect(() => {
    const orientationChanged = lastOrientationRef.current !== currentOrientation;
    lastOrientationRef.current = currentOrientation;

    // Update camera if:
    // 1. Orientation explicitly changed (user clicked view button), OR
    // 2. This is the first part being added (shouldReframeCameraRef is true)
    if (orientationChanged || (modelBounds && shouldReframeCameraRef.current)) {
      updateCamera(currentOrientation, modelBounds);
      shouldReframeCameraRef.current = false; // Reset after initial framing
    }
  }, [currentOrientation, modelBounds, updateCamera]);

  // Reset state when all parts are removed
  useEffect(() => {
    if (importedPartsLength === 0) {
      setModelBounds(null);
      setPartBounds(new Map());
      setCurrentOrientation('iso');
      shouldReframeCameraRef.current = true; // Reset so next part import will frame the camera
    }
  }, [importedPartsLength, setModelBounds, setPartBounds]);

  return {
    // State
    currentOrientation,
    setCurrentOrientation,
    orbitControlsEnabled,
    setOrbitControlsEnabled,
    
    // Refs
    prevOrientationRef,
    shouldReframeCameraRef,
    
    // Callbacks
    updateCamera,
  };
}
