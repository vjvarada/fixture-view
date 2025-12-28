/**
 * Debug visualization components for 3D scene
 * Shows perimeters, silhouettes, and other debug overlays
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Debug component to visualize the computed perimeter as a red line
 */
export interface DebugPerimeterLineProps {
  perimeter: Array<{ x: number; z: number }>;
  y: number;
}

export function DebugPerimeterLine({ perimeter, y }: DebugPerimeterLineProps) {
  const lineObj = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (const p of perimeter) {
      points.push(new THREE.Vector3(p.x, y, p.z));
    }
    // Close the loop
    if (perimeter.length > 0) {
      points.push(new THREE.Vector3(perimeter[0].x, y, perimeter[0].z));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
    return new THREE.Line(geometry, material);
  }, [perimeter, y]);
  
  return <primitive object={lineObj} />;
}

/**
 * Debug component to visualize the clamp placement silhouette as a line on the baseplate
 * This shows the part's XZ projection used for calculating clamp positions
 */
export interface DebugSilhouetteLineProps {
  silhouette: Array<{ x: number; z: number }>;
  y: number;
  color?: number;
}

export function DebugSilhouetteLine({ silhouette, y, color = 0x00ffff }: DebugSilhouetteLineProps) {
  const lineObj = useMemo(() => {
    if (!silhouette || silhouette.length < 3) return null;
    
    const points: THREE.Vector3[] = [];
    for (const p of silhouette) {
      points.push(new THREE.Vector3(p.x, y, p.z));
    }
    // Close the loop
    points.push(new THREE.Vector3(silhouette[0].x, y, silhouette[0].z));
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
      color, 
      linewidth: 3,
      depthTest: false, // Always visible
      depthWrite: false,
      transparent: true,
      opacity: 0.9
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 999; // Render on top
    return line;
  }, [silhouette, y, color]);
  
  if (!lineObj) return null;
  return <primitive object={lineObj} />;
}

/**
 * Component for placed fixture elements from the component library
 * Currently a placeholder for future fixture component functionality
 */
export interface FixtureComponentProps {
  component: { geometry: THREE.BufferGeometry; material: THREE.Material };
  position: THREE.Vector3;
  onSelect?: () => void;
}

export function FixtureComponent({ component, position, onSelect }: FixtureComponentProps) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = React.useState(false);

  return (
    <mesh
      ref={meshRef}
      position={position}
      geometry={component.geometry}
      material={component.material}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onClick={onSelect}
      scale={hovered ? 1.05 : 1}
    />
  );
}
