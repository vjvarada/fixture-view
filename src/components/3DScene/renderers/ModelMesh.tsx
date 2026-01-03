/**
 * ModelMesh - Renders individual imported STL models with proper orientation and coloring
 * Extracted from 3DScene.tsx for modularity
 */
import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import type { ProcessedFile } from '../../../modules/FileImport/types';
import type { BoundsSummary } from '../types';
import { computeDominantUpQuaternion } from '../utils/geometryUtils';
import { getModelColor } from '../utils/colorUtils';

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

/**
 * ModelMesh renders an imported 3D model with:
 * - Automatic orientation correction (largest face down)
 * - Color assignment from palette
 * - Double-click detection for interactions
 * - Bounds reporting for layout calculations
 */
const ModelMesh = React.memo(function ModelMesh({ 
  file, 
  meshRef, 
  dimensions, 
  colorsMap, 
  setColorsMap, 
  onBoundsChange,
  disableDoubleClick = false,
  onDoubleClick,
  initialOffset
}: ModelMeshProps) {
  const internalRef = useRef<THREE.Mesh>(null);
  const actualRef = meshRef || internalRef;
  const hasNormalizedRef = useRef(false);
  const lastClickTimeRef = useRef<number>(0);
  
  const DOUBLE_CLICK_DELAY = 300;

  const unitScale = useMemo(() => {
    switch (file.metadata.units) {
      case 'cm': return 10;
      case 'inch': return 25.4;
      default: return 1;
    }
  }, [file.metadata.units]);

  const modelId = file.metadata.name;
  const modelColor = getModelColor(modelId, colorsMap || new Map());

  // Assign color on mount
  useEffect(() => {
    if (setColorsMap && colorsMap && !colorsMap.has(modelId)) {
      setColorsMap(prev => new Map(prev.set(modelId, getModelColor(modelId, colorsMap))));
    }
  }, [modelId, setColorsMap, colorsMap]);

  // Apply material color
  useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh?.material || !modelColor) return;
    
    const hex = modelColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if ('color' in material) {
      material.color.setRGB(r, g, b);
      material.needsUpdate = true;
    }
  }, [modelColor, actualRef]);

  // Emit transform on mount and whenever mesh position might have changed from setup
  useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh) return;
    
    // Delay slightly to ensure position is finalized after any setup
    const timeoutId = setTimeout(() => {
      if (actualRef.current) {
        window.dispatchEvent(new CustomEvent('model-transform-updated', {
          detail: {
            position: actualRef.current.position.clone(),
            rotation: actualRef.current.rotation.clone(),
            partId: file.id,
          },
        }));
      }
    }, 50);
    
    return () => clearTimeout(timeoutId);
  }, [file.id, actualRef]);

  // Normalize geometry and set initial position
  useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh) return;

    const geometry = mesh.geometry as THREE.BufferGeometry;

    if (!hasNormalizedRef.current) {
      // Center geometry and orient to dominant up
      geometry.computeBoundingBox();
      const geoBox = geometry.boundingBox;
      
      if (geoBox) {
        const geoCenter = geoBox.getCenter(new THREE.Vector3());
        geometry.translate(-geoCenter.x, -geoBox.min.y, -geoCenter.z);
        
        const dominantQuaternion = computeDominantUpQuaternion(geometry);
        if (dominantQuaternion) {
          geometry.applyQuaternion(dominantQuaternion);
          geometry.computeBoundingBox();
          const orientedBox = geometry.boundingBox;
          if (orientedBox) {
            const orientedCenter = orientedBox.getCenter(new THREE.Vector3());
            geometry.translate(-orientedCenter.x, -orientedBox.min.y, -orientedCenter.z);
          }
        }
        
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.attributes.position?.needsUpdate;
      }

      // Set initial position from offset
      mesh.position.set(initialOffset?.x ?? 0, 0, initialOffset?.z ?? 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(unitScale);
      mesh.updateMatrixWorld(true);
      mesh.userData.normalized = true;
      hasNormalizedRef.current = true;
    }

    // BVH acceleration
    const geo = geometry as any;
    geo.disposeBoundsTree?.();
    geo.computeBoundsTree?.();

    // Handle dimension overrides
    if (dimensions && (dimensions.x || dimensions.y || dimensions.z)) {
      const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
      const currentDimensions = box.getSize(new THREE.Vector3());
      mesh.scale.set(
        dimensions.x ? (dimensions.x / unitScale) / (currentDimensions.x || 1) : mesh.scale.x,
        dimensions.y ? (dimensions.y / unitScale) / (currentDimensions.y || 1) : mesh.scale.y,
        dimensions.z ? (dimensions.z / unitScale) / (currentDimensions.z || 1) : mesh.scale.z
      );
      mesh.updateMatrixWorld(true);
    }

    // Report bounds
    const finalBox = new THREE.Box3().setFromObject(mesh);
    const sphere = finalBox.getBoundingSphere(new THREE.Sphere());
    onBoundsChange?.({
      min: finalBox.min.clone(),
      max: finalBox.max.clone(),
      center: finalBox.getCenter(new THREE.Vector3()),
      size: finalBox.getSize(new THREE.Vector3()),
      radius: sphere.radius,
      unitsScale: unitScale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, dimensions, unitScale, initialOffset]);

  // Click handler with double-click detection
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (disableDoubleClick) return;
    
    const now = Date.now();
    if (now - lastClickTimeRef.current < DOUBLE_CLICK_DELAY) {
      // Dispatch navigation event to open step and accordion
      window.dispatchEvent(new CustomEvent('highlight-component', {
        detail: { category: 'part', id: file.id }
      }));
      onDoubleClick?.() ?? window.dispatchEvent(new CustomEvent('mesh-double-click'));
      lastClickTimeRef.current = 0;
    } else {
      lastClickTimeRef.current = now;
    }
  }, [disableDoubleClick, onDoubleClick, file.id]);

  return (
    <mesh 
      ref={actualRef} 
      geometry={file.mesh.geometry} 
      material={file.mesh.material}
      onClick={handleClick}
    />
  );
});

export default ModelMesh;
