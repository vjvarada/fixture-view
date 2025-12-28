/**
 * ScalableGrid component
 * 
 * A ground grid that scales with the model and adapts to model position.
 * Renders major/minor grid lines and axis indicators.
 */

import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { BoundsSummary } from '../types';
import { calculateGridConfig } from '../utils';

interface ScalableGridProps {
  modelBounds: BoundsSummary | null;
  isDarkMode?: boolean;
}

export const ScalableGrid: React.FC<ScalableGridProps> = ({ 
  modelBounds, 
  isDarkMode = false 
}) => {
  const gridRef = useRef<THREE.Group>(null);
  
  // Calculate grid size based on model bounds
  const gridConfig = useMemo(() => calculateGridConfig(modelBounds), [modelBounds]);

  // Create axis lines using useMemo to avoid recreation on every render
  const xAxisLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      -gridConfig.size / 2, 0.01, 0,
      gridConfig.size / 2, 0.01, 0
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xff4444 });
    return new THREE.Line(geometry, material);
  }, [gridConfig.size]);

  const zAxisLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      0, 0.01, -gridConfig.size / 2,
      0, 0.01, gridConfig.size / 2
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x44ff44 });
    return new THREE.Line(geometry, material);
  }, [gridConfig.size]);

  return (
    <group ref={gridRef} position={[0, -0.01, 0]} frustumCulled={false}>
      {/* Minor grid lines */}
      <gridHelper 
        args={[
          gridConfig.size, 
          gridConfig.divisions, 
          isDarkMode ? '#3a3a4a' : '#d0d0d0', 
          isDarkMode ? '#2a2a3a' : '#e8e8e8'
        ]} 
        rotation={[0, 0, 0]}
      />
      
      {/* Major grid lines (every N cells) */}
      <gridHelper 
        args={[
          gridConfig.size, 
          Math.floor(gridConfig.divisions / gridConfig.majorDivisions), 
          isDarkMode ? '#4a4a5a' : '#a0a0a0', 
          isDarkMode ? '#4a4a5a' : '#a0a0a0'
        ]} 
        rotation={[0, 0, 0]}
        position={[0, 0.001, 0]}
      />
      
      {/* X axis (red) */}
      <primitive object={xAxisLine} />
      
      {/* Z axis (green) */}
      <primitive object={zAxisLine} />
    </group>
  );
};

export default ScalableGrid;
