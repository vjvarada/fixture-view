/**
 * ClampTransformControls
 * 
 * Transform controls for clamps using PivotControls from @react-three/drei.
 * The pivot point is positioned at the top center of the fixture_point.obj disk,
 * which represents where the clamp contacts the workpiece.
 * 
 * On transform end, the clamp position is adjusted to:
 * 1. Avoid overlap between support and part
 * 2. Drop to the part surface
 */

import { useRef, useCallback, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { PlacedClamp } from '../types';
import {
  TransformController,
  CLAMP_TRANSFORM_CONFIG,
  setOrbitControlsEnabled,
  resetPivotMatrix,
  calculateGizmoScale,
} from '@/core/transform';

interface ClampTransformControlsProps {
  placedClamp: PlacedClamp;
  /** Position of the fixture point top center in world space */
  fixturePointWorldPos: THREE.Vector3;
  onTransformChange: (position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => void;
  onTransformEnd: (position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => void;
  onDeselect: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

// Reusable THREE.js objects
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

// Transform controller for applying constraints (shared instance for performance)
const transformController = new TransformController(CLAMP_TRANSFORM_CONFIG);

const ClampTransformControls: React.FC<ClampTransformControlsProps> = ({
  placedClamp,
  fixturePointWorldPos,
  onTransformChange,
  onTransformEnd,
  onDeselect,
  onDragStart,
  onDragEnd,
}) => {
  const { gl } = useThree();
  const pivotRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Mesh>(null);
  const isDraggingRef = useRef(false);
  
  // Store initial transform at drag start
  const dragStartPos = useRef<THREE.Vector3 | null>(null);
  const dragStartRot = useRef<THREE.Euler | null>(null);
  
  const { position, rotation } = placedClamp;
  
  // Use locked position during drag to prevent feedback loop
  const displayPos = isDraggingRef.current && dragStartPos.current 
    ? dragStartPos.current 
    : new THREE.Vector3(position.x, position.y, position.z);
  
  // Use Y rotation (green gizmo) for rotation in XZ plane, like supports
  const displayRotY = isDraggingRef.current && dragStartRot.current
    ? dragStartRot.current.y
    : THREE.MathUtils.degToRad(rotation.y);

  // Read world transform from the anchor mesh
  const getTransformFromAnchor = useCallback(() => {
    if (!anchorRef.current) return null;
    
    anchorRef.current.updateMatrixWorld(true);
    anchorRef.current.getWorldPosition(tempPosition);
    anchorRef.current.getWorldQuaternion(tempQuaternion);
    // Use YXZ order to extract Y rotation cleanly, like supports
    tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
    
    // Only allow Y rotation (rotation in XZ plane via green gizmo)
    const newRotationY = tempEuler.y;
    
    return {
      position: { x: tempPosition.x, y: tempPosition.y, z: tempPosition.z },
      rotation: {
        x: 0, // Lock X rotation
        y: THREE.MathUtils.radToDeg(newRotationY), // Only Y rotation allowed (green gizmo)
        z: 0, // Lock Z rotation
      },
    };
  }, []);

  // Handle drag
  const handleDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    
    const transform = getTransformFromAnchor();
    if (transform) {
      onTransformChange(transform.position, transform.rotation);
    }
  }, [getTransformFromAnchor, onTransformChange]);

  // Drag start
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    dragStartPos.current = new THREE.Vector3(position.x, position.y, position.z);
    // Only store Y rotation (green gizmo), like supports
    dragStartRot.current = new THREE.Euler(0, THREE.MathUtils.degToRad(rotation.y), 0);
    setOrbitControlsEnabled(false);
    gl.domElement.style.cursor = 'grabbing';
    onDragStart?.();
  }, [gl, position, rotation, onDragStart]);

  // Drag end
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    dragStartPos.current = null;
    dragStartRot.current = null;
    setOrbitControlsEnabled(true);
    gl.domElement.style.cursor = 'auto';
    
    const transform = getTransformFromAnchor();
    if (transform) {
      onTransformEnd(transform.position, transform.rotation);
    }
    
    onDragEnd?.();
    
    // Reset pivot using unified utility
    if (pivotRef.current) {
      resetPivotMatrix(pivotRef.current);
    }
  }, [gl, getTransformFromAnchor, onTransformEnd, onDragEnd]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDeselect();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeselect]);

  // Click outside to deselect
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      if (gl.domElement.contains(target) || gl.domElement === target) return;
      
      if (target.closest('button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]')) {
        onDeselect();
      }
    };
    
    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [onDeselect, gl.domElement]);

  return (
    <group 
      position={[displayPos.x, displayPos.y, displayPos.z]} 
      rotation={[0, displayRotY, 0]}
    >
      <PivotControls
        ref={pivotRef}
        scale={calculateGizmoScale('clamp', {})}
        lineWidth={4}
        depthTest={false}
        fixed={false}
        visible={true}
        activeAxes={[true, true, true]}
        axisColors={['#ff4060', '#40ff60', '#4080ff']}
        hoveredColor="#ffff40"
        annotations={false}
        autoTransform={true}
        disableScaling={true}
        disableSliders={true}
        onDrag={handleDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <mesh ref={anchorRef} visible={false}>
          <sphereGeometry args={[0.1]} />
        </mesh>
        
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
    </group>
  );
};

export default ClampTransformControls;
