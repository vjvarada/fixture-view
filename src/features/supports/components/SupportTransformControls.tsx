/**
 * SupportTransformControls
 * 
 * Transform controls for supports using PivotControls from @react-three/drei.
 * Allows XZ plane translation, Y-axis height adjustment, and Y-axis rotation.
 * Styled consistently with SelectableTransformControls for parts.
 * 
 * Uses the same pattern as SelectableTransformControls:
 * - Place a reference object inside PivotControls
 * - Let autoTransform handle visual movement
 * - Read world transform from the reference object
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { AnySupport } from '../types';
import {
  TransformController,
  SUPPORT_TRANSFORM_CONFIG,
  setOrbitControlsEnabled,
  resetPivotMatrix,
  calculateGizmoScale,
} from '@/core/transform';

interface SupportTransformControlsProps {
  support: AnySupport;
  baseTopY: number;
  onTransformChange: (newCenter: THREE.Vector2, rotationY?: number, height?: number) => void;
  onTransformEnd: (newCenter: THREE.Vector2, rotationY?: number, height?: number) => void;
  onDeselect: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

// Reusable THREE.js objects to avoid allocations
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

// Transform controller for applying constraints (shared instance for performance)
const transformController = new TransformController(SUPPORT_TRANSFORM_CONFIG);

const SupportTransformControls: React.FC<SupportTransformControlsProps> = ({
  support,
  baseTopY,
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
  
  // Store initial group transform at drag start to prevent feedback loop
  const dragStartGroupPos = useRef<THREE.Vector3 | null>(null);
  const dragStartGroupRotY = useRef<number>(0);
  
  const center = (support as any).center as THREE.Vector2;
  const effectiveBaseY = (support as any).baseY ?? baseTopY;
  const supportHeight = (support as any).height ?? 10;
  const currentRotationY = (support as any).rotationY ?? 0;
  
  // Position the gizmo at the top of the support
  const gizmoY = effectiveBaseY + supportHeight + 5;
  
  // Use locked position during drag to prevent janky feedback loop
  const displayPos = isDraggingRef.current && dragStartGroupPos.current 
    ? dragStartGroupPos.current 
    : new THREE.Vector3(center.x, gizmoY, center.y);
  const displayRotY = isDraggingRef.current ? dragStartGroupRotY.current : currentRotationY;
  
  // Gizmo scale based on support size using unified system
  const gizmoScale = useMemo(() => {
    const supportRadius = (support as any).radius ?? (support as any).width ?? 10;
    return calculateGizmoScale('support', { radius: supportRadius });
  }, [support]);

  // Read world transform from the anchor mesh (inside PivotControls)
  const getTransformFromAnchor = useCallback(() => {
    if (!anchorRef.current) return null;
    
    anchorRef.current.updateMatrixWorld(true);
    anchorRef.current.getWorldPosition(tempPosition);
    anchorRef.current.getWorldQuaternion(tempQuaternion);
    tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');
    
    // Convert world position to support center (X, Z) and height delta (Y)
    const newCenter = new THREE.Vector2(tempPosition.x, tempPosition.z);
    const newRotationY = tempEuler.y;
    
    // Height is derived from Y position change relative to initial gizmo position
    // Y position = effectiveBaseY + height + 5 (gizmo offset)
    // So: height = Y position - effectiveBaseY - 5
    const newHeight = Math.max(1, tempPosition.y - effectiveBaseY - 5);
    
    return { center: newCenter, rotationY: newRotationY, height: newHeight };
  }, [effectiveBaseY]);

  // Handle drag - read transform from anchor mesh
  const handleDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    
    const transform = getTransformFromAnchor();
    if (transform) {
      onTransformChange(transform.center, transform.rotationY, transform.height);
    }
  }, [getTransformFromAnchor, onTransformChange]);

  // Drag start - lock the group position to prevent feedback loop
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    dragStartGroupPos.current = new THREE.Vector3(center.x, gizmoY, center.y);
    dragStartGroupRotY.current = currentRotationY;
    setOrbitControlsEnabled(false);
    gl.domElement.style.cursor = 'grabbing';
    onDragStart?.();
  }, [gl, center, gizmoY, currentRotationY, onDragStart]);

  // Drag end - emit final transform and reset pivot
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    dragStartGroupPos.current = null;
    setOrbitControlsEnabled(true);
    gl.domElement.style.cursor = 'auto';
    
    // Read final transform from anchor
    const transform = getTransformFromAnchor();
    if (transform) {
      onTransformEnd(transform.center, transform.rotationY, transform.height);
    }
    
    // Notify parent drag ended (before resetting pivot)
    onDragEnd?.();
    
    // Reset pivot to identity after drag ends using unified utility
    if (pivotRef.current) {
      resetPivotMatrix(pivotRef.current);
    }
  }, [gl, getTransformFromAnchor, onTransformEnd]);

  // Click outside to close - ONLY when clicking on UI elements, NOT on canvas
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // If click is on canvas, allow it (for camera controls) - don't deselect
      if (gl.domElement.contains(target) || gl.domElement === target) return;
      
      // If click is on UI elements (buttons, inputs, accordions, etc.), deselect
      if (target.closest('button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]')) {
        onDeselect();
      }
    };
    
    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [onDeselect, gl.domElement]);
  
  // Keyboard escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDeselect();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeselect]);
  
  // Close when another pivot control (part transform) is activated
  useEffect(() => {
    const handleOtherActivated = () => {
      onDeselect();
    };
    window.addEventListener('pivot-control-activated', handleOtherActivated);
    return () => window.removeEventListener('pivot-control-activated', handleOtherActivated);
  }, [onDeselect]);

  return (
    <group 
      position={[displayPos.x, displayPos.y, displayPos.z]} 
      rotation={[0, displayRotY, 0]}
    >
      <PivotControls
        ref={pivotRef}
        scale={gizmoScale}
        lineWidth={4}
        depthTest={false}
        fixed={false}
        visible={true}
        activeAxes={[true, true, true]}
        axisColors={['#ff4060', '#40ff60', '#4080ff']}
        hoveredColor="#ffff40"
        annotations={false}
        annotationsClass="pivot-annotation"
        autoTransform={true}
        disableScaling={true}
        disableSliders={true}
        onDrag={handleDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Anchor mesh - we read world transform from this */}
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
    </group>
  );
};

export default SupportTransformControls;
