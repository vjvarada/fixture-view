import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

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

// Singleton shared renderer for all thumbnails to avoid WebGL context limit
let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedEnvMap: THREE.Texture | null = null;
let rendererRefCount = 0;

function getSharedRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    // Create offscreen canvas for shared rendering
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 128; // Max thumbnail size we'll support
    offscreenCanvas.height = 128;
    
    sharedRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // Required to copy pixels to visible canvas
    });
    sharedRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    sharedRenderer.setClearColor(0xffffff, 1);
    sharedRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    sharedRenderer.toneMappingExposure = 1;
    sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Create shared environment map
    sharedEnvMap = createWarehouseEnvMap(sharedRenderer);
  }
  rendererRefCount++;
  return sharedRenderer;
}

function releaseSharedRenderer(): void {
  rendererRefCount--;
  // Don't dispose - keep it alive for reuse
  // Only dispose if explicitly needed (e.g., on app unmount)
}

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
  const hasRenderedRef = useRef(false);

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
    if (!canvasRef.current || !thumbnailMesh || hasRenderedRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get shared renderer (uses singleton pattern)
    const renderer = getSharedRenderer();
    
    // Resize shared renderer's canvas for this thumbnail
    const renderSize = Math.max(size * window.devicePixelRatio, 64); // Min 64px for quality
    renderer.setSize(renderSize, renderSize);

    // Create scene with white background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    
    // Use shared environment map
    if (sharedEnvMap) {
      scene.environment = sharedEnvMap;
      
      // Apply environment map to the mesh material for reflections
      if (thumbnailMesh.material instanceof THREE.MeshStandardMaterial) {
        thumbnailMesh.material.envMap = sharedEnvMap;
        thumbnailMesh.material.envMapIntensity = 1.0;
        thumbnailMesh.material.needsUpdate = true;
      }
    }

    // Match lighting exactly from 3DScene.tsx
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-10, -10, -5);
    scene.add(backLight);

    const topLight = new THREE.PointLight(0xffffff, 0.3);
    topLight.position.set(0, 10, 0);
    scene.add(topLight);

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
    const frustumSize = maxDim * 1.2;
    const camera = new THREE.OrthographicCamera(
      -frustumSize / 2,
      frustumSize / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      maxDim * 10
    );

    // Position camera for isometric-like view
    const distance = maxDim * 2;
    camera.position.set(distance, distance * 0.8, distance);
    camera.lookAt(0, 0, 0);

    // Render to shared offscreen canvas
    renderer.render(scene, camera);

    // Copy from shared renderer's canvas to visible canvas
    canvas.width = size * window.devicePixelRatio;
    canvas.height = size * window.devicePixelRatio;
    ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
    
    hasRenderedRef.current = true;

    // Cleanup (but don't dispose shared renderer)
    return () => {
      releaseSharedRenderer();
      thumbnailMesh.geometry.dispose();
      if (thumbnailMesh.material instanceof THREE.Material) {
        thumbnailMesh.material.dispose();
      }
      hasRenderedRef.current = false;
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
