/**
 * HoleTransformControls
 * 
 * Transform controls for mounting holes using PivotControls from @react-three/drei.
 * Allows XZ plane translation only (no Y-axis movement or rotation).
 * Styled consistently with SupportTransformControls.
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { PlacedHole } from './types';

interface HoleTransformControlsProps {
  hole: PlacedHole;
  baseTopY: number;
  onTransformChange: (newPosition: THREE.Vector2) => void;
  onTransformEnd: (newPosition: THREE.Vector2) => void;
  onDragStart?: () => void;
  onDeselect: () => void;
}

// Reusable THREE.js objects to avoid allocations
const tempPosition = new THREE.Vector3();

const HoleTransformControls: React.FC<HoleTransformControlsProps> = ({
  hole,
  baseTopY,
  onTransformChange,
  onTransformEnd,
  onDragStart: onDragStartProp,
  onDeselect,
}) => {
  const { gl } = useThree();
  const pivotRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Mesh>(null);
  const isDraggingRef = useRef(false);
  
  // Store initial group transform at drag start to prevent feedback loop
  const dragStartGroupPos = useRef<THREE.Vector3 | null>(null);
  
  // Get hole position
  const holeX = Number(hole.position?.x) || 0;
  const holeZ = Number(hole.position?.y) || 0; // position.y is Z in world coords
  const holeDiameter = Number(hole.diameter) || 6;
  
  // Position the gizmo at the top of the baseplate where the hole is
  const gizmoY = baseTopY + 5; // Slightly above the surface
  
  // Use locked position during drag to prevent janky feedback loop
  const displayPos = isDraggingRef.current && dragStartGroupPos.current 
    ? dragStartGroupPos.current 
    : new THREE.Vector3(holeX, gizmoY, holeZ);
  
  // Gizmo scale based on hole size
  const gizmoScale = useMemo(() => {
    return Math.max(holeDiameter * 3, 30);
  }, [holeDiameter]);

  // Read world transform from the anchor mesh (inside PivotControls)
  const getTransformFromAnchor = useCallback(() => {
    if (!anchorRef.current) return null;
    
    anchorRef.current.updateMatrixWorld(true);
    anchorRef.current.getWorldPosition(tempPosition);
    
    // Convert world position to hole position (X, Z)
    // Note: hole.position uses Vector2 where x = worldX, y = worldZ
    const newPosition = new THREE.Vector2(tempPosition.x, tempPosition.z);
    
    return newPosition;
  }, []);

  // Handle drag - read transform from anchor mesh
  const handleDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    
    const newPosition = getTransformFromAnchor();
    if (newPosition) {
      onTransformChange(newPosition);
    }
  }, [getTransformFromAnchor, onTransformChange]);

  // Drag start - lock the group position to prevent feedback loop
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    dragStartGroupPos.current = new THREE.Vector3(holeX, gizmoY, holeZ);
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: true } }));
    gl.domElement.style.cursor = 'grabbing';
    onDragStartProp?.();
  }, [gl, holeX, holeZ, gizmoY, onDragStartProp]);

  // Drag end - emit final transform and reset pivot
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    dragStartGroupPos.current = null;
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: false } }));
    gl.domElement.style.cursor = 'auto';
    
    // Read final transform from anchor
    const newPosition = getTransformFromAnchor();
    if (newPosition) {
      onTransformEnd(newPosition);
    }
    
    // Reset pivot to identity after drag ends
    if (pivotRef.current) {
      pivotRef.current.matrix.identity();
      pivotRef.current.position.set(0, 0, 0);
      pivotRef.current.rotation.set(0, 0, 0);
      pivotRef.current.scale.set(1, 1, 1);
      pivotRef.current.updateMatrix();
    }
  }, [gl, getTransformFromAnchor, onTransformEnd]);

  // Click outside to close - when clicking on ANY UI element outside canvas
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // If click is on canvas, allow it (for camera controls) - don't deselect
      if (gl.domElement.contains(target) || gl.domElement === target) return;
      
      // Any click outside the canvas (on UI elements, sidebar, panels, etc.) should deselect
      // This matches behavior of other gizmos
      onDeselect();
    };
    
    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [onDeselect, gl.domElement]);
  
  // Escape key to deselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDeselect();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeselect]);

  return (
    <group position={displayPos}>
      <PivotControls
        ref={pivotRef}
        scale={gizmoScale}
        lineWidth={3}
        depthTest={false}
        autoTransform={true}
        disableRotations={true}  // No rotation for holes
        disableScaling={true}
        disableSliders={true}
        activeAxes={[true, false, true]}  // Only X and Z axes (XZ plane)
        onDrag={handleDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        visible={true}
        anchor={[0, 0, 0]}
        annotations={false}
      >
        {/* Invisible anchor mesh that moves with the pivot */}
        <mesh ref={anchorRef} visible={false}>
          <sphereGeometry args={[0.1]} />
        </mesh>
        
        {/* Close button at gizmo center */}
        <Html center style={{ pointerEvents: 'auto', userSelect: 'none' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeselect();
            }}
            className="w-6 h-6 flex items-center justify-center bg-slate-800/90 hover:bg-red-600 text-white rounded-full shadow-lg border border-slate-600 transition-colors text-xs"
            title="Close (Esc)"
          >
            ✕
          </button>
        </Html>
      </PivotControls>

      {/* Visual indicator - hole preview ring at baseplate surface level */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <ringGeometry args={[holeDiameter / 2, holeDiameter / 2 + 0.15, 32]} />
        <meshBasicMaterial color={0x00ff88} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

export default HoleTransformControls;
