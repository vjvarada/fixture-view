import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Environment, OrbitControls as DreiOrbitControls, Html } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import BasePlate from "./BasePlate";
import type { BasePlateConfig } from './BasePlate/types';
import { ProcessedFile, ViewOrientation } from "@/modules/FileImport/types";
import SelectableTransformControls from './SelectableTransformControls';
import * as THREE from 'three';
import SupportPlacement from './Supports/SupportPlacement';
import SupportMesh from './Supports/SupportMeshes';
import SupportEditOverlay from './Supports/SupportEditOverlay';
import { SupportType, AnySupport } from './Supports/types';
import { getSupportFootprintBounds, getSupportFootprintPoints } from './Supports/metrics';
import { CSGEngine } from '@/lib/csgEngine';
import { createOffsetMesh, extractVertices } from '@/lib/offset/offsetMeshProcessor';

interface ThreeDSceneProps {
  importedParts: ProcessedFile[];
  selectedPartId: string | null;
  onPartSelected: (partId: string | null) => void;
  onModelColorAssigned?: (modelId: string, color: string) => void;
  partVisibility?: Map<string, boolean>;
  onPartVisibilityChange?: (partId: string, visible: boolean) => void;
  isDarkMode?: boolean;
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

// Reusable temp vector for world position calculations (module-level)
const tempVec = new THREE.Vector3();

/**
 * Get the actual minimum Y value from mesh geometry vertices in world space.
 * This uses the actual mesh vertices instead of the bounding box for more accurate
 * collision detection with the buildplate.
 * 
 * @param object - The THREE.Object3D to analyze (typically a Mesh or Group)
 * @returns The minimum Y coordinate in world space
 */
const getActualMinYFromMesh = (object: THREE.Object3D): number => {
  let minY = Infinity;
  const worldVertex = new THREE.Vector3();
  
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry;
      const positionAttribute = geometry.getAttribute('position');
      
      if (positionAttribute) {
        // Get the world matrix for this mesh
        child.updateMatrixWorld(true);
        const worldMatrix = child.matrixWorld;
        
        // Check all vertices
        for (let i = 0; i < positionAttribute.count; i++) {
          worldVertex.set(
            positionAttribute.getX(i),
            positionAttribute.getY(i),
            positionAttribute.getZ(i)
          );
          // Transform to world space
          worldVertex.applyMatrix4(worldMatrix);
          
          if (worldVertex.y < minY) {
            minY = worldVertex.y;
          }
        }
      }
    }
  });
  
  return minY === Infinity ? 0 : minY;
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

// Ground grid that scales with the model and adapts to model position
function ScalableGrid({ modelBounds, isDarkMode = false }: { 
  modelBounds: BoundsSummary | null;
  isDarkMode?: boolean;
}) {
  const gridRef = useRef<THREE.Group>(null);
  
  // Calculate grid size based on model bounds (which now include world positions)
  const gridConfig = useMemo(() => {
    if (!modelBounds) {
      // Default grid when no model loaded
      return { size: 200, divisions: 20, majorDivisions: 4 };
    }
    
    // Calculate max extent from origin to any edge of the model bounds
    // This ensures the grid covers all parts regardless of where they're positioned
    const maxExtentX = Math.max(Math.abs(modelBounds.min.x), Math.abs(modelBounds.max.x));
    const maxExtentZ = Math.max(Math.abs(modelBounds.min.z), Math.abs(modelBounds.max.z));
    const maxExtent = Math.max(maxExtentX, maxExtentZ);
    
    // Make grid large enough to cover the extent with 20% margin
    const rawSize = maxExtent * 2 * 1.2;
    
    // Round to nearest nice value (10, 25, 50, 100, 250, 500, etc.)
    const niceValues = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    let gridSize = niceValues[0];
    for (const val of niceValues) {
      if (val >= rawSize) {
        gridSize = val;
        break;
      }
      gridSize = val;
    }
    
    // Determine appropriate cell size (1mm, 5mm, 10mm, 25mm, 50mm, 100mm)
    const cellSizes = [1, 5, 10, 25, 50, 100, 250, 500];
    let cellSize = 10;
    for (const cs of cellSizes) {
      if (gridSize / cs <= 50) { // Aim for max ~50 divisions
        cellSize = cs;
        break;
      }
    }
    
    const divisions = Math.floor(gridSize / cellSize);
    const majorDivisions = cellSize >= 100 ? 1 : (cellSize >= 25 ? 4 : 10);
    
    return { size: gridSize, divisions, majorDivisions, cellSize };
  }, [modelBounds]);

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
        args={[gridConfig.size, gridConfig.divisions, isDarkMode ? '#3a3a4a' : '#d0d0d0', isDarkMode ? '#2a2a3a' : '#e8e8e8']} 
        rotation={[0, 0, 0]}
      />
      
      {/* Major grid lines (every N cells) */}
      <gridHelper 
        args={[gridConfig.size, Math.floor(gridConfig.divisions / gridConfig.majorDivisions), isDarkMode ? '#4a4a5a' : '#a0a0a0', isDarkMode ? '#4a4a5a' : '#a0a0a0']} 
        rotation={[0, 0, 0]}
        position={[0, 0.001, 0]}
      />
      
      {/* X axis (red) */}
      <primitive object={xAxisLine} />
      
      {/* Z axis (green) */}
      <primitive object={zAxisLine} />
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

// Component for the main 3D model
const ModelMesh = React.memo(function ModelMesh({ 
  file, 
  meshRef, 
  dimensions, 
  colorsMap, 
  setColorsMap, 
  onBoundsChange, 
  disableDoubleClick = false, 
  onDoubleClick, 
  initialOffset 
}: {
  file: ProcessedFile;
  meshRef?: React.RefObject<THREE.Mesh>;
  dimensions?: { x?: number; y?: number; z?: number };
  colorsMap?: Map<string, string>;
  setColorsMap?: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  onBoundsChange?: (bounds: BoundsSummary) => void;
  disableDoubleClick?: boolean;
  onDoubleClick?: () => void;
  initialOffset?: THREE.Vector3;
}) {
  const internalRef = useRef<THREE.Mesh>(null);
  const actualRef = meshRef || internalRef;
  const hasNormalizedRef = useRef(false);
  const lastClickTimeRef = useRef<number>(0);
  
  const DOUBLE_CLICK_DELAY = 300;

  const unitScale = useMemo(() => {
    switch (file.metadata.units) {
      case 'cm': return 10;
      case 'inch': return 25.4;
      default: return 1;
    }
  }, [file.metadata.units]);

  const modelId = file.metadata.name;
  const modelColor = getModelColor(modelId, colorsMap || new Map());

  // Assign color on mount
  useEffect(() => {
    if (setColorsMap && colorsMap && !colorsMap.has(modelId)) {
      setColorsMap(prev => new Map(prev.set(modelId, getModelColor(modelId, colorsMap))));
    }
  }, [modelId, setColorsMap, colorsMap]);

  // Apply material color
  useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh?.material || !modelColor) return;
    
    const hex = modelColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if ('color' in material) {
      material.color.setRGB(r, g, b);
      material.needsUpdate = true;
    }
  }, [modelColor, actualRef]);

  // Emit transform on mount and whenever mesh position might have changed from setup
  useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh) return;
    
    // Delay slightly to ensure position is finalized after any setup
    const timeoutId = setTimeout(() => {
      if (actualRef.current) {
        window.dispatchEvent(new CustomEvent('model-transform-updated', {
          detail: {
            position: actualRef.current.position.clone(),
            rotation: actualRef.current.rotation.clone(),
            partId: file.id,
          },
        }));
      }
    }, 50);
    
    return () => clearTimeout(timeoutId);
  }, [file.id, actualRef]);

  // Normalize geometry and set initial position
  useEffect(() => {
    const mesh = actualRef.current;
    if (!mesh) return;

    const geometry = mesh.geometry as THREE.BufferGeometry;

    if (!hasNormalizedRef.current) {
      // Center geometry and orient to dominant up
      geometry.computeBoundingBox();
      const geoBox = geometry.boundingBox;
      
      if (geoBox) {
        const geoCenter = geoBox.getCenter(new THREE.Vector3());
        geometry.translate(-geoCenter.x, -geoBox.min.y, -geoCenter.z);
        
        const dominantQuaternion = computeDominantUpQuaternion(geometry);
        if (dominantQuaternion) {
          geometry.applyQuaternion(dominantQuaternion);
          geometry.computeBoundingBox();
          const orientedBox = geometry.boundingBox;
          if (orientedBox) {
            const orientedCenter = orientedBox.getCenter(new THREE.Vector3());
            geometry.translate(-orientedCenter.x, -orientedBox.min.y, -orientedCenter.z);
          }
        }
        
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.attributes.position?.needsUpdate;
      }

      // Set initial position from offset
      mesh.position.set(initialOffset?.x ?? 0, 0, initialOffset?.z ?? 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(unitScale);
      mesh.updateMatrixWorld(true);
      mesh.userData.normalized = true;
      hasNormalizedRef.current = true;
    }

    // BVH acceleration
    const geo = geometry as any;
    geo.disposeBoundsTree?.();
    geo.computeBoundsTree?.();

    // Handle dimension overrides
    if (dimensions && (dimensions.x || dimensions.y || dimensions.z)) {
      const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
      const currentDimensions = box.getSize(new THREE.Vector3());
      mesh.scale.set(
        dimensions.x ? (dimensions.x / unitScale) / (currentDimensions.x || 1) : mesh.scale.x,
        dimensions.y ? (dimensions.y / unitScale) / (currentDimensions.y || 1) : mesh.scale.y,
        dimensions.z ? (dimensions.z / unitScale) / (currentDimensions.z || 1) : mesh.scale.z
      );
      mesh.updateMatrixWorld(true);
    }

    // Report bounds
    const finalBox = new THREE.Box3().setFromObject(mesh);
    const sphere = finalBox.getBoundingSphere(new THREE.Sphere());
    onBoundsChange?.({
      min: finalBox.min.clone(),
      max: finalBox.max.clone(),
      center: finalBox.getCenter(new THREE.Vector3()),
      size: finalBox.getSize(new THREE.Vector3()),
      radius: sphere.radius,
      unitsScale: unitScale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, dimensions, unitScale, initialOffset]);

  // Click handler with double-click detection
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (disableDoubleClick) return;
    
    const now = Date.now();
    if (now - lastClickTimeRef.current < DOUBLE_CLICK_DELAY) {
      onDoubleClick?.() ?? window.dispatchEvent(new CustomEvent('mesh-double-click'));
      lastClickTimeRef.current = 0;
    } else {
      lastClickTimeRef.current = now;
    }
  }, [disableDoubleClick, onDoubleClick]);

  return (
    <mesh 
      ref={actualRef} 
      geometry={file.mesh.geometry} 
      material={file.mesh.material}
      onClick={handleClick}
    />
  );
});

/**
 * Component for placed fixture elements from the component library
 * Currently a placeholder for future fixture component functionality
 */
interface FixtureComponentProps {
  component: { geometry: THREE.BufferGeometry; material: THREE.Material };
  position: THREE.Vector3;
  onSelect?: () => void;
}

function FixtureComponent({ component, position, onSelect }: FixtureComponentProps) {
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
  importedParts,
  selectedPartId,
  onPartSelected,
  onModelColorAssigned,
  partVisibility = new Map(),
  onPartVisibilityChange,
  isDarkMode = false,
}) => {
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  
  // Future: Component library for fixture elements (currently placeholder)
  const [placedComponents, setPlacedComponents] = useState<Array<{ component: unknown; position: THREE.Vector3; id: string }>>([]);
  const [selectedComponent, setSelectedComponent] = useState<unknown>(null);
  
  // Baseplate configuration state
  const [basePlate, setBasePlate] = useState<BasePlateConfig | null>(null);
  
  // Store refs for each model mesh by part ID
  const modelMeshRefs = useRef<Map<string, React.RefObject<THREE.Mesh>>>(new Map());
  // Store initial offsets for each part (persists across renders to prevent position reset)
  const partInitialOffsetsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const basePlateMeshRef = useRef<THREE.Mesh>(null);
  const [baseTopY, setBaseTopY] = useState<number>(0);
  const [modelDimensions, setModelDimensions] = useState<{ x?: number; y?: number; z?: number } | undefined>();
  const [orbitControlsEnabled, setOrbitControlsEnabled] = useState(true);
  const [modelColors, setModelColors] = useState<Map<string, string>>(new Map());
  const [modelBounds, setModelBounds] = useState<BoundsSummary | null>(null);
  // Store bounds for each part for combined bounding box calculation
  const [partBounds, setPartBounds] = useState<Map<string, BoundsSummary>>(new Map());
  const [currentOrientation, setCurrentOrientation] = useState<ViewOrientation>('iso');
  const prevOrientationRef = useRef<ViewOrientation>('iso');
  // Track whether to update camera on next bounds change (only for first part or explicit reframe)
  const shouldReframeCameraRef = useRef<boolean>(true);

  // Local state to track the selected part's transform (for property panel sync and grid positioning)
  const [modelTransform, setModelTransform] = useState({
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    scale: new THREE.Vector3(1, 1, 1),
  });

  // Get or create a ref for a part
  const getPartMeshRef = useCallback((partId: string) => {
    if (!modelMeshRefs.current.has(partId)) {
      modelMeshRefs.current.set(partId, React.createRef<THREE.Mesh>());
    }
    return modelMeshRefs.current.get(partId)!;
  }, []);

  // Get the currently selected part's mesh ref
  const selectedPartMeshRef = selectedPartId ? getPartMeshRef(selectedPartId) : null;

  // Get the first part (for backward compatibility with single-file operations)
  const firstPart = importedParts.length > 0 ? importedParts[0] : null;

  // Function to recalculate combined bounds from all mesh world positions
  const recalculateCombinedBounds = useCallback(() => {
    if (importedParts.length === 0) {
      setModelBounds(null);
      return;
    }

    const combinedBox = new THREE.Box3();
    let hasValidBounds = false;
    let firstUnitsScale = 1;

    // Calculate bounds from actual mesh world positions
    importedParts.forEach((part, index) => {
      const meshRef = modelMeshRefs.current.get(part.id);
      const mesh = meshRef?.current;
      if (mesh) {
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        if (!box.isEmpty()) {
          combinedBox.union(box);
          hasValidBounds = true;
          if (index === 0) {
            firstUnitsScale = partBounds.get(part.id)?.unitsScale ?? 1;
          }
        }
      }
    });

    if (!hasValidBounds || combinedBox.isEmpty()) {
      // Fall back to stored partBounds if meshes not ready
      if (partBounds.size === 0) {
        setModelBounds(null);
        return;
      }
      partBounds.forEach((bounds) => {
        combinedBox.expandByPoint(bounds.min);
        combinedBox.expandByPoint(bounds.max);
      });
      const firstPartBounds = Array.from(partBounds.values())[0];
      firstUnitsScale = firstPartBounds?.unitsScale ?? 1;
    }

    if (combinedBox.isEmpty()) {
      setModelBounds(null);
      return;
    }

    const center = combinedBox.getCenter(new THREE.Vector3());
    const combinedSize = combinedBox.getSize(new THREE.Vector3());
    const sphere = combinedBox.getBoundingSphere(new THREE.Sphere());

    setModelBounds({
      min: combinedBox.min.clone(),
      max: combinedBox.max.clone(),
      center,
      size: combinedSize,
      radius: sphere.radius,
      unitsScale: firstUnitsScale,
    });
  }, [importedParts, partBounds]);

  // Calculate combined bounds from all parts (initial load and partBounds changes)
  useEffect(() => {
    recalculateCombinedBounds();
  }, [partBounds, recalculateCombinedBounds]);

  // Recalculate bounds when any part is transformed
  useEffect(() => {
    const handleTransformUpdated = () => {
      // Debounce slightly to batch rapid updates
      recalculateCombinedBounds();
    };

    window.addEventListener('model-transform-updated', handleTransformUpdated as EventListener);
    return () => window.removeEventListener('model-transform-updated', handleTransformUpdated as EventListener);
  }, [recalculateCombinedBounds]);

  // Clean up stale partBounds entries when parts are removed
  useEffect(() => {
    const currentPartIds = new Set(importedParts.map(p => p.id));
    setPartBounds(prev => {
      const newMap = new Map(prev);
      let changed = false;
      for (const [partId] of newMap) {
        if (!currentPartIds.has(partId)) {
          newMap.delete(partId);
          changed = true;
        }
      }
      return changed ? newMap : prev;
    });
    
    // Also clean up mesh refs and initial offsets
    for (const [partId] of modelMeshRefs.current) {
      if (!currentPartIds.has(partId)) {
        modelMeshRefs.current.delete(partId);
      }
    }
    for (const [partId] of partInitialOffsetsRef.current) {
      if (!currentPartIds.has(partId)) {
        partInitialOffsetsRef.current.delete(partId);
      }
    }
  }, [importedParts]);

  // Report model colors to parent when they change
  useEffect(() => {
    if (onModelColorAssigned) {
      modelColors.forEach((color, modelId) => {
        onModelColorAssigned(modelId, color);
      });
    }
  }, [modelColors, onModelColorAssigned]);
  
  // Support placement state
  const [placing, setPlacing] = useState<{ active: boolean; type: SupportType | null; initParams?: Record<string, number> }>({ active: false, type: null });
  const [supports, setSupports] = useState<AnySupport[]>([]);
  const [supportsTrimPreview, setSupportsTrimPreview] = useState<THREE.Mesh[]>([]);
  const [supportsTrimProcessing, setSupportsTrimProcessing] = useState(false);
  
  // Cavity operations preview (for CSG operations)
  const [cavityPreview, setCavityPreview] = useState<THREE.Mesh | null>(null);
  
  // Support editing state
  const editingSupportRef = useRef<AnySupport | null>(null);
  const [editingSupport, setEditingSupport] = useState<AnySupport | null>(null);
  
  // Live transform state - when pivot controls are active, this tracks the model's live position/bounds
  const [liveTransform, setLiveTransform] = useState<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    bounds: THREE.Box3;
  } | null>(null);
  
  // Track whether we're in the process of closing (to ignore spurious transforms)
  const pivotClosingRef = useRef(false);

  // Supports stay fixed - no live position tracking needed
  // Calculate all support footprint points for convex hull calculation
  // Use a ref to cache the previous result and avoid recreating the array
  const prevSupportHullPointsRef = useRef<Array<{x: number; z: number}>>([]);
  const supportHullPoints = useMemo(() => {
    const points: Array<{x: number; z: number}> = [];
    for (const support of supports) {
      const footprintPoints = getSupportFootprintPoints(support);
      points.push(...footprintPoints);
    }
    
    // Check if points are the same as before to avoid unnecessary updates
    const prev = prevSupportHullPointsRef.current;
    if (prev.length === points.length) {
      let same = true;
      for (let i = 0; i < points.length && same; i++) {
        if (Math.abs(prev[i].x - points[i].x) > 0.001 || Math.abs(prev[i].z - points[i].z) > 0.001) {
          same = false;
        }
      }
      if (same) return prev; // Return the cached array to avoid triggering downstream updates
    }
    
    prevSupportHullPointsRef.current = points;
    return points;
  }, [supports]);

  const csgEngineRef = useRef<CSGEngine | null>(null);
  if (!csgEngineRef.current) {
    csgEngineRef.current = new CSGEngine();
  }

  // Ensure supports use the baseplate TOP surface, not bottom: compute baseTopY from world bbox
  React.useEffect(() => {
    const updateTopY = () => {
      const mesh = basePlateMeshRef.current;
      if (!mesh) { 
        setBaseTopY(prev => prev === 0 ? prev : 0); 
        return; 
      }
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) { 
        setBaseTopY(prev => prev === 0 ? prev : 0); 
        return; 
      }
      const newTopY = box.max.y;
      // Only update if the value actually changed (with small tolerance)
      setBaseTopY(prev => Math.abs(prev - newTopY) < 0.001 ? prev : newTopY);
    };
    updateTopY();
    const id = setInterval(updateTopY, 250);
    return () => clearInterval(id);
  }, []);

  // Supports stay fixed in world space - they don't move when model moves
  // The baseplate will expand to include both the model and the supports
  
  // Handle live transform from PivotControls
  // Supports stay fixed, but we track the transform for baseplate live updates
  const handleLiveTransformChange = useCallback((transform: { position: THREE.Vector3; rotation: THREE.Euler; bounds: THREE.Box3; pivotClosed?: boolean } | null) => {
    if (transform === null) {
      setLiveTransform(null);
      pivotClosingRef.current = false;
      return;
    }
    
    // Ignore transforms that come in while we're closing
    if (pivotClosingRef.current && !transform.pivotClosed) {
      return;
    }
    
    if (transform.pivotClosed) {
      // Mark that we're closing - ignore any further transforms until cleared
      pivotClosingRef.current = true;
      
      // Emit the transform update first, then schedule collision check
      // The collision check needs to happen AFTER SelectableTransformControls finishes
      if (selectedPartId) {
        const partRef = modelMeshRefs.current.get(selectedPartId);
        if (partRef?.current) {
          partRef.current.updateMatrixWorld(true);
          partRef.current.getWorldPosition(tempVec);
          
          // Emit transform update immediately
          window.dispatchEvent(new CustomEvent('model-transform-updated', {
            detail: {
              position: tempVec.clone(),
              rotation: partRef.current.rotation.clone(),
              partId: selectedPartId,
            },
          }));
          
          // Schedule collision check for after everything settles
          // Use setTimeout to ensure it runs after the current call stack
          if (basePlate) {
            const partId = selectedPartId;
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('check-baseplate-collision-delayed', {
                detail: { partId }
              }));
            }, 50); // Small delay to ensure all transforms are baked
          }
        }
      }
      
      // Clear liveTransform after a short delay to allow geometry to update
      requestAnimationFrame(() => {
        setLiveTransform(null);
        pivotClosingRef.current = false;
      });
      return;
    }
    
    setLiveTransform(transform);
  }, [basePlate, selectedPartId]);
  
  // Compute live position delta from the pivot transform for baseplate
  const livePositionDelta = useMemo(() => {
    if (!liveTransform) return null;
    
    // liveTransform.position is already the delta from pivot origin
    return {
      x: liveTransform.position.x,
      z: liveTransform.position.z,
    };
  }, [liveTransform]);

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

  // Track previous orientation to detect explicit orientation changes
  const lastOrientationRef = useRef<ViewOrientation>(currentOrientation);

  React.useEffect(() => {
    const orientationChanged = lastOrientationRef.current !== currentOrientation;
    lastOrientationRef.current = currentOrientation;

    // Update camera if:
    // 1. Orientation explicitly changed (user clicked view button), OR
    // 2. This is the first part being added (shouldReframeCameraRef is true)
    if (orientationChanged || (modelBounds && shouldReframeCameraRef.current)) {
      updateCamera(currentOrientation, modelBounds);
      shouldReframeCameraRef.current = false; // Reset after initial framing
    }
  }, [currentOrientation, modelBounds, updateCamera]);

  React.useEffect(() => {
    if (importedParts.length === 0) {
      setModelBounds(null);
      setPartBounds(new Map());
      setCurrentOrientation('iso');
      shouldReframeCameraRef.current = true; // Reset so next part import will frame the camera
    } else {
      // When a new file is loaded, emit the initial transform with isInitial flag
      // This allows the Properties panel to store the initial position for reset functionality
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('model-transform-updated', {
            detail: {
              position: modelTransform.position,
              rotation: modelTransform.rotation,
              isInitial: true,
            },
          })
        );
      }, 100); // Small delay to ensure mesh is positioned
    }
  }, [importedParts.length]);

  // Trigger baseplate recalculation when parts are added/removed
  // This forces a re-render of the baseplate with updated geometries
  // Also lifts parts above the baseplate after recalculation
  const prevPartCountRef = useRef(importedParts.length);
  useEffect(() => {
    const prevCount = prevPartCountRef.current;
    const currentCount = importedParts.length;
    prevPartCountRef.current = currentCount;
    
    // Only trigger if we have a baseplate and parts were added
    if (basePlate && currentCount > prevCount) {
      // Delay to ensure new mesh refs are populated and baseplate is updated
      const timeoutId = setTimeout(() => {
        // Force baseplate to recalculate for convex-hull type
        if (basePlate.type === 'convex-hull') {
          setBasePlate(prev => prev ? { ...prev } : null);
        }
        
        // After another short delay, lift any parts that collide with the baseplate
        setTimeout(() => {
          const baseplateMesh = basePlateMeshRef.current;
          if (!baseplateMesh) return;
          
          baseplateMesh.updateMatrixWorld(true);
          const baseplateBox = new THREE.Box3().setFromObject(baseplateMesh);
          const baseplateTopY = baseplateBox.max.y;
          
          // Check each part and lift if needed
          importedParts.forEach(part => {
            const ref = modelMeshRefs.current.get(part.id);
            if (ref?.current) {
              ref.current.updateMatrixWorld(true);
              const partBox = new THREE.Box3().setFromObject(ref.current);
              const partBottomY = partBox.min.y;
              
              // If part's bottom is below baseplate top, lift it
              if (partBottomY < baseplateTopY) {
                const offsetY = baseplateTopY - partBottomY;
                ref.current.position.y += offsetY;
                ref.current.updateMatrixWorld(true);
                
                // Emit transform update
                const tempVec = new THREE.Vector3();
                ref.current.getWorldPosition(tempVec);
                window.dispatchEvent(new CustomEvent('model-transform-updated', {
                  detail: {
                    position: tempVec.clone(),
                    rotation: ref.current.rotation.clone(),
                    partId: part.id,
                  },
                }));
              }
            }
          });
        }, 100);
      }, 200);
      return () => clearTimeout(timeoutId);
    } else if (basePlate?.type === 'convex-hull' && prevCount !== currentCount) {
      // Parts were removed - just recalculate baseplate
      const timeoutId = setTimeout(() => {
        setBasePlate(prev => prev ? { ...prev } : null);
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [importedParts.length, basePlate]);

  // Cavity context request/dispatch
  React.useEffect(() => {
    const handleRequestContext = () => {
      const base = basePlateMeshRef.current || null;
      
      // Collect all part meshes
      const partMeshes: THREE.Mesh[] = [];
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          partMeshes.push(ref.current);
        }
      });
      
      let baseMesh: THREE.Mesh | null = null;
      let tools: THREE.Mesh[] = [];
      if (base && partMeshes.length > 0) {
        baseMesh = base; // default: baseplate as base
        tools = partMeshes;
      } else if (base) {
        baseMesh = base;
        tools = [];
      } else if (partMeshes.length > 0) {
        baseMesh = partMeshes[0];
        tools = partMeshes.slice(1);
      }
      window.dispatchEvent(new CustomEvent('cavity-context', { detail: { baseMesh, fixtureComponents: tools } }));
    };
    window.addEventListener('request-cavity-context', handleRequestContext as EventListener);
    return () => window.removeEventListener('request-cavity-context', handleRequestContext as EventListener);
  }, [importedParts]);

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
      // Prefer replacing baseplate if present, otherwise first part
      const firstPartRef = importedParts.length > 0 ? modelMeshRefs.current.get(importedParts[0].id) : null;
      const target = basePlateMeshRef.current || firstPartRef?.current;
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
  }, [importedParts]);

  // TODO: Implement drag-and-drop for fixture components when library panel is ready
  const handlePointerMove = useCallback((_event: unknown) => {
    // Reserved for future drag-and-drop functionality
  }, []);

  const handlePointerUp = useCallback(() => {
    // Reserved for future drag-and-drop functionality
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

      // Disable orbit controls during placement
      setOrbitControlsEnabled(false);

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
      // Clear any editing state
      editingSupportRef.current = null;
      setEditingSupport(null);
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
    // For convex-hull plates, the hull will automatically recalculate to include support points
    setBasePlate(prev => {
      if (!prev) return prev;
      
      // For convex-hull, no need to manually expand - the hull recalculates from supports
      if (prev.type === 'convex-hull') {
        // Just trigger a re-render by returning a new object reference
        return { ...prev };
      }
      
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

  // Listen for support updates from properties panel
  React.useEffect(() => {
    const onSupportUpdated = (e: CustomEvent) => {
      const updatedSupport = e.detail as AnySupport;
      setSupports(prev => prev.map(s => s.id === updatedSupport.id ? updatedSupport : s));
    };

    const onSupportDelete = (e: CustomEvent) => {
      const supportId = e.detail as string;
      setSupports(prev => prev.filter(s => s.id !== supportId));
      // If we were editing this support, cancel the edit
      if (editingSupportRef.current?.id === supportId) {
        editingSupportRef.current = null;
        setEditingSupport(null);
      }
    };

    const onSupportsClearAll = () => {
      setSupports([]);
      editingSupportRef.current = null;
      setEditingSupport(null);
    };

    window.addEventListener('support-updated', onSupportUpdated as EventListener);
    window.addEventListener('support-delete', onSupportDelete as EventListener);
    window.addEventListener('supports-clear-all', onSupportsClearAll);

    return () => {
      window.removeEventListener('support-updated', onSupportUpdated as EventListener);
      window.removeEventListener('support-delete', onSupportDelete as EventListener);
      window.removeEventListener('supports-clear-all', onSupportsClearAll);
    };
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

        // Use first part's mesh for support trimming (or could use all parts)
        const firstPartRef = importedParts.length > 0 ? modelMeshRefs.current.get(importedParts[0].id) : null;
        const modelMesh = firstPartRef?.current;
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

      const basePlateId = `baseplate-${Date.now()}`;

      // Calculate combined WORLD bounding box from all parts
      // This properly accounts for rotations and transformations
      let combinedBox: THREE.Box3 | null = null;
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          // Force full matrix world update through the hierarchy
          ref.current.updateMatrixWorld(true);
          // setFromObject automatically uses world coordinates
          const partBox = new THREE.Box3().setFromObject(ref.current);
          if (!combinedBox) {
            combinedBox = partBox.clone();
          } else {
            combinedBox.union(partBox);
          }
        }
      });
      
      const box = combinedBox;
      const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(60, 60, 60);
      const boxCenter = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);

      // Helper to coerce dimension
      const clampPos = (v: any, min: number, fallback: number) => Math.max(Number(v) || fallback, min);

      // Default baseplate thickness (4mm)
      const DEFAULT_THICKNESS = 4;

      let cfg: NonNullable<typeof basePlate> = {
        type: (option as any),
        id: basePlateId,
        material: (dimensions?.material || 'metal'),
        position: new THREE.Vector3(0, 0, 0)
      };

      if (option === 'rectangular') {
        // Use padding from dimensions if provided, otherwise use default
        const paddingValue = clampPos(dimensions?.padding, 0, 10);
        const width = clampPos(dimensions?.width, 10, size.x + (paddingValue * 2));
        const height = clampPos(dimensions?.length ?? dimensions?.depth, 10, size.z + (paddingValue * 2));
        const depth = clampPos(dimensions?.height, 1, DEFAULT_THICKNESS);
        cfg = { ...cfg, type: 'rectangular', width, height, depth, oversizeXY: paddingValue };
        // Position baseplate centered under the parts (in XZ plane)
        cfg.position = new THREE.Vector3(boxCenter.x, 0, boxCenter.z);
      } else if (option === 'convex-hull') {
        const depth = clampPos(dimensions?.height, 1, DEFAULT_THICKNESS);
        const oversizeXY = clampPos(dimensions?.oversizeXY ?? dimensions?.padding, 0, 10);
        // Convex hull computes its own shape from geometry, position stays at origin
        cfg = { ...cfg, type: 'convex-hull', depth, oversizeXY, width: size.x + oversizeXY * 2, height: size.z + oversizeXY * 2 };
        cfg.position = new THREE.Vector3(0, 0, 0);
      } else if (option === 'perforated-panel') {
        const paddingValue = clampPos(dimensions?.padding, 0, 10);
        const width = clampPos(dimensions?.width, 10, size.x + (paddingValue * 2));
        const height = clampPos(dimensions?.length ?? dimensions?.depth, 10, size.z + (paddingValue * 2));
        const depth = clampPos(dimensions?.height, 1, DEFAULT_THICKNESS);
        const pitch = clampPos(dimensions?.pitch ?? dimensions?.holeDistance, 2, 20);
        const holeDiameter = clampPos(dimensions?.holeDiameter, 1, 6);
        cfg = { ...cfg, type: 'perforated-panel', width, height, depth, pitch, holeDiameter, oversizeXY: paddingValue };
        cfg.position = new THREE.Vector3(boxCenter.x, 0, boxCenter.z);
      } else if (option === 'metal-wooden-plate') {
        const paddingValue = clampPos(dimensions?.padding, 0, 10);
        const width = clampPos(dimensions?.width, 10, size.x + (paddingValue * 2));
        const height = clampPos(dimensions?.length ?? dimensions?.depth, 10, size.z + (paddingValue * 2));
        const depth = clampPos(dimensions?.height, 1, DEFAULT_THICKNESS);
        const holeDiameter = clampPos(dimensions?.holeDiameter, 1, 6);
        cfg = { ...cfg, type: 'metal-wooden-plate', width, height, depth, holeDiameter, oversizeXY: paddingValue };
        cfg.position = new THREE.Vector3(boxCenter.x, 0, boxCenter.z);
      } else {
        console.warn('Unsupported baseplate option:', option);
        return;
      }

      // Get baseplate depth/thickness - total height is exactly this value
      const baseplateDepth = cfg.depth ?? DEFAULT_THICKNESS;
      // Top of baseplate is at Y = baseplateDepth (bevel is included within the depth)
      const baseplateTopY = baseplateDepth;
      
      // Lift parts that would collide with baseplate
      // Move in global Y direction (Three.js up = CAD Z direction)
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          ref.current.updateMatrixWorld(true);
          const mbox = new THREE.Box3().setFromObject(ref.current);
          const currentMinY = mbox.min.y;
          
          // Only lift if model's bottom is below the baseplate's top surface (collision)
          if (currentMinY < baseplateTopY) {
            const offsetY = baseplateTopY - currentMinY;
            // Move in world Y (global up direction)
            ref.current.position.y += offsetY;
            ref.current.updateMatrixWorld(true);
          }
        }
      });
      
      // Update transform state for the selected part
      if (selectedPartId) {
        const selectedRef = modelMeshRefs.current.get(selectedPartId);
        if (selectedRef?.current) {
          selectedRef.current.getWorldPosition(tempVec);
          setModelTransform({
            position: tempVec.clone(),
            rotation: selectedRef.current.rotation.clone(),
            scale: selectedRef.current.scale.clone(),
          });
        }
      }

      setBasePlate(cfg);
      
      // Emit transform updates for all parts after lifting
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          ref.current.getWorldPosition(tempVec);
          window.dispatchEvent(new CustomEvent('model-transform-updated', {
            detail: {
              position: tempVec.clone(),
              rotation: ref.current.rotation.clone(),
              partId: part.id,
            },
          }));
        }
      });
    };

    window.addEventListener('create-baseplate', handleCreateBaseplate as EventListener);
    return () => window.removeEventListener('create-baseplate', handleCreateBaseplate as EventListener);
  }, [importedParts, selectedPartId]);

  // Handle base plate deselection/cancellation/update
  React.useEffect(() => {
    const handleDeselectBaseplate = (e: CustomEvent) => {
      const { basePlateId } = e.detail;

      if (basePlate && basePlate.id === basePlateId) {
        setBasePlate(null);
      }
    };

    const handleCancelBaseplate = () => {
      setBasePlate(null);
    };

    const handleUpdateBaseplate = (e: CustomEvent) => {
      const { dimensions } = e.detail;
      if (!basePlate) return;
      
      // Update baseplate with new dimensions
      const updatedBaseplate = {
        ...basePlate,
        depth: dimensions?.height ?? basePlate.depth,
        oversizeXY: dimensions?.padding ?? dimensions?.oversizeXY ?? basePlate.oversizeXY,
      };
      
      // Recalculate width/height based on model bounds + new padding
      if (basePlate.type === 'rectangular' || basePlate.type === 'convex-hull') {
        const padding = updatedBaseplate.oversizeXY ?? 10;
        
        // Get combined bounding box
        const box = new THREE.Box3();
        importedParts.forEach(part => {
          const ref = modelMeshRefs.current.get(part.id);
          if (ref?.current) {
            ref.current.updateMatrixWorld(true);
            const partBox = new THREE.Box3().setFromObject(ref.current);
            box.union(partBox);
          }
        });
        
        if (!box.isEmpty()) {
          const size = box.getSize(new THREE.Vector3());
          updatedBaseplate.width = size.x + padding * 2;
          updatedBaseplate.height = size.z + padding * 2;
        }
      }
      
      // Get new baseplate top Y position
      const baseplateTopY = updatedBaseplate.depth ?? 4;
      
      // Lift parts that would collide with the new baseplate height
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          ref.current.updateMatrixWorld(true);
          const mbox = new THREE.Box3().setFromObject(ref.current);
          const currentMinY = mbox.min.y;
          
          // Only lift if model's bottom is below the baseplate's top surface (collision)
          if (currentMinY < baseplateTopY) {
            const offsetY = baseplateTopY - currentMinY;
            // Move in world Y (global up direction)
            ref.current.position.y += offsetY;
            ref.current.updateMatrixWorld(true);
          }
        }
      });
      
      // Update transform state for the selected part
      if (selectedPartId) {
        const selectedRef = modelMeshRefs.current.get(selectedPartId);
        if (selectedRef?.current) {
          selectedRef.current.getWorldPosition(tempVec);
          setModelTransform({
            position: tempVec.clone(),
            rotation: selectedRef.current.rotation.clone(),
            scale: selectedRef.current.scale.clone(),
          });
        }
      }
      
      setBasePlate(updatedBaseplate);
      
      // Emit transform updates for all parts after lifting
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          ref.current.getWorldPosition(tempVec);
          window.dispatchEvent(new CustomEvent('model-transform-updated', {
            detail: {
              position: tempVec.clone(),
              rotation: ref.current.rotation.clone(),
              partId: part.id,
            },
          }));
        }
      });
    };

    const handleRemoveBaseplate = (e: CustomEvent) => {
      setBasePlate(null);
    };

    window.addEventListener('baseplate-deselected', handleDeselectBaseplate as EventListener);
    window.addEventListener('cancel-baseplate', handleCancelBaseplate as EventListener);
    window.addEventListener('update-baseplate', handleUpdateBaseplate as EventListener);
    window.addEventListener('remove-baseplate', handleRemoveBaseplate as EventListener);

    return () => {
      window.removeEventListener('baseplate-deselected', handleDeselectBaseplate as EventListener);
      window.removeEventListener('cancel-baseplate', handleCancelBaseplate as EventListener);
      window.removeEventListener('update-baseplate', handleUpdateBaseplate as EventListener);
      window.removeEventListener('remove-baseplate', handleRemoveBaseplate as EventListener);
    };
  }, [basePlate, importedParts, selectedPartId]);

  // Update rectangular baseplate size and position when model transform changes
  // This recalculates dimensions based on new bounding box after gizmo closes
  React.useEffect(() => {
    if (!basePlate) return;
    if (importedParts.length === 0) return;
    
    // Only update for non-convex-hull types
    // Convex-hull recalculates its geometry from modelGeometry/modelMatrixWorld props automatically
    if (basePlate.type === 'convex-hull') return;
    
    // Compute combined bounding box of all parts
    // NOTE: The mesh's matrixWorld already includes the live pivot transform since the mesh
    // is a child of the PivotControls group, so setFromObject gives us the correct live bounds.
    const box = new THREE.Box3();
    importedParts.forEach(part => {
      const ref = modelMeshRefs.current.get(part.id);
      if (ref?.current) {
        ref.current.updateMatrixWorld(true);
        const partBox = new THREE.Box3().setFromObject(ref.current);
        box.union(partBox);
      }
    });
    
    if (box.isEmpty()) return;
    
    // Expand the bounding box to include support footprints
    // Supports stay fixed, so use their actual positions
    for (const support of supports) {
      // Get footprint bounds for this support
      const footprintBounds = getSupportFootprintBounds(support);
      
      // Expand the box to include this support's footprint
      box.min.x = Math.min(box.min.x, footprintBounds.minX);
      box.max.x = Math.max(box.max.x, footprintBounds.maxX);
      box.min.z = Math.min(box.min.z, footprintBounds.minZ);
      box.max.z = Math.max(box.max.z, footprintBounds.maxZ);
    }
    
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    
    // Get current padding (oversizeXY or default)
    const currentPadding = basePlate.oversizeXY ?? 10;
    
    // Calculate new dimensions based on bounding box + padding
    const newWidth = size.x + currentPadding * 2;
    const newHeight = size.z + currentPadding * 2; // height in baseplate terms = Z extent
    const newPosition = new THREE.Vector3(center.x, 0, center.z);
    
    // Only update if dimensions actually changed significantly
    const widthChanged = Math.abs((basePlate.width || 0) - newWidth) > 0.1;
    const heightChanged = Math.abs((basePlate.height || 0) - newHeight) > 0.1;
    const positionChanged = !basePlate.position || 
      Math.abs(basePlate.position.x - newPosition.x) > 0.1 ||
      Math.abs(basePlate.position.z - newPosition.z) > 0.1;
    
    if (widthChanged || heightChanged || positionChanged) {
      setBasePlate(prev => prev ? {
        ...prev,
        width: newWidth,
        height: newHeight,
        position: newPosition
      } : null);
    }
  }, [modelTransform.position, modelTransform.rotation, basePlate?.type, supports, livePositionDelta]);

  // Handle check-baseplate-collision event (triggered when position is reset from Properties panel)
  // This lifts the part above the baseplate if there's a collision
  // Uses actual mesh vertices for accurate collision detection instead of bounding box
  React.useEffect(() => {
    const handleCheckBaseplateCollision = (e: CustomEvent) => {
      if (!basePlate) return;
      
      const { partId } = e.detail;
      if (!partId) return;
      
      const partRef = modelMeshRefs.current.get(partId);
      if (!partRef?.current) return;
      
      const baseplateTopY = basePlate.depth ?? 4;
      
      partRef.current.updateMatrixWorld(true);
      // Use actual mesh vertices for accurate collision detection
      const currentMinY = getActualMinYFromMesh(partRef.current);
      
      // If part's bottom is below baseplate top, lift it
      if (currentMinY < baseplateTopY) {
        const offsetY = baseplateTopY - currentMinY;
        partRef.current.position.y += offsetY;
        partRef.current.updateMatrixWorld(true);
        
        // Emit updated transform so the Properties panel updates
        partRef.current.getWorldPosition(tempVec);
        window.dispatchEvent(new CustomEvent('model-transform-updated', {
          detail: {
            position: tempVec.clone(),
            rotation: partRef.current.rotation.clone(),
            partId: partId,
          },
        }));
      }
    };

    window.addEventListener('check-baseplate-collision', handleCheckBaseplateCollision as EventListener);
    return () => window.removeEventListener('check-baseplate-collision', handleCheckBaseplateCollision as EventListener);
  }, [basePlate]);

  // Handle delayed baseplate collision check - runs AFTER pivot controls finish baking transform
  // This ensures the mesh position is stable before we check and adjust
  // Uses actual mesh vertices for accurate collision detection instead of bounding box
  React.useEffect(() => {
    const handleDelayedCollisionCheck = (e: CustomEvent) => {
      if (!basePlate) return;
      
      const { partId } = e.detail;
      if (!partId) return;
      
      const partRef = modelMeshRefs.current.get(partId);
      if (!partRef?.current) return;
      
      const baseplateTopY = basePlate.depth ?? 4;
      
      // Force update world matrix to get accurate vertex positions
      partRef.current.updateMatrixWorld(true);
      
      // Use actual mesh vertices for accurate collision detection
      const currentMinY = getActualMinYFromMesh(partRef.current);
      
      // If part's bottom is below baseplate top, lift it
      if (currentMinY < baseplateTopY - 0.01) {
        const offsetY = baseplateTopY - currentMinY;
        partRef.current.position.y += offsetY;
        partRef.current.updateMatrixWorld(true);
        
        // Emit updated transform so Properties panel updates
        partRef.current.getWorldPosition(tempVec);
        window.dispatchEvent(new CustomEvent('model-transform-updated', {
          detail: {
            position: tempVec.clone(),
            rotation: partRef.current.rotation.clone(),
            partId: partId,
          },
        }));
      }
    };

    window.addEventListener('check-baseplate-collision-delayed', handleDelayedCollisionCheck as EventListener);
    return () => window.removeEventListener('check-baseplate-collision-delayed', handleDelayedCollisionCheck as EventListener);
  }, [basePlate]);

  // Handle set-part-to-baseplate event - positions part so its bottom touches baseplate top
  // Uses actual mesh vertices for accurate positioning instead of bounding box
  React.useEffect(() => {
    const handleSetPartToBaseplate = (e: CustomEvent) => {
      if (!basePlate) return;
      
      const { partId } = e.detail;
      if (!partId) return;
      
      const partRef = modelMeshRefs.current.get(partId);
      if (!partRef?.current) return;
      
      const baseplateTopY = basePlate.depth ?? 4;
      
      partRef.current.updateMatrixWorld(true);
      // Use actual mesh vertices for accurate positioning
      const currentMinY = getActualMinYFromMesh(partRef.current);
      
      // Calculate offset to place part's bottom exactly on baseplate top
      const offsetY = baseplateTopY - currentMinY;
      
      // Only move if there's actually a difference
      if (Math.abs(offsetY) > 0.001) {
        partRef.current.position.y += offsetY;
        partRef.current.updateMatrixWorld(true);
        
        // Emit updated transform so the Properties panel updates
        partRef.current.getWorldPosition(tempVec);
        window.dispatchEvent(new CustomEvent('model-transform-updated', {
          detail: {
            position: tempVec.clone(),
            rotation: partRef.current.rotation.clone(),
            partId: partId,
          },
        }));
      }
    };

    window.addEventListener('set-part-to-baseplate', handleSetPartToBaseplate as EventListener);
    return () => window.removeEventListener('set-part-to-baseplate', handleSetPartToBaseplate as EventListener);
  }, [basePlate]);

  // Handle transform mode toggle events
  React.useEffect(() => {
    const handleToggleTransform = () => {
      // This will be handled by the parent component
    };

    window.addEventListener('toggle-transform-mode', handleToggleTransform as EventListener);
    return () => window.removeEventListener('toggle-transform-mode', handleToggleTransform as EventListener);
  }, []);

  // NOTE: We no longer emit model-transform-updated from modelTransform state changes
  // because SelectableTransformControls already emits per-part transform events directly.
  // The old useEffect caused all parts to update when any part was transformed.

  // Listen for transform changes from Properties panel input fields
  // Note: SelectableTransformControls handles the actual mesh positioning
  // This handler just updates the modelTransform state for the selected part
  React.useEffect(() => {
    const handleSetTransform = (e: CustomEvent) => {
      const { position, rotation, partId } = e.detail;
      
      // Use partId from event if provided, otherwise fall back to selectedPartId
      const targetPartId = partId || selectedPartId;
      
      // Update the state if it's the selected part
      if (targetPartId === selectedPartId) {
        setModelTransform({
          position: position.clone(),
          rotation: rotation.clone(),
          scale: modelTransform.scale.clone(),
        });
      }
    };

    const handleRequestTransform = (e: CustomEvent) => {
      // If a specific partId is requested, use that; otherwise use selected part
      const requestedPartId = e.detail?.partId || selectedPartId;
      if (!requestedPartId) return;
      
      const partRef = modelMeshRefs.current.get(requestedPartId);
      const mesh = partRef?.current;
      
      if (mesh) {
        mesh.updateMatrixWorld(true);
        mesh.getWorldPosition(tempVec);
        window.dispatchEvent(
          new CustomEvent('model-transform-updated', {
            detail: {
              position: tempVec.clone(),
              rotation: mesh.rotation.clone(),
              partId: requestedPartId,
            },
          })
        );
      } else if (requestedPartId === selectedPartId) {
        // Fallback to state for selected part if mesh not ready
        window.dispatchEvent(
          new CustomEvent('model-transform-updated', {
            detail: {
              position: modelTransform.position,
              rotation: modelTransform.rotation,
              partId: selectedPartId,
            },
          })
        );
      }
      // Note: If mesh isn't found and it's not selected, we skip - the ModelMesh 
      // will emit its own transform when it mounts via the useEffect
    };

    window.addEventListener('set-model-transform', handleSetTransform as EventListener);
    window.addEventListener('request-model-transform', handleRequestTransform as EventListener);

    return () => {
      window.removeEventListener('set-model-transform', handleSetTransform as EventListener);
      window.removeEventListener('request-model-transform', handleRequestTransform as EventListener);
    };
  }, [modelTransform, setModelTransform, selectedPartId]);

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
      if (importedParts.length > 0) {
        // Reset camera to isometric view position based on model size and units
        setCurrentOrientation('iso');
        updateCamera('iso', modelBounds);
      } else {
        // Reset camera to default isometric position (no model loaded)
        setCurrentOrientation('iso');
        updateCamera('iso', null);
      }

      // Clear baseplate and supports when resetting
      setBasePlate(null);
      setSupports([]);
      setSupportsTrimPreview([]);
      editingSupportRef.current = null;
      setEditingSupport(null);
    };

    window.addEventListener('viewer-reset', handleViewReset as EventListener);
    return () => window.removeEventListener('viewer-reset', handleViewReset as EventListener);
  }, [camera, importedParts.length, updateCamera, modelBounds]);

  // Handle view orientation events
  React.useEffect(() => {
    const handleViewOrientation = (e: CustomEvent) => {
      const orientation = e.detail;

      if (importedParts.length > 0) {
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
  }, [camera, importedParts.length, updateCamera, modelBounds]);

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

      {/* Scalable grid - sized based on combined model bounds (includes world positions) */}
      <ScalableGrid modelBounds={modelBounds} isDarkMode={isDarkMode} />

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
          modelGeometries={basePlate.type === 'convex-hull' && importedParts.length > 0 ? (() => {
            // Collect geometries and matrices from ALL imported parts
            const geometries: Array<{geometry: THREE.BufferGeometry, matrixWorld?: THREE.Matrix4}> = [];
            importedParts.forEach(part => {
              const partRef = modelMeshRefs.current.get(part.id);
              if (partRef?.current?.geometry) {
                geometries.push({
                  geometry: partRef.current.geometry,
                  matrixWorld: partRef.current.matrixWorld
                });
              }
            });
            return geometries;
          })() : undefined}
          modelOrigin={importedParts.length > 0 ? (() => {
            // Use center of combined bounding box for model origin
            let combinedBox: THREE.Box3 | null = null;
            importedParts.forEach(part => {
              const partRef = modelMeshRefs.current.get(part.id);
              if (partRef?.current) {
                const partBox = new THREE.Box3().setFromObject(partRef.current);
                if (!combinedBox) {
                  combinedBox = partBox;
                } else {
                  combinedBox.union(partBox);
                }
              }
            });
            if (combinedBox) {
              return combinedBox.getCenter(new THREE.Vector3());
            }
            const firstPartRef = modelMeshRefs.current.get(importedParts[0].id);
            return firstPartRef?.current?.position;
          })() : undefined}
          additionalHullPoints={basePlate.type === 'convex-hull' ? supportHullPoints : undefined}
          livePositionDelta={livePositionDelta}
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

      {/* Render all imported parts with transform controls */}
      {importedParts.map((part, index) => {
        const partMeshRef = getPartMeshRef(part.id);
        const isSelected = selectedPartId === part.id;
        const isVisible = partVisibility.get(part.id) !== false; // default to visible
        
        // Use stored offset if available, otherwise calculate and store new offset
        let initialOffset = partInitialOffsetsRef.current.get(part.id);
        if (!initialOffset && index > 0) {
          const partDims = part.metadata.dimensions;
          const spacing = partDims ? Math.max(partDims.x, partDims.z) * 1.5 : 100;
          initialOffset = new THREE.Vector3(spacing * index, 0, 0);
          partInitialOffsetsRef.current.set(part.id, initialOffset);
        }
        
        return (
          <SelectableTransformControls
            key={part.id}
            meshRef={partMeshRef}
            enabled={isSelected && isVisible} // Disable controls when hidden
            partId={part.id}
            onLiveTransformChange={isSelected && isVisible ? handleLiveTransformChange : undefined}
          >
            <group visible={isVisible}>
              <ModelMesh
                file={part}
                meshRef={partMeshRef}
                dimensions={modelDimensions}
                colorsMap={modelColors}
                setColorsMap={setModelColors}
                initialOffset={initialOffset}
                onBoundsChange={(bounds) => {
                  setPartBounds(prev => new Map(prev).set(part.id, bounds));
                }}
                disableDoubleClick={placing.active || editingSupport !== null || !isVisible}
                onDoubleClick={() => {
                  if (isVisible) {
                    onPartSelected(part.id);
                    window.dispatchEvent(new CustomEvent('mesh-double-click', { detail: { partId: part.id } }));
                  }
                }}
              />
            </group>
          </SelectableTransformControls>
        );
      })}

      {/* Placed fixture components */}
      {placedComponents.map((item) => (
        <FixtureComponent
          key={item.id}
          component={item.component}
          position={item.position}
          onSelect={() => {}}
        />
      ))}

      {/* Supports rendering */}
      {supportsTrimPreview.length === 0
        ? supports.map((s) => <SupportMesh key={s.id} support={s} baseTopY={baseTopY} />)
        : supportsTrimPreview.map((mesh, idx) => <primitive key={`${mesh.uuid}-${idx}`} object={mesh} />)}

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
          raycastTargets={importedParts.map(part => {
            const ref = modelMeshRefs.current.get(part.id);
            return ref?.current;
          }).filter(Boolean) as THREE.Mesh[]}
          baseTopY={baseTopY}
          baseTarget={basePlateMeshRef.current}
          contactOffset={Number(placing.initParams?.contactOffset ?? 0)}
          maxRayHeight={2000}
          modelBounds={modelBounds ? { min: modelBounds.min, max: modelBounds.max } : null}
        />
      )}

      {/* Event handlers - use a ref to disable raycasting so it doesn't block model clicks */}
      <mesh
        ref={(mesh) => {
          if (mesh) {
            // Disable raycasting on this helper mesh
            mesh.raycast = () => {};
          }
        }}
        position={[0, -100, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
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
        <planeGeometry args={[10000, 10000]} />
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
        enableDamping={false}
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