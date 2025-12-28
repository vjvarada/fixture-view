/**
 * ModelMesh - Renders individual imported STL models with proper orientation and coloring
 * Extracted from 3DScene.tsx for modularity
 */
import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import type { ProcessedFile } from '../../../modules/FileImport/types';
import type { BoundsSummary } from '../types';
import { computeDominantUpQuaternion, getActualMinYFromMesh } from '../utils/geometryUtils';
import { getModelColor } from '../utils/colorUtils';

export interface ModelMeshProps {
  file: ProcessedFile;
  meshRef?: React.RefObject<THREE.Mesh>;
  dimensions: { x: number; y: number; z: number };
  colorsMap: Map<string, string>;
  setColorsMap: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  onBoundsChange: (bounds: BoundsSummary) => void;
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
  const localRef = useRef<THREE.Mesh>(null);
  const actualRef = meshRef || localRef;
  const lastClickRef = useRef<number>(0);
  const boundsReportedRef = useRef(false);

  // Assign unique color to this model
  const assignedColor = useMemo(() => {
    return getModelColor(file.id, colorsMap, setColorsMap);
  }, [file.id, colorsMap, setColorsMap]);

  // Compute orientation quaternion and normalize geometry
  const { orientationQuat, normalizedGeometry } = useMemo(() => {
    const geom = file.mesh.geometry.clone();
    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    geom.translate(-center.x, -center.y, -center.z);

    // Scale if raw STL units differ (assume mm -> scene units if large)
    const sizeVec = new THREE.Vector3();
    bb.getSize(sizeVec);
    const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
    const scaleFactor = maxDim > 1000 ? 0.1 : 1;
    if (scaleFactor !== 1) {
      geom.scale(scaleFactor, scaleFactor, scaleFactor);
    }

    // Compute the quaternion that orients the part so largest face is down
    const quat = computeDominantUpQuaternion(geom);
    return { orientationQuat: quat, normalizedGeometry: geom };
  }, [file.mesh.geometry]);

  // Report bounds after orientation is applied
  useEffect(() => {
    if (!actualRef.current || boundsReportedRef.current) return;
    
    const mesh = actualRef.current;
    mesh.updateMatrixWorld(true);
    
    // Get world-space bounding box
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const worldCenter = new THREE.Vector3();
    const worldSize = new THREE.Vector3();
    worldBox.getCenter(worldCenter);
    worldBox.getSize(worldSize);
    
    // Get actual minY from mesh vertices in world space
    const actualMinY = getActualMinYFromMesh(mesh);
    
    onBoundsChange({
      fileId: file.id,
      worldCenter,
      worldSize,
      minY: actualMinY,
      maxY: worldBox.max.y,
    });
    
    boundsReportedRef.current = true;
  }, [actualRef, file.id, onBoundsChange, orientationQuat]);

  // Handle double-click detection
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (disableDoubleClick) return;
    
    const now = Date.now();
    const timeSinceLastClick = now - lastClickRef.current;
    
    if (timeSinceLastClick < 300) {
      // Double-click detected
      e.stopPropagation();
      onDoubleClick?.();
    }
    
    lastClickRef.current = now;
  }, [disableDoubleClick, onDoubleClick]);

  // Apply color material
  const coloredMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: assignedColor,
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    return mat;
  }, [assignedColor]);

  // Calculate initial position (centered on baseplate, sitting on surface)
  const position = useMemo(() => {
    if (initialOffset) {
      return initialOffset;
    }
    // Default: center at origin, will be adjusted by bounds callback
    return new THREE.Vector3(0, 0, 0);
  }, [initialOffset]);

  return (
    <mesh 
      ref={actualRef}
      position={position}
      quaternion={orientationQuat}
      geometry={normalizedGeometry}
      material={coloredMaterial}
      onClick={handleClick}
      castShadow
      receiveShadow
    />
  );
});

export default ModelMesh;
