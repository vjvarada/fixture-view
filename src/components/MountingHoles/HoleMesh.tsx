/**
 * HoleMesh Component
 * 
 * Renders a preview of a mounting hole on the baseplate.
 * This shows a visual indicator of where the hole will be drilled.
 * The actual CSG operation happens on the baseplate geometry.
 */

import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { PlacedHole } from './types';
import { createHoleGeometry } from './holeGeometry';

interface HoleMeshProps {
  /** The placed hole configuration */
  hole: PlacedHole;
  /** Y position of the baseplate top */
  baseTopY: number;
  /** Whether this hole is selected */
  isSelected?: boolean;
  /** Whether this hole is being previewed (during placement) */
  isPreview?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Double-click handler for edit mode */
  onDoubleClick?: () => void;
}

// Materials for different states - low opacity to see CSG result beneath
const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0x00aaff,
  transparent: true,
  opacity: 0.25,
  side: THREE.DoubleSide,
});

const normalMaterial = new THREE.MeshStandardMaterial({
  color: 0x444444,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  metalness: 0.3,
  roughness: 0.7,
});

const selectedMaterial = new THREE.MeshStandardMaterial({
  color: 0x00ff88,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
  emissive: 0x004422,
  emissiveIntensity: 0.3,
});

/**
 * Ring indicator showing hole position on baseplate surface
 */
const HoleRingIndicator: React.FC<{
  diameter: number;
  position: THREE.Vector2;
  baseTopY: number;
  isSelected: boolean;
  isPreview: boolean;
}> = ({ diameter, position, baseTopY, isSelected, isPreview }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  
  // Validate inputs to prevent NaN geometries
  const safePosition = useMemo(() => {
    const x = Number(position?.x) || 0;
    const y = Number(position?.y) || 0;
    return { x, y };
  }, [position]);
  
  const safeDiameter = Number(diameter) || 6; // Default 6mm if invalid
  
  // Animate preview ring
  useFrame(({ clock }) => {
    if (ringRef.current && isPreview) {
      ringRef.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 3) * 0.05);
    }
  });
  
  const ringGeometry = useMemo(() => {
    const innerRadius = Math.max(0.5, safeDiameter / 2);
    const outerRadius = innerRadius + 0.15; // 0.15mm ring width (very thin outline)
    return new THREE.RingGeometry(innerRadius, outerRadius, 32);
  }, [safeDiameter]);
  
  const color = isPreview ? 0x00aaff : isSelected ? 0x00ff88 : 0xff6600;
  
  return (
    <mesh
      ref={ringRef}
      position={[safePosition.x, baseTopY + 0.1, safePosition.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={ringGeometry}
    >
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  );
};

/**
 * Main hole mesh component
 */
const HoleMesh: React.FC<HoleMeshProps> = ({
  hole,
  baseTopY,
  isSelected = false,
  isPreview = false,
  onClick,
  onDoubleClick,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Validate hole data to prevent NaN geometries
  const safeHole = useMemo(() => {
    return {
      ...hole,
      diameter: Number(hole.diameter) || 6,
      depth: Number(hole.depth) || 20,
      position: {
        x: Number(hole.position?.x) || 0,
        y: Number(hole.position?.y) || 0,
      },
      countersinkAngle: Number(hole.countersinkAngle) || 90,
      countersinkDiameter: Number(hole.countersinkDiameter) || (Number(hole.diameter) || 6) * 2,
      counterboreDiameter: Number(hole.counterboreDiameter) || (Number(hole.diameter) || 6) * 1.8,
      counterboreDepth: Number(hole.counterboreDepth) || 5,
    };
  }, [hole]);
  
  // Create hole geometry with safe values
  const geometry = useMemo(() => {
    return createHoleGeometry(safeHole as PlacedHole);
  }, [safeHole]);
  
  // Select appropriate material
  const material = useMemo(() => {
    if (isPreview) return previewMaterial;
    if (isSelected) return selectedMaterial;
    return normalMaterial;
  }, [isPreview, isSelected]);
  
  // Handle click events
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick?.();
  };
  
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onDoubleClick?.();
  };
  
  return (
    <group>
      {/* Hole geometry - invisible mesh just for click detection */}
      <mesh
        ref={meshRef}
        position={[safeHole.position.x, baseTopY, safeHole.position.y]}
        geometry={geometry}
        material={material}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        visible={false}
      />
      
      {/* Ring indicator on surface */}
      <HoleRingIndicator
        diameter={hole.type === 'counterbore' ? safeHole.counterboreDiameter :
                  hole.type === 'countersink' ? safeHole.countersinkDiameter :
                  safeHole.diameter}
        position={new THREE.Vector2(safeHole.position.x, safeHole.position.y)}
        baseTopY={baseTopY}
        isSelected={isSelected}
        isPreview={isPreview}
      />
      
      {/* Center marker */}
      {(isSelected || isPreview) && (
        <mesh
          position={[safeHole.position.x, baseTopY + 0.2, safeHole.position.y]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.5, 16]} />
          <meshBasicMaterial color={isPreview ? 0x00aaff : 0x00ff88} />
        </mesh>
      )}
    </group>
  );
};

export default HoleMesh;
