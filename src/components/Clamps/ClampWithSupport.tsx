/**
 * ClampWithSupport Component
 * 
 * Renders a clamp with its associated support structure.
 * The support is automatically generated from the clamp's fixture_mount_surface.
 * The support position and height update based on the clamp's transform.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { ClampModel, PlacedClamp } from './types';
import { loadClampModel, LoadedClampData, createClampMaterials } from './clampLoader';
import { extractSupportFromMountSurface, ClampSupportInfo, createClampSupport } from './clampSupportUtils';
import ClampSupportMesh from './ClampSupportMesh';

interface ClampWithSupportProps {
  /** The clamp model definition */
  clampModel: ClampModel;
  /** Placed clamp instance data */
  placedClamp: PlacedClamp;
  /** Whether this clamp is selected */
  selected?: boolean;
  /** Show debug geometries (fixture point, mount surface, cutouts) */
  showDebug?: boolean;
  /** Y position of the baseplate top in world coords */
  baseTopY?: number;
  /** Whether to show the clamp support */
  showSupport?: boolean;
  /** Callback when clamp is double-clicked */
  onDoubleClick?: (clampId: string) => void;
  /** Callback when clamp is clicked */
  onClick?: (clampId: string) => void;
  /** Callback when clamp data is loaded (provides support info) */
  onClampDataLoaded?: (clampId: string, supportInfo: ClampSupportInfo | null) => void;
}

// Double-click detection threshold
const DOUBLE_CLICK_THRESHOLD_MS = 300;

// Selection highlight color
const SELECTION_COLOR = 0x3b82f6;

const ClampWithSupport: React.FC<ClampWithSupportProps> = ({
  clampModel,
  placedClamp,
  selected = false,
  showDebug = false,
  baseTopY = 0,
  showSupport = true,
  onDoubleClick,
  onClick,
  onClampDataLoaded,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const clampGroupRef = useRef<THREE.Group | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  
  const [clampData, setClampData] = useState<LoadedClampData | null>(null);
  const [supportInfo, setSupportInfo] = useState<ClampSupportInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        
        // Extract support info from fixture_mount_surface
        // Pass the fixturePointTopCenter Y coordinate and minPlacementOffset for proper height calculation
        if (result.data.fixtureMountSurfaceGeometry) {
          const fixturePointY = result.data.fixturePointTopCenter.y;
          const minPlacementOffset = result.data.minPlacementOffset;
          console.log('[ClampWithSupport] fixturePointTopCenter:', result.data.fixturePointTopCenter);
          console.log('[ClampWithSupport] minPlacementOffset:', minPlacementOffset);
          const info = extractSupportFromMountSurface(
            result.data.fixtureMountSurfaceGeometry,
            fixturePointY,
            minPlacementOffset
          );
          setSupportInfo(info);
          onClampDataLoaded?.(placedClamp.id, info);
          
          // Emit event with clamp placement constraints
          window.dispatchEvent(new CustomEvent('clamp-data-loaded', {
            detail: {
              clampId: placedClamp.id,
              minPlacementOffset,
              fixturePointY,
            }
          }));
        } else {
          setSupportInfo(null);
          onClampDataLoaded?.(placedClamp.id, null);
        }
      } else {
        setError(result.error || 'Failed to load clamp');
        onClampDataLoaded?.(placedClamp.id, null);
      }
      
      setIsLoading(false);
    }
    
    load();
    
    return () => {
      cancelled = true;
    };
  }, [clampModel, placedClamp.id, onClampDataLoaded]);

  // Create materials for debug geometries
  const materials = useMemo(() => createClampMaterials(), []);
  
  // Apply selection highlight to clamp meshes
  useEffect(() => {
    if (!clampGroupRef.current) return;
    
    clampGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (selected) {
          // Store original material and apply selection
          if (!child.userData.originalMaterial) {
            child.userData.originalMaterial = child.material;
          }
          child.material = new THREE.MeshStandardMaterial({
            color: SELECTION_COLOR,
            roughness: 0.4,
            metalness: 0.8,
            side: THREE.DoubleSide,
            emissive: SELECTION_COLOR,
            emissiveIntensity: 0.2,
          });
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
      // Double click
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
    return null;
  }

  if (error || !clampData) {
    console.error('Clamp load error:', error);
    return null;
  }

  const { position, rotation, scale } = placedClamp;

  return (
    <>
      {/* Clamp Support - rendered in world space, not inside clamp group */}
      {showSupport && supportInfo && (
        <ClampSupportMesh
          placedClamp={placedClamp}
          supportInfo={supportInfo}
          baseTopY={baseTopY}
          cornerRadius={2}
          visible={true}
        />
      )}
      
      {/* Clamp Mesh Group */}
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
            onClick={handleClick}
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
    </>
  );
};

export default ClampWithSupport;
