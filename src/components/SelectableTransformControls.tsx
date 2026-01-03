import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  TransformController,
  PART_TRANSFORM_CONFIG,
  setOrbitControlsEnabled,
  resetPivotMatrix,
  calculateGizmoScale,
  dispatchTransformUpdate,
} from '@/core/transform';

// ============================================================================
// Types
// ============================================================================

interface TransformData {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

interface LiveTransformData extends TransformData {
  bounds: THREE.Box3;
  pivotClosed?: boolean;
}

interface SelectableTransformControlsProps {
  /** Reference to the mesh being transformed */
  meshRef: React.RefObject<THREE.Mesh>;
  /** Whether transform controls are enabled for this part */
  enabled: boolean;
  /** Unique identifier for the part */
  partId?: string;
  /** Callback when transform changes (on drag end or close) */
  onTransformChange?: (transform: TransformData) => void;
  /** Callback when selection state changes */
  onSelectionChange?: (selected: boolean) => void;
  /** Callback for live transform updates during drag */
  onLiveTransformChange?: (transform: LiveTransformData | null) => void;
  /** Child elements (typically the mesh) */
  children?: React.ReactNode;
}

// ============================================================================
// Constants & Reusable Objects
// ============================================================================

// Reusable THREE.js objects to avoid allocations in render loop
const tempBox = new THREE.Box3();
const tempCenter = new THREE.Vector3();
const tempSize = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

// Transform controller for applying constraints (shared instance for performance)
const transformController = new TransformController(PART_TRANSFORM_CONFIG);

// ============================================================================
// Component
// ============================================================================

/**
 * SelectableTransformControls - A wrapper for PivotControls with transform baking.
 * 
 * Behavior:
 * - Double-click a part to activate the gizmo
 * - Gizmo axes are always world-aligned (not affected by part rotation)
 * - On close: transforms are "baked" into the mesh, gizmo resets to identity
 * - Supports multiple parts with proper isolation via partId
 * 
 * Transform Flow:
 * 1. On activate: Move pivot to mesh world position, keep axes world-aligned
 * 2. During drag: PivotControls applies transform, mesh stays at local origin
 * 3. On deactivate: Capture world transform, hide gizmo, bake into mesh
 */
const SelectableTransformControls: React.FC<SelectableTransformControlsProps> = ({
  meshRef,
  enabled,
  partId,
  onTransformChange,
  onSelectionChange,
  onLiveTransformChange,
  children,
}) => {
  const { gl, camera } = useThree();
  const [isActive, setIsActive] = useState(false);
  const [bounds, setBounds] = useState<{ center: THREE.Vector3; size: THREE.Vector3; radius: number } | null>(null);
  
  const pivotRef = useRef<THREE.Group>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const groupRef = useRef<THREE.Group>(null);

  // ============================================================================
  // Transform Helpers
  // ============================================================================

  /** Get mesh's world transform (includes pivot transform when active) */
  const getWorldTransform = useCallback((): TransformData => {
    if (!meshRef.current) {
      return { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    }
    meshRef.current.updateMatrixWorld(true);
    meshRef.current.getWorldPosition(tempPosition);
    meshRef.current.getWorldQuaternion(tempQuaternion);
    tempEuler.setFromQuaternion(tempQuaternion);
    return { 
      position: tempPosition.clone(), 
      rotation: tempEuler.clone() 
    };
  }, [meshRef]);

  /** Emit transform update event using unified utility */
  const emitTransformUpdate = useCallback(() => {
    if (!meshRef.current) return;
    const { position, rotation } = getWorldTransform();
    
    dispatchTransformUpdate(position, rotation, partId);
    onTransformChange?.({ position, rotation });
  }, [meshRef, getWorldTransform, onTransformChange, partId]);

  // ============================================================================
  // Bounds Calculation
  // ============================================================================

  useFrame(() => {
    if (!meshRef.current || !enabled) return;
    
    meshRef.current.updateMatrixWorld(true);
    tempBox.setFromObject(meshRef.current);
    tempBox.getCenter(tempCenter);
    tempBox.getSize(tempSize);
    
    const radius = Math.max(tempSize.x, tempSize.y, tempSize.z) / 2;
    
    // Only update state if bounds changed significantly
    if (!bounds || Math.abs(bounds.radius - radius) > 0.001 || bounds.center.distanceTo(tempCenter) > 0.001) {
      setBounds({ center: tempCenter.clone(), size: tempSize.clone(), radius });
    }
    
    // Emit live transform during active drag
    if (isActive && onLiveTransformChange) {
      const { position, rotation } = getWorldTransform();
      onLiveTransformChange({ position, rotation, bounds: tempBox.clone() });
    }
  });

  // ============================================================================
  // Mouse Helpers
  // ============================================================================

  const getMouseNDC = useCallback((event: MouseEvent): THREE.Vector2 => {
    const rect = gl.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }, [gl]);

  const isMouseOverMesh = useCallback((event: MouseEvent): boolean => {
    if (!meshRef.current) return false;
    raycasterRef.current.setFromCamera(getMouseNDC(event), camera);
    return raycasterRef.current.intersectObject(meshRef.current, true).length > 0;
  }, [meshRef, camera, getMouseNDC]);

  // ============================================================================
  // Gizmo Activation/Deactivation
  // ============================================================================

  /** Activate gizmo - position at mesh center with world-aligned axes */
  const activateGizmo = useCallback(() => {
    if (!meshRef.current || !pivotRef.current) return;
    
    const mesh = meshRef.current;
    const pivot = pivotRef.current;
    
    mesh.updateMatrixWorld(true);
    
    // Get mesh's current world transform
    const meshWorldPos = new THREE.Vector3();
    const meshWorldQuat = new THREE.Quaternion();
    mesh.getWorldPosition(meshWorldPos);
    mesh.getWorldQuaternion(meshWorldQuat);
    const meshWorldEuler = new THREE.Euler().setFromQuaternion(meshWorldQuat);
    
    // Position pivot at mesh's world position, but keep axes world-aligned
    pivot.position.copy(meshWorldPos);
    pivot.rotation.set(0, 0, 0);
    pivot.updateMatrix();
    
    // Reset mesh position to origin, preserve its rotation
    mesh.position.set(0, 0, 0);
    mesh.rotation.copy(meshWorldEuler);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    
    // Notify other controls to close
    window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { partId } }));
    
    setIsActive(true);
    onSelectionChange?.(true);
  }, [meshRef, onSelectionChange, partId]);

  /** Deactivate gizmo - bake transform into mesh */
  const deactivateGizmo = useCallback(async () => {
    setOrbitControlsEnabled(true);
    gl.domElement.style.cursor = 'auto';
    
    // Capture world transform before hiding
    const bakedPosition = new THREE.Vector3();
    const bakedRotation = new THREE.Euler();
    
    if (meshRef.current && pivotRef.current) {
      meshRef.current.updateMatrixWorld(true);
      meshRef.current.getWorldPosition(bakedPosition);
      const worldQuat = new THREE.Quaternion();
      meshRef.current.getWorldQuaternion(worldQuat);
      bakedRotation.setFromQuaternion(worldQuat);
    }
    
    // Hide gizmo first to prevent visual jump
    setIsActive(false);
    onSelectionChange?.(false);
    
    // Wait for React to hide the gizmo
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Bake transform into mesh
    if (meshRef.current && pivotRef.current) {
      // Reset pivot to origin using unified utility
      resetPivotMatrix(pivotRef.current);
      
      // Apply baked transform to mesh
      meshRef.current.position.copy(bakedPosition);
      meshRef.current.rotation.copy(bakedRotation);
      meshRef.current.updateMatrix();
      meshRef.current.updateMatrixWorld(true);
      
      // Get bounds and emit events
      tempBox.setFromObject(meshRef.current);
      
      // Let 3DScene handle the model-transform-updated emission after baseplate collision check
      onLiveTransformChange?.({ 
        position: bakedPosition, 
        rotation: bakedRotation, 
        bounds: tempBox.clone(), 
        pivotClosed: true 
      });
      
      // Note: We don't emit model-transform-updated here because 3DScene will do it
      // after checking/adjusting for baseplate collision
      onTransformChange?.({ position: bakedPosition, rotation: bakedRotation });
    }
    
    requestAnimationFrame(() => onLiveTransformChange?.(null));
  }, [gl, meshRef, onSelectionChange, onLiveTransformChange, onTransformChange, partId]);

  // ============================================================================
  // Drag Handlers
  // ============================================================================

  const handleDragStart = useCallback(() => {
    setOrbitControlsEnabled(false);
    gl.domElement.style.cursor = 'grabbing';
  }, [gl]);

  const handleDrag = useCallback(() => {
    if (!meshRef.current || !onLiveTransformChange) return;
    const { position, rotation } = getWorldTransform();
    tempBox.setFromObject(meshRef.current);
    onLiveTransformChange({ position, rotation, bounds: tempBox.clone() });
  }, [meshRef, onLiveTransformChange, getWorldTransform]);

  const handleDragEnd = useCallback(() => {
    setOrbitControlsEnabled(true);
    gl.domElement.style.cursor = 'auto';
    emitTransformUpdate();
  }, [gl, emitTransformUpdate]);

  // ============================================================================
  // Event Listeners
  // ============================================================================

  // Initial transform emit
  useEffect(() => {
    if (!meshRef.current) return;
    const timer = setTimeout(emitTransformUpdate, 100);
    return () => clearTimeout(timer);
  }, [emitTransformUpdate]);

  // Close when another pivot control is activated
  useEffect(() => {
    if (!isActive) return;
    
    const handleOtherActivated = (e: CustomEvent) => {
      if (e.detail?.partId !== partId) {
        deactivateGizmo();
      }
    };
    
    window.addEventListener('pivot-control-activated', handleOtherActivated as EventListener);
    return () => window.removeEventListener('pivot-control-activated', handleOtherActivated as EventListener);
  }, [isActive, partId, deactivateGizmo]);

  // Double-click handler - listen regardless of enabled state
  // The event from ModelMesh will trigger selection in 3DScene, then we activate
  useEffect(() => {
    const handleMeshDoubleClick = (e: CustomEvent) => {
      if (isActive) return;
      const eventPartId = e.detail?.partId;
      // Only activate if this event is for our part
      if (partId && eventPartId === partId) {
        activateGizmo();
      }
    };
    
    window.addEventListener('mesh-double-click', handleMeshDoubleClick as EventListener);
    return () => window.removeEventListener('mesh-double-click', handleMeshDoubleClick as EventListener);
  }, [isActive, activateGizmo, partId]);

  // Hover cursor - show pointer on ALL parts, not just enabled ones
  useEffect(() => {
    // Don't show hover when gizmo is active (user is transforming)
    if (isActive) return;
    
    const handleMouseMove = (event: MouseEvent) => {
      gl.domElement.style.cursor = isMouseOverMesh(event) ? 'pointer' : 'auto';
    };
    
    gl.domElement.addEventListener('mousemove', handleMouseMove);
    return () => {
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.style.cursor = 'auto';
    };
  }, [gl, enabled, isActive, isMouseOverMesh]);

  // Keyboard escape
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') deactivateGizmo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, deactivateGizmo]);

  // Click outside to close
  useEffect(() => {
    if (!isActive) return;
    
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (gl.domElement.contains(target) || gl.domElement === target) return;
      
      if (target.closest('button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]')) {
        deactivateGizmo();
      }
    };
    
    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [isActive, gl.domElement, deactivateGizmo]);

  // External transform updates (e.g., reset from UI)
  useEffect(() => {
    const handleSetTransform = (e: CustomEvent) => {
      if (!meshRef.current || isActive) return;
      if (partId && e.detail.partId && e.detail.partId !== partId) return;
      
      const { position, rotation, respectBaseplate } = e.detail;
      meshRef.current.position.copy(position);
      if (rotation instanceof THREE.Euler) {
        meshRef.current.rotation.copy(rotation);
      } else {
        meshRef.current.rotation.set(rotation.x, rotation.y, rotation.z);
      }
      meshRef.current.updateMatrixWorld(true);
      
      // If respectBaseplate is set, dispatch event to check and lift above baseplate
      if (respectBaseplate) {
        window.dispatchEvent(new CustomEvent('check-baseplate-collision', {
          detail: { partId: partId || e.detail.partId }
        }));
      }
      
      emitTransformUpdate();
    };

    window.addEventListener('set-model-transform', handleSetTransform as EventListener);
    return () => window.removeEventListener('set-model-transform', handleSetTransform as EventListener);
  }, [meshRef, isActive, partId, emitTransformUpdate]);

  // Baseplate move notification
  useEffect(() => {
    const handler = () => emitTransformUpdate();
    window.addEventListener('baseplate-moved-model', handler);
    return () => window.removeEventListener('baseplate-moved-model', handler);
  }, [emitTransformUpdate]);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const gizmoScale = useMemo(() => 
    bounds ? calculateGizmoScale('part', { radius: bounds.radius }) : 50, 
    [bounds]
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <group ref={groupRef}>
      <PivotControls
        ref={pivotRef}
        scale={gizmoScale}
        lineWidth={4}
        depthTest={false}
        fixed={false}
        visible={isActive}
        activeAxes={isActive ? [true, true, true] : [false, false, false]}
        axisColors={['#ff4060', '#40ff60', '#4080ff']}
        hoveredColor="#ffff40"
        annotations={isActive}
        annotationsClass="pivot-annotation"
        autoTransform={true}
        disableScaling={true}
        onDrag={isActive ? handleDrag : undefined}
        onDragStart={isActive ? handleDragStart : undefined}
        onDragEnd={isActive ? handleDragEnd : undefined}
      >
        {children}
        {/* Close button at gizmo center - inside PivotControls so it moves with gizmo */}
        {isActive && (
          <Html center style={{ pointerEvents: 'auto', userSelect: 'none' }}>
            <button
              onClick={deactivateGizmo}
              className="w-6 h-6 flex items-center justify-center bg-slate-800/90 hover:bg-red-600 text-white rounded-full shadow-lg border border-slate-600 transition-colors text-xs"
              title="Close (Esc)"
            >
              ✕
            </button>
          </Html>
        )}
      </PivotControls>
    </group>
  );
};

export default SelectableTransformControls;
