/**
 * ClampMesh Component
 * 
 * Renders a clamp in the 3D scene with all its components:
 * - Main clamp mesh (visible with materials from MTL file)
 * - Fixture point (debug visualization - transform control anchor)
 * - Fixture mount surface (debug visualization)
 * - Fixture cutouts (debug visualization)
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { ClampModel, PlacedClamp, DOUBLE_CLICK_THRESHOLD_MS, SELECTION_COLOR } from '../types';
import { loadClampModel, LoadedClampData, createClampMaterials } from '../utils/clampLoader';

interface ClampMeshProps {
  /** The clamp model definition */
  clampModel: ClampModel;
  /** Placed clamp instance data */
  placedClamp: PlacedClamp;
  /** Whether this clamp is selected */
  selected?: boolean;
  /** Show debug geometries (fixture point, mount surface, cutouts) */
  showDebug?: boolean;
  /** Callback when clamp is double-clicked */
  onDoubleClick?: (clampId: string) => void;
  /** Callback when clamp is clicked */
  onClick?: (clampId: string) => void;
}

const ClampMesh: React.FC<ClampMeshProps> = ({
  clampModel,
  placedClamp,
  selected = false,
  showDebug = true,
  onDoubleClick,
  onClick,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const clampGroupRef = useRef<THREE.Group | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const selectionMaterialsRef = useRef<THREE.Material[]>([]);
  
  const [clampData, setClampData] = useState<LoadedClampData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to dispose loaded clamp data
  const disposeClampData = useCallback((data: LoadedClampData | null) => {
    if (!data) return;
    
    // Dispose geometries
    if (data.clampGeometry) data.clampGeometry.dispose();
    if (data.fixturePointGeometry) data.fixturePointGeometry.dispose();
    if (data.fixtureMountSurfaceGeometry) data.fixtureMountSurfaceGeometry.dispose();
    if (data.fixtureCutoutsGeometry) data.fixtureCutoutsGeometry.dispose();
    
    // Dispose clamp group meshes
    data.clampGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }, []);

  // Load clamp data on mount or when clamp model changes
  useEffect(() => {
    let cancelled = false;
    
    async function load() {
      setIsLoading(true);
      setError(null);
      
      const result = await loadClampModel(clampModel);
      
      if (cancelled) return;
      
      if (result.success && result.data) {
        setClampData(result.data);
        clampGroupRef.current = result.data.clampGroup;
      } else {
        setError(result.error || 'Failed to load clamp');
      }
      
      setIsLoading(false);
    }
    
    load();
    
    return () => {
      cancelled = true;
    };
  }, [clampModel]);

  // Cleanup clamp data on unmount or when clamp model changes
  useEffect(() => {
    return () => {
      disposeClampData(clampData);
      // Dispose selection materials
      selectionMaterialsRef.current.forEach(mat => mat.dispose());
      selectionMaterialsRef.current = [];
    };
  }, [clampData, disposeClampData]);

  // Create materials for debug geometries
  const materials = useMemo(() => createClampMaterials(), []);
  
  // Apply selection highlight to clamp meshes
  useEffect(() => {
    if (!clampGroupRef.current) return;
    
    // Dispose previous selection materials
    selectionMaterialsRef.current.forEach(mat => mat.dispose());
    selectionMaterialsRef.current = [];
    
    clampGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (selected) {
          // Store original material and apply selection
          if (!child.userData.originalMaterial) {
            child.userData.originalMaterial = child.material;
          }
          const selectionMat = new THREE.MeshStandardMaterial({
            color: SELECTION_COLOR,
            roughness: 0.4,
            metalness: 0.8,
            side: THREE.DoubleSide,
            emissive: SELECTION_COLOR,
            emissiveIntensity: 0.2,
          });
          selectionMaterialsRef.current.push(selectionMat);
          child.material = selectionMat;
        } else {
          // Restore original material
          if (child.userData.originalMaterial) {
            child.material = child.userData.originalMaterial;
          }
        }
      }
    });
  }, [selected, clampData]);

  // Handle click with double-click detection
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    
    if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD_MS) {
      // Double click - dispatch navigation event for accordion auto-open
      window.dispatchEvent(new CustomEvent('highlight-component', {
        detail: { category: 'clamp', id: placedClamp.id }
      }));
      onDoubleClick?.(placedClamp.id);
    } else {
      // Single click
      onClick?.(placedClamp.id);
    }
    
    lastClickTimeRef.current = now;
  }, [placedClamp.id, onDoubleClick, onClick]);

  // Calculate pivot offset (from group origin to fixture point top center)
  const pivotOffset = useMemo(() => {
    if (!clampData) return new THREE.Vector3(0, 0, 0);
    return clampData.fixturePointTopCenter.clone().negate();
  }, [clampData]);

  if (isLoading) {
    return null; // Or a loading indicator mesh
  }

  if (error || !clampData) {
    // Load error - don't render anything
    return null;
  }

  const { position, rotation, scale } = placedClamp;

  return (
    <group
      ref={groupRef}
      position={[position.x, position.y, position.z]}
      rotation={[
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
      ]}
      scale={[scale.x, scale.y, scale.z]}
    >
      {/* Inner group offset so pivot is at fixture point top center */}
      <group position={[pivotOffset.x, pivotOffset.y, pivotOffset.z]}>
        {/* Main clamp group with materials from MTL file */}
        <primitive 
          object={clampData.clampGroup} 
        />

        {/* Debug geometries - only shown when showDebug is true */}
        {showDebug && clampData.fixturePointGeometry && (
          <mesh
            geometry={clampData.fixturePointGeometry}
            material={materials.fixturePoint}
          />
        )}

        {showDebug && clampData.fixtureMountSurfaceGeometry && (
          <mesh
            geometry={clampData.fixtureMountSurfaceGeometry}
            material={materials.fixtureMountSurface}
          />
        )}

        {showDebug && clampData.fixtureCutoutsGeometry && (
          <mesh
            geometry={clampData.fixtureCutoutsGeometry}
            material={materials.fixtureCutouts}
          />
        )}
      </group>

      {/* Pivot point indicator (small sphere at 0,0,0 of this group = fixture point top center) */}
      {showDebug && (
        <mesh>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color={0xff0000} />
        </mesh>
      )}
    </group>
  );
};

// Memoize ClampMesh to prevent unnecessary re-renders
const MemoizedClampMesh = React.memo(ClampMesh, (prevProps, nextProps) => {
  return (
    prevProps.clampModel === nextProps.clampModel &&
    prevProps.placedClamp === nextProps.placedClamp &&
    prevProps.selected === nextProps.selected &&
    prevProps.showDebug === nextProps.showDebug &&
    prevProps.onDoubleClick === nextProps.onDoubleClick &&
    prevProps.onClick === nextProps.onClick
  );
});

export default MemoizedClampMesh;

/**
 * Hook to manage placed clamps state
 */
export function usePlacedClamps() {
  const [placedClamps, setPlacedClamps] = useState<PlacedClamp[]>([]);
  const [selectedClampId, setSelectedClampId] = useState<string | null>(null);

  const addClamp = useCallback((clampModelId: string, position?: { x: number; y: number; z: number }) => {
    const newClamp: PlacedClamp = {
      id: `clamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      clampModelId,
      position: position || { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    
    setPlacedClamps(prev => [...prev, newClamp]);
    return newClamp.id;
  }, []);

  const removeClamp = useCallback((clampId: string) => {
    setPlacedClamps(prev => prev.filter(c => c.id !== clampId));
    if (selectedClampId === clampId) {
      setSelectedClampId(null);
    }
  }, [selectedClampId]);

  const updateClamp = useCallback((clampId: string, updates: Partial<PlacedClamp>) => {
    setPlacedClamps(prev => prev.map(c => 
      c.id === clampId ? { ...c, ...updates } : c
    ));
  }, []);

  const selectClamp = useCallback((clampId: string | null) => {
    setSelectedClampId(clampId);
  }, []);

  return {
    placedClamps,
    selectedClampId,
    addClamp,
    removeClamp,
    updateClamp,
    selectClamp,
  };
}
