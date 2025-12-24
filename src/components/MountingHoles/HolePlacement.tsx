/**
 * HolePlacement Component
 * 
 * Handles the interactive placement of mounting holes on the baseplate.
 * Similar to SupportPlacement but simpler - holes are just positioned on XZ plane.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { PlacedHole, HoleConfig } from './types';
import HoleMesh from './HoleMesh';

interface HolePlacementProps {
  /** Whether placement mode is active */
  active: boolean;
  /** The hole configuration to place */
  holeConfig: HoleConfig | null;
  /** Depth of the hole (baseplate height for through holes) */
  depth: number;
  /** Y position of baseplate top */
  baseTopY: number;
  /** Callback when hole is placed */
  onPlace: (hole: PlacedHole) => void;
  /** Callback to cancel placement */
  onCancel: () => void;
  /** Optional raycast target (baseplate mesh) */
  baseTarget?: THREE.Object3D | null;
}

const HolePlacement: React.FC<HolePlacementProps> = ({
  active,
  holeConfig,
  depth,
  baseTopY,
  onPlace,
  onCancel,
  baseTarget,
}) => {
  const { gl, camera } = useThree();
  const [previewPosition, setPreviewPosition] = useState<THREE.Vector2 | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -baseTopY));
  const hitPointRef = useRef(new THREE.Vector3());
  
  // Update plane when baseTopY changes
  useEffect(() => {
    planeRef.current.constant = -baseTopY;
  }, [baseTopY]);
  
  // Handle mouse move for preview
  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!active || !holeConfig) return;
    
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    raycasterRef.current.setFromCamera(mouse, camera);
    
    // Try to hit baseplate first
    if (baseTarget) {
      const intersects = raycasterRef.current.intersectObject(baseTarget, true);
      if (intersects.length > 0) {
        const point = intersects[0].point;
        setPreviewPosition(new THREE.Vector2(point.x, point.z));
        return;
      }
    }
    
    // Fallback to plane intersection
    if (raycasterRef.current.ray.intersectPlane(planeRef.current, hitPointRef.current)) {
      setPreviewPosition(new THREE.Vector2(hitPointRef.current.x, hitPointRef.current.z));
    }
  }, [active, holeConfig, camera, gl, baseTarget]);
  
  // Handle click to place hole
  const handleClick = useCallback((event: MouseEvent) => {
    if (!active || !holeConfig || !previewPosition) return;
    
    // Prevent if clicking on UI elements
    if ((event.target as HTMLElement).closest('.ui-panel')) return;
    
    const placedHole: PlacedHole = {
      ...holeConfig,
      id: `hole-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      position: previewPosition.clone(),
      depth,
    };
    
    onPlace(placedHole);
  }, [active, holeConfig, previewPosition, depth, onPlace]);
  
  // Handle escape to cancel
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && active) {
      onCancel();
    }
  }, [active, onCancel]);
  
  // Set up event listeners
  useEffect(() => {
    if (!active) {
      setPreviewPosition(null);
      return;
    }
    
    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    
    // Change cursor
    canvas.style.cursor = 'crosshair';
    
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.style.cursor = 'auto';
    };
  }, [active, gl, handlePointerMove, handleClick, handleKeyDown]);
  
  // Don't render if not active or no config
  if (!active || !holeConfig || !previewPosition) {
    return null;
  }
  
  // Create preview hole
  const previewHole: PlacedHole = {
    ...holeConfig,
    id: 'preview',
    position: previewPosition,
    depth,
  };
  
  return (
    <HoleMesh
      hole={previewHole}
      baseTopY={baseTopY}
      isPreview={true}
    />
  );
};

export default HolePlacement;
