/**
 * SceneLighting - Renders the lighting setup for the 3D scene
 * Extracted from 3DScene.tsx for modularity
 */
import React from 'react';

/**
 * Standard lighting setup for the 3D scene
 * Uses multiple light sources for good model visibility without HDR environment
 */
export const SceneLighting: React.FC = () => {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1.0} castShadow />
      <directionalLight position={[-10, -10, -5]} intensity={0.5} />
      <directionalLight position={[5, 15, -5]} intensity={0.6} />
      <pointLight position={[0, 10, 0]} intensity={0.4} />
      <pointLight position={[0, -10, 0]} intensity={0.3} />
      <hemisphereLight args={['#ffffff', '#444444', 0.6]} />
    </>
  );
};

export default SceneLighting;
