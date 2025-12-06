import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';

interface TransformData {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

interface LiveTransformData extends TransformData {
  bounds: THREE.Box3;
  pivotClosed?: boolean;
}

interface SelectableTransformControlsProps {
  meshRef: React.RefObject<THREE.Mesh>;
  enabled: boolean;
  partId?: string;
  onTransformChange?: (transform: TransformData) => void;
  onSelectionChange?: (selected: boolean) => void;
  onLiveTransformChange?: (transform: LiveTransformData | null) => void;
  children?: React.ReactNode;
}

// Reusable THREE.js objects to avoid allocations in render loop
const tempBox = new THREE.Box3();
const tempCenter = new THREE.Vector3();
const tempSize = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempMatrix = new THREE.Matrix4();
const tempScale = new THREE.Vector3();

/**
 * Transform controls wrapper using @react-three/drei PivotControls.
 * 
 * Key behavior:
 * - Double-click to activate gizmo (PivotControls starts at identity)
 * - User transforms the part using the gizmo
 * - On close: "bake" PivotControls transform into the mesh, reset PivotControls
 * - Mesh accumulates all transforms, PivotControls always starts fresh
 * - UI shows the mesh's actual accumulated transform
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
  
  // Key to force PivotControls remount (resets to identity matrix)
  const [pivotKey, setPivotKey] = useState(0);
  
  // Ref to the PivotControls internal group for extracting its transform
  const pivotRef = useRef<THREE.Group>(null);
  
  const raycasterRef = useRef(new THREE.Raycaster());
  const groupRef = useRef<THREE.Group>(null);

  // Get the mesh's current local transform (what's stored on the mesh itself)
  const getMeshLocalTransform = useCallback((): TransformData => {
    if (!meshRef.current) {
      return { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    }
    return { 
      position: meshRef.current.position.clone(), 
      rotation: meshRef.current.rotation.clone() 
    };
  }, [meshRef]);

  // Get the mesh's world transform (includes PivotControls transform when active)
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

  // Emit transform update event (sends the mesh's world transform)
  const emitTransformUpdate = useCallback(() => {
    if (!meshRef.current) return;
    const { position, rotation } = getWorldTransform();
    
    window.dispatchEvent(new CustomEvent('model-transform-updated', {
      detail: { position, rotation, partId },
    }));
    onTransformChange?.({ position, rotation });
  }, [meshRef, getWorldTransform, onTransformChange, partId]);

  // Initial transform emit
  useEffect(() => {
    if (!meshRef.current) return;
    const timer = setTimeout(emitTransformUpdate, 100);
    return () => clearTimeout(timer);
  }, [emitTransformUpdate]);

  // Listen for external transform changes (e.g., reset position from UI)
  useEffect(() => {
    const handleExternalTransform = (e: CustomEvent) => {
      const { position, rotation, partId: eventPartId } = e.detail;
      
      // Only handle events for this part
      if (partId && eventPartId && eventPartId !== partId) return;
      if (!partId && eventPartId) return;
      
      // Update mesh position/rotation directly (this is the "baked" transform)
      if (meshRef.current) {
        meshRef.current.position.copy(position);
        meshRef.current.rotation.copy(rotation);
        meshRef.current.updateMatrixWorld(true);
      }
      
      // Force PivotControls to remount (resets to identity)
      setPivotKey(k => k + 1);
      
      // Emit the transform update so UI stays in sync
      setTimeout(() => {
        emitTransformUpdate();
      }, 50);
    };
    
    window.addEventListener('set-model-transform', handleExternalTransform as EventListener);
    return () => window.removeEventListener('set-model-transform', handleExternalTransform as EventListener);
  }, [partId, emitTransformUpdate, meshRef]);

  // Continuous bounds calculation
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

  // Mouse position helper
  const getMouseNDC = useCallback((event: MouseEvent): THREE.Vector2 => {
    const rect = gl.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }, [gl]);

  // Raycast check for hover
  const isMouseOverMesh = useCallback((event: MouseEvent): boolean => {
    if (!meshRef.current) return false;
    raycasterRef.current.setFromCamera(getMouseNDC(event), camera);
    return raycasterRef.current.intersectObject(meshRef.current, true).length > 0;
  }, [meshRef, camera, getMouseNDC]);

  // Bake PivotControls transform into the mesh and reset PivotControls
  // Returns a promise that resolves after the bake is complete
  const bakeTransformAndReset = useCallback((): Promise<{ position: THREE.Vector3; rotation: THREE.Euler }> => {
    return new Promise((resolve) => {
      if (!meshRef.current || !pivotRef.current) {
        resolve({ position: new THREE.Vector3(), rotation: new THREE.Euler() });
        return;
      }
      
      const mesh = meshRef.current;
      const pivot = pivotRef.current;
      
      console.group('🔧 Bake Transform Debug');
      console.log('Mesh BEFORE bake:');
      console.log('  Local position:', mesh.position.toArray());
      console.log('  Local rotation:', [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]);
      console.log('  Mesh UUID:', mesh.uuid);
      
      mesh.updateMatrixWorld(true);
      const worldPosBefore = new THREE.Vector3();
      const worldQuatBefore = new THREE.Quaternion();
      mesh.getWorldPosition(worldPosBefore);
      mesh.getWorldQuaternion(worldQuatBefore);
      console.log('  World position:', worldPosBefore.toArray());
      console.log('  World quaternion:', worldQuatBefore.toArray());
      
      // The mesh's world transform ALREADY includes all PivotControls transforms
      // Capture the world transform
      const worldPosition = new THREE.Vector3();
      const worldQuaternion = new THREE.Quaternion();
      
      mesh.getWorldPosition(worldPosition);
      mesh.getWorldQuaternion(worldQuaternion);
      
      console.log('World transform to bake:');
      console.log('  Position:', worldPosition.toArray());
      console.log('  Quaternion:', worldQuaternion.toArray());
      
      // Store the world transform
      const bakedPosition = worldPosition.clone();
      const bakedQuaternion = worldQuaternion.clone();
      const bakedEuler = new THREE.Euler().setFromQuaternion(bakedQuaternion);
      
      // NOW: Reset PivotControls matrix to identity WITHOUT using key (no remount)
      // Then set mesh local = baked world
      console.log('Resetting pivot matrix and applying baked transform...');
      
      // Reset pivot's matrix to identity
      pivot.matrix.identity();
      pivot.position.set(0, 0, 0);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, 1, 1);
      pivot.updateMatrix();
      
      // Set mesh local transform to the baked world transform
      mesh.position.copy(bakedPosition);
      mesh.rotation.copy(bakedEuler);
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      
      console.log('Mesh AFTER bake:');
      console.log('  Local position:', mesh.position.toArray());
      console.log('  Local rotation:', [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]);
      console.log('  Mesh UUID:', mesh.uuid);
      console.groupEnd();
      
      // Verify it sticks
      requestAnimationFrame(() => {
        if (meshRef.current) {
          console.log('🔧 Verify after RAF - mesh position:', meshRef.current.position.toArray());
          console.log('🔧 Verify after RAF - mesh UUID:', meshRef.current.uuid);
        }
      });
      
      resolve({ position: bakedPosition, rotation: bakedEuler });
    });
  }, [meshRef]);

  // Activate gizmo
  const activateGizmo = useCallback(() => {
    if (!meshRef.current) return;
    
    // Position PivotControls at the mesh's current world center
    // BUT keep pivot axes world-aligned (no rotation)
    if (pivotRef.current) {
      meshRef.current.updateMatrixWorld(true);
      const meshWorldPos = new THREE.Vector3();
      meshRef.current.getWorldPosition(meshWorldPos);
      
      // Get mesh's world rotation - we'll bake this into the mesh's local rotation
      const meshWorldQuat = new THREE.Quaternion();
      meshRef.current.getWorldQuaternion(meshWorldQuat);
      const meshWorldEuler = new THREE.Euler().setFromQuaternion(meshWorldQuat);
      
      // Set pivot to mesh's world POSITION only - keep rotation at identity (world-aligned)
      pivotRef.current.position.copy(meshWorldPos);
      pivotRef.current.rotation.set(0, 0, 0);  // World-aligned axes!
      pivotRef.current.updateMatrix();
      
      // Reset mesh position to origin, but KEEP its rotation
      // This way the part's orientation is preserved in mesh.rotation
      meshRef.current.position.set(0, 0, 0);
      meshRef.current.rotation.copy(meshWorldEuler);  // Keep the rotation on the mesh
      meshRef.current.updateMatrix();
      meshRef.current.updateMatrixWorld(true);
      
      console.group('🟢 Pivot Controls ACTIVATED');
      console.log('Part ID:', partId);
      console.log('Pivot positioned at:', meshWorldPos.toArray(), '(world-aligned axes)');
      console.log('Mesh rotation preserved:', [meshWorldEuler.x, meshWorldEuler.y, meshWorldEuler.z]);
      console.groupEnd();
    }
    
    // Notify other controls to close
    window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { partId } }));
    
    setIsActive(true);
    onSelectionChange?.(true);
  }, [meshRef, onSelectionChange, partId]);

  // Deactivate gizmo - bake transform into mesh and reset PivotControls
  const deactivateGizmo = useCallback(async () => {
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: false } }));
    gl.domElement.style.cursor = 'auto';
    
    // Capture the transform BEFORE hiding (while pivot still has its transform)
    let bakedPosition = new THREE.Vector3();
    let bakedRotation = new THREE.Euler();
    
    if (meshRef.current && pivotRef.current) {
      meshRef.current.updateMatrixWorld(true);
      meshRef.current.getWorldPosition(bakedPosition);
      const worldQuat = new THREE.Quaternion();
      meshRef.current.getWorldQuaternion(worldQuat);
      bakedRotation.setFromQuaternion(worldQuat);
    }
    
    // Hide the pivot controls FIRST to avoid visual jump to origin
    setIsActive(false);
    onSelectionChange?.(false);
    
    // Wait for React to re-render and hide the pivot
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    if (meshRef.current && pivotRef.current) {
      // Now reset pivot to origin (it's hidden, so no visual jump)
      pivotRef.current.matrix.identity();
      pivotRef.current.position.set(0, 0, 0);
      pivotRef.current.rotation.set(0, 0, 0);
      pivotRef.current.scale.set(1, 1, 1);
      pivotRef.current.updateMatrix();
      
      // Set mesh local transform to the captured world transform
      meshRef.current.position.copy(bakedPosition);
      meshRef.current.rotation.copy(bakedRotation);
      meshRef.current.updateMatrix();
      meshRef.current.updateMatrixWorld(true);
      
      console.log('🔧 deactivateGizmo - Bake complete, position:', bakedPosition.toArray());
      
      // Get bounds after bake
      tempBox.setFromObject(meshRef.current);
      
      // Notify about the final transform
      onLiveTransformChange?.({ position: bakedPosition, rotation: bakedRotation, bounds: tempBox.clone(), pivotClosed: true });
      
      // Emit update with the baked transform
      window.dispatchEvent(new CustomEvent('model-transform-updated', {
        detail: { position: bakedPosition, rotation: bakedRotation, partId },
      }));
      onTransformChange?.({ position: bakedPosition, rotation: bakedRotation });
    }
    
    requestAnimationFrame(() => onLiveTransformChange?.(null));
  }, [gl, meshRef, onSelectionChange, onLiveTransformChange, onTransformChange, partId]);

  // Close when another pivot control is activated
  useEffect(() => {
    if (!isActive) return;
    
    const handleOtherActivated = (e: CustomEvent) => {
      const activatedPartId = e.detail?.partId;
      // If a different part was activated, close this one
      if (activatedPartId !== partId) {
        deactivateGizmo();
      }
    };
    
    window.addEventListener('pivot-control-activated', handleOtherActivated as EventListener);
    return () => window.removeEventListener('pivot-control-activated', handleOtherActivated as EventListener);
  }, [isActive, partId, deactivateGizmo]);

  // Double-click handler
  useEffect(() => {
    if (!enabled) return;
    
    const handleMeshDoubleClick = (e: CustomEvent) => {
      if (isActive) return;
      const eventPartId = e.detail?.partId;
      if (partId && eventPartId && eventPartId !== partId) return;
      activateGizmo();
    };
    
    window.addEventListener('mesh-double-click', handleMeshDoubleClick as EventListener);
    return () => window.removeEventListener('mesh-double-click', handleMeshDoubleClick as EventListener);
  }, [enabled, isActive, activateGizmo, partId]);

  // Hover cursor
  useEffect(() => {
    if (!enabled || isActive) return;
    
    const handleMouseMove = (event: MouseEvent) => {
      gl.domElement.style.cursor = isMouseOverMesh(event) ? 'pointer' : 'auto';
    };
    
    gl.domElement.addEventListener('mousemove', handleMouseMove);
    return () => {
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.style.cursor = 'auto';
    };
  }, [gl, enabled, isActive, isMouseOverMesh]);

  // Drag handlers
  const handleDragStart = useCallback(() => {
    console.log('🔵 Drag START');
    if (meshRef.current) {
      console.log('  Mesh local pos:', meshRef.current.position.toArray());
      meshRef.current.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      meshRef.current.getWorldPosition(wp);
      console.log('  Mesh world pos:', wp.toArray());
    }
    if (pivotRef.current) {
      console.log('  PivotRef matrix:', pivotRef.current.matrix.elements.slice(0, 4), '...');
    }
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: true } }));
    gl.domElement.style.cursor = 'grabbing';
  }, [gl, meshRef]);

  // Handle drag - emit live transform data
  // Use a throttle to avoid too much console spam
  const lastDragLogRef = useRef(0);
  const handleDrag = useCallback(() => {
    if (!meshRef.current) return;
    const { position, rotation } = getWorldTransform();
    
    // Log every 500ms during drag
    const now = Date.now();
    if (now - lastDragLogRef.current > 500) {
      console.log('🟡 Dragging - world pos:', position.toArray().map(v => v.toFixed(2)), 'rot:', [rotation.x.toFixed(2), rotation.y.toFixed(2), rotation.z.toFixed(2)]);
      lastDragLogRef.current = now;
    }
    
    if (onLiveTransformChange) {
      tempBox.setFromObject(meshRef.current);
      onLiveTransformChange({ position, rotation, bounds: tempBox.clone() });
    }
  }, [meshRef, onLiveTransformChange, getWorldTransform]);

  const handleDragEnd = useCallback(() => {
    console.log('🔵 Drag END');
    if (meshRef.current) {
      console.log('  Mesh local pos:', meshRef.current.position.toArray());
      meshRef.current.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      meshRef.current.getWorldPosition(wp);
      meshRef.current.getWorldQuaternion(wq);
      console.log('  Mesh world pos:', wp.toArray());
      console.log('  Mesh world quat:', wq.toArray());
    }
    if (pivotRef.current) {
      console.log('  PivotRef matrix:', pivotRef.current.matrix.elements);
    }
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: false } }));
    gl.domElement.style.cursor = 'auto';
    emitTransformUpdate();
  }, [gl, emitTransformUpdate, meshRef]);

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

  // External transform updates
  useEffect(() => {
    const handleSetTransform = (e: CustomEvent) => {
      if (!meshRef.current || isActive) return;
      if (partId && e.detail.partId && e.detail.partId !== partId) return;
      
      const { position, rotation } = e.detail;
      meshRef.current.position.copy(position);
      if (rotation instanceof THREE.Euler) {
        meshRef.current.rotation.copy(rotation);
      } else {
        meshRef.current.rotation.set(rotation.x, rotation.y, rotation.z);
      }
      meshRef.current.updateMatrixWorld(true);
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

  // Computed values
  const gizmoScale = useMemo(() => bounds ? Math.max(bounds.radius * 0.75, 25) : 50, [bounds]);
  
  const closeButtonPosition = useMemo((): [number, number, number] | undefined => {
    if (!bounds) return undefined;
    return [bounds.center.x + bounds.radius * 1.2, bounds.center.y + bounds.radius * 1.2, bounds.center.z];
  }, [bounds]);

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
      </PivotControls>
      
      {isActive && closeButtonPosition && (
        <Html position={closeButtonPosition} center style={{ pointerEvents: 'auto', userSelect: 'none' }}>
          <button
            onClick={deactivateGizmo}
            className="w-6 h-6 flex items-center justify-center bg-slate-800/90 hover:bg-red-600 text-white rounded-full shadow-lg border border-slate-600 transition-colors text-xs"
            title="Close (Esc)"
          >
            ✕
          </button>
        </Html>
      )}
    </group>
  );
};

export default SelectableTransformControls;
