import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls as DreiOrbitControls, Html } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import BasePlate from "./BasePlate";
import { ProcessedFile, ViewOrientation } from "@/modules/FileImport/types";
import SelectableTransformControls from './SelectableTransformControls';
import * as THREE from 'three';
import SupportPlacement from './Supports/SupportPlacement';
import SupportMesh from './Supports/SupportMeshes';
import SupportEditOverlay from './Supports/SupportEditOverlay';
import { SupportType, AnySupport } from './Supports/types';
import { getSupportFootprintBounds } from './Supports/metrics';
import { CSGEngine } from '@/lib/csgEngine';
import { createOffsetMesh, extractVertices } from '@/lib/offset/offsetMeshProcessor';

interface ThreeDSceneProps {
  currentFile: ProcessedFile | null;
  modelTransform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 };
  setModelTransform: (transform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }) => void;
}

const computeDominantUpQuaternion = (geometry: THREE.BufferGeometry) => {
  const positionAttribute = geometry.attributes.position;
  if (!positionAttribute) {
    return null;
  }

  const normalsMap = new Map<string, { normal: THREE.Vector3; area: number }>();
  const up = new THREE.Vector3(0, 1, 0);
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  const accumulateNormal = (normal: THREE.Vector3, area: number) => {
    if (!Number.isFinite(area) || area <= 1e-6) {
      return;
    }

    const dir = normal.clone().normalize();
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z)) {
      return;
    }

    const key = `${Math.round(dir.x * 25)},${Math.round(dir.y * 25)},${Math.round(dir.z * 25)}`;
    const entry = normalsMap.get(key);
    if (entry) {
      entry.normal.addScaledVector(dir, area);
      entry.area += area;
    } else {
      normalsMap.set(key, { normal: dir.clone().multiplyScalar(area), area });
    }
  };

  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);

      vA.fromBufferAttribute(positionAttribute, a);
      vB.fromBufferAttribute(positionAttribute, b);
      vC.fromBufferAttribute(positionAttribute, c);

      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      const normal = cb.cross(ab);
      const area = normal.length() * 0.5;
      if (area > 0) {
        accumulateNormal(normal, area);
      }
    }
  } else {
    for (let i = 0; i < positionAttribute.count; i += 3) {
      vA.fromBufferAttribute(positionAttribute, i);
      vB.fromBufferAttribute(positionAttribute, i + 1);
      vC.fromBufferAttribute(positionAttribute, i + 2);

      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      const normal = cb.cross(ab);
      const area = normal.length() * 0.5;
      if (area > 0) {
        accumulateNormal(normal, area);
      }
    }
  }

  let bestEntry: { normal: THREE.Vector3; area: number } | null = null;
  normalsMap.forEach(entry => {
    if (!bestEntry || entry.area > bestEntry.area) {
      bestEntry = { normal: entry.normal.clone(), area: entry.area };
    }
  });

  if (!bestEntry) {
    return null;
  }

  const dominantNormal = bestEntry.normal.normalize();
  if (dominantNormal.lengthSq() < 1e-6) {
    return null;
  }

  if (dominantNormal.y < 0) {
    dominantNormal.negate();
  }

  if (dominantNormal.angleTo(up) < 1e-3) {
    return null;
  }

  const quaternion = new THREE.Quaternion().setFromUnitVectors(dominantNormal, up);
  return quaternion;
};

// Utility function for model colors
const modelColorPalette = [
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

function getModelColor(modelId: string, colorsMap: Map<string, string>): string {
  if (colorsMap.has(modelId)) {
    return colorsMap.get(modelId)!;
  }

  // Assign a new color from palette if not already assigned
  const availableColors = modelColorPalette.filter(color =>
    !Array.from(colorsMap.values()).includes(color)
  );

  if (availableColors.length === 0) {
    // If all colors used, cycle back to first color
    const assignedColors = Array.from(colorsMap.values());
    const firstUnusedColor = modelColorPalette.find(color => !assignedColors.includes(color)) || modelColorPalette[0];
    return firstUnusedColor;
  }

  const newColor = availableColors[0];
  return newColor;
}

const ORIENTATION_CONFIG: Record<ViewOrientation, { direction: THREE.Vector3; up: THREE.Vector3 }> = {
  front: { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  back: { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  left: { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  right: { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  bottom: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  iso: { direction: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) },
};

const getProjectedSizeForOrientation = (bounds: BoundsSummary, orientation: ViewOrientation) => {
  const { size } = bounds;
  switch (orientation) {
    case 'front':
    case 'back':
      return { horizontal: size.x, vertical: size.y };
    case 'left':
    case 'right':
      return { horizontal: size.z, vertical: size.y };
    case 'top':
    case 'bottom':
      return { horizontal: size.x, vertical: size.z };
    case 'iso':
    default:
      const diagonal = Math.max(size.x, size.y, size.z);
      return { horizontal: diagonal, vertical: diagonal };
  }
};

// Center cross axes component (lies on ground plane)
function CenterCross({ length = 100, position = [0, -0.001, 0] }: { length?: number; position?: [number, number, number] }) {
  const positions = useMemo(() => new Float32Array([
    // X axis (red) along ground
    -length, 0, 0,   length, 0, 0,
    // Z axis (green) along ground depth
    0, 0, -length,   0, 0, length,
  ]), [length]);

  const colors = useMemo(() => new Float32Array([
    1, 0, 0,   1, 0, 0,  // Red for X
    0, 1, 0,   0, 1, 0,  // Green for Z (projected)
  ]), []);

  return (
    <group position={position} frustumCulled={false}>
      <lineSegments renderOrder={1000}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={positions.length / 3}
            array={positions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={colors.length / 3}
            array={colors}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial vertexColors depthWrite={false} linewidth={1} />
      </lineSegments>
    </group>
  );
}

interface BoundsSummary {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
  unitsScale?: number;
}

const getFootprintMetrics = (bounds: BoundsSummary | null) => {
  if (!bounds) {
    return {
      radius: 25,
      padding: 12,
      halfLength: 37,
    };
  }

  const unitsScale = bounds.unitsScale ?? 1;
  const sizeX = Math.max(bounds.size.x, 0) * unitsScale;
  const sizeZ = Math.max(bounds.size.z, 0) * unitsScale;
  const longestHalfEdge = Math.max(sizeX, sizeZ) * 0.5;
  const padding = Math.max(longestHalfEdge * 0.35, 5);
  const halfLength = Math.max(longestHalfEdge + padding, longestHalfEdge + 5, longestHalfEdge * 1.5, 36);

  return { radius: longestHalfEdge, padding, halfLength };
};

const computeCrossHalfLength = (bounds: BoundsSummary | null) => {
  return getFootprintMetrics(bounds).halfLength;
};

function lightenColor(hex: string, amount: number) {
  const normalized = hex.replace('#', '');
  const num = parseInt(normalized, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}


function getComplementColor(hex: string) {
  const normalized = hex.replace('#', '');
  const num = parseInt(normalized, 16);
  const r = 255 - ((num >> 16) & 0xff);
  const g = 255 - ((num >> 8) & 0xff);
  const b = 255 - (num & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function getHighlightColor(baseHex?: string) {
  if (!baseHex || !baseHex.startsWith('#') || (baseHex.length !== 7 && baseHex.length !== 4)) {
    return '#0ea5e9';
  }

  const normalized = baseHex.length === 4
    ? `#${baseHex[1]}${baseHex[1]}${baseHex[2]}${baseHex[2]}${baseHex[3]}${baseHex[3]}`
    : baseHex;
  const complement = getComplementColor(normalized);
  return lightenColor(complement, 30);
}

// Component for the main 3D model
function ModelMesh({ file, meshRef, dimensions, colorsMap, setColorsMap, onBoundsChange }: {
  file: ProcessedFile;
  meshRef?: React.RefObject<THREE.Mesh>;
  dimensions?: { x?: number; y?: number; z?: number };
  colorsMap?: Map<string, string>;
  setColorsMap?: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  onBoundsChange?: (bounds: BoundsSummary) => void;
}) {
  const internalRef = useRef<THREE.Mesh>(null);
  const actualRef = meshRef || internalRef;
  const hasNormalizedRef = useRef(false);
  const unitScale = useMemo(() => {
    switch (file.metadata.units) {
      case 'cm':
        return 10;
      case 'inch':
        return 25.4;
      default:
        return 1;
    }
  }, [file.metadata.units]);

  // Get model color
  const modelId = file.metadata.name;
  const modelColor = getModelColor(modelId, colorsMap || new Map());

  // Assign color to model when it loads
  React.useEffect(() => {
    if (setColorsMap && colorsMap && !colorsMap.has(modelId)) {
      const newColor = getModelColor(modelId, colorsMap);
      setColorsMap(prev => new Map(prev.set(modelId, newColor)));
    }
  }, [modelId, setColorsMap, colorsMap]);

  // Update material color when model loads
  React.useEffect(() => {
    if (actualRef.current && actualRef.current.material && modelColor) {
      // Convert hex color to RGB values for Three.js
      const hex = modelColor.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16) / 255;
      const g = parseInt(hex.substr(2, 2), 16) / 255;
      const b = parseInt(hex.substr(4, 2), 16) / 255;

      if (actualRef.current.material instanceof THREE.MeshStandardMaterial) {
        actualRef.current.material.color.setRGB(r, g, b);
        actualRef.current.material.needsUpdate = true;
      } else if (actualRef.current.material instanceof THREE.MeshBasicMaterial) {
        actualRef.current.material.color.setRGB(r, g, b);
        actualRef.current.material.needsUpdate = true;
      }
    }
  }, [modelColor]);

  // Normalize model so it rests on the XY plane and report bounds to parent
  React.useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh) {
      return;
    }

    const geometry = mesh.geometry as THREE.BufferGeometry;

    if (!hasNormalizedRef.current) {
      geometry.computeBoundingBox();
      const geoBox = geometry.boundingBox;
      if (geoBox) {
        const geoCenter = geoBox.getCenter(new THREE.Vector3());
        const bottom = geoBox.min.y;
        geometry.translate(-geoCenter.x, -bottom, -geoCenter.z);
        const dominantQuaternion = computeDominantUpQuaternion(geometry);
        if (dominantQuaternion) {
          geometry.applyQuaternion(dominantQuaternion);
          geometry.computeBoundingBox();
          const orientedBox = geometry.boundingBox;
          if (orientedBox) {
            const orientedCenter = orientedBox.getCenter(new THREE.Vector3());
            const orientedBottom = orientedBox.min.y;
            geometry.translate(-orientedCenter.x, -orientedBottom, -orientedCenter.z);
          }
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        if (geometry.attributes.position) {
          geometry.attributes.position.needsUpdate = true;
        }
      }

      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(unitScale);
      mesh.updateMatrixWorld(true, true);
      mesh.userData.normalized = true;
      hasNormalizedRef.current = true;
    }

    if (typeof (geometry as any).disposeBoundsTree === 'function') {
      (geometry as any).disposeBoundsTree();
    }
    if (typeof (geometry as any).computeBoundsTree === 'function') {
      (geometry as any).computeBoundsTree();
    }

    if (dimensions && (dimensions.x || dimensions.y || dimensions.z)) {
      const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
      const currentDimensions = box.getSize(new THREE.Vector3());
      const scaleX = dimensions.x ? (dimensions.x / unitScale) / (currentDimensions.x || 1) : mesh.scale.x;
      const scaleY = dimensions.y ? (dimensions.y / unitScale) / (currentDimensions.y || 1) : mesh.scale.y;
      const scaleZ = dimensions.z ? (dimensions.z / unitScale) / (currentDimensions.z || 1) : mesh.scale.z;
      mesh.scale.set(scaleX, scaleY, scaleZ);
      mesh.updateMatrixWorld(true, true);
    }

    const finalBox = new THREE.Box3().setFromObject(mesh);
    const sphere = finalBox.getBoundingSphere(new THREE.Sphere());
    const finalCenter = finalBox.getCenter(new THREE.Vector3());
    const finalSize = finalBox.getSize(new THREE.Vector3());

    onBoundsChange?.({
      min: finalBox.min.clone(),
      max: finalBox.max.clone(),
      center: finalCenter,
      size: finalSize,
      radius: sphere.radius,
      unitsScale: unitScale,
    });
  }, [file, dimensions, onBoundsChange, unitScale]);

  useFrame(() => {
    if (actualRef.current) {
      // Optional: Add subtle rotation for better visualization
      // actualRef.current.rotation.y += 0.001;
    }
  });

  return (
    <mesh ref={actualRef} geometry={file.mesh.geometry} material={file.mesh.material} />
  );
}

// Component for placed fixture elements
function FixtureComponent({
  component,
  position,
  onSelect
}: {
  component: any;
  position: THREE.Vector3;
  onSelect?: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

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

// Main 3D Scene Component
const ThreeDScene: React.FC<ThreeDSceneProps> = ({
  currentFile,
  modelTransform,
  setModelTransform,
}) => {
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [placedComponents, setPlacedComponents] = useState<Array<{ component: any; position: THREE.Vector3; id: string }>>([]);
  const [selectedComponent, setSelectedComponent] = useState<any>(null);
  const [basePlate, setBasePlate] = useState<{
    type: 'rectangular' | 'convex-hull' | 'perforated-panel' | 'metal-wooden-plate';
    width?: number;      // X extent
    height?: number;     // Z extent
    depth?: number;      // Y thickness
    position?: THREE.Vector3;
    material?: 'metal' | 'wood' | 'plastic';
    id?: string;
    oversizeXY?: number; // convex hull extra per side (mm)
    pitch?: number;      // perforated: hole spacing (mm)
    holeDiameter?: number; // perforated / metal mounting
  } | null>(null);
  const modelMeshRef = useRef<THREE.Mesh>(null);
  const basePlateMeshRef = useRef<THREE.Mesh>(null);
  const [baseTopY, setBaseTopY] = useState<number>(0);
  const [modelDimensions, setModelDimensions] = useState<{ x?: number; y?: number; z?: number } | undefined>();
  const [orbitControlsEnabled, setOrbitControlsEnabled] = useState(true);
  const [modelColors, setModelColors] = useState<Map<string, string>>(new Map());
  const [modelBounds, setModelBounds] = useState<BoundsSummary | null>(null);
  const [currentOrientation, setCurrentOrientation] = useState<ViewOrientation>('iso');
  const prevOrientationRef = useRef<ViewOrientation>('iso');
  const [placing, setPlacing] = useState<{ active: boolean; type: SupportType | null; initParams?: Record<string, number> }>({ active: false, type: null });
  const [supports, setSupports] = useState<AnySupport[]>([]);
  const [supportsTrimPreview, setSupportsTrimPreview] = useState<THREE.Mesh[]>([]);
  const [supportsTrimProcessing, setSupportsTrimProcessing] = useState(false);
  const [cavityPreview, setCavityPreview] = useState<THREE.Mesh | null>(null);
  const editingSupportRef = useRef<AnySupport | null>(null);
  const [editingSupport, setEditingSupport] = useState<AnySupport | null>(null);

  const csgEngineRef = useRef<CSGEngine | null>(null);
  if (!csgEngineRef.current) {
    csgEngineRef.current = new CSGEngine();
  }

  // Ensure supports use the baseplate TOP surface, not bottom: compute baseTopY from world bbox
  React.useEffect(() => {
    const updateTopY = () => {
      const mesh = basePlateMeshRef.current;
      if (!mesh) { setBaseTopY(0); return; }
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) { setBaseTopY(0); return; }
      setBaseTopY(box.max.y);
    };
    updateTopY();
    const id = setInterval(updateTopY, 250);
    return () => clearInterval(id);
  }, []);

  const updateCamera = useCallback((orientation: ViewOrientation, bounds: BoundsSummary | null) => {
    const orthoCam = camera as THREE.OrthographicCamera;
    const { direction, up } = ORIENTATION_CONFIG[orientation] || ORIENTATION_CONFIG.iso;
    const targetY = bounds ? bounds.center.y : 0;
    const target = new THREE.Vector3(0, targetY, 0);
    const normalizedDirection = direction.clone().normalize();

    const footprint = getFootprintMetrics(bounds);
    const footprintRadius = footprint.radius;
    const footprintPadding = footprint.padding;
    const crossHalfLength = footprint.halfLength;
    const radius = bounds?.radius ? Math.max(bounds.radius * (bounds.unitsScale ?? 1), footprintRadius) : footprintRadius;
    const crossSpan = crossHalfLength * 2;
    const horizontalSpan = bounds
      ? Math.max(bounds.size.x, bounds.size.z, crossSpan / (bounds.unitsScale ?? 1)) * (bounds.unitsScale ?? 1)
      : crossSpan;
    const verticalSpan = bounds ? bounds.size.y * (bounds.unitsScale ?? 1) : crossSpan * 0.6;
    const isIsoView = orientation === 'iso';
    const padding = bounds
      ? isIsoView
        ? Math.max(footprintPadding, 5)
        : Math.max(footprintPadding * 0.6, 2)
      : footprintPadding;

    const distance = bounds
      ? Math.max(
          radius * 3.0,
          crossSpan * 2.1,
          (horizontalSpan + padding * 2) * 1.05,
          (verticalSpan + padding * 2) * 1.15
        )
      : crossSpan * 2.1;

    const position = target.clone().add(normalizedDirection.multiplyScalar(distance));
    orthoCam.position.copy(position);
    orthoCam.up.copy(up.clone().normalize());
    orthoCam.lookAt(target);

    const dims = bounds ? getProjectedSizeForOrientation(bounds, orientation) : { horizontal: crossSpan, vertical: crossSpan };
    const spanHorizontal = Math.max(dims.horizontal * (bounds?.unitsScale ?? 1), crossSpan);
    const spanVertical = Math.max(dims.vertical * (bounds?.unitsScale ?? 1), verticalSpan);

    let halfWidth = spanHorizontal / 2 + padding;
    let halfHeight = spanVertical / 2 + Math.max(padding, 4);

    const aspect = size.width / size.height;
    if (halfWidth / halfHeight > aspect) {
      halfHeight = halfWidth / aspect;
    } else {
      halfWidth = halfHeight * aspect;
    }

    const framingScale = isIsoView ? 1.22 : 1.05;
    halfWidth *= framingScale;
    halfHeight *= framingScale;

    orthoCam.left = -halfWidth;
    orthoCam.right = halfWidth;
    orthoCam.top = halfHeight;
    orthoCam.bottom = -halfHeight;
    orthoCam.near = 0.1;
    orthoCam.far = Math.max(distance * 4, 2000);
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();

    if (controlsRef.current) {
      const c = controlsRef.current;
      c.target.copy(target);
      c.update();
    }
  }, [camera, size.width, size.height]);

  React.useEffect(() => {
    updateCamera(currentOrientation, modelBounds);
  }, [currentOrientation, modelBounds, updateCamera]);

  React.useEffect(() => {
    if (!currentFile) {
      setModelBounds(null);
      setCurrentOrientation('iso');
    }
  }, [currentFile]);

  // Cavity context request/dispatch
  React.useEffect(() => {
    const handleRequestContext = () => {
      const base = basePlateMeshRef.current || null;
      const model = modelMeshRef.current || null;
      let baseMesh: THREE.Mesh | null = null;
      let tools: THREE.Mesh[] = [];
      if (base && model) {
        baseMesh = base; // default: baseplate as base
        tools = [model];
      } else if (base) {
        baseMesh = base;
        tools = [];
      } else if (model) {
        baseMesh = model;
        tools = [];
      }
      window.dispatchEvent(new CustomEvent('cavity-context', { detail: { baseMesh, fixtureComponents: tools } }));
    };
    window.addEventListener('request-cavity-context', handleRequestContext as EventListener);
    return () => window.removeEventListener('request-cavity-context', handleRequestContext as EventListener);
  }, []);

  // Listen for cavity operation result to show preview
  React.useEffect(() => {
    const handleCavityResult = (e: CustomEvent) => {
      const { mesh, mode } = e.detail || {};
      if (mesh && mesh.isMesh) {
        // Make preview material translucent
        if (mesh.material && 'transparent' in mesh.material) {
          (mesh.material as any).transparent = true;
          (mesh.material as any).opacity = 0.35;
          (mesh.material as any).depthWrite = false;
        }
        setCavityPreview(mesh as THREE.Mesh);
      }
    };
    window.addEventListener('cavity-operation-result', handleCavityResult as EventListener);
    return () => window.removeEventListener('cavity-operation-result', handleCavityResult as EventListener);
  }, []);

  // Apply final cavity: replace baseplate geometry and clear preview
  React.useEffect(() => {
    const handleApply = (e: CustomEvent) => {
      const { mesh } = e.detail || {};
      if (!mesh || !mesh.isMesh) return;
      // Prefer replacing baseplate if present
      const target = basePlateMeshRef.current || modelMeshRef.current;
      if (target && mesh.geometry) {
        const old = target.geometry;
        target.geometry = mesh.geometry;
        old?.dispose?.();
        target.updateMatrixWorld(true, true);
        setCavityPreview(null);
        // notify undo system
        window.dispatchEvent(new CustomEvent('viewer-state-changed', { detail: { type: 'cavity-apply' } }));
      }
    };
    window.addEventListener('cavity-apply', handleApply as EventListener);
    return () => window.removeEventListener('cavity-apply', handleApply as EventListener);
  }, []);

  const centerCrossLength = React.useMemo(() => {
    let len = computeCrossHalfLength(modelBounds);
    if (basePlate) {
      const halfPlate = Math.max((basePlate.width ?? 0) / 2, (basePlate.height ?? 0) / 2);
      const pad = modelBounds ? getFootprintMetrics(modelBounds).padding : 10;
      len = Math.max(len, halfPlate + pad);
    }
    return len;
  }, [modelBounds, basePlate]);

  // Handle mouse events for drag and drop (disabled for now)
  const handlePointerMove = useCallback((event: any) => {
    // Drag and drop functionality temporarily disabled
  }, []);

  const handlePointerUp = useCallback(() => {
    // Drag and drop functionality temporarily disabled
  }, []);

  // Listen for component selection from library
  React.useEffect(() => {
    const handleComponentSelect = (event: CustomEvent) => {
      const component = event.detail;
      setSelectedComponent(component);
    };
    window.addEventListener('component-selected', handleComponentSelect as EventListener);
    return () => window.removeEventListener('component-selected', handleComponentSelect as EventListener);
  }, [selectedComponent]);

  // Listen for support placement start/cancel
  React.useEffect(() => {
    const handleStartPlacement = (e: CustomEvent) => {
      const { type, params } = e.detail || {};
      // exit any active support edit session when starting fresh placement
      editingSupportRef.current = null;
      setEditingSupport(null);

      // remember previous view, switch to Top for placement
      prevOrientationRef.current = currentOrientation;
      setCurrentOrientation('top');
      updateCamera('top', modelBounds);
      setPlacing({ active: true, type: type as SupportType, initParams: params || {} });
    };
    const handleCancelPlacement = () => {
      setPlacing({ active: false, type: null, initParams: {} });
      setOrbitControlsEnabled(true);
      // restore previous view
      setCurrentOrientation(prevOrientationRef.current);
      updateCamera(prevOrientationRef.current, modelBounds);
      editingSupportRef.current = null;
    };
    window.addEventListener('supports-start-placement', handleStartPlacement as EventListener);
    window.addEventListener('supports-cancel-placement', handleCancelPlacement as EventListener);
    return () => {
      window.removeEventListener('supports-start-placement', handleStartPlacement as EventListener);
      window.removeEventListener('supports-cancel-placement', handleCancelPlacement as EventListener);
    };
  }, [currentOrientation, updateCamera, modelBounds]);

  // Listen for click-to-edit on existing supports
  React.useEffect(() => {
    const handleSupportEdit = (e: CustomEvent) => {
      const s = e.detail as AnySupport;
      if (!s) return;

      // Store support being edited and enter top view with handle-based overlay
      editingSupportRef.current = s;
      setEditingSupport(s);

      // Remember previous view (for when we exit edit) but do NOT force top view;
      // editing should work from whatever view the user is currently in.
      prevOrientationRef.current = currentOrientation;
      // Ensure placement controller is not active while editing
      setPlacing({ active: false, type: null, initParams: {} });
    };

    window.addEventListener('support-edit', handleSupportEdit as EventListener);
    return () => window.removeEventListener('support-edit', handleSupportEdit as EventListener);
  }, [currentOrientation, updateCamera, modelBounds]);

  const handleSupportCreate = useCallback((support: AnySupport) => {
    // For new supports created via placement, just emit event as-is
    window.dispatchEvent(new CustomEvent('support-created', { detail: support }));

    // Auto-expand baseplate if this support overhangs current footprint
    setBasePlate(prev => {
      if (!prev) return prev;
      const { width, height } = prev;
      if (!width || !height) return prev;

      const halfW = width / 2;
      const halfH = height / 2;
      const footprint = getSupportFootprintBounds(support);
      const margin = 10; // extra extension beyond furthest support (mm)

      const needsExpandX = footprint.minX < -halfW || footprint.maxX > halfW;
      const needsExpandZ = footprint.minZ < -halfH || footprint.maxZ > halfH;

      if (!needsExpandX && !needsExpandZ) {
        return prev;
      }

      let newHalfW = halfW;
      let newHalfH = halfH;

      if (needsExpandX) {
        const furthestX = Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX));
        newHalfW = Math.max(halfW, furthestX + margin);
      }

      if (needsExpandZ) {
        const furthestZ = Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ));
        newHalfH = Math.max(halfH, furthestZ + margin);
      }

      const expandedWidth = newHalfW * 2;
      const expandedHeight = newHalfH * 2;

      // For convex-hull plates, width/height are only hints in geometry; when we
      // need to grow beyond the original hull, treat it as a rectangular plate
      // so extension is visually accurate and symmetric around the origin.
      if (prev.type === 'convex-hull') {
        return {
          ...prev,
          type: 'rectangular',
          oversizeXY: undefined,
          width: expandedWidth,
          height: expandedHeight,
        };
      }

      return {
        ...prev,
        width: expandedWidth,
        height: expandedHeight,
      };
    });

    setPlacing({ active: false, type: null, initParams: {} });
    setOrbitControlsEnabled(true);
    // restore previous view after creation
    setCurrentOrientation(prevOrientationRef.current);
    updateCamera(prevOrientationRef.current, modelBounds);
    editingSupportRef.current = null;
  }, [modelBounds, updateCamera]);

  // Persist created supports in scene
  React.useEffect(() => {
    const onSupportCreated = (e: CustomEvent) => {
      const s: AnySupport = e.detail;
      setSupports(prev => {
        const editing = editingSupportRef.current;
        if (editing) {
          const replaced = prev.map(p => (p.id === editing.id ? s : p));
          editingSupportRef.current = null;
          setEditingSupport(null);
          return replaced;
        }
        return [...prev, s];
      });
    };
    window.addEventListener('support-created', onSupportCreated as EventListener);
    return () => window.removeEventListener('support-created', onSupportCreated as EventListener);
  }, []);

  // Undo/Redo handlers for supports
  React.useEffect(() => {
    const onUndo = (e: CustomEvent) => {
      const state = e.detail as any;
      if (state?.type === 'support-created' && state.support?.id) {
        const id = state.support.id as string;
        setSupports(prev => prev.filter(s => s.id !== id));
      }
    };
    const onRedo = (e: CustomEvent) => {
      const state = e.detail as any;
      if (state?.type === 'support-created' && state.support) {
        const s = state.support as AnySupport;
        setSupports(prev => (prev.some(p => p.id === s.id) ? prev : [...prev, s]));
      }
    };
    window.addEventListener('viewer-undo', onUndo as EventListener);
    window.addEventListener('viewer-redo', onRedo as EventListener);
    return () => {
      window.removeEventListener('viewer-undo', onUndo as EventListener);
      window.removeEventListener('viewer-redo', onRedo as EventListener);
    };
  }, []);

  // Build a THREE.Mesh for a support using the same dimensions/origining as SupportMesh
  const buildSupportMesh = useCallback((support: AnySupport, baseTop: number) => {
    const { type, height, center } = support as any;
    const rotY = (support as any).rotationZ ?? 0;
    const effectiveBaseY = (support as any).baseY ?? baseTop;

    let geometry: THREE.BufferGeometry | null = null;
    let position = new THREE.Vector3(center.x, effectiveBaseY, center.y);
    let rotation = new THREE.Euler(0, rotY, 0);

    if (type === 'cylindrical') {
      const { radius } = support as any;
      const geo = new THREE.CylinderGeometry(radius, radius, height, 192);
      geo.translate(0, height / 2, 0);
      geometry = geo;
    } else if (type === 'rectangular') {
      const { width, depth, cornerRadius = 0 } = support as any;
      if (cornerRadius <= 0) {
        geometry = new THREE.BoxGeometry(width, height, depth);
      } else {
        const hw = width / 2;
        const hd = depth / 2;
        const r = Math.min(cornerRadius, hw, hd);
        const s = new THREE.Shape();
        s.moveTo(-hw + r, -hd);
        s.lineTo(hw - r, -hd);
        s.quadraticCurveTo(hw, -hd, hw, -hd + r);
        s.lineTo(hw, hd - r);
        s.quadraticCurveTo(hw, hd, hw - r, hd);
        s.lineTo(-hw + r, hd);
        s.quadraticCurveTo(-hw, hd, -hw, hd - r);
        s.lineTo(-hw, -hd + r);
        s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
        const extrude = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 64 });
        extrude.rotateX(Math.PI / 2);
        extrude.translate(0, height / 2, 0);
        geometry = extrude;
      }
    } else if (type === 'conical') {
      const { baseRadius, topRadius } = support as any;
      const geo = new THREE.CylinderGeometry(topRadius, baseRadius, height, 192);
      geo.translate(0, height / 2, 0);
      geometry = geo;
    } else if (type === 'custom') {
      const { polygon } = support as any;
      const shape = new THREE.Shape();
      if (polygon.length > 0) {
        shape.moveTo(polygon[0][0], polygon[0][1]);
        for (let i = 1; i < polygon.length; i++) shape.lineTo(polygon[i][0], polygon[i][1]);
        shape.closePath();
      }
      const extrude = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 64 });
      extrude.rotateX(Math.PI / 2);
      extrude.translate(0, height / 2, 0);
      geometry = extrude;
    }

    if (!geometry) return null;

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x6b7280 }));
    mesh.position.copy(position);
    mesh.rotation.copy(rotation);
    mesh.updateMatrixWorld(true, true);
    return mesh;
  }, []);

  // Listen for supports trim requests and build preview meshes (non-destructive)
  React.useEffect(() => {
    const handler = async (e: CustomEvent) => {
      const { depth, offset, removalDirection, useModel, useAdvancedOffset, advancedOffsetOptions } = e.detail || {};
      const MIN_SPINNER_MS = 800;
      const startTime = performance.now();
      setSupportsTrimProcessing(true);
      // Yield once so React can render the spinner before heavy CSG work
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      try {
        if (!useModel) {
          setSupportsTrimPreview([]);
          return;
        }

        const modelMesh = modelMeshRef.current;
        if (!modelMesh || supports.length === 0) {
          setSupportsTrimPreview([]);
          return;
        }

        const engine = csgEngineRef.current;
        if (!engine) {
          setSupportsTrimPreview([]);
          return;
        }

        const dir = (removalDirection instanceof THREE.Vector3)
          ? removalDirection.clone().normalize()
          : new THREE.Vector3(0, -1, 0);

        let cutterMesh: THREE.Mesh | null = modelMesh;

        if (useAdvancedOffset && advancedOffsetOptions) {
          try {
            const geo = modelMesh.geometry as THREE.BufferGeometry;
            geo.computeBoundingBox();
            const box = geo.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
            const size = box.getSize(new THREE.Vector3());
            const span = Math.max(size.x, size.z);

            // Clamp pixelsPerUnit to a safe upper bound and estimate the
            // heightmap resolution. If the target resolution is too large,
            // skip GPU offset and fall back to the raw model to avoid
            // exhausting WebGL resources.
            const requestedPPU = advancedOffsetOptions.pixelsPerUnit ?? 6;
            const safePPU = Math.min(requestedPPU, 8);
            const estimatedPixels = span * safePPU;

            if (!Number.isFinite(estimatedPixels) || estimatedPixels > 1600) {
              console.warn('Skipping GPU offset for supports trim: target resolution too large', {
                span,
                safePPU,
                estimatedPixels,
              });
              cutterMesh = modelMesh;
            } else {
              const vertices = extractVertices(geo);
              const result = await createOffsetMesh(vertices, {
                offsetDistance: advancedOffsetOptions.offsetDistance ?? (Math.abs(offset) || 0.2),
                pixelsPerUnit: safePPU,
                simplifyRatio: advancedOffsetOptions.simplifyRatio ?? 0.8,
                verifyManifold: advancedOffsetOptions.verifyManifold ?? false,
                rotationXZ: advancedOffsetOptions.rotationXZ ?? 0,
                rotationYZ: advancedOffsetOptions.rotationYZ ?? 0,
              });
              cutterMesh = new THREE.Mesh(result.geometry, modelMesh.material as THREE.Material);
            }
          } catch (err) {
            console.error('Advanced offset failed, falling back to normal trimming:', err);
            cutterMesh = modelMesh;
          }
        }

        const previewMeshes: THREE.Mesh[] = [];

        supports.forEach((s) => {
          const baseMesh = buildSupportMesh(s, baseTopY);
          if (!baseMesh || !cutterMesh) return;

          // Option A: only trim in a local band measured from the top of the
          // support downward by at most the requested Resolution (depth).
          // This keeps the effective sweep confined near the model contact
          // region even when supports are much taller than the model.
          const supportHeight = (s as any).height ?? 0;
          const requestedDepth = typeof depth === 'number' ? depth : 10;
          const maxLocalDepth = supportHeight > 0 ? supportHeight : requestedDepth;
          const effectiveDepth = Math.max(0, Math.min(requestedDepth, maxLocalDepth));

          try {
            const result = engine.createNegativeSpace(
              baseMesh,
              [cutterMesh],
              dir,
              {
                depth: effectiveDepth,
                angle: 0,
                offset: useAdvancedOffset ? 0 : (typeof offset === 'number' ? offset : 0),
              }
            );

            if (result && result.isMesh) {
              // Derive preview color from the original support material so the
              // trimmed geometry visually reads as the same support, just in a
              // translucent highlight, instead of inheriting the model color.
              let previewColor = new THREE.Color(0x6b7280);
              const baseMat = baseMesh.material as any;
              if (baseMat && baseMat.color && baseMat.color.isColor) {
                previewColor = baseMat.color.clone();
              }

              const previewMaterial = new THREE.MeshStandardMaterial({
                color: previewColor,
                transparent: true,
                opacity: 0.6,
                roughness: 0.5,
                metalness: 0.1,
                depthWrite: false,
              });
              (result as THREE.Mesh).material = previewMaterial;
              previewMeshes.push(result as THREE.Mesh);
            }
          } catch (err) {
            console.error('Error computing trimmed support preview:', err);
          }
        });

        setSupportsTrimPreview(previewMeshes);
      } finally {
        const elapsed = performance.now() - startTime;
        const remaining = MIN_SPINNER_MS - elapsed;
        if (remaining > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        }
        setSupportsTrimProcessing(false);
      }
    };

    window.addEventListener('supports-trim-request', handler as EventListener);
    return () => window.removeEventListener('supports-trim-request', handler as EventListener);
  }, [supports, baseTopY, buildSupportMesh]);

  // Handle base plate creation events
  React.useEffect(() => {
    const handleCreateBaseplate = (e: CustomEvent) => {
      const { type, option, dimensions } = e.detail;
      console.log('Creating baseplate:', type, option, dimensions);

      const basePlateId = `baseplate-${Date.now()}`;

      // Model footprint in mm
      const box = modelMeshRef.current ? new THREE.Box3().setFromObject(modelMeshRef.current) : null;
      const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(60, 60, 60);
      const fitPadTotal = 20; // +20mm total (10mm per side)

      // Helper to coerce dimension
      const clampPos = (v: any, min: number, fallback: number) => Math.max(Number(v) || fallback, min);

      // Thickness defaults per type (reduced)
      const tRect = 3;
      const tHull = 3;
      const tStd = 6;

      let cfg: NonNullable<typeof basePlate> = {
        type: (option as any),
        id: basePlateId,
        material: (dimensions?.material || 'metal'),
        position: new THREE.Vector3(0, 0, 0)
      };

      if (option === 'rectangular') {
        const width = clampPos(dimensions?.width, 10, size.x + fitPadTotal);
        const height = clampPos(dimensions?.length ?? dimensions?.depth, 10, size.z + fitPadTotal);
        const depth = clampPos(dimensions?.height, 1, tRect);
        cfg = { ...cfg, type: 'rectangular', width, height, depth };
      } else if (option === 'convex-hull') {
        const depth = clampPos(dimensions?.height, 1, tHull);
        const oversizeXY = clampPos(dimensions?.oversizeXY, 0, 10);
        // width/height are derived in BasePlate from model geometry + oversize, we pass hint values too
        cfg = { ...cfg, type: 'convex-hull', depth, oversizeXY, width: size.x + oversizeXY * 2, height: size.z + oversizeXY * 2 };
      } else if (option === 'perforated-panel') {
        const width = clampPos(dimensions?.width, 10, size.x + fitPadTotal);
        const height = clampPos(dimensions?.length ?? dimensions?.depth, 10, size.z + fitPadTotal);
        const depth = clampPos(dimensions?.height, 1, tStd);
        const pitch = clampPos(dimensions?.pitch ?? dimensions?.holeDistance, 2, 20);
        const holeDiameter = clampPos(dimensions?.holeDiameter, 1, 6);
        cfg = { ...cfg, type: 'perforated-panel', width, height, depth, pitch, holeDiameter };
      } else if (option === 'metal-wooden-plate') {
        const width = clampPos(dimensions?.width, 10, size.x + fitPadTotal);
        const height = clampPos(dimensions?.length ?? dimensions?.depth, 10, size.z + fitPadTotal);
        const depth = clampPos(dimensions?.height, 1, tStd);
        const holeDiameter = clampPos(dimensions?.holeDiameter, 1, 6);
        cfg = { ...cfg, type: 'metal-wooden-plate', width, height, depth, holeDiameter };
      } else {
        console.warn('Unsupported baseplate option:', option);
        return;
      }

      // Ensure model rests on top: set model minY to 0 if needed
      if (modelMeshRef.current) {
        const mbox = new THREE.Box3().setFromObject(modelMeshRef.current);
        const minY = mbox.min.y;
        if (Math.abs(minY) > 1e-3) {
          modelMeshRef.current.position.y -= minY; // shift so minY becomes 0
          setModelTransform({
            position: modelMeshRef.current.position.clone(),
            rotation: modelMeshRef.current.rotation.clone(),
            scale: modelMeshRef.current.scale.clone(),
          });
        }
      }

      // Place plate directly under the current model transform so convex-hull
      // plates align with the model footprint even when the model is offset.
      const modelPos = modelMeshRef.current
        ? modelMeshRef.current.position.clone()
        : new THREE.Vector3(0, 0, 0);
      const depthForPos = cfg.depth ?? tStd;
      cfg.position = new THREE.Vector3(modelPos.x, modelPos.y - depthForPos / 2, modelPos.z);

      setBasePlate(cfg);
    };

    window.addEventListener('create-baseplate', handleCreateBaseplate as EventListener);
    return () => window.removeEventListener('create-baseplate', handleCreateBaseplate as EventListener);
  }, []);

  // Handle base plate deselection/cancellation
  React.useEffect(() => {
    const handleDeselectBaseplate = (e: CustomEvent) => {
      const { basePlateId } = e.detail;
      console.log('Deselecting baseplate:', basePlateId);

      if (basePlate && basePlate.id === basePlateId) {
        setBasePlate(null);
      }
    };

    const handleCancelBaseplate = () => {
      console.log('Cancelling baseplate selection');
      setBasePlate(null);
    };

    window.addEventListener('baseplate-deselected', handleDeselectBaseplate as EventListener);
    window.addEventListener('cancel-baseplate', handleCancelBaseplate as EventListener);

    return () => {
      window.removeEventListener('baseplate-deselected', handleDeselectBaseplate as EventListener);
      window.removeEventListener('cancel-baseplate', handleCancelBaseplate as EventListener);
    };
  }, [basePlate]);

  // Handle transform mode toggle events
  React.useEffect(() => {
    const handleToggleTransform = () => {
      // This will be handled by the parent component
    };

    window.addEventListener('toggle-transform-mode', handleToggleTransform as EventListener);
    return () => window.removeEventListener('toggle-transform-mode', handleToggleTransform as EventListener);
  }, []);

  // Handle orbit controls enable/disable for transform mode
  React.useEffect(() => {
    const handleOrbitControlsToggle = (e: CustomEvent) => {
      setOrbitControlsEnabled(!e.detail.disabled);
    };

    window.addEventListener('disable-orbit-controls', handleOrbitControlsToggle as EventListener);
    return () => window.removeEventListener('disable-orbit-controls', handleOrbitControlsToggle as EventListener);
  }, [setOrbitControlsEnabled]);

  // Handle view reset events
  React.useEffect(() => {
    const handleViewReset = (e: CustomEvent) => {
      if (currentFile && modelMeshRef.current) {
        // Reset camera to isometric view position based on model size and units
        setCurrentOrientation('iso');
        updateCamera('iso', modelBounds);
      } else {
        // Reset camera to default isometric position (no model loaded)
        setCurrentOrientation('iso');
        updateCamera('iso', null);
      }

      // Clear baseplate when resetting
      setBasePlate(null);
    };

    window.addEventListener('viewer-reset', handleViewReset as EventListener);
    return () => window.removeEventListener('viewer-reset', handleViewReset as EventListener);
  }, [camera, currentFile, updateCamera, modelBounds]);

  // Handle view orientation events
  React.useEffect(() => {
    const handleViewOrientation = (e: CustomEvent) => {
      const orientation = e.detail;

      if (currentFile && modelMeshRef.current) {
        // Set camera position based on orientation and model size/units
        setCurrentOrientation(orientation as ViewOrientation);
        updateCamera(orientation as ViewOrientation, modelBounds);
      } else {
        // Fallback to fixed positions when no model is loaded
        switch (orientation) {
          case 'front':
            updateCamera('front', null);
            break;
          case 'back':
            updateCamera('back', null);
            break;
          case 'left':
            updateCamera('left', null);
            break;
          case 'right':
            updateCamera('right', null);
            break;
          case 'top':
            updateCamera('top', null);
            break;
          case 'bottom':
            updateCamera('bottom', null);
            break;
          case 'iso':
            updateCamera('iso', null);
            break;
          default:
            console.warn('Unknown orientation:', orientation);
        }
      }
    };

    window.addEventListener('viewer-orientation', handleViewOrientation as EventListener);
    return () => window.removeEventListener('viewer-orientation', handleViewOrientation as EventListener);
  }, [camera, currentFile, updateCamera, modelBounds]);

  // Handle clear/reset events
  React.useEffect(() => {
    const handleClear = (e: CustomEvent) => {
      // Reset camera to default position (front view) looking at origin
      updateCamera('iso', null);

      // Clear all state including baseplate
      setPlacedComponents([]);
      setSelectedComponent(null);
      setBasePlate(null);
      setModelDimensions(undefined);
      setModelBounds(null);
      setSupports([]);
    };

    window.addEventListener('viewer-clear', handleClear as EventListener);
    return () => window.removeEventListener('viewer-clear', handleClear as EventListener);
  }, [camera, setModelDimensions]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <directionalLight position={[-10, -10, -5]} intensity={0.4} />
      <pointLight position={[0, 10, 0]} intensity={0.3} />
      <pointLight position={[0, -10, 0]} intensity={0.3} />

      {/* Environment - background disabled to prevent texture regeneration issues */}
      <Environment preset="warehouse" background={false} />

      {/* Center cross axes - sized based on model footprint */}
      <CenterCross length={centerCrossLength} />

      {/* Base plate */}
      {basePlate && (
        <BasePlate
          key={`baseplate-${basePlate.id}`}
          type={basePlate.type}
          width={basePlate.width}
          height={basePlate.height}
          depth={basePlate.depth}
          position={basePlate.position}
          material={basePlate.material}
          oversizeXY={basePlate.oversizeXY}
          pitch={basePlate.pitch}
          holeDiameter={basePlate.holeDiameter}
          modelGeometry={basePlate.type === 'convex-hull' && modelMeshRef.current?.geometry ? modelMeshRef.current.geometry : undefined}
          modelMatrixWorld={basePlate.type === 'convex-hull' && modelMeshRef.current ? modelMeshRef.current.matrixWorld : undefined}
          modelOrigin={basePlate.type === 'convex-hull' && modelMeshRef.current ? modelMeshRef.current.position : undefined}
          selected={false}
          meshRef={basePlateMeshRef}
          onSelect={() => {
            // Dispatch event to select this base plate
            window.dispatchEvent(new CustomEvent('baseplate-selected', {
              detail: { basePlateId: basePlate.id }
            }));
          }}
        />
      )}

      {/* Main 3D model wrapped with transform controls */}
      {currentFile && (
        <SelectableTransformControls
          meshRef={modelMeshRef}
          enabled={true}
          onTransformChange={(transform) => {
            setModelTransform({
              position: transform.position,
              rotation: transform.rotation,
              scale: modelTransform.scale,
            });
          }}
          onSelectionChange={(selected) => {
            // Orbit controls stay enabled - only disabled during drag via events
            console.log('Gizmo active:', selected);
          }}
        >
          <ModelMesh
            file={currentFile}
            meshRef={modelMeshRef}
            dimensions={modelDimensions}
            colorsMap={modelColors}
            setColorsMap={setModelColors}
            onBoundsChange={setModelBounds}
          />
        </SelectableTransformControls>
      )}

      {/* Placed fixture components */}
      {placedComponents.map((item) => (
        <FixtureComponent
          key={item.id}
          component={item.component}
          position={item.position}
          onSelect={() => console.log('Component selected:', item.id)}
        />
      ))}

      {/* Supports vs trimmed supports preview */}
      {supportsTrimPreview.length === 0
        ? supports.map((s) => (
            <SupportMesh key={s.id} support={s} baseTopY={baseTopY} />
          ))
        : supportsTrimPreview.map((mesh, idx) => (
            <primitive key={mesh.uuid + '-' + idx} object={mesh} />
          ))}

      {/* Handle-based support editing overlay */}
      {editingSupport && (
        <SupportEditOverlay
          support={editingSupport}
          baseTopY={baseTopY}
          onCommit={(updated) => {
            setSupports(prev => prev.map(s => (s.id === updated.id ? updated : s)));
            editingSupportRef.current = null;
            setEditingSupport(null);
            setOrbitControlsEnabled(true);
            // Restore previous view after edit
            setCurrentOrientation(prevOrientationRef.current);
            updateCamera(prevOrientationRef.current, modelBounds);
          }}
          onCancel={() => {
            editingSupportRef.current = null;
            setEditingSupport(null);
            setOrbitControlsEnabled(true);
            setCurrentOrientation(prevOrientationRef.current);
          }}
        />
      )}

      {/* Support placement controller */}
      {placing.active && (
        <SupportPlacement
          active={placing.active}
          type={placing.type}
          initParams={placing.initParams}
          onCreate={handleSupportCreate}
          onCancel={() => {
            setPlacing({ active: false, type: null, initParams: {} });
            setOrbitControlsEnabled(true);
          }}
          defaultCenter={new THREE.Vector2(modelBounds?.center.x || 0, modelBounds?.center.z || 0)}
          raycastTargets={[modelMeshRef.current as any].filter(Boolean)}
          baseTopY={baseTopY}
          baseTarget={basePlateMeshRef.current}
          contactOffset={Number(placing.initParams?.contactOffset ?? 0)}
          maxRayHeight={2000}
        />
      )}

      {/* Event handlers */}
      <mesh
        position={[0, 0, 0]}
        onPointerDown={() => {
          // Clicking on empty viewport should clear any active support edit overlay
          if (editingSupportRef.current || editingSupport) {
            editingSupportRef.current = null;
            setEditingSupport(null);
            setOrbitControlsEnabled(true);
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        visible={false}
      >
        <planeGeometry args={[1000, 1000]} />
      </mesh>

      {/* Orbit Controls - allow rotation in both modes for better control */}
      <DreiOrbitControls
        ref={(instance) => {
          controlsRef.current = instance as unknown as OrbitControlsImpl | null;
        }}
        makeDefault
        enablePan={orbitControlsEnabled}
        enableZoom={orbitControlsEnabled}
        enableRotate={orbitControlsEnabled}
        minDistance={0.01}  // Allow unlimited zoom in
        maxDistance={Infinity}  // Allow unlimited zoom out
        dampingFactor={0.05}
        onChange={(event) => {
          if (event?.target?.object?.quaternion) {
            const q = event.target.object.quaternion;
            const arr: [number, number, number, number] = [q.x, q.y, q.z, q.w];
            window.dispatchEvent(new CustomEvent('viewer-camera-changed', { detail: { q: arr } }));
          }
        }}
      />

      {/* Processing indicator for GPU offset + support trimming */}
      {supportsTrimProcessing && (
        <Html
          center
          style={{
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full border-4 border-sky-300 border-t-sky-600 animate-spin shadow-md bg-white/10" />
            <span className="text-[11px] font-medium text-sky-200 drop-shadow-sm">
              Trimming supports...
            </span>
          </div>
        </Html>
      )}

    </>
  );
};

export default ThreeDScene;