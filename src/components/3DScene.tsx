import React, { useRef, useState, useCallback, useMemo, useEffect, Suspense } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls as DreiOrbitControls, Html, GizmoHelper, GizmoViewport, Line } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { BasePlate, MultiSectionDrawing, MultiSectionBasePlate, BasePlateTransformControls, mergeOverlappingSections } from '@/features/baseplate';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';
import { ProcessedFile, ViewOrientation } from "@/modules/FileImport/types";
import SelectableTransformControls from './SelectableTransformControls';
import * as THREE from 'three';
import {
  SupportPlacement,
  SupportMesh,
  buildFullSupportGeometry,
  SupportTransformControls,
  SupportType,
  AnySupport,
  getSupportFootprintBounds,
  getSupportFootprintPoints,
  FootprintBounds,
  autoPlaceSupports,
} from '@/features/supports';
import { CSGEngine } from '@/lib/csgEngine';
import { createOffsetMesh, extractVertices, csgSubtract, initManifold } from '@/lib/offset';
import { performBatchCSGSubtractionInWorker, performBatchCSGUnionInWorker, performHoleCSGInWorker } from '@/lib/workers';
import { decimateMesh, repairMesh, analyzeMesh, laplacianSmooth, cleanupCSGResult } from '@/modules/FileImport/services/meshAnalysisService';
import { LabelMesh, LabelTransformControls, LabelConfig } from '@/features/labels';
import { ClampMesh, ClampTransformControls, ClampWithSupport, PlacedClamp, ClampModel, getClampById } from '@/features/clamps';
import { HoleMesh, HolePlacement, HoleTransformControls, PlacedHole, HoleConfig, createMergedHolesGeometry } from '@/features/holes';

// ============================================================================
// Extracted 3DScene Modules (available for progressive migration)
// These exports provide modular alternatives to inline code below.
// See: src/components/3DScene/index.ts for full API
// ============================================================================
import {
  // Utilities
  computeDominantUpQuaternion as extractedComputeDominantUpQuaternion,
  getActualMinYFromMesh as extractedGetActualMinYFromMesh,
  getModelColor as extractedGetModelColor,
  MODEL_COLOR_PALETTE as extractedModelColorPalette,
  buildClampSupportGeometryAtOrigin as extractedBuildClampSupportGeometryAtOrigin,
  buildLabelGeometry as extractedBuildLabelGeometry,
  calculateGridConfig as extractedCalculateGridConfig,
  getFootprintMetrics as extractedGetFootprintMetrics,
  ORIENTATION_CONFIG,
  getProjectedSizeForOrientation,
  // Renderers
  ScalableGrid as ExtractedScalableGrid,
  DebugPerimeterLine as ExtractedDebugPerimeterLine,
  DebugSilhouetteLine as ExtractedDebugSilhouetteLine,
  FixtureComponent as ExtractedFixtureComponent,
  // State Hooks (for future use)
  useSupportState,
  useClampState,
  useLabelState,
  useHoleState,
  useBaseplateState,
  useSceneState,
  // Container
  Scene3DProvider,
  useScene3DContext,
} from './3DScene/index';
import type { BoundsSummary as ExtractedBoundsSummary } from './3DScene/index';

/** Target triangle count for offset mesh decimation */
const OFFSET_MESH_DECIMATION_TARGET = 50_000;

interface ThreeDSceneProps {
  importedParts: ProcessedFile[];
  selectedPartId: string | null;
  onPartSelected: (partId: string | null) => void;
  onModelColorAssigned?: (modelId: string, color: string) => void;
  partVisibility?: Map<string, boolean>;
  onPartVisibilityChange?: (partId: string, visible: boolean) => void;
  baseplateVisible?: boolean;
  isDarkMode?: boolean;
  selectedSupportId?: string | null;
  onSupportSelect?: (supportId: string | null) => void;
}

// Use extracted utility function (see src/components/3DScene/utils/geometryUtils.ts)
const computeDominantUpQuaternion = extractedComputeDominantUpQuaternion;

// Reusable temp vector for world position calculations (module-level)
const tempVec = new THREE.Vector3();

// Use extracted utility function (see src/components/3DScene/utils/geometryUtils.ts)
const getActualMinYFromMesh = extractedGetActualMinYFromMesh;

// Use extracted utility (see src/components/3DScene/utils/colorUtils.ts)
const modelColorPalette = extractedModelColorPalette;
const getModelColor = extractedGetModelColor;

// Use extracted utility (see src/components/3DScene/utils/csgUtils.ts)
const buildClampSupportGeometryAtOrigin = extractedBuildClampSupportGeometryAtOrigin;
const buildLabelGeometry = extractedBuildLabelGeometry;

// Use extracted renderer (see src/components/3DScene/renderers/ScalableGrid.tsx)
const ScalableGrid = ExtractedScalableGrid;

// Use extracted debug renderers (see src/components/3DScene/renderers/DebugVisualization.tsx)
const DebugPerimeterLine = ExtractedDebugPerimeterLine;
const DebugSilhouetteLine = ExtractedDebugSilhouetteLine;
const FixtureComponent = ExtractedFixtureComponent;

// Use extracted utility (see src/components/3DScene/utils/geometryUtils.ts)
const getFootprintMetrics = extractedGetFootprintMetrics;

// Use extracted type (see src/components/3DScene/types.ts)
type BoundsSummary = ExtractedBoundsSummary;

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

// Main 3D Scene Component
const ThreeDScene: React.FC<ThreeDSceneProps> = ({
  importedParts,
  selectedPartId,
  onPartSelected,
  onModelColorAssigned,
  partVisibility = new Map(),
  onPartVisibilityChange,
  baseplateVisible = true,
  isDarkMode = false,
  selectedSupportId,
  onSupportSelect,
}) => {
  const { camera, size, gl, scene } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  
  // Future: Component library for fixture elements (currently placeholder)
  const [placedComponents, setPlacedComponents] = useState<Array<{ component: unknown; position: THREE.Vector3; id: string }>>([]);
  const [selectedComponent, setSelectedComponent] = useState<unknown>(null);
  
  // Baseplate configuration state
  const [basePlate, setBasePlate] = useState<BasePlateConfig | null>(null);
  
  // Multi-section baseplate drawing state
  const [isMultiSectionDrawingMode, setIsMultiSectionDrawingMode] = useState(false);
  const [drawnSections, setDrawnSections] = useState<BasePlateSection[]>([]);
  const [multiSectionPadding, setMultiSectionPadding] = useState(0);
  
  // Store refs for each model mesh by part ID
  const modelMeshRefs = useRef<Map<string, React.RefObject<THREE.Mesh>>>(new Map());
  // Store initial offsets for each part (persists across renders to prevent position reset)
  const partInitialOffsetsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const basePlateMeshRef = useRef<THREE.Mesh>(null);
  const multiSectionBasePlateGroupRef = useRef<THREE.Group>(null);
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
  
  // Labels state
  const [labels, setLabels] = useState<LabelConfig[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const labelsRef = useRef<LabelConfig[]>([]); // Ref to track latest labels for async operations
  
  // Force bounds recalc when any item (support, clamp, label) is first added
  const [itemBoundsUpdateTrigger, setItemBoundsUpdateTrigger] = useState(0);
  
  // Keep labelsRef in sync with labels state
  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);
  
  // Clamps state
  const [placedClamps, setPlacedClamps] = useState<PlacedClamp[]>([]);
  const [selectedClampId, setSelectedClampId] = useState<string | null>(null);
  const [showClampDebug, setShowClampDebug] = useState(false); // Debug geometries disabled
  // Track minimum placement offsets for each clamp (from clamp-data-loaded events)
  const [clampMinOffsets, setClampMinOffsets] = useState<Map<string, number>>(new Map());
  // Track clamp support info for each clamp (for baseplate bounds calculation and collision)
  const [clampSupportInfos, setClampSupportInfos] = useState<Map<string, { 
    polygon: Array<[number, number]>; 
    localCenter: { x: number; y: number };
    fixturePointY?: number;
    mountSurfaceLocalY?: number;
  }>>(new Map());
  // Track loaded clamp data for CSG operations (fixture cutouts and support geometry)
  const loadedClampDataRef = useRef<Map<string, {
    fixtureCutoutsGeometry: THREE.BufferGeometry | null;
    fixturePointTopCenter: THREE.Vector3;
    supportInfo: { polygon: Array<[number, number]>; mountSurfaceLocalY: number; fixturePointY: number; } | null;
  }>>(new Map());
  
  // Debug: clamp placement debug points (closest boundary point, fixture point, support center)
  const [clampDebugPoints, setClampDebugPoints] = useState<{
    closestBoundaryPoint: { x: number; y: number; z: number };
    fixturePoint: { x: number; y: number; z: number };
    estimatedSupportCenter: { x: number; y: number; z: number };
    silhouette?: Array<{ x: number; z: number }>; // For red outline
  } | null>(null);
  // Ref to store debug points AND silhouette immediately (avoid async state issues)
  const clampDebugPointsRef = useRef<{
    closestBoundaryPoint: { x: number; y: number; z: number };
    fixturePoint: { x: number; y: number; z: number };
    estimatedSupportCenter: { x: number; y: number; z: number };
    silhouette: Array<{ x: number; z: number }>; // Store silhouette for 2D collision
  } | null>(null);
  
  // Clamp placement mode state
  const [clampPlacementMode, setClampPlacementMode] = useState<{
    active: boolean;
    clampModelId: string | null;
    clampCategory: string | null;
  }>({ active: false, clampModelId: null, clampCategory: null });
  // Cache for part silhouettes (computed once per placement session)
  const partSilhouetteRef = useRef<Array<{ x: number; z: number }> | null>(null);
  
  // Debug: perimeter visualization from auto-placement (disabled by default)
  // Set DEBUG_SHOW_PERIMETER to true to enable red boundary line visualization
  const DEBUG_SHOW_PERIMETER = false;
  const [debugPerimeter, setDebugPerimeter] = useState<Array<{ x: number; z: number }> | null>(null);
  
  // Debug: clamp silhouette visualization (for debugging clamp placement calculations)
  // Set DEBUG_SHOW_CLAMP_SILHOUETTE to true to enable cyan silhouette outline on baseplate
  const DEBUG_SHOW_CLAMP_SILHOUETTE = false;
  const [debugClampSilhouette, setDebugClampSilhouette] = useState<Array<{ x: number; z: number }> | null>(null);
  
  // Mounting holes state
  const [mountingHoles, setMountingHoles] = useState<PlacedHole[]>([]);
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null);
  const [editingHoleId, setEditingHoleId] = useState<string | null>(null);
  const isDraggingHoleRef = useRef(false); // Track if hole gizmo is being dragged
  const [isDraggingHole, setIsDraggingHole] = useState(false); // State version for multi-section baseplate
  const isDraggingSupportRef = useRef(false); // Track if support gizmo is being dragged (for CSG debounce)
  const isDraggingLabelRef = useRef(false); // Track if label gizmo is being dragged (for CSG debounce)
  const isDraggingClampRef = useRef(false); // Track if clamp gizmo is being dragged (for CSG debounce)
  const [isDraggingAnyItem, setIsDraggingAnyItem] = useState(false); // Combined state for all drag operations
  const [holePlacementMode, setHolePlacementMode] = useState<{
    active: boolean;
    config: HoleConfig | null;
    depth: number;
  }>({ active: false, config: null, depth: 20 });
  const [holeSnapEnabled, setHoleSnapEnabled] = useState(true); // Snap to alignment enabled by default
  
  // Multi-section baseplate selection state (for feature placement)
  const [selectedBasePlateSectionId, setSelectedBasePlateSectionId] = useState<string | null>(null);
  const [editingBasePlateSectionId, setEditingBasePlateSectionId] = useState<string | null>(null);
  const isDraggingBasePlateSectionRef = useRef(false); // Track if section gizmo is being dragged
  const [waitingForSectionSelection, setWaitingForSectionSelection] = useState(false); // Track if user needs to select section first
  const [waitingForClampSectionSelection, setWaitingForClampSectionSelection] = useState(false); // Track if waiting for section during clamp placement
  const [waitingForLabelSectionSelection, setWaitingForLabelSectionSelection] = useState(false); // Track if waiting for section during label placement
  const [waitingForHoleSectionSelection, setWaitingForHoleSectionSelection] = useState(false); // Track if waiting for section during hole placement
  const [pendingLabelConfig, setPendingLabelConfig] = useState<LabelConfig | null>(null); // Store label config while waiting for section
  const [pendingHoleConfig, setPendingHoleConfig] = useState<{ config: HoleConfig; depth: number } | null>(null); // Store hole config while waiting for section
  
  // Support snap alignment state
  const [supportSnapEnabled, setSupportSnapEnabled] = useState(true); // Snap to alignment enabled by default
  
  // Cavity operations preview (for CSG operations)
  const [cavityPreview, setCavityPreview] = useState<THREE.Mesh | null>(null);
  
  // Offset mesh previews (for visualizing the cavity cutting brush before CSG)
  // Map from part ID to its offset mesh preview - supports multiple parts
  const [offsetMeshPreviews, setOffsetMeshPreviews] = useState<Map<string, THREE.Mesh>>(new Map());
  const [offsetMeshProcessing, setOffsetMeshProcessing] = useState(false);
  const [showOffsetPreview, setShowOffsetPreview] = useState(true); // Controls visibility of the offset mesh preview
  
  // Modified support geometries (after cavity subtraction)
  // Map from support ID to modified BufferGeometry
  const [modifiedSupportGeometries, setModifiedSupportGeometries] = useState<Map<string, THREE.BufferGeometry>>(new Map());
  const [cavitySubtractionProcessing, setCavitySubtractionProcessing] = useState(false);
  
  // Merged fixture mesh (baseplate + cut supports combined via CSG union)
  const [mergedFixtureMesh, setMergedFixtureMesh] = useState<THREE.Mesh | null>(null);
  
  // Modified baseplate geometry with holes cut out (for immediate visual feedback)
  const [baseplateWithHoles, setBaseplateWithHoles] = useState<THREE.BufferGeometry | null>(null);
  const [holeCSGProcessing, setHoleCSGProcessing] = useState(false);
  // Flag to trigger CSG update (only when hole editing ends or hole is placed)
  const [holeCSGTrigger, setHoleCSGTrigger] = useState(0);
  // Cache original baseplate geometry for CSG operations
  // This is needed because when baseplateWithHoles exists, the original BasePlate is hidden
  // and basePlateMeshRef points to the CSG result mesh, not the original
  const originalBaseplateGeoRef = useRef<THREE.BufferGeometry | null>(null);
  // Ref to track latest mountingHoles for CSG effect (avoids stale closure)
  const mountingHolesRef = useRef(mountingHoles);
  mountingHolesRef.current = mountingHoles;
  
  // Support editing ref (kept for cleanup in event handlers)
  const editingSupportRef = useRef<AnySupport | null>(null);
  
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

  // Calculate label footprint points for baseplate expansion
  // Labels need the baseplate to extend underneath them
  const prevLabelHullPointsRef = useRef<Array<{x: number; z: number}>>([]);
  const labelHullPoints = useMemo(() => {
    const points: Array<{x: number; z: number}> = [];
    // Add margin to label footprint (same as FILLET_RADIUS used for supports)
    const LABEL_MARGIN = 2.0;
    
    for (const label of labels) {
      // Use actual computed bounds from rendered geometry if available,
      // otherwise fall back to estimates
      let textWidth: number;
      let textHeight: number;
      
      if (label.computedWidth !== undefined && label.computedHeight !== undefined) {
        // Use actual computed dimensions from LabelMesh
        textWidth = label.computedWidth;
        textHeight = label.computedHeight;
      } else {
        // Fall back to estimates until geometry is rendered
        const charWidthFactor = 0.65;
        textWidth = label.text.length * label.fontSize * charWidthFactor;
        textHeight = label.fontSize * 0.8;
      }
      
      const pos = label.position;
      // Add margin to match support fillet margin for consistent baseplate extension
      
      // Get label's rotation around Y axis (which is Z rotation when label is flat)
      // Label lies flat with X rotation of -PI/2, so its "spin" is stored in rotation.z
      const rot = label.rotation;
      const rotationAngle = typeof rot === 'object' ? ((rot as any).z || 0) : 0;
      
      // Label lies flat with rotation.x = -PI/2, which flips the Y axis:
      // - Text width runs along world X
      // - Text height (font size) runs along world -Z (inverted)
      // Add LABEL_MARGIN to dimensions (same as supports use FILLET_RADIUS)
      const halfW = textWidth / 2 + LABEL_MARGIN;
      const halfH = textHeight / 2 + LABEL_MARGIN;
      
      // Define corner points in the world XZ plane (accounting for the Y flip)
      // In local label space: +localY (font height "up") maps to world -Z
      const localCorners = [
        { x: -halfW, z:  halfH },  // local bottom-left  → world: -X, +Z (front-left)
        { x:  halfW, z:  halfH },  // local bottom-right → world: +X, +Z (front-right)  
        { x:  halfW, z: -halfH },  // local top-right    → world: +X, -Z (back-right)
        { x: -halfW, z: -halfH }   // local top-left     → world: -X, -Z (back-left)
      ];
      
      // Rotate corners and translate to world position
      // Use same rotation formula as supports (Three.js Y-rotation)
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);
      for (const corner of localCorners) {
        // Three.js Y-rotation: x' = x*cos + z*sin, z' = -x*sin + z*cos
        const rx = corner.x * cos + corner.z * sin;
        const rz = -corner.x * sin + corner.z * cos;
        // Translate to world position
        points.push({
          x: (pos as any).x + rx,
          z: (pos as any).z + rz
        });
      }
    }
    
    // Check if points are the same as before
    const prev = prevLabelHullPointsRef.current;
    if (prev.length === points.length) {
      let same = true;
      for (let i = 0; i < points.length && same; i++) {
        if (Math.abs(prev[i].x - points[i].x) > 0.001 || Math.abs(prev[i].z - points[i].z) > 0.001) {
          same = false;
        }
      }
      if (same) return prev;
    }
    
    prevLabelHullPointsRef.current = points;
    return points;
  }, [labels]);

  // Calculate clamp support footprint points for convex hull calculation
  const prevClampSupportHullPointsRef = useRef<Array<{x: number; z: number}>>([]);
  const clampSupportHullPoints = useMemo(() => {
    const points: Array<{x: number; z: number}> = [];
    
    for (const placedClamp of placedClamps) {
      const supportInfo = clampSupportInfos.get(placedClamp.id);
      if (!supportInfo) continue;
      
      // Transform polygon from clamp local space to world space
      const rotationY = THREE.MathUtils.degToRad(placedClamp.rotation.y);
      const cosR = Math.cos(rotationY);
      const sinR = Math.sin(rotationY);
      
      for (const [localX, localZ] of supportInfo.polygon) {
        // Apply Y-axis rotation and add clamp position
        const worldX = localX * cosR + localZ * sinR + placedClamp.position.x;
        const worldZ = -localX * sinR + localZ * cosR + placedClamp.position.z;
        points.push({ x: worldX, z: worldZ });
      }
    }
    
    // Check if points are the same as before to avoid unnecessary updates
    const prev = prevClampSupportHullPointsRef.current;
    if (prev.length === points.length) {
      let same = true;
      for (let i = 0; i < points.length && same; i++) {
        if (Math.abs(prev[i].x - points[i].x) > 0.001 || Math.abs(prev[i].z - points[i].z) > 0.001) {
          same = false;
        }
      }
      if (same) return prev; // Return the cached array to avoid triggering downstream updates
    }
    
    prevClampSupportHullPointsRef.current = points;
    return points;
  }, [placedClamps, clampSupportInfos]);

  // Calculate mounting hole footprint points for baseplate expansion
  const HOLE_MARGIN = 3.0;
  const POINTS_PER_HOLE = 8;
  const prevHoleHullPointsRef = useRef<Array<{ x: number; z: number }>>([]);

  const holeHullPoints = useMemo(() => {
    const points: Array<{ x: number; z: number }> = [];

    for (const hole of mountingHoles) {
      const holeX = Number(hole.position?.x) || 0;
      const holeZ = Number(hole.position?.y) || 0;
      const radius = (Number(hole.diameter) || 6) / 2;
      const outerRadius = radius + HOLE_MARGIN;

      for (let i = 0; i < POINTS_PER_HOLE; i++) {
        const angle = (i / POINTS_PER_HOLE) * Math.PI * 2;
        points.push({
          x: holeX + Math.cos(angle) * outerRadius,
          z: holeZ + Math.sin(angle) * outerRadius,
        });
      }
    }

    // Avoid unnecessary updates if points unchanged
    const prev = prevHoleHullPointsRef.current;
    if (prev.length === points.length) {
      const isEqual = points.every(
        (pt, i) =>
          Math.abs(prev[i].x - pt.x) <= 0.001 && Math.abs(prev[i].z - pt.z) <= 0.001
      );
      if (isEqual) return prev;
    }

    prevHoleHullPointsRef.current = points;
    return points;
  }, [mountingHoles]);

  // Combined hull points for baseplate (supports + labels + clamp supports + holes)
  const combinedHullPoints = useMemo(() => {
    return [...supportHullPoints, ...labelHullPoints, ...clampSupportHullPoints, ...holeHullPoints];
  }, [supportHullPoints, labelHullPoints, clampSupportHullPoints, holeHullPoints]);

  const csgEngineRef = useRef<CSGEngine | null>(null);
  if (!csgEngineRef.current) {
    csgEngineRef.current = new CSGEngine();
  }

  // Ensure supports use the baseplate TOP surface, not bottom: compute baseTopY from world bbox
  // When baseplate is not visible, use the configured depth value as fallback
  React.useEffect(() => {
    const updateTopY = () => {
      const mesh = basePlateMeshRef.current;
      const multiSectionGroup = multiSectionBasePlateGroupRef.current;
      // Fallback to basePlate.depth when mesh is not visible
      const fallbackTopY = basePlate?.depth ?? 5;
      
      // For multi-section baseplates, use the group
      if (multiSectionGroup && basePlate?.type === 'multi-section') {
        multiSectionGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(multiSectionGroup);
        if (!box.isEmpty()) {
          const newTopY = box.max.y;
          setBaseTopY(prev => Math.abs(prev - newTopY) < 0.001 ? prev : newTopY);
          return;
        }
      }
      
      if (!mesh) { 
        setBaseTopY(prev => Math.abs(prev - fallbackTopY) < 0.001 ? prev : fallbackTopY); 
        return; 
      }
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) { 
        setBaseTopY(prev => Math.abs(prev - fallbackTopY) < 0.001 ? prev : fallbackTopY); 
        return; 
      }
      const newTopY = box.max.y;
      // Only update if the value actually changed (with small tolerance)
      setBaseTopY(prev => Math.abs(prev - newTopY) < 0.001 ? prev : newTopY);
    };
    updateTopY();
    const id = setInterval(updateTopY, 250);
    return () => clearInterval(id);
  }, [basePlate?.depth, basePlate?.type]);

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

  // Listen for offset mesh preview generation requests - processes ALL parts sequentially
  React.useEffect(() => {
    const handleGenerateOffsetMesh = async (e: CustomEvent) => {
      const { settings } = e.detail || {};
      if (!settings || !settings.enabled) {
        // Clear all offset mesh previews
        offsetMeshPreviews.forEach(mesh => {
          mesh.geometry?.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(m => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        });
        setOffsetMeshPreviews(new Map());
        return;
      }

      if (importedParts.length === 0) {
        console.warn('[3DScene] Cannot generate offset mesh: no parts loaded');
        setOffsetMeshPreviews(new Map());
        return;
      }

      setOffsetMeshProcessing(true);
      
      // Calculate how much to move the parts up to achieve clearance from baseplate
      // The goal is to have at least `clearanceTolerance` gap between part bottom and baseplate top
      const clearanceTolerance = settings.offsetDistance ?? 0.5;
      
      // Find the lowest point across all parts
      let globalMinY = Infinity;
      for (const part of importedParts) {
        const partRef = modelMeshRefs.current.get(part.id);
        const modelMesh = partRef?.current;
        if (!modelMesh) continue;
        
        modelMesh.updateMatrixWorld(true);
        const geometry = modelMesh.geometry as THREE.BufferGeometry;
        const tempGeometry = geometry.clone();
        tempGeometry.applyMatrix4(modelMesh.matrixWorld);
        tempGeometry.computeBoundingBox();
        const partMinY = tempGeometry.boundingBox?.min.y ?? baseTopY;
        tempGeometry.dispose();
        
        globalMinY = Math.min(globalMinY, partMinY);
      }
      
      if (globalMinY === Infinity) globalMinY = baseTopY;
      
      // Calculate current gap between lowest part and baseplate top
      const currentGap = globalMinY - baseTopY;
      
      // Determine how much to move up:
      // - If currentGap >= clearanceTolerance: no movement needed (already has enough clearance)
      // - If currentGap < clearanceTolerance: move up by (clearanceTolerance - currentGap)
      const moveUpAmount = Math.max(0, clearanceTolerance - currentGap);
      
      if (moveUpAmount > 0) {
        // Move ALL parts UP by the calculated amount
        importedParts.forEach(part => {
          const partRef = modelMeshRefs.current.get(part.id);
          if (partRef?.current) {
            partRef.current.position.y += moveUpAmount;
            partRef.current.updateMatrixWorld(true);
          }
        });
        
        // Extend all support heights by the same amount
        // This ensures supports still reach the (now elevated) parts
        setSupports(prev => prev.map(s => ({
          ...s,
          height: (s as any).height + moveUpAmount
        } as AnySupport)));
        
        // Move all clamps UP by the same amount
        // This ensures clamps maintain their relative position to the elevated parts
        setPlacedClamps(prev => prev.map(c => ({
          ...c,
          position: { ...c.position, y: c.position.y + moveUpAmount }
        })));
      }

      // Process each part sequentially to generate offset meshes
      const newOffsetMeshes = new Map<string, THREE.Mesh>();
      const totalParts = importedParts.length;
      let processedParts = 0;

      try {
        for (const part of importedParts) {
          const partRef = modelMeshRefs.current.get(part.id);
          const modelMesh = partRef?.current;
          if (!modelMesh) {
            console.warn(`[3DScene] Skipping part ${part.id}: no mesh found`);
            continue;
          }

          console.log(`[3DScene] Processing offset mesh for part ${processedParts + 1}/${totalParts}: ${part.metadata?.name || part.id}`);
          
          // Dispatch progress for this part
          window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
            detail: { 
              current: processedParts, 
              total: totalParts, 
              stage: `Processing part ${processedParts + 1}/${totalParts}...` 
            }
          }));

          // Update world matrix to ensure transforms are current
          modelMesh.updateMatrixWorld(true);

          // Get the geometry and extract vertices
          const geometry = modelMesh.geometry as THREE.BufferGeometry;
          
          // We need to apply the world transform to the vertices before processing
          // Create a clone of the geometry with world-space vertices
          const worldGeometry = geometry.clone();
          worldGeometry.applyMatrix4(modelMesh.matrixWorld);
          
          const vertices = extractVertices(worldGeometry);
          
          // Calculate safe resolution
          worldGeometry.computeBoundingBox();
          const box = worldGeometry.boundingBox ?? new THREE.Box3();
          const size = box.getSize(new THREE.Vector3());
          const span = Math.max(size.x, size.y, size.z);
          
          // Clamp pixelsPerUnit to avoid GPU memory issues
          const requestedPPU = settings.pixelsPerUnit ?? 6;
          const safePPU = Math.min(requestedPPU, 8);
          const estimatedPixels = span * safePPU;
          
          if (!Number.isFinite(estimatedPixels) || estimatedPixels > 2000) {
            console.warn(`[3DScene] Offset mesh resolution clamped for GPU limits (part ${part.id})`);
          }

          // Yield to browser before heavy computation
          await new Promise(resolve => setTimeout(resolve, 0));

          // Generate the offset mesh with user settings
          const result = await createOffsetMesh(vertices, {
            offsetDistance: settings.offsetDistance ?? 0.5,
            pixelsPerUnit: Math.min(safePPU, 2000 / span),
            rotationXZ: settings.rotationXZ ?? 0,
            rotationYZ: settings.rotationYZ ?? 0,
            fillHoles: settings.fillHoles ?? true,
            progressCallback: (current, total, stage) => {
              // Dispatch progress event for UI updates (scale to part progress)
              const partProgress = (processedParts + (current / total)) / totalParts;
              window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
                detail: { 
                  current: Math.round(partProgress * 100), 
                  total: 100, 
                  stage: `Part ${processedParts + 1}/${totalParts}: ${stage}` 
                }
              }));
            },
          });

          // Yield to browser after heavy computation
          await new Promise(resolve => setTimeout(resolve, 0));

          if (result.geometry) {
            let finalGeometry = result.geometry;
            let finalTriangleCount = result.metadata.triangleCount;
            
            // Process offset mesh based on settings
            const shouldDecimate = settings.enableDecimation !== false && result.metadata.triangleCount > OFFSET_MESH_DECIMATION_TARGET;
            const shouldSmooth = settings.enableSmoothing !== false;
            
            if (shouldDecimate || shouldSmooth) {
              let currentGeometry = result.geometry;
              
              // === Step 1: Decimation (if enabled and needed) ===
              if (shouldDecimate) {
                window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
                  detail: { 
                    current: Math.round((processedParts + 0.7) / totalParts * 100), 
                    total: 100, 
                    stage: `Part ${processedParts + 1}/${totalParts}: Decimating mesh...` 
                  }
                }));
                
                // Yield to browser before decimation
                await new Promise(resolve => setTimeout(resolve, 0));
                
                // decimateMesh expects non-indexed geometry, so convert if needed
                let geometryToDecimate = currentGeometry;
                if (currentGeometry.index) {
                  geometryToDecimate = currentGeometry.toNonIndexed();
                  currentGeometry.dispose();
                  currentGeometry = geometryToDecimate;
                }
                
                const decimationResult = await decimateMesh(
                  geometryToDecimate,
                  OFFSET_MESH_DECIMATION_TARGET
                );
                
                if (decimationResult.success && decimationResult.geometry) {
                  currentGeometry.dispose();
                  currentGeometry = decimationResult.geometry;
                  finalTriangleCount = Math.round(decimationResult.finalTriangles);
                }
              }
              
              // === Step 2: Smoothing (if enabled) ===
              if (shouldSmooth) {
                const iterations = settings.smoothingIterations ?? 10;
                const strength = settings.smoothingStrength ?? 0;
                const quality = settings.smoothingQuality ?? true;
                const debugColors = settings.debugSmoothingColors ?? false;
                const tiltXZ = settings.rotationXZ ?? 0;
                const tiltYZ = settings.rotationYZ ?? 0;
                
                const strengthLabel = strength === 0 ? 'Taubin' : strength === 1 ? 'Laplacian' : `${(strength * 100).toFixed(0)}%`;
                
                window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
                  detail: { 
                    current: Math.round((processedParts + 0.85) / totalParts * 100), 
                    total: 100, 
                    stage: `Part ${processedParts + 1}/${totalParts}: Smoothing mesh (${iterations} iter, ${strengthLabel})...` 
                  }
                }));
                
                // Yield to browser before smoothing
                await new Promise(resolve => setTimeout(resolve, 0));
                
                // Use blended Taubin/Laplacian smoothing based on trCAD approach
                // Pass tilt angles so smoothing can classify vertices correctly
                const smoothingResult = await laplacianSmooth(
                  currentGeometry,
                  {
                    iterations,
                    strength,
                    quality,
                    debugColors,
                    tiltXZ,
                    tiltYZ,
                  }
                );
                
                if (smoothingResult.success && smoothingResult.geometry) {
                  currentGeometry.dispose();
                  currentGeometry = smoothingResult.geometry;
                  // Update triangle count after smoothing (smoothing outputs non-indexed)
                  finalTriangleCount = Math.round(currentGeometry.getAttribute('position').count / 3);
                }
              }
              
              finalGeometry = currentGeometry;
            }
            
            // Check if geometry has vertex colors (from debug mode)
            const hasVertexColors = finalGeometry.hasAttribute('color');
            
            // Create preview material - use vertex colors for debug, or translucent blue normally
            const previewMaterial = hasVertexColors
              ? new THREE.MeshBasicMaterial({
                  vertexColors: true,
                  transparent: true,
                  opacity: settings.previewOpacity ?? 0.8, // Higher opacity for debug colors
                  side: THREE.DoubleSide,
                  depthWrite: false,
                })
              : new THREE.MeshStandardMaterial({
                  color: 0x3b82f6, // Blue-500 for visibility
                  transparent: true,
                  opacity: settings.previewOpacity ?? 0.3,
                  side: THREE.DoubleSide,
                  depthWrite: false,
                  roughness: 0.5,
                  metalness: 0.1,
                });
            
            if (hasVertexColors) {
              console.log('[3DScene] Debug colors enabled - vertex classification visualization:');
              console.log('  RED: WALL vertices (smoothed in X-Z)');
              console.log('  GREEN: TOP_SURFACE_BOUNDARY vertices (smoothed in X-Z)');
              console.log('  BLUE: TOP_SURFACE_INTERIOR vertices (NOT smoothed)');
              console.log('  YELLOW: BOTTOM_SURFACE vertices (NOT smoothed)');
            }

            const previewMesh = new THREE.Mesh(finalGeometry, previewMaterial);
            
            // The offset mesh is already in world space (we applied the transform before processing)
            // No need to apply transform again
            previewMesh.name = `offset-mesh-preview-${part.id}`;
            
            console.log(`[3DScene] Offset mesh generated for part ${part.id}: ${finalTriangleCount} triangles in ${result.metadata.processingTime.toFixed(0)}ms`);
            
            newOffsetMeshes.set(part.id, previewMesh);
            
            // INCREMENTAL UPDATE: Show this offset mesh immediately as it's ready
            // This provides visual feedback while other parts are still processing
            setOffsetMeshPreviews(prev => {
              const updated = new Map(prev);
              updated.set(part.id, previewMesh);
              return updated;
            });
          } else {
            console.warn(`[3DScene] Offset mesh generation returned no geometry for part ${part.id}`);
          }

          // Clean up cloned geometry
          worldGeometry.dispose();
          processedParts++;
        }

        // All parts processed - dispose any old meshes that are no longer needed
        // (meshes from parts that were removed)
        offsetMeshPreviews.forEach((mesh, partId) => {
          if (!newOffsetMeshes.has(partId)) {
            mesh.geometry?.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
              } else {
                mesh.material.dispose();
              }
            }
          }
        });
        
        // Final state is already set incrementally, but ensure consistency
        setOffsetMeshPreviews(newOffsetMeshes);
        
        // Notify completion
        window.dispatchEvent(new CustomEvent('offset-mesh-preview-complete', { 
          detail: { success: true, partsProcessed: newOffsetMeshes.size, totalParts } 
        }));
        
        console.log(`[3DScene] Offset mesh generation complete: ${newOffsetMeshes.size}/${totalParts} parts processed`);
        
      } catch (err) {
        console.error('[3DScene] Failed to generate offset mesh preview:', err);
        // Clear any partial results
        newOffsetMeshes.forEach(mesh => {
          mesh.geometry?.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(m => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        });
        setOffsetMeshPreviews(new Map());
        window.dispatchEvent(new CustomEvent('offset-mesh-preview-complete', { 
          detail: { success: false, error: err } 
        }));
      } finally {
        setOffsetMeshProcessing(false);
      }
    };

    const handleClearOffsetMesh = () => {
      offsetMeshPreviews.forEach(mesh => {
        mesh.geometry?.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      setOffsetMeshPreviews(new Map());
    };

    const handleToggleOffsetPreview = (e: CustomEvent<{ visible: boolean }>) => {
      setShowOffsetPreview(e.detail.visible);
    };

    window.addEventListener('generate-offset-mesh-preview', handleGenerateOffsetMesh as EventListener);
    window.addEventListener('clear-offset-mesh-preview', handleClearOffsetMesh as EventListener);
    window.addEventListener('toggle-offset-preview', handleToggleOffsetPreview as EventListener);
    
    return () => {
      window.removeEventListener('generate-offset-mesh-preview', handleGenerateOffsetMesh as EventListener);
      window.removeEventListener('clear-offset-mesh-preview', handleClearOffsetMesh as EventListener);
      window.removeEventListener('toggle-offset-preview', handleToggleOffsetPreview as EventListener);
    };
  }, [importedParts, offsetMeshPreviews]);

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

      // For multi-section baseplates, require section selection only if none selected
      if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
        // Don't start placement yet, wait for section selection
        setWaitingForSectionSelection(true);
        // Store the type and params for later
        setPlacing({ active: false, type: type as SupportType, initParams: params || {} });
        // Switch to top view for section selection
        prevOrientationRef.current = currentOrientation;
        setCurrentOrientation('top');
        updateCamera('top', modelBounds);
        return;
      }

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
      setWaitingForSectionSelection(false);
      // restore previous view
      setCurrentOrientation(prevOrientationRef.current);
      updateCamera(prevOrientationRef.current, modelBounds);
      // Clear any editing state
      editingSupportRef.current = null;
    };
    const handleSupportSnapEnabledChanged = (e: CustomEvent) => {
      setSupportSnapEnabled(e.detail.enabled);
    };
    window.addEventListener('supports-start-placement', handleStartPlacement as EventListener);
    window.addEventListener('supports-cancel-placement', handleCancelPlacement as EventListener);
    window.addEventListener('support-snap-enabled-changed', handleSupportSnapEnabledChanged as EventListener);
    return () => {
      window.removeEventListener('supports-start-placement', handleStartPlacement as EventListener);
      window.removeEventListener('supports-cancel-placement', handleCancelPlacement as EventListener);
      window.removeEventListener('support-snap-enabled-changed', handleSupportSnapEnabledChanged as EventListener);
    };
  }, [currentOrientation, updateCamera, modelBounds, basePlate, selectedBasePlateSectionId]);

  // Listen for mounting hole placement start/cancel
  React.useEffect(() => {
    const handleStartHolePlacement = (e: CustomEvent) => {
      const { config, depth } = e.detail as { config: HoleConfig; depth: number };
      
      // For multi-section baseplates, require section selection first
      if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
        setWaitingForHoleSectionSelection(true);
        setPendingHoleConfig({ config, depth });
        return;
      }
      
      // Disable orbit controls during placement
      setOrbitControlsEnabled(false);
      
      // Switch to top view for placement
      prevOrientationRef.current = currentOrientation;
      setCurrentOrientation('top');
      updateCamera('top', modelBounds);
      
      // Use depth from event (baseplate thickness) or fallback to basePlate state
      const holeDepth = depth ?? basePlate?.depth ?? 20;
      setHolePlacementMode({ active: true, config, depth: holeDepth });
    };
    
    const handleCancelHolePlacement = () => {
      setHolePlacementMode({ active: false, config: null, depth: 20 });
      setOrbitControlsEnabled(true);
      // restore previous view
      setCurrentOrientation(prevOrientationRef.current);
      updateCamera(prevOrientationRef.current, modelBounds);
    };
    
    const handleSnapEnabledChanged = (e: CustomEvent) => {
      setHoleSnapEnabled(e.detail.enabled);
    };
    
    window.addEventListener('hole-start-placement', handleStartHolePlacement as EventListener);
    window.addEventListener('hole-cancel-placement', handleCancelHolePlacement as EventListener);
    window.addEventListener('hole-snap-enabled-changed', handleSnapEnabledChanged as EventListener);
    
    return () => {
      window.removeEventListener('hole-start-placement', handleStartHolePlacement as EventListener);
      window.removeEventListener('hole-cancel-placement', handleCancelHolePlacement as EventListener);
      window.removeEventListener('hole-snap-enabled-changed', handleSnapEnabledChanged as EventListener);
    };
  }, [currentOrientation, updateCamera, modelBounds, basePlate?.depth, basePlate?.type, selectedBasePlateSectionId]);

  // DOM-level click handler for section selection during support placement
  // This allows clicking through parts/supports/clamps to select baseplate sections
  useEffect(() => {
    if (!waitingForSectionSelection) return;

    const handleCanvasClick = (event: MouseEvent) => {
      if (!basePlate?.type === 'multi-section' || !basePlate.sections) return;

      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      raycasterRef.current.setFromCamera(mouse, camera);

      // Get all baseplate section meshes by traversing the scene
      const baseplateObjects: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.userData.isBaseplateSection) {
          baseplateObjects.push(obj);
        }
      });

      if (baseplateObjects.length > 0) {
        // Raycast only against baseplate sections (ignoring parts/supports/clamps)
        const baseplateIntersects = raycasterRef.current.intersectObjects(baseplateObjects, false);
        if (baseplateIntersects.length > 0) {
          const sectionMesh = baseplateIntersects[0].object;
          const sectionId = sectionMesh.userData.sectionId;
          if (sectionId) {
            setSelectedBasePlateSectionId(sectionId);
            window.dispatchEvent(new CustomEvent('baseplate-section-selected', {
              detail: { sectionId }
            }));
          }
        }
      }
    };

    gl.domElement.addEventListener('click', handleCanvasClick);
    return () => gl.domElement.removeEventListener('click', handleCanvasClick);
  }, [waitingForSectionSelection, basePlate, gl, camera, scene]);

  // Handle section selection when waiting for it during support placement
  useEffect(() => {
    if (waitingForSectionSelection && selectedBasePlateSectionId && placing.type) {
      // Section selected, now start support placement
      setWaitingForSectionSelection(false);
      setOrbitControlsEnabled(false);
      setPlacing({ active: true, type: placing.type, initParams: placing.initParams });
    }
  }, [waitingForSectionSelection, selectedBasePlateSectionId, placing.type, placing.initParams]);

  // Handle ESC key to cancel section selection
  useEffect(() => {
    if (!waitingForSectionSelection) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWaitingForSectionSelection(false);
        setPlacing({ active: false, type: null, initParams: {} });
        setOrbitControlsEnabled(true);
        // Restore previous view
        setCurrentOrientation(prevOrientationRef.current);
        updateCamera(prevOrientationRef.current, modelBounds);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [waitingForSectionSelection, updateCamera, modelBounds]);

  // Handle section selection when waiting for it during clamp placement
  useEffect(() => {
    if (waitingForClampSectionSelection && selectedBasePlateSectionId && clampPlacementMode.clampModelId) {
      console.log('[ClampPlacement] Section selected, starting placement');
      setWaitingForClampSectionSelection(false);
      
      const { clampModelId, clampCategory } = clampPlacementMode;
      
      // Compute part silhouette for placement
      const meshes = importedParts
        .map(p => modelMeshRefs.current.get(p.id)?.current)
        .filter((m): m is THREE.Mesh => m !== null);
      
      if (meshes.length > 0) {
        import('@/features/clamps/utils/clampPlacement').then(({ computePartSilhouetteForClamps }) => {
          const silhouette = computePartSilhouetteForClamps(meshes, baseTopY);
          partSilhouetteRef.current = silhouette;
          
          if (DEBUG_SHOW_CLAMP_SILHOUETTE) {
            setDebugClampSilhouette(silhouette);
          }
        });
      }
      
      setClampPlacementMode({
        active: true,
        clampModelId,
        clampCategory
      });
      
      // Deselect any currently selected item
      onPartSelected(null);
      onSupportSelect?.(null);
      setSelectedClampId(null);
    }
  }, [waitingForClampSectionSelection, selectedBasePlateSectionId, clampPlacementMode, importedParts, baseTopY, onPartSelected, onSupportSelect]);

  // Handle ESC key to cancel clamp section selection
  useEffect(() => {
    if (!waitingForClampSectionSelection) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWaitingForClampSectionSelection(false);
        setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
        partSilhouetteRef.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [waitingForClampSectionSelection]);

  // Handle section selection when waiting for it during label placement
  useEffect(() => {
    if (waitingForLabelSectionSelection && selectedBasePlateSectionId && pendingLabelConfig) {
      setWaitingForLabelSectionSelection(false);
      
      // Add section to label and dispatch
      const labelWithSection = { ...pendingLabelConfig, sectionId: selectedBasePlateSectionId };
      setPendingLabelConfig(null);
      
      // Dispatch the label-add event again with section
      window.dispatchEvent(new CustomEvent('label-add', { detail: labelWithSection }));
    }
  }, [waitingForLabelSectionSelection, selectedBasePlateSectionId, pendingLabelConfig]);

  // Complete hole placement after section selected
  useEffect(() => {
    if (waitingForHoleSectionSelection && selectedBasePlateSectionId && pendingHoleConfig) {
      console.log('[HolePlacement] Section selected, starting hole placement');
      
      // Log section state at this point
      if (basePlate?.type === 'multi-section' && basePlate.sections) {
        const selectedSection = basePlate.sections.find(s => s.id === selectedBasePlateSectionId);
        console.log('[HolePlacement] Selected section:', JSON.stringify({
          id: selectedSection?.id,
          minX: selectedSection?.minX,
          maxX: selectedSection?.maxX,
          minZ: selectedSection?.minZ,
          maxZ: selectedSection?.maxZ
        }));
      }
      setWaitingForHoleSectionSelection(false);
      
      const { config, depth } = pendingHoleConfig;
      setPendingHoleConfig(null);
      
      // Disable orbit controls during placement
      setOrbitControlsEnabled(false);
      
      // Switch to top view for placement
      prevOrientationRef.current = currentOrientation;
      setCurrentOrientation('top');
      updateCamera('top', modelBounds);
      
      // Use depth from event (baseplate thickness) or fallback to basePlate state
      const holeDepth = depth ?? basePlate?.depth ?? 20;
      setHolePlacementMode({ active: true, config, depth: holeDepth });
    }
  }, [waitingForHoleSectionSelection, selectedBasePlateSectionId, pendingHoleConfig, currentOrientation, updateCamera, modelBounds, basePlate]);

  // Handle ESC key to cancel waiting for section selection
  useEffect(() => {
    if (!waitingForLabelSectionSelection && !waitingForHoleSectionSelection) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWaitingForLabelSectionSelection(false);
        setPendingLabelConfig(null);
        setWaitingForHoleSectionSelection(false);
        setPendingHoleConfig(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [waitingForLabelSectionSelection, waitingForHoleSectionSelection]);

  // Handle hole creation
  const handleHoleCreate = useCallback((hole: PlacedHole) => {
    // For multi-section baseplates, require section selection first
    if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
      console.warn('Cannot create hole: Please select a baseplate section first');
      return;
    }

    // Validate hole position is within selected section for multi-section baseplates
    if (basePlate?.type === 'multi-section' && selectedBasePlateSectionId && basePlate.sections) {
      const section = basePlate.sections.find(s => s.id === selectedBasePlateSectionId);
      console.log('[HolePlacement] handleHoleCreate - section:', JSON.stringify({
        id: section?.id,
        minX: section?.minX,
        maxX: section?.maxX,
        minZ: section?.minZ,
        maxZ: section?.maxZ
      }));
      console.log('[HolePlacement] handleHoleCreate - all sections:', basePlate.sections.map(s => `${s.id}: minZ=${s.minZ}, maxZ=${s.maxZ}`).join(', '));
      if (section && hole.position) {
        // Note: hole.position is Vector2 where .x = world X, .y = world Z
        const { x, y } = hole.position;
        // Check if hole is within section bounds
        if (x < section.minX || x > section.maxX || y < section.minZ || y > section.maxZ) {
          console.warn('[HolePlacement] Hole position outside selected section bounds, skipping placement', {
            holePos: { x, z: y },
            sectionBounds: { minX: section.minX, maxX: section.maxX, minZ: section.minZ, maxZ: section.maxZ }
          });
          // Clear section selection and exit hole placement mode
          setSelectedBasePlateSectionId(null);
          setHolePlacementMode({ active: false, config: null, depth: 20 });
          setOrbitControlsEnabled(true);
          setCurrentOrientation(prevOrientationRef.current);
          updateCamera(prevOrientationRef.current, modelBounds);
          return;
        }
      }
    }

    // Add sectionId to hole if we have a multi-section baseplate
    const holeWithSection: PlacedHole = basePlate?.type === 'multi-section' && selectedBasePlateSectionId
      ? { ...hole, sectionId: selectedBasePlateSectionId }
      : hole;

    console.log('[HolePlacement] Hole being placed:', JSON.stringify({
      id: holeWithSection.id,
      position: holeWithSection.position,
      diameter: holeWithSection.diameter,
      sectionId: holeWithSection.sectionId
    }));

    // Emit event to AppShell
    window.dispatchEvent(new CustomEvent('hole-placed', { detail: holeWithSection }));
    
    // Clear section selection after placing hole
    setSelectedBasePlateSectionId(null);
    
    // Exit placement mode
    setHolePlacementMode({ active: false, config: null, depth: 20 });
    setOrbitControlsEnabled(true);
    
    // Restore previous view
    setCurrentOrientation(prevOrientationRef.current);
    updateCamera(prevOrientationRef.current, modelBounds);
    
    // Note: CSG is triggered by handleHolesUpdated when AppShell sends back the updated holes array
  }, [modelBounds, updateCamera, basePlate, selectedBasePlateSectionId]);

  // Sync holes from AppShell
  React.useEffect(() => {
    const handleHolesUpdated = (e: CustomEvent) => {
      const holes = e.detail as PlacedHole[];
      
      setMountingHoles(prev => {
        // Trigger CSG if hole count changed (added or deleted) and not currently editing
        // The editing case is handled by onDeselect/onTransformEnd
        if (holes.length !== prev.length && !editingHoleId) {
          // Use setTimeout to ensure state update completes first
          setTimeout(() => {
            setHoleCSGTrigger(t => t + 1);
          }, 0);
        }
        return holes;
      });
    };
    
    window.addEventListener('holes-updated', handleHolesUpdated as EventListener);
    return () => {
      window.removeEventListener('holes-updated', handleHolesUpdated as EventListener);
    };
  }, [editingHoleId]);

  // Sync selected hole ID from AppShell
  React.useEffect(() => {
    const handleHoleSelected = (e: CustomEvent) => {
      const holeId = e.detail as string | null;
      setSelectedHoleId(holeId);
    };
    
    window.addEventListener('hole-selected', handleHoleSelected as EventListener);
    return () => {
      window.removeEventListener('hole-selected', handleHoleSelected as EventListener);
    };
  }, []);

  // Handle hole edit request (double-click or button click to show transform controls)
  React.useEffect(() => {
    const handleHoleEditRequest = (e: CustomEvent) => {
      const holeId = e.detail as string;
      setSelectedHoleId(holeId);
      setEditingHoleId(holeId);
    };
    
    window.addEventListener('hole-edit-request', handleHoleEditRequest as EventListener);
    return () => {
      window.removeEventListener('hole-edit-request', handleHoleEditRequest as EventListener);
    };
  }, []);

  // Listen for hole updates from properties panel
  React.useEffect(() => {
    let debounceTimer: number | null = null;
    
    const handleHoleUpdated = (e: CustomEvent) => {
      const updatedHole = e.detail as PlacedHole;
      setMountingHoles(prev => prev.map(h => h.id === updatedHole.id ? updatedHole : h));
      
      // Debounce CSG update for property panel changes (not from transform controls)
      // Transform controls handle their own CSG trigger on drag end
      if (!editingHoleId) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = window.setTimeout(() => {
          setHoleCSGTrigger(prev => prev + 1);
        }, 500); // 500ms debounce for property panel edits
      }
    };
    
    window.addEventListener('hole-updated', handleHoleUpdated as EventListener);
    return () => {
      window.removeEventListener('hole-updated', handleHoleUpdated as EventListener);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [editingHoleId]);

  // =============================================================================
  // HOLE CSG SYSTEM
  // =============================================================================

  /** Waits for React render cycle to complete. */
  const waitForRenderCycle = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }, []);

  /** Triggers CSG recalculation with delay. */
  const scheduleCSGTrigger = useCallback((delay = 150) => {
    const timer = setTimeout(() => {
      if (!isDraggingHoleRef.current) {
        setHoleCSGTrigger((prev) => prev + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  // Handle CSG updates when baseplate or holes change (skip during drag)
  React.useEffect(() => {
    if (basePlate?.type === 'multi-section' || isDraggingHoleRef.current) {
      return;
    }

    // No holes - clear CSG result
    if (mountingHoles.length === 0) {
      if (baseplateWithHoles !== null) {
        setBaseplateWithHoles(null);
      }
      return;
    }

    // We have holes - trigger CSG recalculation
    // Clear existing CSG first so BasePlate renders with correct size
    if (baseplateWithHoles !== null) {
      setBaseplateWithHoles(null);
    }
    
    // Schedule CSG trigger
    return scheduleCSGTrigger();
  }, [
    basePlate?.type,
    basePlate?.width,
    basePlate?.height,
    basePlate?.depth,
    combinedHullPoints,
    mountingHoles.length,
    scheduleCSGTrigger,
  ]);

  // Serialize hull points for stable dependency comparison
  const hullPointsKey = React.useMemo(() => {
    return JSON.stringify(combinedHullPoints.map(p => ({ x: Math.round(p.x * 100), z: Math.round(p.z * 100) })));
  }, [combinedHullPoints]);

  // Clear cached original geometry when baseplate configuration changes
  // This forces re-capture of the geometry on next CSG trigger
  React.useEffect(() => {
    originalBaseplateGeoRef.current = null;
    setBaseplateWithHoles(null);
  }, [basePlate?.type, basePlate?.width, basePlate?.height, basePlate?.depth, hullPointsKey]);

  // Execute CSG operation
  React.useEffect(() => {
    const performHoleCSG = async () => {
      // Skip conditions
      if (
        basePlate?.type === 'multi-section' ||
        isDraggingHoleRef.current ||
        holeCSGTrigger === 0
      ) {
        return;
      }

      const currentHoles = mountingHolesRef.current;
      if (currentHoles.length === 0) {
        setBaseplateWithHoles(null);
        return;
      }

      // Wait for geometry to be ready
      await waitForRenderCycle();

      if (isDraggingHoleRef.current) return;

      // Get source geometry - prefer cached original, fallback to mesh
      let sourceGeo: THREE.BufferGeometry | null = null;
      
      if (originalBaseplateGeoRef.current) {
        // Use cached original geometry
        sourceGeo = originalBaseplateGeoRef.current.clone();
        console.log('[HoleCSG] Using cached original geometry');
      } else {
        // No cache - capture from mesh (must be original BasePlate since baseplateWithHoles is null)
        const meshGeometry = basePlateMeshRef.current?.geometry;
        if (!meshGeometry) {
          scheduleCSGTrigger(100);
          return;
        }
        // Cache the original geometry for future CSG operations
        originalBaseplateGeoRef.current = meshGeometry.clone();
        sourceGeo = meshGeometry.clone();
        console.log('[HoleCSG] Captured and cached original geometry');
      }

      const baseplateOffset = basePlate?.position
        ? { x: basePlate.position.x, z: basePlate.position.z }
        : undefined;
      const depth = basePlate?.depth ?? 5;

      // Calculate geometry offset - accounts for asymmetric expansion when hull points
      // cause the baseplate to expand in one direction more than the other.
      // 
      // IMPORTANT: This only applies to RECTANGULAR baseplates where geometry is in local space
      // and gets translated by (geometryOffsetX, geometryOffsetZ) when hull points cause asymmetric expansion.
      //
      // For CONVEX-HULL baseplates, the geometry is created directly in WORLD space (vertices have
      // actual world coordinates) and the mesh position is (0,0,0). No geometry offset is needed.
      let geometryOffset: { x: number; z: number } | undefined;
      
      if (basePlate?.type !== 'convex-hull') {
        // Only calculate geometry offset for non-convex-hull types
        sourceGeo.computeBoundingBox();
        if (sourceGeo.boundingBox) {
          const box = sourceGeo.boundingBox;
          const geoCenterX = (box.min.x + box.max.x) / 2;
          const geoCenterZ = (box.min.z + box.max.z) / 2;
          // Only apply offset if significant (> 0.1mm)
          if (Math.abs(geoCenterX) > 0.1 || Math.abs(geoCenterZ) > 0.1) {
            geometryOffset = { x: geoCenterX, z: geoCenterZ };
            console.log('[HoleCSG] Geometry offset detected (rectangular):', geometryOffset);
          }
        }
      } else {
        console.log('[HoleCSG] Convex-hull baseplate - no geometry offset needed');
      }

      const holesWithDepth = currentHoles.map((hole) => ({
        ...hole,
        depth: hole.depth || depth,
      }));

      const holesGeo = createMergedHolesGeometry(holesWithDepth, depth, baseplateOffset, geometryOffset);
      if (!holesGeo) return;

      setHoleCSGProcessing(true);

      try {
        const result = await performHoleCSGInWorker(sourceGeo, holesGeo);

        if (isDraggingHoleRef.current) return;

        if (result) {
          setBaseplateWithHoles(result);
        }
      } catch (error) {
        console.error('[HoleCSG] Error:', error);
      } finally {
        setHoleCSGProcessing(false);
      }
    };

    performHoleCSG();
  }, [holeCSGTrigger, basePlate?.type, basePlate?.position, basePlate?.depth, waitForRenderCycle, scheduleCSGTrigger]);

  // Track previous baseplate depth
  const prevBaseplateDepthRef = React.useRef(basePlate?.depth);

  // Sync hole depths with baseplate depth changes
  React.useEffect(() => {
    const newDepth = basePlate?.depth ?? 20;
    const prevDepth = prevBaseplateDepthRef.current;

    if (prevDepth === newDepth) return;
    prevBaseplateDepthRef.current = newDepth;

    setMountingHoles((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((hole) => ({ ...hole, depth: newDepth }));
    });
  }, [basePlate?.depth]);

  /**
   * Gets the footprint bounds of a clamp in world space.
   * Applies rotation and translation to transform local polygon to world space.
   */
  const getClampFootprintBounds = useCallback((clamp: PlacedClamp): FootprintBounds | null => {
    const supportInfo = clampSupportInfos.get(clamp.id);
    if (!supportInfo || !supportInfo.polygon || supportInfo.polygon.length === 0) {
      return null;
    }

    // Apply clamp rotation to polygon points before translating
    const rotationY = THREE.MathUtils.degToRad(clamp.rotation.y);
    const cosR = Math.cos(rotationY);
    const sinR = Math.sin(rotationY);

    // Transform polygon points to world space
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    
    supportInfo.polygon.forEach(([localX, localZ]) => {
      // Apply Y-axis rotation (rotation in the XZ horizontal plane)
      const rotatedX = localX * cosR + localZ * sinR;
      const rotatedZ = -localX * sinR + localZ * cosR;
      
      // Add clamp world position
      const worldX = rotatedX + clamp.position.x;
      const worldZ = rotatedZ + clamp.position.z;
      
      minX = Math.min(minX, worldX);
      maxX = Math.max(maxX, worldX);
      minZ = Math.min(minZ, worldZ);
      maxZ = Math.max(maxZ, worldZ);
    });

    return { minX, maxX, minZ, maxZ };
  }, [clampSupportInfos]);

  /**
   * Calculates the optimal bounds for a section based on its original size and nearby supports/clamps.
   * Maintains minimum original size but allows the section to be positioned anywhere.
   */
  const calculateOptimalSectionBounds = useCallback((
    section: BasePlateSection,
    nearbySupports: AnySupport[],
    nearbyClamps: PlacedClamp[],
    padding: number,
    nearbyLabels: LabelConfig[] = [],
    nearbyHoles: PlacedHole[] = []
  ): BasePlateSection => {
    // Validate section has required bounds
    if (!isFinite(section.minX) || !isFinite(section.maxX) || 
        !isFinite(section.minZ) || !isFinite(section.maxZ)) {
      console.error('[calculateOptimalSectionBounds] Invalid section bounds:', section);
      // Return section unchanged if it's invalid
      return section;
    }
    
    const originalWidth = section.originalWidth ?? (section.maxX - section.minX);
    const originalDepth = section.originalDepth ?? (section.maxZ - section.minZ);
    
    // Use original center if available, otherwise calculate from current bounds
    // This prevents the section from drifting when items are added/removed
    const centerX = section.originalCenterX ?? (section.minX + section.maxX) / 2;
    const centerZ = section.originalCenterZ ?? (section.minZ + section.maxZ) / 2;
    
    // Start with original size centered at original position
    let minX = centerX - originalWidth / 2;
    let maxX = centerX + originalWidth / 2;
    let minZ = centerZ - originalDepth / 2;
    let maxZ = centerZ + originalDepth / 2;

    // Expand to include each nearby support (but don't shrink below original)
    nearbySupports.forEach(support => {
      const footprint = getSupportFootprintBounds(support);
      minX = Math.min(minX, footprint.minX - padding);
      maxX = Math.max(maxX, footprint.maxX + padding);
      minZ = Math.min(minZ, footprint.minZ - padding);
      maxZ = Math.max(maxZ, footprint.maxZ + padding);
    });

    // Expand to include each nearby clamp
    nearbyClamps.forEach(clamp => {
      const footprint = getClampFootprintBounds(clamp);
      if (footprint) {
        minX = Math.min(minX, footprint.minX - padding);
        maxX = Math.max(maxX, footprint.maxX + padding);
        minZ = Math.min(minZ, footprint.minZ - padding);
        maxZ = Math.max(maxZ, footprint.maxZ + padding);
      }
    });

    // Expand to include each nearby label
    nearbyLabels.forEach(label => {
      if (label.position) {
        // Approximate label bounds based on text length and font size
        const fontSize = label.fontSize ?? 10;
        const textLength = (label.text?.length ?? 0) * fontSize * 0.6;
        const labelHalfWidth = textLength / 2;
        const labelHalfHeight = fontSize / 2;
        
        minX = Math.min(minX, label.position.x - labelHalfWidth - padding);
        maxX = Math.max(maxX, label.position.x + labelHalfWidth + padding);
        minZ = Math.min(minZ, label.position.z - labelHalfHeight - padding);
        maxZ = Math.max(maxZ, label.position.z + labelHalfHeight + padding);
      }
    });

    // Expand to include each nearby hole
    nearbyHoles.forEach(hole => {
      // Note: hole.position is Vector2 where .x = world X, .y = world Z
      if (hole.position && isFinite(hole.position.x) && isFinite(hole.position.y)) {
        const holeRadius = (hole.diameter ?? 5) / 2;
        minX = Math.min(minX, hole.position.x - holeRadius - padding);
        maxX = Math.max(maxX, hole.position.x + holeRadius + padding);
        minZ = Math.min(minZ, hole.position.y - holeRadius - padding);
        maxZ = Math.max(maxZ, hole.position.y + holeRadius + padding);
      }
    });

    return {
      ...section,
      minX,
      maxX,
      minZ,
      maxZ,
    };
  }, [getClampFootprintBounds]);
  /**
   * Expands a baseplate section to include a support's footprint with padding.
   */
  const expandSectionForSupport = useCallback((section: BasePlateSection, footprint: FootprintBounds, padding: number): BasePlateSection => {
    return {
      ...section,
      minX: Math.min(section.minX, footprint.minX - padding),
      maxX: Math.max(section.maxX, footprint.maxX + padding),
      minZ: Math.min(section.minZ, footprint.minZ - padding),
      maxZ: Math.max(section.maxZ, footprint.maxZ + padding),
    };
  }, []);

  const handleSupportCreate = useCallback((support: AnySupport) => {
    // For multi-section baseplates, require section selection first
    if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
      console.warn('Cannot create support: Please select a baseplate section first');
      return;
    }

    // Add sectionId to support if we have a multi-section baseplate
    const supportWithSection: AnySupport = basePlate?.type === 'multi-section' && selectedBasePlateSectionId
      ? { ...support, sectionId: selectedBasePlateSectionId }
      : support;

    // Emit event with sectionId included
    window.dispatchEvent(new CustomEvent('support-created', { detail: supportWithSection }));

    // Auto-expand baseplate section if this support overhangs current footprint
    setBasePlate(prev => {
      if (!prev) return prev;
      
      const padding = prev.padding ?? 5;

      // For multi-section baseplates, recalculate the selected section bounds
      if (prev.type === 'multi-section' && prev.sections && prev.sections.length > 0 && selectedBasePlateSectionId) {
        const sectionIndex = prev.sections.findIndex(s => s.id === selectedBasePlateSectionId);
        if (sectionIndex === -1) return prev;

        const section = prev.sections[sectionIndex];

        // Get all supports currently in this section (including the new one)
        // Filter by sectionId to only include supports that belong to this section
        const sectionSupports = [...supports, supportWithSection].filter(s => s.sectionId === selectedBasePlateSectionId);

        // Get all clamps in this section (filter by sectionId)
        const sectionClamps = placedClamps.filter(c => c.sectionId === selectedBasePlateSectionId);

        // Get all labels in this section (filter by sectionId)
        const sectionLabels = labels.filter(l => l.sectionId === selectedBasePlateSectionId);

        // Get all holes in this section (filter by sectionId)
        const sectionHoles = mountingHoles.filter(h => h.sectionId === selectedBasePlateSectionId);

        // Calculate optimal bounds based on items in this section only
        const optimizedSection = calculateOptimalSectionBounds(
          section, 
          sectionSupports, 
          sectionClamps, 
          padding,
          sectionLabels,
          sectionHoles
        );
        
        const updatedSections = prev.sections.map((s, i) => 
          i === sectionIndex ? optimizedSection : s
        );

        // Dispatch event to notify AppShell of section update
        window.dispatchEvent(new CustomEvent('baseplate-section-updated', {
          detail: {
            basePlateId: prev.id,
            sectionId: optimizedSection.id,
            newBounds: {
              minX: optimizedSection.minX,
              maxX: optimizedSection.maxX,
              minZ: optimizedSection.minZ,
              maxZ: optimizedSection.maxZ,
            }
          }
        }));

        return {
          ...prev,
          sections: updatedSections,
        };
      }
      
      // For convex-hull, no need to manually expand - the hull recalculates from supports
      if (prev.type === 'convex-hull') {
        // Just trigger a re-render by returning a new object reference
        return { ...prev };
      }
      
      // For fixed-size baseplates, calculate footprint and expand if needed
      const footprint = getSupportFootprintBounds(support);
      const { width, height } = prev;
      if (!width || !height) return prev;

      const halfW = width / 2;
      const halfH = height / 2;
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
    
    // Clear selected section after support placement completes
    setSelectedBasePlateSectionId(null);
    
    // restore previous view after creation
    setCurrentOrientation(prevOrientationRef.current);
    updateCamera(prevOrientationRef.current, modelBounds);
    editingSupportRef.current = null;
  }, [modelBounds, updateCamera, calculateOptimalSectionBounds, basePlate, selectedBasePlateSectionId, supports, placedClamps, labels, mountingHoles]);

  // Auto-expand sections when holes are added (for multi-section baseplates)
  useEffect(() => {
    if (basePlate?.type !== 'multi-section' || !basePlate.sections || mountingHoles.length === 0) {
      return;
    }
    
    // Validate all sections before processing
    const invalidSection = basePlate.sections.find(s => 
      !isFinite(s.minX) || !isFinite(s.maxX) || !isFinite(s.minZ) || !isFinite(s.maxZ)
    );
    if (invalidSection) {
      console.error('[HoleExpansion] Baseplate has invalid section:', {
        id: invalidSection.id,
        minX: invalidSection.minX,
        maxX: invalidSection.maxX,
        minZ: invalidSection.minZ,
        maxZ: invalidSection.maxZ,
        originalWidth: invalidSection.originalWidth,
        originalDepth: invalidSection.originalDepth
      });
      console.error('[HoleExpansion] All sections:', basePlate.sections.map(s => ({
        id: s.id,
        minX: s.minX,
        maxX: s.maxX,
        minZ: s.minZ,
        maxZ: s.maxZ
      })));
      return;
    }
    
    // Group holes by section
    const holesBySectionId = new Map<string, PlacedHole[]>();
    mountingHoles.forEach(hole => {
      if (hole.sectionId) {
        const existing = holesBySectionId.get(hole.sectionId) || [];
        existing.push(hole);
        holesBySectionId.set(hole.sectionId, existing);
      }
    });
    
    // Update sections to accommodate holes
    setBasePlate(prev => {
      if (!prev || prev.type !== 'multi-section' || !prev.sections) return prev;
      
      const padding = prev.padding ?? 5;
      let hasChanges = false;
      
      const updatedSections = prev.sections.map(section => {
        const sectionHoles = holesBySectionId.get(section.id) || [];
        if (sectionHoles.length === 0) return section;
        
        const sectionSupports = supports.filter(s => s.sectionId === section.id);
        const sectionClamps = placedClamps.filter(c => c.sectionId === section.id);
        const sectionLabels = labels.filter(l => l.sectionId === section.id);
        
        const optimizedSection = calculateOptimalSectionBounds(
          section,
          sectionSupports,
          sectionClamps,
          padding,
          sectionLabels,
          sectionHoles
        );
        
        // Check if bounds actually changed
        if (
          optimizedSection.minX !== section.minX ||
          optimizedSection.maxX !== section.maxX ||
          optimizedSection.minZ !== section.minZ ||
          optimizedSection.maxZ !== section.maxZ
        ) {
          hasChanges = true;
        }
        
        return optimizedSection;
      });
      
      if (!hasChanges) return prev;
      
      return {
        ...prev,
        sections: updatedSections
      };
    });
  }, [mountingHoles, basePlate, supports, placedClamps, labels, calculateOptimalSectionBounds]);

  // Persist created supports in scene
  React.useEffect(() => {
    const onSupportCreated = (e: CustomEvent) => {
      const s: AnySupport = e.detail;
      setSupports(prev => {
        const editing = editingSupportRef.current;
        if (editing) {
          const replaced = prev.map(p => (p.id === editing.id ? s : p));
          editingSupportRef.current = null;
          return replaced;
        }
        return [...prev, s];
      });
      
      // Force bounds recalculation after support is added to state
      if (s.sectionId) {
        setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
      }
    };
    window.addEventListener('support-created', onSupportCreated as EventListener);
    return () => window.removeEventListener('support-created', onSupportCreated as EventListener);
  }, []);

  // Listen for support updates from properties panel
  // Note: The reactive multi-section bounds effect will automatically recalculate section bounds
  React.useEffect(() => {
    const onSupportUpdated = (e: CustomEvent) => {
      const updatedSupport = e.detail as AnySupport;
      // Update supports state - reactive effect will handle bounds recalculation
      setSupports(prev => prev.map(s => s.id === updatedSupport.id ? updatedSupport : s));
    };

    const onSupportDelete = (e: CustomEvent) => {
      const supportId = e.detail as string;
      // Update supports state - reactive effect will handle bounds recalculation
      setSupports(prev => prev.filter(s => s.id !== supportId));
      
      // If we were editing this support, cancel the edit
      if (editingSupportRef.current?.id === supportId) {
        editingSupportRef.current = null;
      }
    };

    const onSupportsClearAll = () => {
      // Clear all supports - reactive effect will handle bounds recalculation
      setSupports([]);
      editingSupportRef.current = null;
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

  // Handle auto-place supports event
  React.useEffect(() => {
    const onAutoPlaceSupports = (e: CustomEvent) => {
      if (!basePlate) {
        console.warn('[3DScene] Cannot auto-place supports: no baseplate configured');
        return;
      }

      const { supportType, overhangAngle, aspectRatioThreshold } = e.detail as {
        supportType?: 'auto' | 'cylindrical' | 'rectangular' | 'custom';
        overhangAngle?: number;
        aspectRatioThreshold?: number;
      };

      // Collect all model meshes from refs
      const meshes: THREE.Object3D[] = [];
      modelMeshRefs.current.forEach((ref) => {
        if (ref.current) {
          meshes.push(ref.current);
        }
      });

      if (meshes.length === 0) {
        console.warn('[3DScene] Cannot auto-place supports: no model meshes found');
        return;
      }

      const baseTopY = basePlate.depth ?? 5;

      console.log('[3DScene] Auto-placing supports - type:', supportType, 
        `(angle: ${overhangAngle ?? 45}°, aspectRatio: ${aspectRatioThreshold ?? 1.2})`);

      // Call autoPlaceSupports with model targets for raycasting
      // This ensures supports get proper heights (same as manual placement)
      const result = autoPlaceSupports(
        meshes, 
        baseTopY, 
        {
          supportType: supportType || 'auto',
          cornerRadius: 2,
          contactOffset: 0,
          overhangAngle: overhangAngle ?? 45,
          aspectRatioThreshold: aspectRatioThreshold ?? 1.2,
          clusterDistance: 15,
          minClusterArea: 25,
        },
        meshes,  // modelTargets for raycasting
        null     // baseTarget (baseplate mesh, if available)
      );

      console.log('[3DScene] Auto-placement result:', result.message, 
        `- ${result.clustersFound} clusters, ${result.totalOverhangArea.toFixed(1)}mm² overhang area`);

      // Store debug perimeter for visualization if debug mode is enabled
      if (DEBUG_SHOW_PERIMETER && result.debugPerimeter && result.debugPerimeter.length > 2) {
        setDebugPerimeter(result.debugPerimeter);
      }

      if (result.supports.length > 0) {
        // Set supports locally in 3DScene
        setSupports(result.supports);
        
        // Notify AppShell about the batch of new supports (single event to avoid duplicates)
        window.dispatchEvent(new CustomEvent('supports-auto-placed', { 
          detail: { 
            supports: result.supports,
            message: result.message 
          } 
        }));
      } else {
        console.warn('[3DScene] Auto-placement generated no supports:', result.message);
      }
    };

    window.addEventListener('supports-auto-place', onAutoPlaceSupports as EventListener);
    return () => window.removeEventListener('supports-auto-place', onAutoPlaceSupports as EventListener);
  }, [basePlate]);

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

  // Label event handlers
  React.useEffect(() => {
    const onLabelAdd = (e: CustomEvent) => {
      const newLabel = e.detail as LabelConfig;
      
      // For multi-section baseplates, require section selection if not already provided
      if (basePlate?.type === 'multi-section') {
        if (!newLabel.sectionId && !selectedBasePlateSectionId) {
          // Wait for section selection
          setWaitingForLabelSectionSelection(true);
          setPendingLabelConfig(newLabel);
          return;
        }
        
        // Use provided sectionId or selected section
        const sectionId = newLabel.sectionId || selectedBasePlateSectionId;
        if (sectionId && basePlate.sections) {
          const section = basePlate.sections.find(s => s.id === sectionId);
          if (section) {
            // Add sectionId to label
            newLabel.sectionId = sectionId;
            
            // Position label at the center-front of the section
            const sectionCenterX = (section.minX + section.maxX) / 2;
            const sectionFrontZ = section.maxZ;
            
            const labelY = baseTopY;
            const labelX = sectionCenterX;
            const labelZ = sectionFrontZ + newLabel.fontSize / 2;
            
            newLabel.position = new THREE.Vector3(labelX, labelY, labelZ);
            newLabel.rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
            
            setLabels(prev => [...prev, newLabel]);
            setSelectedLabelId(newLabel.id);
            
            // Force bounds recalculation after label is added to state
            setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
            
            // Clear selected section after label placement
            setSelectedBasePlateSectionId(null);
            
            // Dispatch events
            window.dispatchEvent(new CustomEvent('label-added', { detail: newLabel }));
            window.dispatchEvent(new CustomEvent('label-placed', { 
              detail: { 
                labelId: newLabel.id, 
                sectionId: newLabel.sectionId,
                position: newLabel.position,
                fontSize: newLabel.fontSize,
                text: newLabel.text
              } 
            }));
            
            return;
          }
        }
      }
      
      // Original logic for rectangular/convex-hull baseplates
      // Calculate rectangular bounding box of supports + part
      // Label should be placed at the lower-left boundary (outside)
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      // Include support footprint points in bounds
      for (const support of supports) {
        const footprintPoints = getSupportFootprintPoints(support);
        for (const pt of footprintPoints) {
          minX = Math.min(minX, pt.x);
          maxX = Math.max(maxX, pt.x);
          minZ = Math.min(minZ, pt.z);
          maxZ = Math.max(maxZ, pt.z);
        }
      }
      
      // Include clamp support footprint points in bounds
      for (const placedClamp of placedClamps) {
        const supportInfo = clampSupportInfos.get(placedClamp.id);
        if (!supportInfo) continue;
        
        // Transform polygon from clamp local space to world space
        const rotationY = THREE.MathUtils.degToRad(placedClamp.rotation.y);
        const cosR = Math.cos(rotationY);
        const sinR = Math.sin(rotationY);
        
        for (const [localX, localZ] of supportInfo.polygon) {
          // Apply Y-axis rotation and add clamp position
          const worldX = localX * cosR + localZ * sinR + placedClamp.position.x;
          const worldZ = -localX * sinR + localZ * cosR + placedClamp.position.z;
          minX = Math.min(minX, worldX);
          maxX = Math.max(maxX, worldX);
          minZ = Math.min(minZ, worldZ);
          maxZ = Math.max(maxZ, worldZ);
        }
      }
      
      // Include part bounds if available
      if (modelBounds) {
        const center = modelBounds.center;
        const halfX = modelBounds.size.x / 2;
        const halfZ = modelBounds.size.z / 2;
        minX = Math.min(minX, center.x - halfX);
        maxX = Math.max(maxX, center.x + halfX);
        minZ = Math.min(minZ, center.z - halfZ);
        maxZ = Math.max(maxZ, center.z + halfZ);
      }
      
      // Fallback if no supports or parts
      if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minZ) || !isFinite(maxZ)) {
        minX = -50; maxX = 50;
        minZ = -50; maxZ = 50;
      }
      
      // Use the actual baseplate top Y from the mesh bounding box
      // baseTopY is computed from the actual geometry, accounting for chamfers
      const labelY = baseTopY;
      
      // Estimate label width based on text length and font size
      const estimatedLabelWidth = newLabel.fontSize * newLabel.text.length * 0.6;
      
      // Position label at front-center (centered X, maxZ is front in world coords)
      // No padding - label edge touches the boundary
      const labelX = (minX + maxX) / 2; // Center X
      const labelZ = maxZ + newLabel.fontSize / 2; // Front edge (positive Z)
      
      newLabel.position = new THREE.Vector3(labelX, labelY, labelZ);
      // Rotate to face up (readable from above)
      newLabel.rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
      
      setLabels(prev => [...prev, newLabel]);
      setSelectedLabelId(newLabel.id);
      
      // Notify LabelsStepContent about the label position update
      window.dispatchEvent(new CustomEvent('label-added', { detail: newLabel }));
    };

    const onLabelUpdate = (e: CustomEvent) => {
      const { labelId, updates } = e.detail as { labelId: string; updates: Partial<LabelConfig> };
      setLabels(prev => prev.map(l => l.id === labelId ? { ...l, ...updates } : l));
    };

    const onLabelDelete = (e: CustomEvent) => {
      const labelId = e.detail as string;
      setLabels(prev => prev.filter(l => l.id !== labelId));
      if (selectedLabelId === labelId) {
        setSelectedLabelId(null);
      }
    };

    const onLabelSelect = (e: CustomEvent) => {
      const labelId = e.detail as string | null;
      setSelectedLabelId(labelId);
    };

    const onLabelsClearAll = () => {
      setLabels([]);
      setSelectedLabelId(null);
    };

    window.addEventListener('label-add', onLabelAdd as EventListener);
    window.addEventListener('label-update', onLabelUpdate as EventListener);
    window.addEventListener('label-delete', onLabelDelete as EventListener);
    window.addEventListener('label-select', onLabelSelect as EventListener);
    window.addEventListener('labels-clear-all', onLabelsClearAll);

    return () => {
      window.removeEventListener('label-add', onLabelAdd as EventListener);
      window.removeEventListener('label-update', onLabelUpdate as EventListener);
      window.removeEventListener('label-delete', onLabelDelete as EventListener);
      window.removeEventListener('label-select', onLabelSelect as EventListener);
      window.removeEventListener('labels-clear-all', onLabelsClearAll);
    };
  }, [basePlate, selectedLabelId, supports, modelBounds, baseTopY, placedClamps, clampSupportInfos]);

  // DOM-level click handler for clamp placement mode
  // This bypasses R3F's event system which can be blocked by PivotControls
  useEffect(() => {
    if (!clampPlacementMode.active) return;
    
    const handleCanvasClick = (event: MouseEvent) => {
      console.log('[ClampPlacement] Canvas click detected');
      
      if (!clampPlacementMode.active || !clampPlacementMode.clampModelId) {
        console.log('[ClampPlacement] Not in active placement mode');
        return;
      }
      
      // Calculate normalized device coordinates
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      
      // Set up raycaster
      raycasterRef.current.setFromCamera(mouse, camera);
      
      // For multi-section baseplates, check if user clicked on a baseplate section first
      if (basePlate?.type === 'multi-section' && basePlate.sections) {
        // Get baseplate group reference and check intersections
        const baseplateObjects: THREE.Object3D[] = [];
        scene.traverse((obj) => {
          if (obj.userData.isBaseplateSection) {
            baseplateObjects.push(obj);
          }
        });
        
        if (baseplateObjects.length > 0) {
          const baseplateIntersects = raycasterRef.current.intersectObjects(baseplateObjects, false);
          if (baseplateIntersects.length > 0) {
            // User clicked on a baseplate section - select it
            const sectionMesh = baseplateIntersects[0].object;
            const sectionId = sectionMesh.userData.sectionId;
            if (sectionId) {
              console.log('[ClampPlacement] Section selected:', sectionId);
              setSelectedBasePlateSectionId(sectionId);
              window.dispatchEvent(new CustomEvent('baseplate-section-selected', {
                detail: { sectionId }
              }));
              // Don't proceed with clamp placement, just select the section
              return;
            }
          }
        }
      }
      
      // Get all part meshes to test against
      const partMeshes: THREE.Mesh[] = [];
      importedParts.forEach(part => {
        const meshRef = modelMeshRefs.current.get(part.id);
        if (meshRef?.current && partVisibility.get(part.id) !== false) {
          partMeshes.push(meshRef.current);
        }
      });
      
      console.log('[ClampPlacement] Raycasting against', partMeshes.length, 'part meshes');
      
      if (partMeshes.length === 0) {
        console.log('[ClampPlacement] No visible part meshes to raycast against');
        return;
      }
      
      // Perform raycast
      const intersects = raycasterRef.current.intersectObjects(partMeshes, false);
      
      console.log('[ClampPlacement] Intersections found:', intersects.length);
      
      if (intersects.length === 0) {
        console.log('[ClampPlacement] No intersection with parts');
        return;
      }
      
      const intersection = intersects[0];
      const clickPoint = intersection.point.clone();
      const surfaceNormal = intersection.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
      const partMesh = intersection.object;
      
      console.log('[ClampPlacement] Hit point:', { x: clickPoint.x, y: clickPoint.y, z: clickPoint.z });
      
      // Transform normal to world space
      if (partMesh instanceof THREE.Mesh) {
        surfaceNormal.transformDirection(partMesh.matrixWorld);
      }
      
      // Get minimum placement offset for this clamp type (default 15mm)
      const minPlacementOffset = 15;
      
      console.log('[ClampPlacement] Loading clampPlacement module...');
      
      // Notify UI that processing has started
      window.dispatchEvent(new CustomEvent('clamp-processing-start'));
      window.dispatchEvent(new CustomEvent('clamp-progress', { 
        detail: { stage: 'loading', progress: 10, message: 'Loading placement module...' } 
      }));
      
      import('@/features/clamps/utils/clampPlacement').then(({ calculateVerticalClampPlacement }) => {
        console.log('[ClampPlacement] Module loaded, calculating placement...');
        
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'computing', progress: 30, message: 'Computing optimal position...' } 
        }));
        
        const silhouette = partSilhouetteRef.current || [];
        
        const result = calculateVerticalClampPlacement({
          clickPoint,
          surfaceNormal,
          partMesh,
          allPartMeshes: partMeshes,
          partSilhouette: silhouette,
          existingSupports: supports,
          existingClamps: placedClamps,
          baseTopY,
          minPlacementOffset,
          clampCategory: clampPlacementMode.clampCategory as 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push',
        });
        
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'positioning', progress: 60, message: 'Positioning clamp support...' } 
        }));
        
        console.log('[ClampPlacement] Placement result:', result);
        console.log('[ClampPlacement] Debug points:', result.debugPoints);
        console.log('[ClampPlacement] Silhouette points count:', silhouette.length);
        
        // Store debug points for visualization (including silhouette for red outline)
        if (result.debugPoints) {
          console.log('[ClampPlacement] Setting debug points with silhouette:', silhouette.length, 'points');
          // Store in ref immediately for sync access in onClampDataLoaded (include silhouette!)
          clampDebugPointsRef.current = {
            ...result.debugPoints,
            silhouette: silhouette, // IMPORTANT: Store silhouette for 2D collision check
          };
          setClampDebugPoints({
            ...result.debugPoints,
            silhouette: silhouette, // Store silhouette for red outline visualization
          });
        }
        
        if (result.success) {
          // For multi-section baseplates, require section selection first
          if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
            console.warn('Cannot place clamp: Please select a baseplate section first');
            window.dispatchEvent(new CustomEvent('clamp-progress', { 
              detail: { stage: 'idle', progress: 0, message: 'Please select a section first' } 
            }));
            return;
          }

          window.dispatchEvent(new CustomEvent('clamp-progress', { 
            detail: { stage: 'csg', progress: 80, message: 'Generating support geometry...' } 
          }));
          
          const newClamp: PlacedClamp = {
            id: `clamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            clampModelId: clampPlacementMode.clampModelId!,
            position: { x: result.position.x, y: result.position.y, z: result.position.z },
            rotation: result.rotation,
            scale: { x: 1, y: 1, z: 1 },
            // Add sectionId if multi-section baseplate
            ...(basePlate?.type === 'multi-section' && selectedBasePlateSectionId ? { sectionId: selectedBasePlateSectionId } : {}),
          };
          
          setPlacedClamps(prev => [...prev, newClamp]);
          setSelectedClampId(newClamp.id);
          
          // Force bounds recalculation after clamp is added to state
          if (newClamp.sectionId) {
            setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
          }
          
          // Exit placement mode and notify UI
          setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
          partSilhouetteRef.current = null;
          
          // Clear selected section after clamp placement
          setSelectedBasePlateSectionId(null);
          
          window.dispatchEvent(new CustomEvent('clamp-progress', { 
            detail: { stage: 'idle', progress: 100, message: 'Clamp placed successfully' } 
          }));
          window.dispatchEvent(new CustomEvent('clamp-placed', { detail: newClamp }));
        } else {
          console.log('[ClampPlacement] Placement failed:', result.reason);
          window.dispatchEvent(new CustomEvent('clamp-progress', { 
            detail: { stage: 'idle', progress: 0, message: '' } 
          }));
        }
      }).catch(err => {
        console.error('[ClampPlacement] Error loading module:', err);
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'idle', progress: 0, message: '' } 
        }));
      });
    };
    
    console.log('[ClampPlacement] Adding canvas click listener');
    gl.domElement.addEventListener('click', handleCanvasClick);
    
    return () => {
      console.log('[ClampPlacement] Removing canvas click listener');
      gl.domElement.removeEventListener('click', handleCanvasClick);
    };
  }, [clampPlacementMode, gl, camera, importedParts, partVisibility, supports, placedClamps, baseTopY, basePlate, selectedBasePlateSectionId]);

  // Handle clamp placement click on a part (legacy R3F handler - keeping for reference)
  const handleClampPlacementClick = useCallback((e: ThreeEvent<MouseEvent>, partMesh: THREE.Object3D) => {
    console.log('[ClampPlacement] handleClampPlacementClick called', {
      placementModeActive: clampPlacementMode.active,
      clampModelId: clampPlacementMode.clampModelId,
      clampCategory: clampPlacementMode.clampCategory
    });
    
    if (!clampPlacementMode.active || !clampPlacementMode.clampModelId) {
      console.log('[ClampPlacement] Exiting early - placement mode not active or no clamp selected');
      return;
    }
    
    e.stopPropagation();
    
    // Get intersection details
    const intersection = e.intersections[0];
    if (!intersection) {
      console.log('[ClampPlacement] No intersection found');
      return;
    }
    
    const clickPoint = intersection.point.clone();
    const surfaceNormal = intersection.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
    
    console.log('[ClampPlacement] Click details:', {
      clickPoint: { x: clickPoint.x, y: clickPoint.y, z: clickPoint.z },
      surfaceNormal: { x: surfaceNormal.x, y: surfaceNormal.y, z: surfaceNormal.z }
    });
    
    // Transform normal to world space
    if (intersection.object instanceof THREE.Mesh) {
      surfaceNormal.transformDirection(intersection.object.matrixWorld);
    }
    
    // Get minimum placement offset for this clamp type (default 15mm)
    const minPlacementOffset = 15;
    
    // For vertical clamps, we need to:
    // 1. Position fixture point on/near the click point
    // 2. Calculate rotation so support is outside part silhouette
    // 3. Ensure Y position respects fixture cutout clearance
    
    console.log('[ClampPlacement] Loading clampPlacement module...');
    
    import('@/features/clamps/utils/clampPlacement').then(({ calculateVerticalClampPlacement, isPointInsidePolygon }) => {
      console.log('[ClampPlacement] Module loaded');
      const silhouette = partSilhouetteRef.current || [];
      console.log('[ClampPlacement] Silhouette points:', silhouette.length);
      
      // Get all part meshes
      const allPartMeshes = importedParts
        .map(p => modelMeshRefs.current.get(p.id)?.current)
        .filter((m): m is THREE.Mesh => m !== null);
      
      console.log('[ClampPlacement] All part meshes count:', allPartMeshes.length);
      
      const result = calculateVerticalClampPlacement({
        clickPoint,
        surfaceNormal,
        partMesh,
        allPartMeshes,
        partSilhouette: silhouette,
        existingSupports: supports,
        existingClamps: placedClamps,
        baseTopY,
        minPlacementOffset,
        clampCategory: clampPlacementMode.clampCategory as 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push',
      });
      
      console.log('[ClampPlacement] Placement result:', result);
      
      if (result.success) {
        // Create the clamp at calculated position
        const newClamp: PlacedClamp = {
          id: `clamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          clampModelId: clampPlacementMode.clampModelId!,
          position: { x: result.position.x, y: result.position.y, z: result.position.z },
          rotation: result.rotation,
          scale: { x: 1, y: 1, z: 1 },
          sectionId: selectedBasePlateSectionId ?? undefined,  // Assign sectionId for multi-section baseplates
        };
        
        setPlacedClamps(prev => [...prev, newClamp]);
        setSelectedClampId(newClamp.id);
        
        // Force bounds recalculation after clamp is added to state
        if (newClamp.sectionId) {
          setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
        }
        
        // Auto-expand baseplate section if this is a multi-section baseplate
        if (newClamp.sectionId) {
          setBasePlate(prev => {
            if (!prev || prev.type !== 'multi-section' || !prev.sections || prev.sections.length === 0) {
              return prev;
            }

            const sectionId = newClamp.sectionId!;
            const section = prev.sections.find(s => s.id === sectionId);
            if (!section) return prev;

            const padding = prev.padding ?? 5;

            // Filter all items by sectionId (including the new clamp)
            const sectionSupports = supports.filter(s => s.sectionId === sectionId);
            const sectionClamps = [...placedClamps, newClamp].filter(c => c.sectionId === sectionId);
            const sectionLabels = labels.filter(l => l.sectionId === sectionId);
            const sectionHoles = mountingHoles.filter(h => h.sectionId === sectionId);

            // Calculate optimal bounds
            const optimizedSection = calculateOptimalSectionBounds(
              section, sectionSupports, sectionClamps, padding, sectionLabels, sectionHoles
            );

            const sectionIndex = prev.sections.findIndex(s => s.id === sectionId);
            if (sectionIndex === -1) return prev;

            const updatedSections = prev.sections.map((s, i) =>
              i === sectionIndex ? optimizedSection : s
            );

            // Dispatch event to notify AppShell
            window.dispatchEvent(new CustomEvent('baseplate-section-updated', {
              detail: {
                basePlateId: prev.id,
                sectionId: optimizedSection.id,
                newBounds: {
                  minX: optimizedSection.minX,
                  maxX: optimizedSection.maxX,
                  minZ: optimizedSection.minZ,
                  maxZ: optimizedSection.maxZ,
                }
              }
            }));

            return {
              ...prev,
              sections: updatedSections,
            };
          });
        }
        
        // Exit placement mode and notify UI
        setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
        partSilhouetteRef.current = null;
        
        window.dispatchEvent(new CustomEvent('clamp-placed', { detail: newClamp }));
      } else {
        console.log('[ClampPlacement] Placement failed:', result.reason);
      }
    }).catch(err => {
      console.error('[ClampPlacement] Error loading module:', err);
    });
  }, [clampPlacementMode, importedParts, supports, placedClamps, baseTopY, selectedBasePlateSectionId, labels, mountingHoles, calculateOptimalSectionBounds]);

  // Clamp event listeners
  useEffect(() => {
    const onClampPlace = (e: CustomEvent) => {
      const { clampModelId, position } = e.detail as { clampModelId: string; position?: { x: number; y: number; z: number } };
      
      // Default minimum placement offset (will be updated when clamp data loads)
      // Use a reasonable default that assumes cutouts extend ~15mm below fixture point
      const defaultMinOffset = 15;
      const minPlacementY = baseTopY + defaultMinOffset;
      
      // Default position at minimum placement height or provided position
      const defaultPosition = position || { x: 0, y: minPlacementY, z: 0 };
      // Ensure Y is at least at minimum placement height
      defaultPosition.y = Math.max(defaultPosition.y, minPlacementY);
      
      // For multi-section baseplates, require section selection first
      if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
        console.warn('Cannot place clamp: Please select a baseplate section first');
        return;
      }
      
      const newClamp: PlacedClamp = {
        id: `clamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        clampModelId,
        position: defaultPosition,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        // Add sectionId if multi-section baseplate
        ...(basePlate?.type === 'multi-section' && selectedBasePlateSectionId ? { sectionId: selectedBasePlateSectionId } : {}),
      };
      
      setPlacedClamps(prev => [...prev, newClamp]);
      setSelectedClampId(newClamp.id);
      
      // Force bounds recalculation after clamp is added to state
      if (newClamp.sectionId) {
        setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
      }
      
      // Notify UI about the clamp placement
      window.dispatchEvent(new CustomEvent('clamp-placed', { detail: newClamp }));
    };

    const onClampUpdate = (e: CustomEvent) => {
      const { clampId, updates } = e.detail as { clampId: string; updates: Partial<PlacedClamp> };
      
      // Enforce minimum Y position if we have the offset for this clamp
      if (updates.position) {
        const minOffset = clampMinOffsets.get(clampId) ?? 15; // Default 15mm
        const minY = baseTopY + minOffset;
        updates.position.y = Math.max(updates.position.y, minY);
      }
      
      // Update clamp state - reactive effect will handle bounds recalculation
      setPlacedClamps(prev => prev.map(c => c.id === clampId ? { ...c, ...updates } : c));
    };

    const onClampDelete = (e: CustomEvent) => {
      const clampId = e.detail as string;
      
      // Update state - reactive effect will handle bounds recalculation
      setPlacedClamps(prev => prev.filter(c => c.id !== clampId));
      setClampMinOffsets(prev => {
        const next = new Map(prev);
        next.delete(clampId);
        return next;
      });
      if (selectedClampId === clampId) {
        setSelectedClampId(null);
      }
    };
    
    // Handle clamp data loaded events (update minimum placement offset and store CSG data)
    // Note: The reactive effect will handle bounds recalculation when clampSupportInfos changes
    const onClampDataLoaded = (e: CustomEvent) => {
      const { 
        clampId, 
        minPlacementOffset,
        fixtureCutoutsGeometry,
        fixturePointTopCenter,
        supportInfo,
      } = e.detail as { 
        clampId: string; 
        minPlacementOffset: number;
        fixturePointY: number;
        fixtureCutoutsGeometry: THREE.BufferGeometry | null;
        fixturePointTopCenter: THREE.Vector3;
        supportInfo: { polygon: Array<[number, number]>; mountSurfaceLocalY: number; fixturePointY: number; } | null;
      };
      
      console.log('[3DScene] Clamp data loaded:', { clampId, minPlacementOffset });
      
      // Store the minimum offset for this clamp
      setClampMinOffsets(prev => new Map(prev).set(clampId, minPlacementOffset));
      
      // Store support info for baseplate bounds calculation
      // The reactive effect will automatically recalculate section bounds when this changes
      if (supportInfo) {
        setClampSupportInfos(prev => new Map(prev).set(clampId, {
          polygon: supportInfo.polygon,
          localCenter: { x: 0, y: 0 }, // Center is at origin in local space
          fixturePointY: supportInfo.fixturePointY,
          mountSurfaceLocalY: supportInfo.mountSurfaceLocalY,
        }));
      }
      
      // Store full clamp data for CSG operations (cavity creation)
      loadedClampDataRef.current.set(clampId, {
        fixtureCutoutsGeometry,
        fixturePointTopCenter,
        supportInfo,
      });
      
      // Update clamp position if it's below the minimum
      const minY = baseTopY + minPlacementOffset;
      setPlacedClamps(prev => prev.map(c => {
        if (c.id === clampId && c.position.y < minY) {
          console.log('[3DScene] Adjusting clamp position from', c.position.y, 'to', minY);
          return { ...c, position: { ...c.position, y: minY } };
        }
        return c;
      }));
    };

    const onClampSelect = (e: CustomEvent) => {
      const clampId = e.detail as string | null;
      setSelectedClampId(clampId);
    };

    const onClampsClearAll = () => {
      // Clear all clamps - reactive effect will handle bounds recalculation
      setPlacedClamps([]);
      setSelectedClampId(null);
      setClampMinOffsets(new Map());
    };

    const onClampToggleDebug = (e: CustomEvent) => {
      const show = e.detail as boolean;
      setShowClampDebug(show);
    };

    // Handle start clamp placement mode
    const onClampStartPlacement = (e: CustomEvent) => {
      const { clampModelId, clampCategory } = e.detail as { 
        clampModelId: string; 
        clampCategory: string;
      };
      
      console.log('[ClampPlacement] Start placement event received:', { clampModelId, clampCategory });
      
      // For multi-section baseplates, require section selection first
      if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
        console.log('[ClampPlacement] Waiting for section selection');
        setWaitingForClampSectionSelection(true);
        // Store clamp info for later
        setClampPlacementMode({
          active: false,
          clampModelId,
          clampCategory
        });
        return;
      }
      
      // Compute part silhouette for placement
      const meshes = importedParts
        .map(p => modelMeshRefs.current.get(p.id)?.current)
        .filter((m): m is THREE.Mesh => m !== null);
      
      console.log('[ClampPlacement] Part meshes found for silhouette:', meshes.length);
      
      if (meshes.length > 0) {
        // Import and compute silhouette
        import('@/features/clamps/utils/clampPlacement').then(({ computePartSilhouetteForClamps }) => {
          console.log('[ClampPlacement] Computing silhouette...');
          const silhouette = computePartSilhouetteForClamps(meshes, baseTopY);
          partSilhouetteRef.current = silhouette;
          console.log('[ClampPlacement] Silhouette computed, points:', silhouette.length);
          
          // DEBUG: Store silhouette for visualization on baseplate
          if (DEBUG_SHOW_CLAMP_SILHOUETTE) {
            setDebugClampSilhouette(silhouette);
          }
        });
      }
      
      setClampPlacementMode({
        active: true,
        clampModelId,
        clampCategory
      });
      
      console.log('[ClampPlacement] Placement mode activated');
      
      // Deselect any currently selected item
      onPartSelected(null);
      onSupportSelect?.(null);
      setSelectedClampId(null);
    };

    // Handle cancel clamp placement mode
    const onClampCancelPlacement = () => {
      setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
      partSilhouetteRef.current = null;
      setWaitingForClampSectionSelection(false);
      // Clear debug silhouette visualization
      setDebugClampSilhouette(null);
    };

    window.addEventListener('clamp-place', onClampPlace as EventListener);
    window.addEventListener('clamp-update', onClampUpdate as EventListener);
    window.addEventListener('clamp-delete', onClampDelete as EventListener);
    window.addEventListener('clamp-select', onClampSelect as EventListener);
    window.addEventListener('clamps-clear-all', onClampsClearAll);
    window.addEventListener('clamp-toggle-debug', onClampToggleDebug as EventListener);
    window.addEventListener('clamp-data-loaded', onClampDataLoaded as EventListener);
    window.addEventListener('clamp-start-placement', onClampStartPlacement as EventListener);
    window.addEventListener('clamp-cancel-placement', onClampCancelPlacement);

    return () => {
      window.removeEventListener('clamp-place', onClampPlace as EventListener);
      window.removeEventListener('clamp-update', onClampUpdate as EventListener);
      window.removeEventListener('clamp-delete', onClampDelete as EventListener);
      window.removeEventListener('clamp-select', onClampSelect as EventListener);
      window.removeEventListener('clamps-clear-all', onClampsClearAll);
      window.removeEventListener('clamp-toggle-debug', onClampToggleDebug as EventListener);
      window.removeEventListener('clamp-data-loaded', onClampDataLoaded as EventListener);
      window.removeEventListener('clamp-start-placement', onClampStartPlacement as EventListener);
      window.removeEventListener('clamp-cancel-placement', onClampCancelPlacement);
    };
  }, [selectedClampId, baseTopY, clampMinOffsets, importedParts, basePlate, selectedBasePlateSectionId]);

  // Reactive multi-section baseplate bounds update
  // This effect automatically recalculates section bounds when any items change
  useEffect(() => {
    // Skip if not a multi-section baseplate
    if (!basePlate || basePlate.type !== 'multi-section' || !basePlate.sections || basePlate.sections.length === 0) {
      return;
    }

    const padding = basePlate.padding ?? 5;
    let sectionsUpdated = false;
    
    const updatedSections = basePlate.sections.map(section => {
      // Find all items assigned to this section by sectionId
      const sectionSupports = supports.filter(s => s.sectionId === section.id);
      const sectionClamps = placedClamps.filter(c => c.sectionId === section.id);
      const sectionLabels = labels.filter(l => l.sectionId === section.id);
      const sectionHoles = mountingHoles.filter(h => h.sectionId === section.id);

      // Calculate optimal bounds based only on items assigned to this section
      const optimizedSection = calculateOptimalSectionBounds(
        section, 
        sectionSupports, 
        sectionClamps, 
        padding,
        sectionLabels,
        sectionHoles
      );

      // Check if section changed (with small tolerance for floating point)
      if (
        Math.abs(optimizedSection.minX - section.minX) > 0.01 ||
        Math.abs(optimizedSection.maxX - section.maxX) > 0.01 ||
        Math.abs(optimizedSection.minZ - section.minZ) > 0.01 ||
        Math.abs(optimizedSection.maxZ - section.maxZ) > 0.01
      ) {
        sectionsUpdated = true;
      }

      return optimizedSection;
    });

    if (sectionsUpdated) {
      setBasePlate(prev => {
        if (!prev || prev.type !== 'multi-section' || !prev.sections) return prev;
        
        // Dispatch events for each updated section
        updatedSections.forEach((section, index) => {
          const originalSection = prev.sections![index];
          if (
            Math.abs(section.minX - originalSection.minX) > 0.01 ||
            Math.abs(section.maxX - originalSection.maxX) > 0.01 ||
            Math.abs(section.minZ - originalSection.minZ) > 0.01 ||
            Math.abs(section.maxZ - originalSection.maxZ) > 0.01
          ) {
            window.dispatchEvent(new CustomEvent('baseplate-section-updated', {
              detail: {
                basePlateId: prev.id,
                sectionId: section.id,
                newBounds: {
                  minX: section.minX,
                  maxX: section.maxX,
                  minZ: section.minZ,
                  maxZ: section.maxZ,
                }
              }
            }));
          }
        });
        
        return { ...prev, sections: updatedSections };
      });
      
      // Trigger CSG recalculation after sections update - but only if not actively dragging
      if (mountingHoles.length > 0 && !isDraggingHoleRef.current && !isDraggingSupportRef.current && !isDraggingLabelRef.current && !isDraggingClampRef.current) {
        const timer = setTimeout(() => {
          if (!isDraggingHoleRef.current && !isDraggingSupportRef.current && !isDraggingLabelRef.current && !isDraggingClampRef.current) {
            setHoleCSGTrigger(t => t + 1);
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [basePlate?.type, basePlate?.sections, basePlate?.padding, supports, placedClamps, labels, mountingHoles, clampSupportInfos, calculateOptimalSectionBounds, itemBoundsUpdateTrigger]);

  // Build a THREE.Mesh for a support using the same dimensions/origining as SupportMesh
  const buildSupportMesh = useCallback((support: AnySupport, baseTop: number) => {
    const { type, height, center } = support as any;
    const rotY = (support as any).rotationZ ?? 0;
    const effectiveBaseY = (support as any).baseY ?? baseTop;

    let geometry: THREE.BufferGeometry | null = null;
    const position = new THREE.Vector3(center.x, effectiveBaseY, center.y);
    const rotation = new THREE.Euler(0, rotY, 0);

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

  // Handle cavity subtraction - cut supports (including clamp supports) with ALL offset meshes using web worker
  // Strategy: Cut each support individually against all offset meshes (for all parts)
  // Then add labels and subtract fixture_cutouts at the end
  React.useEffect(() => {
    const handleExecuteCavitySubtraction = async (e: CustomEvent) => {
      const { settings } = e.detail || {};
      const clearanceTolerance = settings?.offsetDistance ?? 0.5;
      
      // Extract CSG cleanup settings from cavity settings
      const csgMinVolume = settings?.csgMinVolume ?? 1.0;
      const csgMinThickness = settings?.csgMinThickness ?? 0.5;
      const csgMinTriangles = settings?.csgMinTriangles ?? 5;
      const csgEnableLocalThickness = settings?.csgEnableLocalThickness ?? true;
      
      console.log('[3DScene] CSG Cleanup settings:', {
        csgMinVolume,
        csgMinThickness,
        csgMinTriangles,
        csgEnableLocalThickness,
        settingsProvided: !!settings
      });
      
      if (offsetMeshPreviews.size === 0) {
        console.warn('[3DScene] No offset mesh previews available for cavity subtraction');
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { success: false, error: 'No offset mesh previews available' }
        }));
        return;
      }

      const hasSupports = supports && supports.length > 0;
      const hasClampSupports = placedClamps && placedClamps.length > 0;
      
      if (!hasSupports && !hasClampSupports) {
        console.warn('[3DScene] No supports (regular or clamp) available for cavity subtraction');
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { success: false, error: 'No supports available' }
        }));
        return;
      }

      try {
        // Collect all cutter geometries from all offset mesh previews (one per part)
        const cutterGeometries: THREE.BufferGeometry[] = [];
        
        for (const [partId, offsetMesh] of offsetMeshPreviews) {
          console.log(`[3DScene] Preparing cutter geometry for part ${partId}`);
          
          // Get the cutter (offset mesh) geometry in world space
          const cutterGeometry = offsetMesh.geometry.clone();
          offsetMesh.updateMatrixWorld(true);
          cutterGeometry.applyMatrix4(offsetMesh.matrixWorld);
          
          // Prepare cutter geometry
          if (!cutterGeometry.index) {
            const posAttr = cutterGeometry.getAttribute('position');
            const vertexCount = posAttr.count;
            const indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
            cutterGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
          if (!cutterGeometry.getAttribute('uv')) {
            const position = cutterGeometry.getAttribute('position');
            const uvArray = new Float32Array(position.count * 2);
            cutterGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
          }
          cutterGeometry.computeVertexNormals();
          
          cutterGeometries.push(cutterGeometry);
        }
        
        console.log(`[3DScene] Prepared ${cutterGeometries.length} cutter geometries for ${offsetMeshPreviews.size} parts`);

        // Prepare regular support geometries for batch processing
        const supportsToProcess: Array<{ id: string; geometry: THREE.BufferGeometry; isClampSupport?: boolean }> = [];
        
        for (const support of supports) {
          const supportGeometry = buildFullSupportGeometry(support, baseTopY, false);
          if (!supportGeometry) continue;
          
          // Prepare support geometry for CSG
          if (!supportGeometry.index) {
            const posAttr = supportGeometry.getAttribute('position');
            const vertexCount = posAttr.count;
            const indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
            supportGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
          if (!supportGeometry.getAttribute('uv')) {
            const position = supportGeometry.getAttribute('position');
            const uvArray = new Float32Array(position.count * 2);
            supportGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
          }
          supportGeometry.computeVertexNormals();
          
          supportsToProcess.push({ id: support.id, geometry: supportGeometry, isClampSupport: false });
        }

        // === ADD CLAMP SUPPORTS ===
        // Build clamp support geometries and add them to the processing list
        for (const clamp of placedClamps) {
          const clampData = loadedClampDataRef.current.get(clamp.id);
          const supportInfo = clampSupportInfos.get(clamp.id);
          
          if (!clampData?.supportInfo || !supportInfo) {
            console.log(`[3DScene] Skipping clamp ${clamp.id} - no support info`);
            continue;
          }
          
          // Build clamp support geometry using the same logic as ClampSupportMesh
          const polygon = clampData.supportInfo.polygon;
          const mountSurfaceLocalY = clampData.supportInfo.mountSurfaceLocalY;
          const fixturePointY = clampData.supportInfo.fixturePointY;
          
          // Calculate support height
          const mountSurfaceWorldY = clamp.position.y + (mountSurfaceLocalY - fixturePointY);
          const supportHeight = Math.max(1.0, mountSurfaceWorldY - baseTopY);
          
          // Build geometry at origin
          const clampSupportGeometry = buildClampSupportGeometryAtOrigin(polygon, supportHeight, 2);
          if (!clampSupportGeometry) continue;
          
          // Transform to world position (same logic as ClampSupportMesh)
          const worldRotationY = THREE.MathUtils.degToRad(clamp.rotation.y);
          const transformMatrix = new THREE.Matrix4()
            .makeRotationY(worldRotationY)
            .setPosition(clamp.position.x, baseTopY, clamp.position.z);
          clampSupportGeometry.applyMatrix4(transformMatrix);
          
          // Prepare for CSG
          if (!clampSupportGeometry.index) {
            const posAttr = clampSupportGeometry.getAttribute('position');
            const vertexCount = posAttr.count;
            const indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
            clampSupportGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
          if (!clampSupportGeometry.getAttribute('uv')) {
            const position = clampSupportGeometry.getAttribute('position');
            const uvArray = new Float32Array(position.count * 2);
            clampSupportGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
          }
          clampSupportGeometry.computeVertexNormals();
          
          supportsToProcess.push({ 
            id: `clamp-support-${clamp.id}`, 
            geometry: clampSupportGeometry, 
            isClampSupport: true 
          });
          
          console.log(`[3DScene] Added clamp support for ${clamp.id}, height: ${supportHeight.toFixed(2)}mm`);
        }

        if (supportsToProcess.length === 0) {
          window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
            detail: { success: false, error: 'No valid support geometries' }
          }));
          return;
        }

        // For each support, we need to subtract ALL cutter geometries (all part cavities)
        // Process supports sequentially, and for each support, subtract all cutters
        console.log(`[3DScene] Starting batch CSG subtraction for ${supportsToProcess.length} supports (${supports.length} regular + ${placedClamps.length} clamp) against ${cutterGeometries.length} cutters...`);
        
        const allResultGeometries = new Map<string, THREE.BufferGeometry>();
        const totalOperations = supportsToProcess.length * cutterGeometries.length;
        let completedOperations = 0;
        
        for (const supportItem of supportsToProcess) {
          let currentSupportGeometry = supportItem.geometry;
          
          // Subtract each cutter from this support sequentially
          for (let cutterIdx = 0; cutterIdx < cutterGeometries.length; cutterIdx++) {
            const cutterGeometry = cutterGeometries[cutterIdx];
            
            window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
              detail: { 
                current: completedOperations + 1, 
                total: totalOperations, 
                supportId: supportItem.id, 
                stage: `Cutting ${supportItem.isClampSupport ? 'clamp ' : ''}support with part ${cutterIdx + 1}/${cutterGeometries.length}`
              }
            }));
            
            try {
              // Perform CSG subtraction for this support against this cutter
              const singleSupportArray = [{ id: supportItem.id, geometry: currentSupportGeometry }];
              const result = await performBatchCSGSubtractionInWorker(
                singleSupportArray,
                cutterGeometry,
                (current, total, supportId, stage) => {
                  // Progress is already being reported above
                }
              );
              
              if (result.has(supportItem.id)) {
                // Replace the support geometry with the result for the next iteration
                if (currentSupportGeometry !== supportItem.geometry) {
                  currentSupportGeometry.dispose(); // Dispose intermediate result
                }
                currentSupportGeometry = result.get(supportItem.id)!;
                // Note: No intermediate cleanup - we'll clean up the final merged result
              }
            } catch (err) {
              console.warn(`[3DScene] CSG subtraction failed for support ${supportItem.id} with cutter ${cutterIdx}:`, err);
            }
            
            completedOperations++;
          }
          
          // Store the final result for this support
          allResultGeometries.set(supportItem.id, currentSupportGeometry);
          
          // INCREMENTAL UPDATE: Show this cut support immediately as it's ready (only for regular supports)
          // This provides visual feedback while other supports are still being processed
          if (!supportItem.isClampSupport) {
            setModifiedSupportGeometries(prev => {
              const updated = new Map(prev);
              updated.set(supportItem.id, currentSupportGeometry);
              return updated;
            });
          }
          
          console.log(`[3DScene] Support ${supportItem.id} cut complete (${allResultGeometries.size}/${supportsToProcess.length})`);
        }

        const successCount = allResultGeometries.size;
        const errorCount = supportsToProcess.length - successCount;

        // Clean up individual support geometries - repair bad triangles from CSG operations
        console.log('[3DScene] Cleaning up individual support geometries...');
        const cleanedGeometries = new Map<string, THREE.BufferGeometry>();
        
        for (const [supportId, geometry] of allResultGeometries) {
          try {
            const analysis = await analyzeMesh(geometry);
            if (analysis.hasDegenerateFaces || !analysis.isManifold) {
              console.log(`[3DScene] Repairing support ${supportId}: degenerate=${analysis.hasDegenerateFaces}, manifold=${analysis.isManifold}`);
              const repairResult = await repairMesh(geometry);
              if (repairResult.success && repairResult.geometry) {
                cleanedGeometries.set(supportId, repairResult.geometry);
                geometry.dispose(); // Dispose the original unrepaired geometry
              } else {
                cleanedGeometries.set(supportId, geometry); // Keep original if repair fails
              }
            } else {
              cleanedGeometries.set(supportId, geometry);
            }
          } catch (err) {
            console.warn(`[3DScene] Failed to analyze/repair support ${supportId}:`, err);
            cleanedGeometries.set(supportId, geometry);
          }
        }
        
        // Update state with cleaned geometries (only for regular supports)
        const regularSupportGeometries = new Map<string, THREE.BufferGeometry>();
        cleanedGeometries.forEach((geom, id) => {
          if (!id.startsWith('clamp-support-')) {
            regularSupportGeometries.set(id, geom);
          }
        });
        setModifiedSupportGeometries(regularSupportGeometries);

        if (successCount > 0) {
          // Clear all offset mesh previews
          offsetMeshPreviews.forEach(mesh => {
            mesh.geometry?.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
              } else {
                mesh.material.dispose();
              }
            }
          });
          setOffsetMeshPreviews(new Map());
          
          // === STEP 2: Union all cut supports with baseplate ===
          console.log(`[3DScene] Starting CSG union of ${cleanedGeometries.size} supports with baseplate...`);
          
          window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
            detail: { 
              current: 0, 
              total: cleanedGeometries.size + 1, 
              stage: 'Merging supports with baseplate...'
            }
          }));
          
          // Get baseplate geometry if available
          // For regular baseplates: use baseplateWithHoles if it exists (holes already cut), otherwise use original baseplate
          // For multi-section baseplates: collect all section geometries (which already have holes from useSectionHoleCSG)
          let baseplateGeometry: THREE.BufferGeometry | undefined;
          let useBaseplateWithHoles = baseplateWithHoles !== null;
          const isMultiSection = basePlate?.type === 'multi-section';
          
          if (isMultiSection && multiSectionBasePlateGroupRef.current) {
            // === MULTI-SECTION BASEPLATE ===
            // Collect all section geometries from the group
            // These already have holes cut via useSectionHoleCSG
            console.log('[3DScene] Collecting multi-section baseplate geometries...');
            
            const sectionGeometries: THREE.BufferGeometry[] = [];
            multiSectionBasePlateGroupRef.current.updateMatrixWorld(true);
            
            multiSectionBasePlateGroupRef.current.traverse((child) => {
              if (child instanceof THREE.Mesh && child.geometry) {
                // Clone and transform to world space
                const sectionGeo = child.geometry.clone();
                child.updateMatrixWorld(true);
                sectionGeo.applyMatrix4(child.matrixWorld);
                sectionGeometries.push(sectionGeo);
              }
            });
            
            if (sectionGeometries.length > 0) {
              console.log(`[3DScene] Found ${sectionGeometries.length} multi-section baseplate sections`);
              
              // Union all sections together into one geometry
              if (sectionGeometries.length === 1) {
                baseplateGeometry = sectionGeometries[0];
              } else {
                // Merge all section geometries using BufferGeometryUtils
                const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
                
                // Prepare each geometry for merging
                for (const geo of sectionGeometries) {
                  if (!geo.index) {
                    const posAttr = geo.getAttribute('position');
                    const vertexCount = posAttr.count;
                    const indices = new Uint32Array(vertexCount);
                    for (let i = 0; i < vertexCount; i++) indices[i] = i;
                    geo.setIndex(new THREE.BufferAttribute(indices, 1));
                  }
                  if (!geo.getAttribute('uv')) {
                    const position = geo.getAttribute('position');
                    const uvArray = new Float32Array(position.count * 2);
                    geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                  }
                  geo.computeVertexNormals();
                }
                
                const mergedGeo = mergeGeometries(sectionGeometries, false);
                if (mergedGeo) {
                  baseplateGeometry = mergedGeo;
                  // Dispose individual section geometries after merging
                  sectionGeometries.forEach(geo => geo.dispose());
                  console.log('[3DScene] Merged multi-section baseplate geometries');
                } else {
                  // Fallback: use just the first section
                  baseplateGeometry = sectionGeometries[0];
                  for (let i = 1; i < sectionGeometries.length; i++) {
                    sectionGeometries[i].dispose();
                  }
                  console.warn('[3DScene] Failed to merge multi-section geometries, using first section only');
                }
              }
              
              // Multi-section baseplates already have holes cut, so skip hole subtraction later
              useBaseplateWithHoles = true;
              console.log('[3DScene] Using multi-section baseplate (holes already cut per section)');
            }
          } else if (useBaseplateWithHoles && baseplateWithHoles) {
            // === REGULAR BASEPLATE WITH HOLES ===
            // Use the baseplate geometry that already has holes cut
            // This geometry is already in local space, need to transform to world space
            baseplateGeometry = baseplateWithHoles.clone();
            if (basePlateMeshRef.current) {
              basePlateMeshRef.current.updateMatrixWorld(true);
              baseplateGeometry.applyMatrix4(basePlateMeshRef.current.matrixWorld);
            }
            console.log('[3DScene] Using baseplateWithHoles (holes already cut)');
          } else if (basePlateMeshRef.current) {
            // === REGULAR BASEPLATE WITHOUT HOLES ===
            basePlateMeshRef.current.updateMatrixWorld(true);
            baseplateGeometry = basePlateMeshRef.current.geometry.clone();
            baseplateGeometry.applyMatrix4(basePlateMeshRef.current.matrixWorld);
            console.log('[3DScene] Using original baseplate geometry');
          }
          
          if (baseplateGeometry) {
            // Ensure baseplate geometry has proper attributes for CSG
            if (!baseplateGeometry.index) {
              const posAttr = baseplateGeometry.getAttribute('position');
              const vertexCount = posAttr.count;
              const indices = new Uint32Array(vertexCount);
              for (let i = 0; i < vertexCount; i++) indices[i] = i;
              baseplateGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
            }
            if (!baseplateGeometry.getAttribute('uv')) {
              const position = baseplateGeometry.getAttribute('position');
              const uvArray = new Float32Array(position.count * 2);
              baseplateGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            baseplateGeometry.computeVertexNormals();
          }
          
          // Prepare geometries for union (including all cut supports - regular and clamp)
          const geometriesForUnion: Array<{ id: string; geometry: THREE.BufferGeometry }> = [];
          cleanedGeometries.forEach((geom, supportId) => {
            // Ensure geometry has proper attributes for CSG
            if (!geom.index) {
              const posAttr = geom.getAttribute('position');
              const vertexCount = posAttr.count;
              const indices = new Uint32Array(vertexCount);
              for (let i = 0; i < vertexCount; i++) indices[i] = i;
              geom.setIndex(new THREE.BufferAttribute(indices, 1));
            }
            if (!geom.getAttribute('uv')) {
              const position = geom.getAttribute('position');
              const uvArray = new Float32Array(position.count * 2);
              geom.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            geometriesForUnion.push({ id: supportId, geometry: geom });
          });
          
          // === ADD LABELS TO UNION ===
          // Use labelsRef.current to get the latest labels (avoid stale closure)
          const currentLabels = labelsRef.current;
          console.log(`[3DScene] Labels ref:`, currentLabels, `Count: ${currentLabels?.length ?? 0}`);
          if (currentLabels && currentLabels.length > 0) {
            console.log(`[3DScene] Adding ${currentLabels.length} labels to union...`);
            window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
              detail: { current: 0, total: currentLabels.length, stage: 'Building label geometries...' }
            }));
            
            for (let i = 0; i < currentLabels.length; i++) {
              const label = currentLabels[i];
              console.log(`[3DScene] Building geometry for label ${i + 1}/${currentLabels.length}: "${label.text}" at`, label.position);
              try {
                const labelGeometry = await buildLabelGeometry(label);
                console.log(`[3DScene] Label geometry result for "${label.text}":`, labelGeometry ? 'SUCCESS' : 'NULL');
                if (labelGeometry) {
                  // Prepare label geometry for CSG
                  if (!labelGeometry.index) {
                    const posAttr = labelGeometry.getAttribute('position');
                    const vertexCount = posAttr.count;
                    const indices = new Uint32Array(vertexCount);
                    for (let j = 0; j < vertexCount; j++) indices[j] = j;
                    labelGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
                  }
                  if (!labelGeometry.getAttribute('uv')) {
                    const position = labelGeometry.getAttribute('position');
                    const uvArray = new Float32Array(position.count * 2);
                    labelGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                  }
                  labelGeometry.computeVertexNormals();
                  
                  console.log(`[3DScene] Label geometry stats - vertices: ${labelGeometry.getAttribute('position').count}, hasIndex: ${!!labelGeometry.index}`);
                  geometriesForUnion.push({ id: `label-${label.id}`, geometry: labelGeometry });
                  console.log(`[3DScene] Added label: ${label.text}, total geometries for union: ${geometriesForUnion.length}`);
                }
              } catch (err) {
                console.warn(`[3DScene] Failed to build label geometry for "${label.text}":`, err);
              }
            }
          } else {
            console.log(`[3DScene] No labels to add to union`);
          }
          
          // Log final geometries being sent to union
          console.log(`[3DScene] Sending ${geometriesForUnion.length} geometries to union worker:`, 
            geometriesForUnion.map(g => ({ id: g.id, vertices: g.geometry.getAttribute('position')?.count }))
          );
          
          try {
            const mergedGeometry = await performBatchCSGUnionInWorker(
              geometriesForUnion,
              baseplateGeometry,
              (current, total, stage) => {
                console.log(`[3DScene] Union Progress: ${current}/${total} - ${stage}`);
                window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                  detail: { current, total, stage: `Merging: ${stage}` }
                }));
              }
            );
            
            if (mergedGeometry) {
              // === STEP 3: SUBTRACT FIXTURE CUTOUTS FROM ALL CLAMPS ===
              // This ensures any clamp cutouts that overlap with supports are properly cut
              let finalGeometry = mergedGeometry;
              
              if (placedClamps.length > 0) {
                console.log(`[3DScene] Subtracting fixture cutouts from ${placedClamps.length} clamps...`);
                window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                  detail: { current: 0, total: placedClamps.length, stage: 'Subtracting clamp fixture cutouts...' }
                }));
                
                for (let i = 0; i < placedClamps.length; i++) {
                  const clamp = placedClamps[i];
                  const clampData = loadedClampDataRef.current.get(clamp.id);
                  
                  if (!clampData?.fixtureCutoutsGeometry) {
                    console.log(`[3DScene] No fixture cutouts for clamp ${clamp.id}`);
                    continue;
                  }
                  
                  window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                    detail: { 
                      current: i + 1, 
                      total: placedClamps.length, 
                      stage: `Cutting fixture cutouts ${i + 1}/${placedClamps.length}...` 
                    }
                  }));
                  
                  try {
                    // Clone and transform cutouts to world space
                    const cutoutsGeometry = clampData.fixtureCutoutsGeometry.clone();
                    
                    // Transform cutouts: first offset from fixture point, then rotate and position
                    const fpCenter = clampData.fixturePointTopCenter;
                    cutoutsGeometry.translate(-fpCenter.x, -fpCenter.y, -fpCenter.z);
                    
                    // Apply clamp world transform
                    const worldRotationY = THREE.MathUtils.degToRad(clamp.rotation.y);
                    const transformMatrix = new THREE.Matrix4()
                      .makeRotationY(worldRotationY)
                      .setPosition(clamp.position.x, clamp.position.y, clamp.position.z);
                    cutoutsGeometry.applyMatrix4(transformMatrix);
                    
                    // Prepare for CSG
                    if (!cutoutsGeometry.index) {
                      const posAttr = cutoutsGeometry.getAttribute('position');
                      const vertexCount = posAttr.count;
                      const indices = new Uint32Array(vertexCount);
                      for (let j = 0; j < vertexCount; j++) indices[j] = j;
                      cutoutsGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
                    }
                    if (!cutoutsGeometry.getAttribute('uv')) {
                      const position = cutoutsGeometry.getAttribute('position');
                      const uvArray = new Float32Array(position.count * 2);
                      cutoutsGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                    }
                    cutoutsGeometry.computeVertexNormals();
                    
                    // Perform CSG subtraction
                    const subtractionResult = await performBatchCSGSubtractionInWorker(
                      [{ id: 'fixture', geometry: finalGeometry }],
                      cutoutsGeometry,
                      () => {}
                    );
                    
                    if (subtractionResult.has('fixture')) {
                      finalGeometry.dispose();
                      finalGeometry = subtractionResult.get('fixture')!;
                      console.log(`[3DScene] Subtracted fixture cutouts for clamp ${clamp.id}`);
                    }
                    
                    cutoutsGeometry.dispose();
                  } catch (err) {
                    console.warn(`[3DScene] Failed to subtract fixture cutouts for clamp ${clamp.id}:`, err);
                  }
                }
              }
              
              // === STEP 3.5: SUBTRACT MOUNTING HOLES ===
              // Skip this step if we already used baseplateWithHoles (holes already cut into baseplate)
              if (mountingHoles.length > 0 && !useBaseplateWithHoles) {
                console.log(`[3DScene] Subtracting ${mountingHoles.length} mounting holes from fixture...`);
                window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                  detail: { current: 85, total: 100, stage: 'Cutting mounting holes...' }
                }));
                
                try {
                  // For final geometry which is in world space, we need world-space holes
                  // baseTopY is already the world Y of the baseplate top surface
                  // Hole positions are stored in world space (x, z) in the position Vector2
                  // No offset needed since finalGeometry is in world space
                  
                  // Ensure all holes have correct depth (use baseplate depth for through holes)
                  const baseplateDepth = basePlate?.depth ?? 20;
                  const holesWithCorrectDepth = mountingHoles.map(hole => ({
                    ...hole,
                    depth: hole.depth || baseplateDepth
                  }));
                  
                  console.log(`[3DScene] Creating hole geometry with baseTopY=${baseTopY}, baseplateDepth=${baseplateDepth}`, 
                    holesWithCorrectDepth.map(h => ({
                      id: h.id,
                      type: h.type,
                      diameter: h.diameter,
                      depth: h.depth,
                      position: { x: h.position.x, z: h.position.y }
                    }))
                  );
                  
                  // Create holes in world space - no offset needed since finalGeometry is in world space
                  const holesGeometry = createMergedHolesGeometry(holesWithCorrectDepth, baseTopY, undefined);
                  
                  if (holesGeometry) {
                    // Ensure proper geometry attributes for CSG
                    if (!holesGeometry.index) {
                      const posAttr = holesGeometry.getAttribute('position');
                      const vertexCount = posAttr.count;
                      const indices = new Uint32Array(vertexCount);
                      for (let i = 0; i < vertexCount; i++) indices[i] = i;
                      holesGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
                    }
                    if (!holesGeometry.getAttribute('uv')) {
                      const position = holesGeometry.getAttribute('position');
                      const uvArray = new Float32Array(position.count * 2);
                      holesGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                    }
                    holesGeometry.computeVertexNormals();
                    
                    // Perform CSG subtraction
                    const subtractionResult = await performBatchCSGSubtractionInWorker(
                      [{ id: 'fixture', geometry: finalGeometry }],
                      holesGeometry,
                      () => {}
                    );
                    
                    if (subtractionResult.has('fixture')) {
                      finalGeometry.dispose();
                      finalGeometry = subtractionResult.get('fixture')!;
                      console.log(`[3DScene] Subtracted ${mountingHoles.length} mounting holes`);
                    }
                    
                    holesGeometry.dispose();
                  }
                } catch (err) {
                  console.warn('[3DScene] Failed to subtract mounting holes:', err);
                }
              }
              
              // STEP 4: Display the final merged geometry IMMEDIATELY
              // This gives instant visual feedback while cleanup runs in background
              console.log('[3DScene] Displaying final merged geometry...');
              
              // Create merged fixture mesh with amber color
              const amberMaterial = new THREE.MeshStandardMaterial({
                color: 0xFFBF00, // Amber
                metalness: 0.1,
                roughness: 0.6,
                side: THREE.DoubleSide,
              });
              
              // Dispose old merged fixture if exists
              if (mergedFixtureMesh) {
                mergedFixtureMesh.geometry?.dispose();
                if (mergedFixtureMesh.material) {
                  if (Array.isArray(mergedFixtureMesh.material)) {
                    mergedFixtureMesh.material.forEach(m => m.dispose());
                  } else {
                    mergedFixtureMesh.material.dispose();
                  }
                }
              }
              
              const rawFixtureMesh = new THREE.Mesh(finalGeometry.clone(), amberMaterial);
              rawFixtureMesh.name = 'merged-fixture';
              rawFixtureMesh.castShadow = true;
              rawFixtureMesh.receiveShadow = true;
              
              setMergedFixtureMesh(rawFixtureMesh);
              console.log(`[3DScene] Final merged fixture displayed with ${finalGeometry.getAttribute('position').count / 3} vertices`);
              
              // STEP 5: Run manifold analysis, repair, and cleanup in background
              // This happens asynchronously and updates the mesh when complete
              window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                detail: { current: 90, total: 100, stage: 'Starting background cleanup...' }
              }));
              
              // Run cleanup in a setTimeout to allow the UI to update first
              // Capture finalGeometry for the async closure
              const geometryToClean = finalGeometry;
              setTimeout(async () => {
                try {
                  console.log('[3DScene] Starting background manifold analysis and cleanup...');
                  
                  // Step 5a: Analyze the mesh for manifold issues
                  const analysisResult = await analyzeMesh(geometryToClean);
                  console.log('[3DScene] Mesh analysis:', {
                    isManifold: analysisResult.isManifold,
                    hasDegenerateFaces: analysisResult.hasDegenerateFaces,
                    hasNonManifoldEdges: analysisResult.hasNonManifoldEdges,
                    vertexCount: analysisResult.vertexCount,
                    triangleCount: analysisResult.triangleCount,
                  });
                  
                  let workingGeometry = geometryToClean;
                  
                  // Step 5b: Repair if needed
                  if (analysisResult.hasDegenerateFaces || !analysisResult.isManifold || analysisResult.hasNonManifoldEdges) {
                    console.log('[3DScene] Repairing mesh...');
                    window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                      detail: { current: 93, total: 100, stage: 'Repairing mesh...' }
                    }));
                    
                    const repairResult = await repairMesh(workingGeometry);
                    if (repairResult.success && repairResult.geometry) {
                      workingGeometry = repairResult.geometry;
                      console.log('[3DScene] Mesh repair completed:', repairResult.actions);
                    }
                  }
                  
                  // Step 5c: CSG Cleanup - remove small components and degenerate triangles
                  console.log('[3DScene] Running CSG cleanup...');
                  window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                    detail: { current: 96, total: 100, stage: 'Cleaning up artifacts...' }
                  }));
                  
                  const cleanupResult = await cleanupCSGResult(workingGeometry, {
                    minVolume: csgMinVolume,
                    minTriangles: csgMinTriangles,
                    minTriangleArea: 0.0001, // More aggressive: 0.0001 mm² (was 0.001)
                    keepLargestN: 0,
                    minThickness: csgMinThickness,
                    vertexMergeTolerance: 0.001, // Tighter tolerance for better component detection
                  });
                  
                  let cleanedGeometry = workingGeometry;
                  
                  if (cleanupResult.success && cleanupResult.geometry) {
                    cleanedGeometry = cleanupResult.geometry;
                    console.log('[3DScene] CSG cleanup result:', {
                      originalTriangles: cleanupResult.originalTriangles,
                      finalTriangles: cleanupResult.finalTriangles,
                      componentsFound: cleanupResult.componentsFound,
                      componentsRemoved: cleanupResult.componentsRemoved,
                      degenerateTrianglesRemoved: cleanupResult.degenerateTrianglesRemoved,
                      actions: cleanupResult.actions,
                    });
                  }
                  
                  // Step 5d: Update the displayed mesh with cleaned geometry
                  if (cleanedGeometry !== geometryToClean) {
                    console.log('[3DScene] Updating fixture with cleaned geometry...');
                    
                    const cleanedMaterial = new THREE.MeshStandardMaterial({
                      color: 0xFFBF00, // Amber
                      metalness: 0.1,
                      roughness: 0.6,
                      side: THREE.DoubleSide,
                    });
                    
                    const cleanedFixtureMesh = new THREE.Mesh(cleanedGeometry, cleanedMaterial);
                    cleanedFixtureMesh.name = 'merged-fixture';
                    cleanedFixtureMesh.castShadow = true;
                    cleanedFixtureMesh.receiveShadow = true;
                    
                    setMergedFixtureMesh(prevMesh => {
                      // Dispose the old raw mesh
                      if (prevMesh) {
                        prevMesh.geometry?.dispose();
                        if (prevMesh.material) {
                          if (Array.isArray(prevMesh.material)) {
                            prevMesh.material.forEach(m => m.dispose());
                          } else {
                            prevMesh.material.dispose();
                          }
                        }
                      }
                      return cleanedFixtureMesh;
                    });
                    
                    console.log(`[3DScene] Cleaned fixture updated with ${cleanedGeometry.getAttribute('position').count / 3} vertices`);
                  }
                  
                  window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                    detail: { current: 100, total: 100, stage: 'Cleanup complete' }
                  }));
                  
                } catch (cleanupErr) {
                  console.error('[3DScene] Background cleanup failed:', cleanupErr);
                  // Keep the raw geometry - it's already displayed
                }
              }, 100); // Small delay to let UI render first
            } else {
              console.warn('[3DScene] CSG union returned no result');
            }
            
            // Clean up baseplate geometry clone
            baseplateGeometry?.dispose();
          } catch (unionErr) {
            console.error('[3DScene] CSG union failed:', unionErr);
          }
        }
        
        // Clean up cutter geometries
        cutterGeometries.forEach(geom => geom.dispose());
        
        console.log(`[3DScene] Batch CSG completed: ${successCount} success, ${errorCount} failed`);
        
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { 
            success: successCount > 0, 
            successCount, 
            errorCount,
            totalSupports: supports.length + placedClamps.length,
            totalClampSupports: placedClamps.length,
            totalLabels: labelsRef.current?.length || 0,
            totalParts: offsetMeshPreviews.size
          }
        }));

      } catch (err) {
        console.error('[3DScene] Cavity subtraction failed:', err);
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { success: false, error: String(err) }
        }));
      }
    };

    window.addEventListener('execute-cavity-subtraction', handleExecuteCavitySubtraction as EventListener);
    return () => {
      window.removeEventListener('execute-cavity-subtraction', handleExecuteCavitySubtraction as EventListener);
    };
  }, [offsetMeshPreviews, supports, basePlate, baseTopY, placedClamps, clampSupportInfos, labels, mountingHoles, baseplateWithHoles]);

  // Handle reset cavity event
  React.useEffect(() => {
    const handleResetCavity = () => {
      console.log('[3DScene] Resetting cavity - clearing merged fixture and restoring original supports');
      
      // Dispose and clear the merged fixture mesh
      if (mergedFixtureMesh) {
        mergedFixtureMesh.geometry?.dispose();
        if (mergedFixtureMesh.material) {
          if (Array.isArray(mergedFixtureMesh.material)) {
            mergedFixtureMesh.material.forEach(m => m.dispose());
          } else {
            mergedFixtureMesh.material.dispose();
          }
        }
        setMergedFixtureMesh(null);
      }
      
      // Dispose and clear modified support geometries to restore original supports
      modifiedSupportGeometries.forEach((geometry) => {
        geometry.dispose();
      });
      setModifiedSupportGeometries(new Map());
      
      // Clear the trimmed supports preview to show original supports again
      setSupportsTrimPreview([]);
      
      // Clear all offset mesh previews
      offsetMeshPreviews.forEach(mesh => {
        mesh.geometry?.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      setOffsetMeshPreviews(new Map());
      
      console.log('[3DScene] Cavity reset complete - supports restored to original state');
    };

    window.addEventListener('reset-cavity', handleResetCavity as EventListener);
    return () => {
      window.removeEventListener('reset-cavity', handleResetCavity as EventListener);
    };
  }, [mergedFixtureMesh, offsetMeshPreviews, modifiedSupportGeometries]);

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

      // Default baseplate thickness (5mm)
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
        const cornerRadius = 5; // Constant corner radius for rounded edges
        // Convex hull computes its own shape from geometry, position stays at origin
        cfg = { ...cfg, type: 'convex-hull', depth, oversizeXY, cornerRadius, width: size.x + oversizeXY * 2, height: size.z + oversizeXY * 2 };
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
      } else if (option === 'multi-section') {
        // Multi-section baseplate - uses drawn sections
        const sections = dimensions?.sections as BasePlateSection[] | undefined;
        if (!sections || sections.length === 0) {
          console.warn('Multi-section baseplate requires sections');
          return;
        }
        
        console.log('[BasePlate Creation] Sections received from AppShell:', sections.map(s => JSON.stringify({
          id: s.id,
          minX: s.minX,
          maxX: s.maxX,
          minZ: s.minZ,
          maxZ: s.maxZ
        })).join('\\n'));
        
        // Validate all sections have valid bounds
        const invalidSection = sections.find(s => 
          !isFinite(s.minX) || !isFinite(s.maxX) || !isFinite(s.minZ) || !isFinite(s.maxZ)
        );
        if (invalidSection) {
          console.error('[BasePlate Creation] Invalid section detected:', JSON.stringify(invalidSection));
          return;
        }
        
        // If there's an existing multi-section baseplate, append new sections to it
        const existingSections = basePlate?.type === 'multi-section' ? (basePlate.sections || []) : [];
        const combinedSections = [...existingSections, ...sections];
        
        // Merge overlapping sections
        const allSections = mergeOverlappingSections(combinedSections);
        
        console.log('[BasePlate Creation] After merging, sections:', allSections.map(s => JSON.stringify({
          id: s.id,
          minX: s.minX,
          maxX: s.maxX,
          minZ: s.minZ,
          maxZ: s.maxZ
        })).join('\n'));
        
        // Validate merged sections
        const invalidMerged = allSections.find(s =>
          !isFinite(s.minX) || !isFinite(s.maxX) || !isFinite(s.minZ) || !isFinite(s.maxZ)
        );
        if (invalidMerged) {
          console.error('[BasePlate Creation] Invalid merged section:', JSON.stringify(invalidMerged));
          return;
        }
        
        const depth = clampPos(dimensions?.height, 1, DEFAULT_THICKNESS);
        const paddingValue = clampPos(dimensions?.padding, 0, 0);
        cfg = { 
          ...cfg, 
          type: 'multi-section', 
          depth, 
          oversizeXY: paddingValue,
          sections: allSections,
          // Calculate overall bounds for the multi-section baseplate
          width: Math.max(...allSections.map(s => s.maxX)) - Math.min(...allSections.map(s => s.minX)),
          height: Math.max(...allSections.map(s => s.maxZ)) - Math.min(...allSections.map(s => s.minZ)),
        };
        cfg.position = new THREE.Vector3(0, 0, 0);
        // Clear drawn sections after creating the baseplate
        setDrawnSections([]);
        setIsMultiSectionDrawingMode(false);
        setOrbitControlsEnabled(true);
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
      
      // Notify AppShell of the final baseplate configuration with merged sections
      window.dispatchEvent(new CustomEvent('baseplate-config-updated', {
        detail: {
          id: cfg.id,
          type: cfg.type,
          sections: cfg.sections,
          padding: cfg.oversizeXY,
          height: cfg.depth,
          depth: cfg.depth
        }
      }));
      
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
  }, [importedParts, selectedPartId, basePlate]);

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
      const baseplateTopY = updatedBaseplate.depth ?? 5;
      
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

    const handleSectionRemoved = (e: CustomEvent<{ sectionId: string; sections: BasePlateSection[] }>) => {
      if (!basePlate || basePlate.type !== 'multi-section') return;
      
      // Update baseplate with remaining sections
      setBasePlate({
        ...basePlate,
        sections: e.detail.sections,
        // Recalculate overall bounds
        width: Math.max(...e.detail.sections.map(s => s.maxX)) - Math.min(...e.detail.sections.map(s => s.minX)),
        height: Math.max(...e.detail.sections.map(s => s.maxZ)) - Math.min(...e.detail.sections.map(s => s.minZ)),
      });
    };

    window.addEventListener('baseplate-deselected', handleDeselectBaseplate as EventListener);
    window.addEventListener('cancel-baseplate', handleCancelBaseplate as EventListener);
    window.addEventListener('update-baseplate', handleUpdateBaseplate as EventListener);
    window.addEventListener('remove-baseplate', handleRemoveBaseplate as EventListener);
    window.addEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);

    return () => {
      window.removeEventListener('baseplate-deselected', handleDeselectBaseplate as EventListener);
      window.removeEventListener('cancel-baseplate', handleCancelBaseplate as EventListener);
      window.removeEventListener('update-baseplate', handleUpdateBaseplate as EventListener);
      window.removeEventListener('remove-baseplate', handleRemoveBaseplate as EventListener);
      window.removeEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
    };
  }, [basePlate, importedParts, selectedPartId]);

  // Handle multi-section baseplate drawing mode
  React.useEffect(() => {
    const handleDrawingModeChanged = (e: CustomEvent<{ active: boolean; padding?: number }>) => {
      const isActive = e.detail.active;
      setIsMultiSectionDrawingMode(isActive);
      
      // Update padding if provided
      if (e.detail.padding !== undefined) {
        setMultiSectionPadding(e.detail.padding);
      }
      
      if (isActive) {
        // Entering drawing mode - switch to top view and disable orbit controls
        prevOrientationRef.current = currentOrientation;
        setCurrentOrientation('top');
        updateCamera('top', modelBounds);
        setOrbitControlsEnabled(false);
      } else {
        // Exiting drawing mode - restore previous view and enable orbit controls
        setCurrentOrientation(prevOrientationRef.current);
        updateCamera(prevOrientationRef.current, modelBounds);
        setOrbitControlsEnabled(true);
      }
    };

    window.addEventListener('baseplate-drawing-mode-changed', handleDrawingModeChanged as EventListener);
    return () => window.removeEventListener('baseplate-drawing-mode-changed', handleDrawingModeChanged as EventListener);
  }, [currentOrientation, updateCamera, modelBounds]);

  // Handle section drawn - forward to AppShell
  const handleSectionDrawn = useCallback((section: BasePlateSection) => {
    console.log('[SectionDrawing] Section drawn:', JSON.stringify({
      id: section.id,
      minX: section.minX,
      maxX: section.maxX,
      minZ: section.minZ,
      maxZ: section.maxZ,
      originalWidth: section.originalWidth,
      originalDepth: section.originalDepth
    }));
    window.dispatchEvent(new CustomEvent('baseplate-section-drawn', { detail: section }));
    setDrawnSections(prev => [...prev, section]);
  }, []);

  // Sync drawn sections from AppShell events (for removal)
  React.useEffect(() => {
    const handleSectionRemoved = () => {
      // Re-sync sections from the event if needed
      // For now, the sections are managed locally and synced via events
    };

    window.addEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
    return () => window.removeEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
  }, []);

  // Update rectangular baseplate size and position when model transform changes
  // This recalculates dimensions based on new bounding box after gizmo closes
  // DEBOUNCED: Clamp drag causes frequent placedClamps updates, so we debounce to avoid lag
  React.useEffect(() => {
    if (!basePlate) return;
    // Allow update if there are imported parts OR clamps with support info
    if (importedParts.length === 0 && placedClamps.length === 0) return;
    
    // Only update for non-convex-hull types
    // Convex-hull recalculates its geometry from modelGeometry/modelMatrixWorld props automatically
    if (basePlate.type === 'convex-hull') return;
    
    // Skip during hole drag to prevent updates during gizmo manipulation
    if (isDraggingHoleRef.current) return;
    
    // Debounce the expensive calculation
    const timeoutId = setTimeout(() => {
      // Skip if we started dragging during debounce
      if (isDraggingHoleRef.current) return;
      
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
      
      // Don't return early if box is empty - clamps/supports may still expand it
      
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
      
      // Expand the bounding box to include clamp support footprints
      for (const placedClamp of placedClamps) {
        const supportInfo = clampSupportInfos.get(placedClamp.id);
        if (!supportInfo) continue;
        
        // Transform polygon from clamp local space to world space
        const rotationY = THREE.MathUtils.degToRad(placedClamp.rotation.y);
        const cosR = Math.cos(rotationY);
        const sinR = Math.sin(rotationY);
      
      for (const [localX, localZ] of supportInfo.polygon) {
        // Apply Y-axis rotation and add clamp position
        const worldX = localX * cosR + localZ * sinR + placedClamp.position.x;
        const worldZ = -localX * sinR + localZ * cosR + placedClamp.position.z;
        
        box.min.x = Math.min(box.min.x, worldX);
        box.max.x = Math.max(box.max.x, worldX);
        box.min.z = Math.min(box.min.z, worldZ);
        box.max.z = Math.max(box.max.z, worldZ);
      }
    }
    
    // Expand the bounding box to include mounting hole footprints
    // Holes stay fixed, so use their actual positions
    const HOLE_MARGIN = 3.0; // Same margin as used for hull points
    for (const hole of mountingHoles) {
      const holeX = Number(hole.position?.x) || 0;
      const holeZ = Number(hole.position?.y) || 0; // position.y is Z in world coords
      const radius = (Number(hole.diameter) || 6) / 2;
      const outerRadius = radius + HOLE_MARGIN;
      
      box.min.x = Math.min(box.min.x, holeX - outerRadius);
      box.max.x = Math.max(box.max.x, holeX + outerRadius);
      box.min.z = Math.min(box.min.z, holeZ - outerRadius);
      box.max.z = Math.max(box.max.z, holeZ + outerRadius);
    }
    
    // Expand the bounding box to include label footprints
    // Labels stay fixed, so use their actual positions (with rotation)
    for (const label of labels) {
      const textWidth = label.text.length * label.fontSize * 0.6;
      const textHeight = label.fontSize;
      const padding = 5;
      
      // Get label's rotation (Z rotation when lying flat)
      const rot = label.rotation;
      const rotationAngle = typeof rot === 'object' ? ((rot as any).z || 0) : 0;
      
      const halfW = textWidth / 2 + padding;
      const halfH = textHeight / 2 + padding;
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);
      
      // Calculate rotated corners and find bounds
      const corners = [
        { x: -halfW, z: -halfH },
        { x:  halfW, z: -halfH },
        { x:  halfW, z:  halfH },
        { x: -halfW, z:  halfH }
      ];
      
      const pos = label.position;
      const px = (pos as any).x || 0;
      const pz = (pos as any).z || 0;
      
      for (const corner of corners) {
        const rx = corner.x * cos - corner.z * sin + px;
        const rz = corner.x * sin + corner.z * cos + pz;
        box.min.x = Math.min(box.min.x, rx);
        box.max.x = Math.max(box.max.x, rx);
        box.min.z = Math.min(box.min.z, rz);
        box.max.z = Math.max(box.max.z, rz);
      }
    }
    
    // If box is still empty after all expansions, nothing to update
    if (box.isEmpty()) return;
    
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
    }, 100); // 100ms debounce to avoid lag during drag

    return () => clearTimeout(timeoutId);
  }, [modelTransform.position, modelTransform.rotation, basePlate?.type, supports, labels, livePositionDelta, placedClamps, clampSupportInfos, mountingHoles]);

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
      
      const baseplateTopY = basePlate.depth ?? 5;
      
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
      
      const baseplateTopY = basePlate.depth ?? 5;
      
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
      
      const baseplateTopY = basePlate.depth ?? 5;
      
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
      
      // Clear merged fixture mesh
      setMergedFixtureMesh((prev) => {
        if (prev) {
          prev.geometry?.dispose();
          if (prev.material) {
            if (Array.isArray(prev.material)) {
              prev.material.forEach(m => m.dispose());
            } else {
              prev.material.dispose();
            }
          }
        }
        return null;
      });
      
      // Clear all offset mesh previews
      setOffsetMeshPreviews(prev => {
        prev.forEach(mesh => {
          mesh.geometry?.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(m => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        });
        return new Map();
      });
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
      {/* Scene Lighting - using direct lights instead of HDR environment to avoid memory issues */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1.0} castShadow />
      <directionalLight position={[-10, -10, -5]} intensity={0.5} />
      <directionalLight position={[5, 15, -5]} intensity={0.6} />
      <pointLight position={[0, 10, 0]} intensity={0.4} />
      <pointLight position={[0, -10, 0]} intensity={0.3} />
      <hemisphereLight args={['#ffffff', '#444444', 0.6]} />

      {/* Scalable grid - sized based on combined model bounds (includes world positions) */}
      <ScalableGrid modelBounds={modelBounds} isDarkMode={isDarkMode} />

      {/* Base plate - hide when merged fixture is shown OR when we have baseplateWithHoles OR multi-section (rendered separately) */}
      {basePlate && basePlate.type !== 'multi-section' && baseplateVisible && !mergedFixtureMesh && !baseplateWithHoles && (
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
          cornerRadius={basePlate.cornerRadius}
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
          additionalHullPoints={combinedHullPoints}
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

      {/* Multi-section baseplate - rendered as multiple separate sections */}
      {basePlate && basePlate.type === 'multi-section' && basePlate.sections && baseplateVisible && !mergedFixtureMesh && (
        <MultiSectionBasePlate
          sections={basePlate.sections}
          depth={basePlate.depth ?? 4}
          material={basePlate.material}
          selected={false}
          selectedSectionId={selectedBasePlateSectionId}
          holes={mountingHoles}
          isDraggingHole={isDraggingHole}
          isDraggingAnyItem={isDraggingAnyItem}
          holeCSGTrigger={holeCSGTrigger}
          groupRef={multiSectionBasePlateGroupRef}
          onSelect={() => {
            window.dispatchEvent(new CustomEvent('baseplate-selected', {
              detail: { basePlateId: basePlate.id }
            }));
          }}
          onSectionClick={
            // Only allow section selection when actively placing features
            (waitingForSectionSelection || waitingForClampSectionSelection || waitingForLabelSectionSelection || waitingForHoleSectionSelection || clampPlacementMode.active || holePlacementMode.active)
              ? (sectionId) => {
                  // Single click - select section for feature placement
                  console.log('[SectionSelection] Section clicked:', sectionId);
                  if (basePlate?.type === 'multi-section' && basePlate.sections) {
                    const section = basePlate.sections.find(s => s.id === sectionId);
                    console.log('[SectionSelection] Section state:', JSON.stringify({
                      id: section?.id,
                      minX: section?.minX,
                      maxX: section?.maxX,
                      minZ: section?.minZ,
                      maxZ: section?.maxZ,
                      originalWidth: section?.originalWidth,
                      originalDepth: section?.originalDepth
                    }));
                  }
                  setSelectedBasePlateSectionId(sectionId);
                }
              : undefined
          }
          onSectionDoubleClick={(isMultiSectionDrawingMode || holePlacementMode.active) ? undefined : (sectionId) => {
            // Double click - enter edit mode for moving this section
            // First, notify all other controls to deactivate
            window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { sectionId } }));
            // Clear part selection when selecting a baseplate section
            onPartSelected(null);
            setSelectedBasePlateSectionId(sectionId);
            setEditingBasePlateSectionId(sectionId);
          }}
        />
      )}

      {/* BasePlate section transform controls - XZ plane only - disabled during drawing mode */}
      {editingBasePlateSectionId && basePlate && basePlate.type === 'multi-section' && basePlate.sections && !mergedFixtureMesh && !isMultiSectionDrawingMode && (
        (() => {
          const editingSection = basePlate.sections.find(s => s.id === editingBasePlateSectionId);
          if (!editingSection) return null;
          return (
            <BasePlateTransformControls
              section={editingSection}
              onDragStart={() => {
                isDraggingBasePlateSectionRef.current = true;
                // Set isDraggingAnyItem to prevent CSG during drag
                setIsDraggingAnyItem(true);
              }}
              onTransformChange={(newBounds) => {
                // Skip live updates during drag to prevent gizmo jumping
                // The visual update is handled by PivotControls autoTransform
              }}
              onTransformEnd={(newBounds) => {
                isDraggingBasePlateSectionRef.current = false;
                
                // Create section with new position
                const editingSection = basePlate.sections!.find(s => s.id === editingBasePlateSectionId)!;
                
                // Calculate the movement delta
                const oldCenterX = (editingSection.minX + editingSection.maxX) / 2;
                const oldCenterZ = (editingSection.minZ + editingSection.maxZ) / 2;
                const newCenterX = (newBounds.minX + newBounds.maxX) / 2;
                const newCenterZ = (newBounds.minZ + newBounds.maxZ) / 2;
                const deltaX = newCenterX - oldCenterX;
                const deltaZ = newCenterZ - oldCenterZ;
                
                // Move all items in this section by the same delta
                const sectionId = editingSection.id;
                
                // Move supports (supports use 'center' which is Vector2 with x,y where y is Z in world space)
                setSupports(prev => prev.map(s => 
                  s.sectionId === sectionId && s.center
                    ? { ...s, center: new THREE.Vector2(s.center.x + deltaX, s.center.y + deltaZ) }
                    : s
                ));
                
                // Move clamps (check for position existence)
                setPlacedClamps(prev => prev.map(c =>
                  c.sectionId === sectionId && c.position
                    ? { ...c, position: { ...c.position, x: c.position.x + deltaX, z: c.position.z + deltaZ } }
                    : c
                ));
                
                // Move labels (check for position existence)
                setLabels(prev => prev.map(l =>
                  l.sectionId === sectionId && l.position
                    ? { ...l, position: { ...l.position, x: l.position.x + deltaX, z: l.position.z + deltaZ } }
                    : l
                ));
                
                // Move holes (position is Vector2 where x=X and y=Z in world coords)
                setMountingHoles(prev => prev.map(h =>
                  h.sectionId === sectionId && h.position
                    ? { ...h, position: new THREE.Vector2(h.position.x + deltaX, h.position.y + deltaZ) }
                    : h
                ));
                
                const movedSection = { 
                  ...editingSection,
                  ...newBounds,
                  // Preserve original size (not position)
                  originalWidth: editingSection.originalWidth ?? (editingSection.maxX - editingSection.minX),
                  originalDepth: editingSection.originalDepth ?? (editingSection.maxZ - editingSection.minZ),
                  // UPDATE the original center to the new position
                  originalCenterX: newCenterX,
                  originalCenterZ: newCenterZ,
                };

                // Update the section (don't recalculate bounds - just use the new position)
                const updatedSections = basePlate.sections!.map(s => 
                  s.id === editingBasePlateSectionId 
                    ? movedSection
                    : s
                );
                
                // Update basePlate with new sections
                setBasePlate(prev => {
                  if (!prev || prev.type !== 'multi-section') return prev;
                  return {
                    ...prev,
                    sections: updatedSections
                  };
                });
                
                // Dispatch event to AppShell to update its state
                window.dispatchEvent(new CustomEvent('baseplate-section-updated', {
                  detail: {
                    basePlateId: basePlate.id,
                    sectionId: editingBasePlateSectionId,
                    newBounds: {
                      minX: movedSection.minX,
                      maxX: movedSection.maxX,
                      minZ: movedSection.minZ,
                      maxZ: movedSection.maxZ,
                    }
                  }
                }));
                
                // Clear dragging flag and trigger CSG after a short delay
                // to allow state updates to propagate
                setTimeout(() => {
                  setIsDraggingAnyItem(false);
                  // Trigger CSG recalculation
                  setHoleCSGTrigger(t => t + 1);
                }, 50);
              }}
              onDeselect={() => {
                isDraggingBasePlateSectionRef.current = false;
                setIsDraggingAnyItem(false);
                setEditingBasePlateSectionId(null);
                setSelectedBasePlateSectionId(null);
              }}
            />
          );
        })()
      )}

      {/* Base plate with holes cut (CSG result) - show when baseplateWithHoles exists - only for non-multi-section */}
      {basePlate && basePlate.type !== 'multi-section' && baseplateVisible && !mergedFixtureMesh && baseplateWithHoles && (
        <mesh
          ref={basePlateMeshRef}
          geometry={baseplateWithHoles}
          position={basePlate.position}
          receiveShadow
          castShadow
          onClick={() => {
            window.dispatchEvent(new CustomEvent('baseplate-selected', {
              detail: { basePlateId: basePlate.id }
            }));
          }}
        >
          {/* Use same colors as BasePlate component */}
          <meshStandardMaterial 
            color={basePlate.material === 'wood' ? 0x8B4513 : basePlate.material === 'plastic' ? 0x333333 : 0x888888} 
            roughness={basePlate.material === 'wood' ? 0.8 : basePlate.material === 'plastic' ? 0.3 : 0.7}
            metalness={basePlate.material === 'wood' ? 0.1 : 0.0}
          />
        </mesh>
      )}

      {/* Multi-section baseplate drawing overlay */}
      <MultiSectionDrawing
        active={isMultiSectionDrawingMode}
        planeY={0}
        padding={multiSectionPadding}
        onSectionDrawn={handleSectionDrawn}
        onCancel={() => {
          setIsMultiSectionDrawingMode(false);
          setOrbitControlsEnabled(true);
          window.dispatchEvent(new CustomEvent('baseplate-drawing-mode-changed', { detail: { active: false } }));
        }}
        existingSections={drawnSections}
      />

      {/* Processing indicator for hole CSG */}
      {holeCSGProcessing && (
        <Html center position={[0, 50, 0]}>
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '14px',
            whiteSpace: 'nowrap'
          }}>
            Cutting holes...
          </div>
        </Html>
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
            <group 
              visible={isVisible}
              onPointerOver={() => {
                // Change cursor to crosshair when in placement mode
                if (clampPlacementMode.active && isVisible) {
                  document.body.style.cursor = 'crosshair';
                }
              }}
              onPointerOut={() => {
                // Reset cursor when leaving part
                if (clampPlacementMode.active) {
                  document.body.style.cursor = 'auto';
                }
              }}
            >
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
                disableDoubleClick={placing.active || !isVisible || clampPlacementMode.active}
                onClick={(e) => {
                  console.log('[ClampPlacement] ModelMesh onClick triggered', {
                    placementModeActive: clampPlacementMode.active,
                    isVisible,
                    hasPartMesh: !!partMeshRef.current
                  });
                  // Handle clamp placement click if in placement mode
                  if (clampPlacementMode.active && isVisible) {
                    const mesh = partMeshRef.current;
                    if (mesh) {
                      console.log('[ClampPlacement] Calling handleClampPlacementClick from ModelMesh');
                      handleClampPlacementClick(e as any, mesh);
                    } else {
                      console.log('[ClampPlacement] No mesh ref available');
                    }
                  }
                }}
                onDoubleClick={() => {
                  if (isVisible && !clampPlacementMode.active) {
                    // Clear baseplate section selection when selecting a part
                    setSelectedBasePlateSectionId(null);
                    setEditingBasePlateSectionId(null);
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

      {/* Supports rendering - hide when merged fixture is shown */}
      {!mergedFixtureMesh && supportsTrimPreview.length === 0
        ? (() => {
            // Render individual supports (with modified geometry if CSG-cut)
            return supports.map((s) => {
              // Check if this support has a modified geometry (from individual cavity subtraction)
              const modifiedGeometry = modifiedSupportGeometries.get(s.id);
            
            if (modifiedGeometry) {
              // Render the modified geometry - it's already in world space from the CSG operation
              // Use amber/orange color to indicate the support has been cut
              const isSelected = selectedSupportId === s.id;
              const cutSupportColor = 0xf59e0b; // Amber-500 - indicates support has been cut
              const cutSupportSelectedColor = 0xfbbf24; // Amber-400 - lighter when selected
              
              return (
                <mesh
                  key={s.id}
                  geometry={modifiedGeometry}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { supportId: s.id } }));
                    onSupportSelect?.(s.id);
                  }}
                >
                  <meshStandardMaterial 
                    color={isSelected ? cutSupportSelectedColor : cutSupportColor}
                    metalness={0.0}
                    roughness={0.6}
                    emissive={isSelected ? cutSupportSelectedColor : cutSupportColor}
                    emissiveIntensity={isSelected ? 0.25 : 0.1}
                  />
                </mesh>
              );
            }
            
            // Render standard support mesh
            return (
              <SupportMesh 
                key={s.id} 
                support={s} 
                baseTopY={baseTopY}
                selected={selectedSupportId === s.id}
                onDoubleClick={(supportId) => {
                  // Notify part gizmos to close
                  window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { supportId } }));
                  onSupportSelect?.(supportId);
                  // Don't disable orbit controls here - let the gizmo handle it during drag
                  // This allows pan/tilt/zoom while gizmo is active (same as part gizmo)
                }}
              />
            );
          });
        })()
        : supportsTrimPreview.map((mesh, idx) => <primitive key={`${mesh.uuid}-${idx}`} object={mesh} />)}
      
      {/* Support transform controls - XY plane only */}
      {selectedSupportId && !placing.active && (
        (() => {
          const selectedSupport = supports.find(s => s.id === selectedSupportId);
          if (!selectedSupport) return null;
          return (
            <SupportTransformControls
              support={selectedSupport}
              baseTopY={baseTopY}
              onDragStart={() => {
                isDraggingSupportRef.current = true;
                setIsDraggingAnyItem(true);
              }}
              onDragEnd={() => {
                isDraggingSupportRef.current = false;
                setIsDraggingAnyItem(false);
                // Trigger CSG after support drag ends if we have holes
                if (basePlate?.type === 'multi-section' && mountingHoles.length > 0) {
                  console.log('[SupportTransformControls] Drag ended, triggering CSG');
                  setHoleCSGTrigger(t => t + 1);
                }
              }}
              onTransformChange={(newCenter, rotationY, height) => {
                // Live update support position, rotation, and height
                // The reactive effect will automatically recalculate section bounds
                setSupports(prev => {
                  return prev.map(s => {
                    if (s.id === selectedSupportId) {
                      const updates: Partial<AnySupport> = { center: newCenter };
                      if (rotationY !== undefined) {
                        (updates as any).rotationY = rotationY;
                      }
                      if (height !== undefined) {
                        (updates as any).height = height;
                      }
                      return { ...s, ...updates } as AnySupport;
                    }
                    return s;
                  });
                });
              }}
              onTransformEnd={(newCenter, rotationY, height) => {
                // Dispatch event for AppShell to update its state
                const updatedSupport = supports.find(s => s.id === selectedSupportId);
                if (updatedSupport) {
                  const finalSupport: any = { ...updatedSupport, center: newCenter };
                  if (rotationY !== undefined) {
                    finalSupport.rotationY = rotationY;
                  }
                  if (height !== undefined) {
                    finalSupport.height = height;
                  }
                  window.dispatchEvent(new CustomEvent('support-updated', { detail: finalSupport }));
                }
              }}
              onDeselect={() => {
                onSupportSelect?.(null);
              }}
            />
          );
        })()
      )}

      {/* Labels rendering - on top of baseplate, hide when merged fixture is shown */}
      {!mergedFixtureMesh && (
        <Suspense fallback={null}>
          {labels.map((label) => (
            <LabelMesh
              key={label.id}
              label={label}
              selected={selectedLabelId === label.id}
              onSelect={(id) => {
                setSelectedLabelId(id);
                window.dispatchEvent(new CustomEvent('label-selected', { detail: id }));
              }}
              onDoubleClick={(id) => {
                // Activate pivot controls for this label
                window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { labelId: id } }));
                setSelectedLabelId(id);
                window.dispatchEvent(new CustomEvent('label-selected', { detail: id }));
              }}
              onBoundsComputed={(id, width, height) => {
                // Update label with computed bounds from actual geometry
                setLabels(prev => prev.map(l => 
                  l.id === id ? { ...l, computedWidth: width, computedHeight: height } : l
                ));
              }}
            />
          ))}
        </Suspense>
      )}

      {/* Label transform controls - activated on double-click */}
      {selectedLabelId && (
        (() => {
          const selectedLabel = labels.find(l => l.id === selectedLabelId);
          if (!selectedLabel) return null;
          return (
            <LabelTransformControls
              label={selectedLabel}
              onDragStart={() => {
                isDraggingLabelRef.current = true;
                setIsDraggingAnyItem(true);
              }}
              onDragEnd={() => {
                isDraggingLabelRef.current = false;
                setIsDraggingAnyItem(false);
                // Trigger CSG after label drag ends if we have holes
                if (basePlate?.type === 'multi-section' && mountingHoles.length > 0) {
                  setHoleCSGTrigger(t => t + 1);
                }
              }}
              onTransformChange={(position, rotation, depth) => {
                // Live update label position, rotation, and depth
                setLabels(prev => prev.map(l => {
                  if (l.id === selectedLabelId) {
                    return {
                      ...l,
                      position,
                      rotation,
                      depth: depth ?? l.depth,
                    };
                  }
                  return l;
                }));
                // Also dispatch event for AppShell to update Properties panel live
                const updates = { position, rotation, depth: depth ?? selectedLabel.depth };
                window.dispatchEvent(new CustomEvent('label-update', { 
                  detail: { labelId: selectedLabelId, updates } 
                }));
              }}
              onTransformEnd={(position, rotation, depth) => {
                // Dispatch event for AppShell to update its state
                const finalLabel = labels.find(l => l.id === selectedLabelId);
                if (finalLabel) {
                  const updates = { position, rotation, depth: depth ?? finalLabel.depth };
                  window.dispatchEvent(new CustomEvent('label-update', { 
                    detail: { labelId: selectedLabelId, updates } 
                  }));
                }
              }}
              onDeselect={() => {
                setSelectedLabelId(null);
                window.dispatchEvent(new CustomEvent('label-selected', { detail: null }));
              }}
            />
          );
        })()
      )}

      {/* Clamps rendering - hide clamp supports when merged fixture is shown */}
      <Suspense fallback={null}>
        {placedClamps.map((placedClamp) => {
          const clampModel = getClampById(placedClamp.clampModelId);
          if (!clampModel) return null;
          
          return (
            <ClampWithSupport
              key={placedClamp.id}
              clampModel={clampModel}
              placedClamp={placedClamp}
              selected={selectedClampId === placedClamp.id}
              showDebug={showClampDebug}
              baseTopY={baseTopY}
              showSupport={!mergedFixtureMesh}
              showClampBody={placedClamp.visible !== false}
              onClick={(id) => {
                setSelectedClampId(id);
                window.dispatchEvent(new CustomEvent('clamp-selected', { detail: id }));
              }}
              onDoubleClick={(id) => {
                // Activate pivot controls for this clamp
                window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { clampId: id } }));
                setSelectedClampId(id);
                window.dispatchEvent(new CustomEvent('clamp-selected', { detail: id }));
              }}
              onClampDataLoaded={(clampId, supportInfo) => {
                if (supportInfo) {
                  setClampSupportInfos(prev => {
                    const updated = new Map(prev);
                    updated.set(clampId, {
                      polygon: supportInfo.polygon,
                      localCenter: { x: supportInfo.localCenter.x, y: supportInfo.localCenter.y },
                      fixturePointY: supportInfo.fixturePointY,
                      mountSurfaceLocalY: supportInfo.mountSurfaceLocalY,
                    });
                    return updated;
                  });
                  
                  // Adjust clamp position to ensure support is outside the part
                  const clamp = placedClamps.find(c => c.id === clampId);
                  
                  if (clamp && supportInfo.polygon.length > 0) {
                    // Update debug points with actual support center
                    const rotRad = THREE.MathUtils.degToRad(clamp.rotation.y);
                    const cosR = Math.cos(rotRad);
                    const sinR = Math.sin(rotRad);
                    const lx = supportInfo.localCenter.x;
                    const lz = supportInfo.localCenter.y;
                    const actualSupportCenterX = clamp.position.x + lx * cosR + lz * sinR;
                    const actualSupportCenterZ = clamp.position.z - lx * sinR + lz * cosR;
                    
                    setClampDebugPoints(prev => prev ? {
                      ...prev,
                      estimatedSupportCenter: { 
                        x: actualSupportCenterX, 
                        y: clamp.position.y, 
                        z: actualSupportCenterZ 
                      }
                    } : null);
                    
                    // Get debug points from REF (includes silhouette!)
                    const debugPointsFromRef = clampDebugPointsRef.current;
                    
                    // Use 2D silhouette-based collision detection
                    if (debugPointsFromRef && debugPointsFromRef.silhouette && debugPointsFromRef.silhouette.length > 0) {
                      const closestBoundary = debugPointsFromRef.closestBoundaryPoint 
                        ? { x: debugPointsFromRef.closestBoundaryPoint.x, z: debugPointsFromRef.closestBoundaryPoint.z }
                        : null;
                      
                      import('@/features/clamps/utils/clampPlacement').then(({ adjustClampAfterDataLoad }) => {
                        const result = adjustClampAfterDataLoad(
                          clamp.position,
                          clamp.rotation,
                          supportInfo.polygon,
                          closestBoundary,
                          debugPointsFromRef.silhouette,
                          1 // minimal clearance - just outside boundary
                        );
                        
                        if (result.adjusted) {
                          setPlacedClamps(prev => prev.map(c => {
                            if (c.id === clampId) {
                              return { ...c, position: result.position };
                            }
                            return c;
                          }));
                        }
                      });
                    }
                  }
                } else {
                  setClampSupportInfos(prev => {
                    const updated = new Map(prev);
                    updated.delete(clampId);
                    return updated;
                  });
                }
              }}
            />
          );
        })}
      </Suspense>

      {/* Clamp transform controls - activated on double-click */}
      {selectedClampId && (
        (() => {
          const selectedClamp = placedClamps.find(c => c.id === selectedClampId);
          if (!selectedClamp) return null;
          
          const clampModel = getClampById(selectedClamp.clampModelId);
          if (!clampModel) return null;
          
          // Calculate fixture point world position (this is where the gizmo should be)
          const fixturePointWorldPos = new THREE.Vector3(
            selectedClamp.position.x,
            selectedClamp.position.y,
            selectedClamp.position.z
          );
          
          return (
            <ClampTransformControls
              placedClamp={selectedClamp}
              fixturePointWorldPos={fixturePointWorldPos}
              onDragStart={() => {
                isDraggingClampRef.current = true;
                setIsDraggingAnyItem(true);
              }}
              onDragEnd={() => {
                isDraggingClampRef.current = false;
                setIsDraggingAnyItem(false);
                // Trigger CSG after clamp drag ends if we have holes
                if (basePlate?.type === 'multi-section' && mountingHoles.length > 0) {
                  console.log('[ClampTransformControls] Drag ended, triggering CSG');
                  setHoleCSGTrigger(t => t + 1);
                }
              }}
              onTransformChange={(position, rotation) => {
                // Live update clamp position and rotation
                // The reactive effect will automatically recalculate section bounds
                setPlacedClamps(prev => prev.map(c => {
                  if (c.id === selectedClampId) {
                    return { ...c, position, rotation };
                  }
                  return c;
                }));
              }}
              onTransformEnd={(position, rotation) => {
                // Just update state on drag end - NO collision adjustment here
                window.dispatchEvent(new CustomEvent('clamp-update', { 
                  detail: { clampId: selectedClampId, updates: { position, rotation } } 
                }));
              }}
              onDeselect={() => {
                // Perform collision adjustment when pivot controls are CLOSED
                const clamp = placedClamps.find(c => c.id === selectedClampId);
                const supportInfo = clampSupportInfos.get(selectedClampId);
                
                if (clamp && supportInfo && supportInfo.polygon.length > 0) {
                  const partMeshes = importedParts
                    .map(p => modelMeshRefs.current.get(p.id)?.current)
                    .filter((m): m is THREE.Mesh => m !== null && partVisibility.get(importedParts.find(ip => modelMeshRefs.current.get(ip.id)?.current === m)?.id || '') !== false);
                  
                  import('@/features/clamps/utils/clampPlacement').then(({ adjustClampPositionAfterTransform, computePartSilhouetteForClamps }) => {
                    let silhouette = partSilhouetteRef.current;
                    if (!silhouette || silhouette.length === 0) {
                      silhouette = computePartSilhouetteForClamps(partMeshes, baseTopY);
                      partSilhouetteRef.current = silhouette;
                    }
                    
                    const fixturePointRadius = supportInfo.fixturePointRadius || 10;
                    
                    console.log('[ClampAdjust] Adjusting on deselect:', {
                      position: clamp.position,
                      rotation: clamp.rotation,
                      supportPolygon: supportInfo.polygon.length,
                      silhouette: silhouette.length
                    });
                    
                    const result = adjustClampPositionAfterTransform(
                      clamp.position,
                      clamp.rotation,
                      supportInfo.polygon,
                      fixturePointRadius,
                      partMeshes,
                      silhouette,
                      baseTopY
                    );
                    
                    if (result.wasAdjusted) {
                      console.log('[ClampAdjust] Adjusted:', result.adjustmentReason);
                      setPlacedClamps(prev => prev.map(c => {
                        if (c.id === selectedClampId) {
                          return { ...c, position: result.position, rotation: result.rotation };
                        }
                        return c;
                      }));
                      window.dispatchEvent(new CustomEvent('clamp-update', { 
                        detail: { clampId: selectedClampId, updates: { position: result.position, rotation: result.rotation } } 
                      }));
                    }
                  });
                }
                
                setSelectedClampId(null);
                window.dispatchEvent(new CustomEvent('clamp-selected', { detail: null }));
              }}
            />
          );
        })()
      )}

      {/* Offset mesh previews (cavity cutting brush visualization) - one per part */}
      {showOffsetPreview && Array.from(offsetMeshPreviews.values()).map((mesh, index) => (
        <primitive key={mesh.name || `offset-preview-${index}`} object={mesh} />
      ))}

      {/* Merged fixture mesh (baseplate + cut supports combined) */}
      {mergedFixtureMesh && (
        <primitive object={mergedFixtureMesh} />
      )}

      {/* Debug: Perimeter visualization (raycast silhouette) - controlled by DEBUG_SHOW_PERIMETER flag */}
      {DEBUG_SHOW_PERIMETER && debugPerimeter && debugPerimeter.length > 2 && (
        <DebugPerimeterLine perimeter={debugPerimeter} y={baseTopY + 0.5} />
      )}

      {/* Debug: Clamp silhouette visualization - shows the part outline used for clamp placement */}
      {DEBUG_SHOW_CLAMP_SILHOUETTE && debugClampSilhouette && debugClampSilhouette.length > 2 && (
        <DebugSilhouetteLine silhouette={debugClampSilhouette} y={baseTopY + 0.5} color={0x00ffff} />
      )}

      {/* Section selection tooltip for support placement */}
      {waitingForSectionSelection && (
        <Html position={[0, baseTopY + 5, 0]} center>
          <div
            className="bg-primary/90 text-white rounded-lg px-3 py-2 text-xs font-tech whitespace-nowrap shadow-lg"
            style={{ pointerEvents: 'none' }}
          >
            Select the baseplate section, then click-drag to place supports • ESC to cancel
          </div>
        </Html>
      )}

      {/* Section selection tooltip for clamp placement */}
      {waitingForClampSectionSelection && (
        <Html position={[0, baseTopY + 5, 0]} center>
          <div
            className="bg-primary/90 text-white rounded-lg px-3 py-2 text-xs font-tech whitespace-nowrap shadow-lg"
            style={{ pointerEvents: 'none' }}
          >
            Select the baseplate section, then click on part to place clamp • ESC to cancel
          </div>
        </Html>
      )}

      {/* Section selection tooltip for label placement */}
      {waitingForLabelSectionSelection && (
        <Html position={[0, baseTopY + 5, 0]} center>
          <div
            className="bg-primary/90 text-white rounded-lg px-3 py-2 text-xs font-tech whitespace-nowrap shadow-lg"
            style={{ pointerEvents: 'none' }}
          >
            Click on a baseplate section to place label • ESC to cancel
          </div>
        </Html>
      )}

      {/* Section selection tooltip for hole placement */}
      {waitingForHoleSectionSelection && (
        <Html position={[0, baseTopY + 5, 0]} center>
          <div
            className="bg-primary/90 text-white rounded-lg px-3 py-2 text-xs font-tech whitespace-nowrap shadow-lg"
            style={{ pointerEvents: 'none' }}
          >
            Click on a baseplate section to place hole • ESC to cancel
          </div>
        </Html>
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
            setWaitingForSectionSelection(false);
            // restore previous view
            setCurrentOrientation(prevOrientationRef.current);
            updateCamera(prevOrientationRef.current, modelBounds);
          }}
          defaultCenter={new THREE.Vector2(modelBounds?.center.x || 0, modelBounds?.center.z || 0)}
          raycastTargets={importedParts.map(part => {
            const ref = modelMeshRefs.current.get(part.id);
            return ref?.current;
          }).filter(Boolean) as THREE.Mesh[]}
          baseTopY={baseTopY}
          baseTarget={basePlate?.type === 'multi-section' ? multiSectionBasePlateGroupRef.current : basePlateMeshRef.current}
          contactOffset={Number(placing.initParams?.contactOffset ?? 0)}
          maxRayHeight={2000}
          modelBounds={modelBounds ? { min: modelBounds.min, max: modelBounds.max } : null}
          existingSupports={supports}
          snapThreshold={supportSnapEnabled ? 3 : 0}
          basePlateSections={basePlate?.type === 'multi-section' ? basePlate.sections : undefined}
        />
      )}

      {/* Mounting hole placement controller */}
      {holePlacementMode.active && holePlacementMode.config && (basePlateMeshRef.current || basePlate?.type === 'multi-section') && (
        <HolePlacement
          active={holePlacementMode.active}
          holeConfig={holePlacementMode.config}
          baseTarget={basePlate?.type === 'multi-section' ? multiSectionBasePlateGroupRef.current : basePlateMeshRef.current}
          baseTopY={baseTopY}
          depth={holePlacementMode.depth}
          existingHoles={mountingHoles}
          snapThreshold={holeSnapEnabled ? 3 : 0}
          onPlace={handleHoleCreate}
          onCancel={() => {
            setHolePlacementMode({ active: false, config: null, depth: 20 });
            setOrbitControlsEnabled(true);
            // Restore previous view
            setCurrentOrientation(prevOrientationRef.current);
            updateCamera(prevOrientationRef.current, modelBounds);
            // Dispatch cancellation event
            window.dispatchEvent(new CustomEvent('hole-placement-cancelled'));
          }}
        />
      )}

      {/* Render placed mounting holes - hide when merged fixture is shown */}
      {!mergedFixtureMesh && mountingHoles.map(hole => (
        <HoleMesh
          key={hole.id}
          hole={hole}
          baseTopY={baseTopY}
          isSelected={selectedHoleId === hole.id}
          onClick={() => {
            // Single click just selects the hole (no gizmo)
            setSelectedHoleId(hole.id);
            window.dispatchEvent(new CustomEvent('hole-select-request', { detail: hole.id }));
          }}
          onDoubleClick={() => {
            // Double-click enters edit/move mode with gizmo
            setSelectedHoleId(hole.id);
            setEditingHoleId(hole.id);
            window.dispatchEvent(new CustomEvent('hole-edit-request', { detail: hole.id }));
          }}
        />
      ))}

      {/* Hole transform controls - XZ plane only - disabled when merged fixture exists */}
      {editingHoleId && !holePlacementMode.active && !mergedFixtureMesh && (
        (() => {
          const editingHole = mountingHoles.find(h => h.id === editingHoleId);
          if (!editingHole) return null;
          return (
            <HoleTransformControls
              hole={editingHole}
              baseTopY={baseTopY}
              onDragStart={() => {
                isDraggingHoleRef.current = true;
                setIsDraggingHole(true); // State for multi-section baseplate
                setIsDraggingAnyItem(true);
                // Clear CSG result to show original baseplate during drag
                setBaseplateWithHoles(null);
                // Clear cached geometry since baseplate may resize during drag
                originalBaseplateGeoRef.current = null;
              }}
              onTransformChange={(newPosition) => {
                // Live update hole position
                // This updates holeHullPoints -> combinedHullPoints -> BasePlate resizes dynamically
                setMountingHoles(prev => prev.map(h => {
                  if (h.id === editingHoleId) {
                    return { ...h, position: newPosition };
                  }
                  return h;
                }));
              }}
              onTransformEnd={(newPosition) => {
                isDraggingHoleRef.current = false;
                setIsDraggingHole(false); // State for multi-section baseplate
                setIsDraggingAnyItem(false);
                // Dispatch event for AppShell to update its state
                const updatedHole = { ...editingHole, position: newPosition };
                window.dispatchEvent(new CustomEvent('hole-updated', { detail: updatedHole }));
                
                // Trigger CSG after BasePlate has rendered with final size
                setTimeout(() => {
                  setHoleCSGTrigger(prev => prev + 1);
                }, 150);
              }}
              onDeselect={() => {
                isDraggingHoleRef.current = false;
                setIsDraggingHole(false); // State for multi-section baseplate
                setEditingHoleId(null);
                setSelectedHoleId(null);
                // Trigger CSG update when closing gizmo (in case holes exist)
                if (mountingHoles.length > 0) {
                  setTimeout(() => {
                    setHoleCSGTrigger(prev => prev + 1);
                  }, 150);
                }
              }}
            />
          );
        })()
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
          // Clicking on empty viewport should clear any active support edit ref
          if (editingSupportRef.current) {
            editingSupportRef.current = null;
            setOrbitControlsEnabled(true);
          }
          // Also deselect support when clicking empty area
          if (selectedSupportId) {
            onSupportSelect?.(null);
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
        enableZoom={true}  // Always allow zoom, even during placement mode
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

      {/* Gizmo Helper for quick view changes */}
      <GizmoHelper
        alignment="top-right"
        margin={[80, 80]}
      >
        <GizmoViewport axisColors={['#ff4060', '#40ff60', '#4080ff']} labels={['X', 'Z', 'Y']} labelColor="white" />
      </GizmoHelper>

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
