import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';

interface SelectableTransformControlsProps {
  meshRef: React.RefObject<THREE.Mesh>;
  enabled: boolean;
  onTransformChange?: (transform: { position: THREE.Vector3; rotation: THREE.Euler }) => void;
  onSelectionChange?: (selected: boolean) => void;
  onLiveTransformChange?: (transform: { position: THREE.Vector3; rotation: THREE.Euler; bounds: THREE.Box3; pivotClosed?: boolean } | null) => void;
  children?: React.ReactNode;
}

/**
 * Transform control system:
 * 1. Double-click: Show PivotControls with temp mesh clone
 * 2. During drag: PivotControls moves the clone naturally (gizmo moves WITH it)
 * 3. On close: Apply delta transform to cumulative transform, update main mesh
 * 4. Tracks cumulative transforms for UI display and restore functionality
 * 5. Next activation: Gizmo appears world-aligned
 */
const SelectableTransformControls: React.FC<SelectableTransformControlsProps> = ({
  meshRef,
  enabled,
  onTransformChange,
  onSelectionChange,
  onLiveTransformChange,
  children,
}) => {
  const { gl, camera } = useThree();
  const [isActive, setIsActive] = useState(false);
  const [bounds, setBounds] = useState<{ center: THREE.Vector3; size: THREE.Vector3; radius: number } | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const groupRef = useRef<THREE.Group>(null);
  
  // Temporary mesh displayed inside PivotControls while active
  const [tempMesh, setTempMesh] = useState<THREE.Mesh | null>(null);
  
  // PivotControls ref to get final transform
  const pivotRef = useRef<THREE.Group>(null);
  
  // Key to force PivotControls remount when activated
  const [gizmoKey, setGizmoKey] = useState(0);
  
  // Store original geometry (before any transforms)
  const originalGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  
  // Cumulative transform tracking (position and quaternion from original)
  const cumulativePositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const cumulativeQuaternionRef = useRef(new THREE.Quaternion());
  
  // Flag to track if we've captured the original geometry
  const hasOriginalGeometryRef = useRef(false);

  // Emit transform update to UI
  const emitTransformUpdate = useCallback(() => {
    const position = cumulativePositionRef.current.clone();
    const rotation = new THREE.Euler().setFromQuaternion(cumulativeQuaternionRef.current);
    
    // Dispatch event for PartPropertiesAccordion
    window.dispatchEvent(
      new CustomEvent('model-transform-updated', {
        detail: { position, rotation },
      })
    );
    
    onTransformChange?.({ position, rotation });
  }, [onTransformChange]);

  // Capture original geometry on first render
  useEffect(() => {
    if (!meshRef.current || hasOriginalGeometryRef.current) return;
    
    // Store a clone of the original geometry
    originalGeometryRef.current = meshRef.current.geometry.clone();
    hasOriginalGeometryRef.current = true;
    
    // Emit initial transform (0,0,0)
    emitTransformUpdate();
  }, [meshRef.current?.geometry, emitTransformUpdate]);

  // Calculate mesh bounds continuously via useFrame and emit live transform when active
  useFrame(() => {
    if (!meshRef.current || !enabled) return;
    
    // Use tempMesh bounds when active, otherwise main mesh
    const targetMesh = isActive && tempMesh ? tempMesh : meshRef.current;
    targetMesh.updateMatrixWorld(true);
    
    const box = new THREE.Box3().setFromObject(targetMesh);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    
    const radius = Math.max(size.x, size.y, size.z) / 2;
    
    // Always update bounds
    if (!bounds || 
        Math.abs(bounds.radius - radius) > 0.001 ||
        bounds.center.distanceTo(center) > 0.001) {
      setBounds({ center: center.clone(), size: size.clone(), radius });
    }
    
    // Emit live transform when pivot is active
    if (isActive && tempMesh && pivotRef.current) {
      tempMesh.updateMatrixWorld(true);
      
      // Get the pivot's transform delta (this is what was applied during this drag session)
      const pivotMatrix = pivotRef.current.matrix.clone();
      const pivotDeltaPosition = new THREE.Vector3();
      const pivotDeltaQuaternion = new THREE.Quaternion();
      const pivotDeltaScale = new THREE.Vector3();
      pivotMatrix.decompose(pivotDeltaPosition, pivotDeltaQuaternion, pivotDeltaScale);
      
      const pivotDeltaRotation = new THREE.Euler().setFromQuaternion(pivotDeltaQuaternion);
      
      // Emit the pivot delta and bounds
      onLiveTransformChange?.({
        position: pivotDeltaPosition,
        rotation: pivotDeltaRotation,
        bounds: box,
      });
    }
  });

  // Helper to get mouse position in normalized device coordinates
  const getMouseNDC = useCallback((event: MouseEvent) => {
    const rect = gl.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }, [gl]);

  // Check if mouse is over the mesh (for cursor changes)
  const isMouseOverMesh = useCallback((event: MouseEvent) => {
    if (!meshRef.current) return false;
    
    const mesh = meshRef.current;
    mesh.updateMatrixWorld(true);
    
    const mouse = getMouseNDC(event);
    raycasterRef.current.setFromCamera(mouse, camera);
    
    const intersects = raycasterRef.current.intersectObject(mesh, true);
    return intersects.length > 0;
  }, [meshRef, camera, getMouseNDC]);

  // Apply cumulative transform to mesh geometry
  const applyTransformToMesh = useCallback(() => {
    if (!meshRef.current || !originalGeometryRef.current) return;
    
    const mesh = meshRef.current;
    
    // Clone original geometry
    const newGeometry = originalGeometryRef.current.clone();
    
    // Create transform matrix from cumulative position and quaternion
    const transformMatrix = new THREE.Matrix4();
    transformMatrix.compose(
      cumulativePositionRef.current,
      cumulativeQuaternionRef.current,
      new THREE.Vector3(1, 1, 1)
    );
    
    // Apply transform to geometry
    newGeometry.applyMatrix4(transformMatrix);
    
    // Replace mesh geometry
    mesh.geometry.dispose();
    mesh.geometry = newGeometry;
    
    // Keep mesh at origin (transform is in geometry)
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
  }, [meshRef]);

  // Activate gizmo: create temp mesh clone, hide main mesh
  const activateGizmo = useCallback(() => {
    if (!meshRef.current) return;
    
    const mesh = meshRef.current;
    
    // Check if mesh has any position/rotation set (e.g., from useViewer baseplate move)
    // If so, we need to bake that into the geometry first
    const meshHasTransform = 
      mesh.position.lengthSq() > 0.0001 || 
      mesh.rotation.x !== 0 || mesh.rotation.y !== 0 || mesh.rotation.z !== 0;
    
    let clonedGeometry = mesh.geometry.clone();
    
    if (meshHasTransform) {
      // Bake the mesh's current transform into the geometry
      const meshMatrix = new THREE.Matrix4();
      meshMatrix.compose(
        mesh.position,
        mesh.quaternion,
        mesh.scale
      );
      clonedGeometry.applyMatrix4(meshMatrix);
      
      // Also update cumulative tracking to include this transform
      // (in case it wasn't already tracked, e.g., from external moves)
      // We add the mesh position to cumulative
      const meshQuaternion = mesh.quaternion.clone();
      
      // Check if this position is already in cumulative (avoid double-counting)
      // Simple check: if cumulative Y differs significantly from mesh position Y
      const positionDelta = mesh.position.clone().sub(cumulativePositionRef.current);
      if (positionDelta.lengthSq() > 0.0001) {
        // There's a discrepancy - sync cumulative to actual mesh state
        cumulativePositionRef.current.copy(mesh.position);
        cumulativeQuaternionRef.current.copy(meshQuaternion);
      }
      
      // Reset the main mesh transform (we've baked it into geometry)
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.geometry.dispose();
      mesh.geometry = clonedGeometry.clone();
      mesh.updateMatrixWorld(true);
    }
    
    const clonedMaterial = Array.isArray(mesh.material) 
      ? mesh.material.map(m => m.clone()) 
      : mesh.material.clone();
    
    const clone = new THREE.Mesh(clonedGeometry, clonedMaterial);
    
    // Temp mesh at origin (geometry already has transform baked in)
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    
    setTempMesh(clone);
    
    // Hide main mesh
    mesh.visible = false;
    
    // Increment key to force fresh PivotControls
    setGizmoKey(k => k + 1);
    setIsActive(true);
    onSelectionChange?.(true);
  }, [meshRef, onSelectionChange]);

  // Deactivate gizmo: apply delta transform to cumulative, update main mesh
  const deactivateGizmo = useCallback(() => {
    if (!meshRef.current || !tempMesh || !pivotRef.current) {
      // Fallback: just show the mesh again
      if (meshRef.current) meshRef.current.visible = true;
      setTempMesh(null);
      setIsActive(false);
      onSelectionChange?.(false);
      // Clear live transform on fallback
      onLiveTransformChange?.(null);
      return;
    }
    
    const mesh = meshRef.current;
    
    // Get the temp mesh's final world transform (this is what we see on screen)
    tempMesh.updateMatrixWorld(true);
    const tempWorldMatrix = tempMesh.matrixWorld.clone();
    
    // Get the PivotControls transform for tracking
    const pivotMatrix = pivotRef.current.matrix.clone();
    const deltaPosition = new THREE.Vector3();
    const deltaQuaternion = new THREE.Quaternion();
    const deltaScale = new THREE.Vector3();
    pivotMatrix.decompose(deltaPosition, deltaQuaternion, deltaScale);
    
    // Emit the final live transform with pivotClosed flag BEFORE updating state
    // This allows 3DScene to know the pivot is closing and the final delta
    const box = new THREE.Box3().setFromObject(tempMesh);
    const deltaRotation = new THREE.Euler().setFromQuaternion(deltaQuaternion);
    onLiveTransformChange?.({
      position: deltaPosition,
      rotation: deltaRotation,
      bounds: box,
      pivotClosed: true,
    });
    
    // Update cumulative tracking
    cumulativePositionRef.current.add(deltaPosition);
    cumulativeQuaternionRef.current.premultiply(deltaQuaternion);
    cumulativeQuaternionRef.current.normalize();
    
    // Instead of applyTransformToMesh (which reconstructs from cumulative),
    // directly use the temp mesh's geometry which is exactly what user sees
    const finalGeometry = tempMesh.geometry.clone();
    
    // Apply the pivot's world transform to the geometry
    finalGeometry.applyMatrix4(pivotMatrix);
    
    // Replace main mesh geometry
    mesh.geometry.dispose();
    mesh.geometry = finalGeometry;
    
    // Keep mesh at origin (transform is baked into geometry)
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
    
    // Show main mesh
    mesh.visible = true;
    
    // Cleanup temp mesh
    tempMesh.geometry.dispose();
    if (Array.isArray(tempMesh.material)) {
      tempMesh.material.forEach(m => m.dispose());
    } else {
      tempMesh.material.dispose();
    }
    setTempMesh(null);
    
    // Emit transform update
    emitTransformUpdate();
    
    setIsActive(false);
    onSelectionChange?.(false);
  }, [meshRef, tempMesh, onSelectionChange, onLiveTransformChange, emitTransformUpdate]);

  // Handle double-click via custom event from the mesh itself
  useEffect(() => {
    if (!enabled) return;
    
    const handleMeshDoubleClick = () => {
      if (isActive) return;
      activateGizmo();
    };
    
    window.addEventListener('mesh-double-click', handleMeshDoubleClick);
    return () => window.removeEventListener('mesh-double-click', handleMeshDoubleClick);
  }, [enabled, isActive, activateGizmo]);

  // Cursor change on hover over mesh (to indicate it's clickable)
  useEffect(() => {
    if (!enabled || isActive) return;
    
    const handleMouseMove = (event: MouseEvent) => {
      if (isMouseOverMesh(event)) {
        gl.domElement.style.cursor = 'pointer';
      } else {
        gl.domElement.style.cursor = 'auto';
      }
    };
    
    gl.domElement.addEventListener('mousemove', handleMouseMove);
    return () => {
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.style.cursor = 'auto';
    };
  }, [gl, enabled, isActive, isMouseOverMesh]);

  // Disable orbit controls when dragging gizmo
  const handleDragStart = useCallback(() => {
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: true } }));
    gl.domElement.style.cursor = 'grabbing';
  }, [gl]);

  const handleDragEnd = useCallback(() => {
    window.dispatchEvent(new CustomEvent('disable-orbit-controls', { detail: { disabled: false } }));
    gl.domElement.style.cursor = 'auto';
  }, [gl]);

  // Keyboard shortcut to close
  useEffect(() => {
    if (!isActive) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        deactivateGizmo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, deactivateGizmo]);

  // Close pivot controls when clicking on UI elements outside the canvas
  useEffect(() => {
    if (!isActive) return;
    
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if click is inside the 3D canvas
      if (gl.domElement.contains(target) || gl.domElement === target) {
        return; // Don't close if clicking in canvas
      }
      
      // Check if clicking on an interactive UI element
      const isInteractiveElement = 
        target.closest('button') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('[role="button"]') ||
        target.closest('[role="slider"]') ||
        target.closest('[role="spinbutton"]') ||
        target.closest('[role="combobox"]') ||
        target.closest('[role="menuitem"]') ||
        target.closest('[data-radix-collection-item]') || // Radix UI components
        target.closest('[class*="accordion"]') ||
        target.closest('[class*="slider"]') ||
        target.closest('[class*="switch"]') ||
        target.closest('[class*="checkbox"]');
      
      if (isInteractiveElement) {
        deactivateGizmo();
      }
    };
    
    // Use capture phase to catch clicks before they're handled
    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [isActive, gl.domElement, deactivateGizmo]);

  // Listen for external transform updates (from Properties panel input fields)
  useEffect(() => {
    const handleSetTransform = (e: CustomEvent) => {
      if (!meshRef.current || isActive) return;
      
      const { position, rotation } = e.detail;
      
      // Update cumulative transform
      cumulativePositionRef.current.copy(position);
      if (rotation instanceof THREE.Euler) {
        cumulativeQuaternionRef.current.setFromEuler(rotation);
      } else {
        cumulativeQuaternionRef.current.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
      }
      
      // Apply to mesh
      applyTransformToMesh();
      
      // Emit update
      emitTransformUpdate();
    };

    window.addEventListener('set-model-transform', handleSetTransform as EventListener);
    return () => window.removeEventListener('set-model-transform', handleSetTransform as EventListener);
  }, [meshRef, isActive, applyTransformToMesh, emitTransformUpdate]);

  // Listen for restore transform request
  useEffect(() => {
    const handleRestoreTransform = (e: CustomEvent) => {
      if (!meshRef.current || isActive) return;
      
      const { position, rotation } = e.detail;
      
      // Update cumulative transform
      cumulativePositionRef.current.copy(position);
      if (rotation instanceof THREE.Euler) {
        cumulativeQuaternionRef.current.setFromEuler(rotation);
      } else if (rotation instanceof THREE.Quaternion) {
        cumulativeQuaternionRef.current.copy(rotation);
      } else {
        // Assume it's an object with x, y, z in radians
        const euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
        cumulativeQuaternionRef.current.setFromEuler(euler);
      }
      
      // Apply to mesh
      applyTransformToMesh();
      
      // Emit update
      emitTransformUpdate();
    };

    window.addEventListener('restore-model-transform', handleRestoreTransform as EventListener);
    return () => window.removeEventListener('restore-model-transform', handleRestoreTransform as EventListener);
  }, [meshRef, isActive, applyTransformToMesh, emitTransformUpdate]);

  // Listen for baseplate-moved-model event (when baseplate creation moves the part)
  // This just tracks the transform like PivotControls does - updates cumulative tracking
  useEffect(() => {
    const handleBaseplateMovedModel = (e: CustomEvent) => {
      if (!meshRef.current) return;
      
      const { deltaY } = e.detail;
      
      // Just update cumulative position tracking (like PivotControls does)
      // The mesh was already moved by useViewer, we just need to track it
      cumulativePositionRef.current.y += deltaY;
      
      // Emit update to UI so position displays correctly
      emitTransformUpdate();
    };

    window.addEventListener('baseplate-moved-model', handleBaseplateMovedModel as EventListener);
    return () => window.removeEventListener('baseplate-moved-model', handleBaseplateMovedModel as EventListener);
  }, [meshRef, emitTransformUpdate]);

  // Scale the gizmo based on model size
  const gizmoScale = bounds ? Math.max(bounds.radius * 0.75, 25) : 50;

  // Render
  return (
    <group ref={groupRef}>
      {/* Main mesh - always rendered, but hidden when gizmo is active */}
      {children}
      
      {/* PivotControls with temp mesh clone - only when active */}
      {isActive && tempMesh && (
        <PivotControls
          ref={pivotRef}
          key={gizmoKey}
          scale={gizmoScale}
          lineWidth={4}
          depthTest={false}
          fixed={false}
          axisColors={['#ff4060', '#40ff60', '#4080ff']}
          hoveredColor="#ffff40"
          annotations={true}
          annotationsClass="pivot-annotation"
          autoTransform={true}
          anchor={[0, 0, 0]}
          disableScaling={true}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <primitive object={tempMesh} />
        </PivotControls>
      )}
      
      {/* Small close button - only shown when active */}
      {isActive && bounds && (
        <Html
          position={[bounds.center.x + bounds.radius * 1.2, bounds.center.y + bounds.radius * 1.2, bounds.center.z]}
          center
          style={{
            pointerEvents: 'auto',
            userSelect: 'none',
          }}
        >
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
