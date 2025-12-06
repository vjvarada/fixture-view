import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

interface PartThumbnailProps {
  mesh: THREE.Mesh;
  size?: number;
  className?: string;
  color?: string; // Optional hex color like '#4ade80'
}

// Color palette (same as 3DScene.tsx) - first model always gets first color
const MODEL_COLOR_PALETTE = [
  '#4ade80', // Green
  '#f97316', // Orange
  '#06b6d4', // Cyan
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#eab308', // Yellow
  '#ef4444', // Red
  '#22c55e', // Emerald
  '#3b82f6', // Blue
  '#f59e0b'  // Amber
];

// Create a simple environment map that simulates warehouse lighting
function createWarehouseEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  
  // Create a simple gradient scene to simulate warehouse environment
  const envScene = new THREE.Scene();
  
  // Warehouse-like colors: bright top, neutral sides, darker floor reflection
  const topColor = new THREE.Color(0xffffff);    // Bright white ceiling lights
  const middleColor = new THREE.Color(0xe8e8e8); // Light gray walls
  const bottomColor = new THREE.Color(0xcccccc); // Slightly darker floor
  
  // Create hemisphere light to simulate environment
  const hemiLight = new THREE.HemisphereLight(topColor, bottomColor, 1.0);
  envScene.add(hemiLight);
  
  // Add ambient to fill
  const ambient = new THREE.AmbientLight(middleColor, 0.5);
  envScene.add(ambient);
  
  // Create environment from scene
  const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
  pmremGenerator.dispose();
  
  return envMap;
}

const PartThumbnail: React.FC<PartThumbnailProps> = ({ mesh, size = 24, className = '', color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Determine the color to use - read from mesh material since color is applied before file is set
  const thumbnailColor = useMemo(() => {
    // First priority: explicitly passed color prop
    if (color) return color;
    
    // Second priority: get color from mesh's current material (set during file import)
    if (mesh?.material) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.color) {
        const hexColor = '#' + material.color.getHexString();
        return hexColor;
      }
    }
    
    // Default: use first color from palette
    return MODEL_COLOR_PALETTE[0];
  }, [mesh, mesh?.material, color]);

  // Clone the geometry and create a material with the correct color
  const thumbnailMesh = useMemo(() => {
    if (!mesh?.geometry) return null;
    
    const geometry = mesh.geometry.clone();
    
    // Convert hex color to THREE.Color
    const threeColor = new THREE.Color(thumbnailColor);
    
    // Match material settings closer to 3D scene (metalness: 0, roughness: 0.6)
    const material = new THREE.MeshStandardMaterial({
      color: threeColor,
      metalness: 0.0,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    
    return new THREE.Mesh(geometry, material);
  }, [mesh, thumbnailColor]);

  useEffect(() => {
    if (!canvasRef.current || !thumbnailMesh) return;

    const canvas = canvasRef.current;
    
    // Create renderer matching R3F Canvas defaults exactly
    const renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true,
      alpha: false, // No alpha - solid background like 3D viewer
      powerPreference: 'high-performance',
    });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xffffff, 1); // White background like 3D viewer
    // R3F defaults - matching exactly
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    // Create scene with white background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    
    // Create environment map to simulate <Environment preset="warehouse" />
    const envMap = createWarehouseEnvMap(renderer);
    scene.environment = envMap;
    
    // Apply environment map to the mesh material for reflections
    if (thumbnailMesh.material instanceof THREE.MeshStandardMaterial) {
      thumbnailMesh.material.envMap = envMap;
      thumbnailMesh.material.envMapIntensity = 1.0;
      thumbnailMesh.material.needsUpdate = true;
    }

    // Match lighting exactly from 3DScene.tsx (lines 1618-1623)
    // <ambientLight intensity={0.6} />
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // <directionalLight position={[10, 10, 5]} intensity={0.8} />
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    scene.add(directionalLight);

    // <directionalLight position={[-10, -10, -5]} intensity={0.4} />
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-10, -10, -5);
    scene.add(backLight);

    // <pointLight position={[0, 10, 0]} intensity={0.3} />
    const topLight = new THREE.PointLight(0xffffff, 0.3);
    topLight.position.set(0, 10, 0);
    scene.add(topLight);

    // <pointLight position={[0, -10, 0]} intensity={0.3} />
    const bottomLight = new THREE.PointLight(0xffffff, 0.3);
    bottomLight.position.set(0, -10, 0);
    scene.add(bottomLight);

    // Compute bounding box and center the mesh
    const box = new THREE.Box3().setFromObject(thumbnailMesh);
    const center = box.getCenter(new THREE.Vector3());
    const boxSize = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z);

    // Center the mesh
    thumbnailMesh.position.sub(center);
    scene.add(thumbnailMesh);

    // Create orthographic camera for consistent thumbnail
    const aspect = 1;
    const frustumSize = maxDim * 1.2;
    const camera = new THREE.OrthographicCamera(
      -frustumSize / 2,
      frustumSize / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      maxDim * 10
    );

    // Position camera for isometric-like view (matching 3D viewer default)
    const distance = maxDim * 2;
    camera.position.set(distance, distance * 0.8, distance);
    camera.lookAt(0, 0, 0);

    // Render
    renderer.render(scene, camera);

    // Cleanup
    return () => {
      envMap.dispose();
      renderer.dispose();
      thumbnailMesh.geometry.dispose();
      if (thumbnailMesh.material instanceof THREE.Material) {
        thumbnailMesh.material.dispose();
      }
    };
  }, [thumbnailMesh, size]);

  if (!mesh?.geometry) {
    return (
      <div 
        className={`bg-muted/50 rounded flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-[8px] text-muted-foreground">?</span>
      </div>
    );
  }

  return (
    <canvas 
      ref={canvasRef} 
      className={`rounded ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

export default PartThumbnail;
export { MODEL_COLOR_PALETTE };
