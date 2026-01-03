import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewerConfig, ViewOrientation, ViewerHandle, DEFAULT_VIEWER_CONFIG } from '../types';

// Create viewer axes that will be positioned in bottom-left and rotate with camera
function createViewerAxes(): THREE.Group {
  const axesGroup = new THREE.Group();
  
  // X Axis (Red)
  const xGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 12);
  const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8, depthWrite: false });
  const xAxis = new THREE.Mesh(xGeometry, xMaterial);
  xAxis.rotation.z = -Math.PI / 2;
  xAxis.position.x = 0.4;
  axesGroup.add(xAxis);

  // X Arrow
  const xArrowGeometry = new THREE.ConeGeometry(0.04, 0.12, 12);
  const xArrow = new THREE.Mesh(xArrowGeometry, xMaterial);
  xArrow.rotation.z = -Math.PI / 2;
  xArrow.position.x = 0.84;
  axesGroup.add(xArrow);

  // Y Axis (Green)
  const yGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 12);
  const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8, depthWrite: false });
  const yAxis = new THREE.Mesh(yGeometry, yMaterial);
  yAxis.position.y = 0.4;
  axesGroup.add(yAxis);

  // Y Arrow
  const yArrowGeometry = new THREE.ConeGeometry(0.04, 0.12, 12);
  const yArrow = new THREE.Mesh(yArrowGeometry, yMaterial);
  yArrow.position.y = 0.84;
  axesGroup.add(yArrow);

  // Z Axis (Blue)
  const zGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 12);
  const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.8, depthWrite: false });
  const zAxis = new THREE.Mesh(zGeometry, zMaterial);
  zAxis.rotation.x = Math.PI / 2;
  zAxis.position.z = 0.4;
  axesGroup.add(zAxis);

  // Z Arrow
  const zArrowGeometry = new THREE.ConeGeometry(0.04, 0.12, 12);
  const zArrow = new THREE.Mesh(zArrowGeometry, zMaterial);
  zArrow.rotation.x = Math.PI / 2;
  zArrow.position.z = 0.84;
  axesGroup.add(zArrow);

  // Add labels
  const labels = [
    { text: 'X', position: new THREE.Vector3(1, 0, 0), color: 0xff0000 },
    { text: 'Y', position: new THREE.Vector3(0, 1, 0), color: 0x00ff00 },
    { text: 'Z', position: new THREE.Vector3(0, 0, 1), color: 0x0000ff }
  ];

  labels.forEach((label) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 32;
    canvas.height = 32;
    
    context.fillStyle = `#${label.color.toString(16).padStart(6, '0')}`;
    context.font = 'bold 24px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label.text, 16, 16);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: texture, 
      transparent: true,
      depthWrite: false,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(label.position);
    sprite.scale.set(0.15, 0.15, 1);
    axesGroup.add(sprite);
  });

  return axesGroup;
}

// Update viewer axes position and orientation based on camera
function updateViewerAxes(axesGroup: THREE.Group, camera: THREE.Camera) {
  // Position in bottom-left corner of the view
  const position = new THREE.Vector3();
  (camera as any).getWorldPosition ? (camera as any).getWorldPosition(position) : position.set(0, 0, 0);
  
  // Get camera direction
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  
  // Position axes relative to camera (bottom-left corner)
  const rightVector = new THREE.Vector3();
  const upVector = new THREE.Vector3();
  
  rightVector.setFromMatrixColumn((camera as any).matrixWorld, 0).normalize();
  upVector.setFromMatrixColumn((camera as any).matrixWorld, 1).normalize();
  
  // Calculate position for bottom-left corner
  const distance = 2; // Distance from camera
  const offsetRight = rightVector.clone().multiplyScalar(-1.5);
  const offsetUp = upVector.clone().multiplyScalar(-1.2);
  const offsetForward = direction.clone().multiplyScalar(distance);
  
  axesGroup.position.copy(position)
    .add(offsetForward)
    .add(offsetRight)
    .add(offsetUp);

  // Rotate axes to match camera orientation, so orientation is intuitive
  axesGroup.quaternion.copy((camera as any).quaternion);
}

interface UseViewerReturn extends ViewerHandle {
  isReady: boolean;
  clearBaseplate: () => void;
}

export function useViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  config: ViewerConfig = DEFAULT_VIEWER_CONFIG
): UseViewerReturn {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const animationIdRef = useRef<number | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const viewerAxesRef = useRef<THREE.Group | null>(null);
  const baseplateRef = useRef<THREE.Mesh | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const overlaySceneRef = useRef<THREE.Scene | null>(null);
  const overlayCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const overlayRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const centerCrossRef = useRef<THREE.LineSegments | null>(null);
  const updateCenterCrossLength = useCallback((length: number) => {
    if (!sceneRef.current) return;
    // Remove existing
    if (centerCrossRef.current) {
      sceneRef.current.remove(centerCrossRef.current);
      (centerCrossRef.current.geometry as THREE.BufferGeometry)?.dispose();
      (centerCrossRef.current.material as THREE.LineBasicMaterial)?.dispose();
      centerCrossRef.current = null;
    }

    const positions = new Float32Array([
      // X axis (red)
      -length, 0, 0,   length, 0, 0,
      // Y axis (green)
      0, -length, 0,   0, length, 0,
    ]);
    const colors = new Float32Array([
      1, 0, 0,   1, 0, 0,
      0, 1, 0,   0, 1, 0,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(geom, mat);
    lines.renderOrder = -1;
    lines.visible = true;
    sceneRef.current.add(lines);
    centerCrossRef.current = lines;
  }, []);
  const isInitializedRef = useRef(false);
  const tmpQuatArray: [number, number, number, number] = [0, 0, 0, 1];

  // Initialize Three.js scene
  const initializeScene = useCallback(() => {
    if (!containerRef.current || isInitializedRef.current) {
      return;
    }

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(config.backgroundColor);
    sceneRef.current = scene;

    // Camera (orthographic default to match RapidTool-like view)
    let camera: THREE.Camera;
    if (config.cameraType === 'orthographic') {
      const aspect = rect.width / rect.height;
      const s = 5; // initial half-height size, will be fit later
      const ortho = new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, -1000, 1000);
      ortho.position.set(5, 5, 5);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(0, 0, 0);
      camera = ortho;
    } else {
      const persp = new THREE.PerspectiveCamera(75, rect.width / rect.height, 0.1, 1000);
      persp.position.set(5, 5, 5);
      persp.lookAt(0, 0, 0);
      camera = persp;
    }
    cameraRef.current = camera;

    // Create main renderer with optimized settings for better WebGL context management
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
      stencil: false,
      depth: true
    });
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    rendererRef.current = renderer;

    // Controls
    if (config.enableOrbitControls) {
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.minDistance = 1;
      controls.maxDistance = 100;
      controls.enablePan = true;
      controls.enableZoom = true;
      controlsRef.current = controls;
    }

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.4);
    scene.add(hemisphereLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 15, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);

    // Grid helper
    if (config.showGrid) {
      const gridHelper = new THREE.GridHelper(config.gridSize, config.gridSize);
      gridHelper.material.color.setHex(0x333333);
      gridHelper.material.opacity = 0.5;
      gridHelper.material.transparent = true;
      gridHelper.position.y = -0.001; // keep slightly under the bed for better contrast
      scene.add(gridHelper);
      gridHelperRef.current = gridHelper;
    }

    // Overlay scene/camera + dedicated transparent renderer for bottom-left axes - DISABLED (using 3DScene.tsx axes instead)
    // const overlayScene = new THREE.Scene();
    // const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    // overlayCam.position.set(0, 0, 2);
    // overlayCam.lookAt(0, 0, 0);
    // const overlayAxes = createViewerAxes();
    // overlayAxes.scale.setScalar(0.65);
    // overlayAxes.visible = true;
    // overlayAxes.traverse((obj) => {
    //   const mat = (obj as THREE.Mesh).material as any;
    //   if (mat && mat.depthTest !== undefined) mat.depthTest = false;
    //   (obj as any).renderOrder = 999;
    // });
    // overlayScene.add(overlayAxes);
    // overlaySceneRef.current = overlayScene;
    // overlayCameraRef.current = overlayCam;
    // viewerAxesRef.current = overlayAxes;

    // Create a second transparent renderer just for the axes HUD - DISABLED
    // const overlayRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // overlayRenderer.setSize(112, 112);
    // overlayRenderer.setPixelRatio(config.pixelRatio);
    // overlayRenderer.setClearColor(0x000000, 0); // fully transparent
    // overlayRendererRef.current = overlayRenderer;

    // Large center X/Y axes (pre-import visual)
    { updateCenterCrossLength(100); }

    // Standard axes helper (optional, can be disabled)
    if (config.showAxes) {
      const axesHelper = new THREE.AxesHelper(2);
      scene.add(axesHelper);
      axesHelperRef.current = axesHelper;
    }

    // Add to container
    container.appendChild(renderer.domElement);
    // Position the overlay axes canvas bottom-left on top of main canvas - DISABLED
    // const hud = overlayRenderer.domElement;
    // hud.style.position = 'absolute';
    // hud.style.left = '8px';
    // hud.style.bottom = '8px';
    // hud.style.width = '112px';
    // hud.style.height = '112px';
    // hud.style.pointerEvents = 'none';
    // hud.style.background = 'transparent';
    // hud.style.backgroundColor = 'transparent';
    // container.appendChild(hud);

    // Test render
    renderer.render(scene, camera);

    // Start render loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Render main scene
      renderer.render(scene, camera);

      // Render overlay axes using dedicated transparent renderer - DISABLED (using 3DScene.tsx axes)
      // if (overlayRendererRef.current && overlaySceneRef.current && overlayCameraRef.current && viewerAxesRef.current && cameraRef.current) {
      //   viewerAxesRef.current.quaternion.copy((cameraRef.current as any).quaternion);
      //   overlayRendererRef.current.render(overlaySceneRef.current, overlayCameraRef.current);
      // }

      // Broadcast camera quaternion so ViewCube can follow
      const q = (camera as THREE.Camera as any).quaternion as THREE.Quaternion;
      if (q) {
        tmpQuatArray[0] = q.x; tmpQuatArray[1] = q.y; tmpQuatArray[2] = q.z; tmpQuatArray[3] = q.w;
        const evt = new CustomEvent('viewer-camera-changed', { detail: { q: tmpQuatArray } });
        window.dispatchEvent(evt);
      }
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      
      const newRect = containerRef.current.getBoundingClientRect();
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const persp = camera as THREE.PerspectiveCamera;
        persp.aspect = newRect.width / newRect.height;
        persp.updateProjectionMatrix();
      } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const ortho = camera as THREE.OrthographicCamera;
        const aspect = newRect.width / newRect.height;
        const halfH = (ortho.top - ortho.bottom) / 2;
        ortho.left = -halfH * aspect;
        ortho.right = halfH * aspect;
        ortho.updateProjectionMatrix();
      }
      renderer.setSize(newRect.width, newRect.height);
    };

    window.addEventListener('resize', handleResize);
    isInitializedRef.current = true;

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      if (overlayRendererRef.current) {
        const hud = overlayRendererRef.current.domElement;
        if (hud && hud.parentElement === container) container.removeChild(hud);
        overlayRendererRef.current.dispose();
        overlayRendererRef.current = null;
      }
      renderer.dispose();
      isInitializedRef.current = false;
    };
  }, [containerRef, config]);

  // Initialize when container is available
  useEffect(() => {
    if (containerRef.current) {
      return initializeScene();
    }
  }, [initializeScene, containerRef]);

  const addMesh = useCallback((mesh: THREE.Mesh) => {
    if (!sceneRef.current) {
      console.error('Cannot add mesh: scene not initialized');
      return;
    }

    try {
      sceneRef.current.add(mesh);
      meshesRef.current.push(mesh);

      // Force a render update
      if (rendererRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      // Recenter large XY cross to model center if present
      if (centerCrossRef.current) {
        const box = new THREE.Box3();
        box.expandByObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        centerCrossRef.current.position.copy(center);
      }

      // Scale large XY cross based on model size
      const bs = computeBoundingSphere();
      if (bs) {
        const dynLen = Math.max(1, bs.radius * 2);
        updateCenterCrossLength(dynLen);
        if (centerCrossRef.current) centerCrossRef.current.position.copy(bs.center);
      }
    } catch (error) {
      console.error('Error adding mesh:', error);
    }
  }, []);

  const removeMesh = useCallback((mesh?: THREE.Mesh) => {
    if (!sceneRef.current) return;

    if (mesh) {
      sceneRef.current.remove(mesh);
      const index = meshesRef.current.indexOf(mesh);
      if (index > -1) {
        meshesRef.current.splice(index, 1);
      }
    } else {
      // Remove all tracked meshes
      meshesRef.current.forEach(m => sceneRef.current!.remove(m));
      meshesRef.current = [];
    }

    // If meshes remain, recenter cross to their combined center; otherwise reset to origin
    if (centerCrossRef.current) {
      if (meshesRef.current.length > 0) {
        const box = new THREE.Box3();
        meshesRef.current.forEach(m => box.expandByObject(m));
        const center = new THREE.Vector3();
        box.getCenter(center);
        centerCrossRef.current.position.copy(center);
      } else {
        centerCrossRef.current.position.set(0, 0, 0);
      }
    }
  }, []);

  const clearBaseplate = useCallback(() => {
    if (!sceneRef.current) return;

    // Remove baseplate
    if (baseplateRef.current) {
      sceneRef.current.remove(baseplateRef.current);
      if (baseplateRef.current.geometry) baseplateRef.current.geometry.dispose();
      if (baseplateRef.current.material) {
        if (Array.isArray(baseplateRef.current.material)) {
          baseplateRef.current.material.forEach(m => m.dispose());
        } else {
          baseplateRef.current.material.dispose();
        }
      }
      baseplateRef.current = null;
    }

    // Remove ground
    if (groundRef.current) {
      sceneRef.current.remove(groundRef.current);
      if (groundRef.current.geometry) groundRef.current.geometry.dispose();
      if (groundRef.current.material) {
        if (Array.isArray(groundRef.current.material)) {
          groundRef.current.material.forEach(m => m.dispose());
        } else {
          groundRef.current.material.dispose();
        }
      }
      groundRef.current = null;
    }
  }, []);

  const computeBoundingSphere = useCallback((): THREE.Sphere | null => {
    if (meshesRef.current.length === 0) return null;

    const box = new THREE.Box3();
    meshesRef.current.forEach(mesh => {
      box.expandByObject(mesh);
    });

    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return sphere;
  }, []);

  const fitToView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;

    const boundingSphere = computeBoundingSphere();
    if (!boundingSphere) return;

    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const persp = camera as THREE.PerspectiveCamera;
      const fov = persp.fov * (Math.PI / 180);
      const distance = Math.abs(boundingSphere.radius / Math.sin(fov / 2)) * 1.2;
      const direction = new THREE.Vector3().subVectors(persp.position, controls.target).normalize();
      persp.position.copy(boundingSphere.center).add(direction.multiplyScalar(distance));
      controls.target.copy(boundingSphere.center);
      controls.minDistance = distance * 0.1;
      controls.maxDistance = distance * 10;
      controls.update();
    } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      const box = new THREE.Box3();
      meshesRef.current.forEach(mesh => box.expandByObject(mesh));
      const size = new THREE.Vector3();
      box.getSize(size);
      const aspect = rendererRef.current ? rendererRef.current.domElement.clientWidth / rendererRef.current.domElement.clientHeight : 1;
      const margin = 1.2;
      const halfH = (Math.max(size.y, size.z) * 0.5) * margin; // Y up; fit Z vertically in screen
      ortho.top = halfH;
      ortho.bottom = -halfH;
      ortho.left = -halfH * aspect;
      ortho.right = halfH * aspect;
      ortho.position.set(boundingSphere.center.x + halfH, boundingSphere.center.y + halfH, boundingSphere.center.z + halfH);
      controls.target.copy(boundingSphere.center);
      ortho.updateProjectionMatrix();
      controls.update();

      // Keep large XY cross at model center
      if (centerCrossRef.current) {
        centerCrossRef.current.position.copy(boundingSphere.center);
      }
      // Adjust large XY cross length to fit model comfortably
      const dynLen = Math.max(1, boundingSphere.radius * 2);
      updateCenterCrossLength(dynLen);
    }
  }, [computeBoundingSphere, updateCenterCrossLength]);

  const resetView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;

    const boundingSphere = computeBoundingSphere();
    if (boundingSphere) {
      // Reset camera position
      if ((cameraRef.current as THREE.PerspectiveCamera).isPerspectiveCamera) {
        (cameraRef.current as THREE.PerspectiveCamera).position.set(5, 5, 5);
      } else if ((cameraRef.current as THREE.OrthographicCamera).isOrthographicCamera) {
        (cameraRef.current as THREE.OrthographicCamera).position.set(5, 5, 5);
      }
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();

      fitToView();
    } else {
      // Default view when no meshes
      cameraRef.current.position.set(5, 5, 5);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [computeBoundingSphere, fitToView]);

  const setOrientation = useCallback((orientation: ViewOrientation) => {
    if (!cameraRef.current || !controlsRef.current) return;

    const bs = computeBoundingSphere();
    const center = bs?.center || new THREE.Vector3(0, 0, 0);
    const radius = bs?.radius || 5;
    const distance = radius * 3;

    const camera = cameraRef.current;
    const controls = controlsRef.current;

    let position: THREE.Vector3;

    switch (orientation) {
      case 'front':
        position = new THREE.Vector3(0, 0, distance);
        break;
      case 'back':
        position = new THREE.Vector3(0, 0, -distance);
        break;
      case 'left':
        position = new THREE.Vector3(-distance, 0, 0);
        break;
      case 'right':
        position = new THREE.Vector3(distance, 0, 0);
        break;
      case 'top':
        position = new THREE.Vector3(0, distance, 0);
        break;
      case 'bottom':
        position = new THREE.Vector3(0, -distance, 0);
        break;
      case 'iso':
      default:
        // Use (-X, +Y, +Z) octant so ViewCube shows TOP, FRONT, LEFT in isometric
        position = new THREE.Vector3(-distance * 0.7, distance * 0.7, distance * 0.7);
        break;
    }

    position.add(center);
    camera.position.copy(position);
    controls.target.copy(center);
    controls.update();
  }, [computeBoundingSphere]);

  const createOrUpdateBaseplate = useCallback((extraXY: number, height: number) => {
    if (!sceneRef.current) return;
    // Compute bounding box of current meshes
    const box = new THREE.Box3();
    meshesRef.current.forEach(mesh => box.expandByObject(mesh));
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const plateWidth = size.x + 2 * extraXY;
      const plateDepth = size.z + 2 * extraXY;
      const minY = box.min.y;

      const geometry = new THREE.BoxGeometry(plateWidth, height, plateDepth);
      const material = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.9, metalness: 0.0 });

      if (!baseplateRef.current) {
        baseplateRef.current = new THREE.Mesh(geometry, material);
        baseplateRef.current.receiveShadow = true;
        sceneRef.current.add(baseplateRef.current);
      } else {
        baseplateRef.current.geometry.dispose();
        baseplateRef.current.geometry = geometry;
        // Replace material safely (explicit dispose can be added later if needed)
        baseplateRef.current.material = material;
      }

      // Place baseplate so its TOP is at y = 0 (bed plane)
      baseplateRef.current.position.set(center.x, height / 2, center.z);

      // Drop the model so its bottom sits on the bed (y=0)
      const dropDy = -minY;
      if (dropDy !== 0) {
        meshesRef.current.forEach(mesh => {
          mesh.position.y += dropDy;
        });
        
        // Notify SelectableTransformControls about the position change
        // so the cumulative transform is updated and gizmo won't reset
        window.dispatchEvent(
          new CustomEvent('baseplate-moved-model', {
            detail: { deltaY: dropDy }
          })
        );
      }

      // Add/update a large ground plane so it doesn't feel like the edge
      const maxSide = Math.max(plateWidth, plateDepth);
      const planeSize = maxSide * 5; // scale factor
      const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
      planeGeom.rotateX(-Math.PI / 2);
      const planeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 1.0, metalness: 0, side: THREE.DoubleSide });
      if (!groundRef.current) {
        groundRef.current = new THREE.Mesh(planeGeom, planeMat);
        groundRef.current.receiveShadow = true;
        groundRef.current.position.set(center.x, 0, center.z);
        sceneRef.current.add(groundRef.current);
      } else {
        groundRef.current.geometry.dispose();
        groundRef.current.geometry = planeGeom;
        groundRef.current.position.set(center.x, 0, center.z);
      }
    }
  }, []);

  // Event listeners for app shell communication
  useEffect(() => {
    const handleReset = () => resetView();
    const handleOrientation = (e: CustomEvent) => setOrientation(e.detail);
    const handleCreateBaseplate = (e: CustomEvent) => {
      const baseplateData = e.detail;
      if (baseplateData.type === 'rectangular') {
        createOrUpdateBaseplate(10, 10); // Default padding
      } else if (baseplateData.type === 'convex-hull') {
        createOrUpdateBaseplate(baseplateData.dimensions.padding || 20, 10);
      } else if (baseplateData.type === 'cylindrical') {
        // FUTURE: Implement cylindrical baseplate geometry using CylinderGeometry
        createOrUpdateBaseplate(10, 10); // Fallback to rectangular
      } else if (baseplateData.type === 'v-block') {
        // FUTURE: Implement V-block baseplate geometry using ExtrudeGeometry with V-profile
        createOrUpdateBaseplate(10, 10); // Fallback to rectangular
      } else if (baseplateData.type === 'hexagonal') {
        // FUTURE: Implement hexagonal baseplate geometry using ShapeGeometry
        createOrUpdateBaseplate(10, 10); // Fallback to rectangular
      } else if (baseplateData.type === 'perforated') {
        // FUTURE: Add perforated hole pattern using CSG subtraction or vertex manipulation
        createOrUpdateBaseplate(10, 10);
      } else if (baseplateData.type === 'solid') {
        createOrUpdateBaseplate(10, 10);
      }
    };

    window.addEventListener('viewer-reset', handleReset);
    window.addEventListener('viewer-orientation', handleOrientation as EventListener);
    const handleSetQuat = (e: CustomEvent<{ q: [number, number, number, number] }>) => {
      if (!cameraRef.current || !controlsRef.current) return;
      const [x, y, z, w] = e.detail.q;
      const cam = cameraRef.current as THREE.Camera & { position: THREE.Vector3; quaternion: THREE.Quaternion };
      const controls = controlsRef.current;
      const target = controls.target.clone();

      // Preserve distance from target
      const offset = cam.position.clone().sub(target);
      const distance = offset.length();

      // Set rotation
      cam.quaternion.set(x, y, z, w);

      // Recompute position from target with same distance along new -Z camera axis
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
      cam.position.copy(target.clone().sub(forward.multiplyScalar(distance)));

      controls.update();
    };
    window.addEventListener('viewer-camera-set-quaternion', handleSetQuat as EventListener);
    window.addEventListener('create-baseplate', handleCreateBaseplate as EventListener);

    return () => {
      window.removeEventListener('viewer-reset', handleReset);
      window.removeEventListener('viewer-orientation', handleOrientation as EventListener);
      window.removeEventListener('viewer-camera-set-quaternion', handleSetQuat as EventListener);
      window.removeEventListener('create-baseplate', handleCreateBaseplate as EventListener);
    };
  }, [resetView, setOrientation, createOrUpdateBaseplate]);

  const dispose = useCallback(() => {
    // Clean up meshes
    meshesRef.current.forEach(mesh => {
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
    meshesRef.current = [];

    // Clean up baseplate and ground
    if (baseplateRef.current) {
      if (baseplateRef.current.geometry) baseplateRef.current.geometry.dispose();
      if (baseplateRef.current.material) {
        if (Array.isArray(baseplateRef.current.material)) {
          baseplateRef.current.material.forEach(m => m.dispose());
        } else {
          baseplateRef.current.material.dispose();
        }
      }
      baseplateRef.current = null;
    }

    if (groundRef.current) {
      if (groundRef.current.geometry) groundRef.current.geometry.dispose();
      if (groundRef.current.material) {
        if (Array.isArray(groundRef.current.material)) {
          groundRef.current.material.forEach(m => m.dispose());
        } else {
          groundRef.current.material.dispose();
        }
      }
      groundRef.current = null;
    }

    // Clean up grid and axes helpers
    if (gridHelperRef.current) {
      if (gridHelperRef.current.geometry) gridHelperRef.current.geometry.dispose();
      if (gridHelperRef.current.material) gridHelperRef.current.material.dispose();
      gridHelperRef.current = null;
    }

    if (axesHelperRef.current) {
      if (axesHelperRef.current.geometry) axesHelperRef.current.geometry.dispose();
      if (axesHelperRef.current.material) axesHelperRef.current.material.dispose();
      axesHelperRef.current = null;
    }

    // Clean up center cross
    if (centerCrossRef.current) {
      if (centerCrossRef.current.geometry) (centerCrossRef.current.geometry as THREE.BufferGeometry).dispose();
      if (centerCrossRef.current.material) (centerCrossRef.current.material as THREE.Material).dispose();
      centerCrossRef.current = null;
    }

    // Clean up Three.js objects
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
    }
    if (controlsRef.current) {
      controlsRef.current.dispose();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => dispose();
  }, [dispose]);

  return {
    addMesh,
    removeMesh,
    resetView,
    setOrientation,
    fitToView,
    dispose,
    isReady: isInitializedRef.current,
    createOrUpdateBaseplate,
    clearBaseplate,
  };
}