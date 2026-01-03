import React, { useRef, useState, useCallback, useMemo, useEffect, Suspense } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls as DreiOrbitControls, Html, GizmoHelper, GizmoViewport, Line } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { BasePlate, MultiSectionDrawing, MultiSectionBasePlate, BasePlateTransformControls, mergeOverlappingSections } from '@/features/baseplate';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';
import { ProcessedFile, ViewOrientation } from "@/modules/FileImport/types";
import SelectableTransformControls from './SelectableTransformControls';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  filterSupportsByBaseplateCoverage,
} from '@/features/supports';
import {
  CSGEngine, 
  createOffsetMesh, 
  extractVertices, 
  csgSubtract, 
  initManifold,
  performBatchCSGSubtractionInWorker, 
  performBatchCSGUnionInWorker,
  performClampCSGInWorker,
  decimateMesh, 
  repairMesh, 
  analyzeMesh, 
  laplacianSmooth, 
  cleanupCSGResult,
  meshToSTL,
  downloadFile,
  generateExportFilename,
  performRealCSGUnionInWorker,
  type ExportConfig,
} from '@rapidtool/cad-core';
import { LabelMesh, LabelTransformControls, LabelConfig } from '@/features/labels';
import { ClampMesh, ClampTransformControls, ClampWithSupport, PlacedClamp, ClampModel, getClampById } from '@/features/clamps';
import { HoleMesh, HolePlacement, HoleTransformControls, PlacedHole, HoleConfig } from '@/features/holes';
import { useExport } from '@/features/export';
import { registerRenderer, unregisterRenderer, logMemoryUsage } from '@/utils/memoryMonitor';

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
  ModelMesh as ExtractedModelMesh,
  DebugPerimeterLine as ExtractedDebugPerimeterLine,
  DebugSilhouetteLine as ExtractedDebugSilhouetteLine,
  FixtureComponent as ExtractedFixtureComponent,
  LabelsRenderer,
  SupportsRenderer,
  SceneLighting,
  // State Hooks
  useSupportState,
  useClampState,
  useLabelState,
  useHoleState,
  useBaseplateState,
  useSceneState,
  usePartManagement,
  useCameraControls,
  useModelTransform,
  useBaseplateHandlers,
  useBaseplateEffects,
  useMultiSectionSelection,
  useSupportHandlers,
  useHoleHandlers,
  useClampHandlers,
  useLabelHandlers,
  useClampPlacement,
  useCavityOperations,
  useOffsetMeshPreview,
  useSupportTrimPreview,
  useBaseplateOperations,
  useHoleCSG,
  useSceneReset,
  // Container
  Scene3DProvider,
  useScene3DContext,
} from './3DScene/index';
import type { BoundsSummary as ExtractedBoundsSummary } from './3DScene/index';
import type { PerformanceSettings } from '@/utils/performanceSettings';

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
  performanceSettings?: PerformanceSettings;
  isCavityApplied?: boolean;
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

// Use extracted renderer (see src/components/3DScene/renderers/ModelMesh.tsx)
const ModelMesh = ExtractedModelMesh;

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
  performanceSettings,
  isCavityApplied = false,
}) => {
  const { camera, size, gl, scene } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  
  // Register renderer for memory monitoring (development only)
  useEffect(() => {
    registerRenderer(gl);
    logMemoryUsage('3DScene mounted');
    
    return () => {
      logMemoryUsage('3DScene unmounting');
      unregisterRenderer();
    };
  }, [gl]);
  
  // Future: Component library for fixture elements (currently placeholder)
  const [placedComponents, setPlacedComponents] = useState<Array<{ component: unknown; position: THREE.Vector3; id: string }>>([]);
  const [selectedComponent, setSelectedComponent] = useState<unknown>(null);
  
  // Baseplate state from hook
  const {
    basePlate,
    setBasePlate,
    isMultiSectionDrawingMode,
    setIsMultiSectionDrawingMode,
    drawnSections,
    setDrawnSections,
    multiSectionPadding,
    setMultiSectionPadding,
    baseTopY,
    setBaseTopY,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    editingBasePlateSectionId,
    setEditingBasePlateSectionId,
    waitingForSectionSelection,
    setWaitingForSectionSelection,
    basePlateMeshRef,
    isDraggingBasePlateSectionRef,
    isMultiSectionBaseplate,
  } = useBaseplateState();
  
  // Part management state from hook
  const {
    modelMeshRefs,
    partInitialOffsetsRef,
    modelDimensions,
    setModelDimensions,
    modelColors,
    setModelColors,
    modelBounds,
    setModelBounds,
    partBounds,
    setPartBounds,
    getPartMeshRef,
    recalculateCombinedBounds,
    firstPart,
  } = usePartManagement({
    importedParts,
    onModelColorAssigned,
  });
  
  // Camera state (will be extracted to useCameraControls in next phase)
  const [orbitControlsEnabled, setOrbitControlsEnabled] = useState(true);
  const [currentOrientation, setCurrentOrientation] = useState<ViewOrientation>('iso');
  const prevOrientationRef = useRef<ViewOrientation>('iso');
  const shouldReframeCameraRef = useRef<boolean>(true);
  
  // Model transform state from hook
  const {
    modelTransform,
    setModelTransform,
    liveTransform,
    setLiveTransform,
    pivotClosingRef,
    handleLiveTransformChange,
    livePositionDelta,
  } = useModelTransform({
    selectedPartId,
    basePlate,
    modelMeshRefs,
  });
  
  // Multi-section baseplate group ref (not part of usePartManagement as it's baseplate-specific)
  const multiSectionBasePlateGroupRef = useRef<THREE.Group>(null);

  // Get the currently selected part's mesh ref
  const selectedPartMeshRef = selectedPartId ? getPartMeshRef(selectedPartId) : null;

  // ========================================================================
  // State Hooks - Modular state management for different features
  // ========================================================================
  
  // Support state from hook
  const {
    placing,
    setPlacing,
    supports,
    setSupports,
    supportsTrimPreview,
    setSupportsTrimPreview,
    supportsTrimProcessing,
    setSupportsTrimProcessing,
    supportSnapEnabled,
    setSupportSnapEnabled,
    modifiedSupportGeometries,
    setModifiedSupportGeometries,
    cavitySubtractionProcessing,
    setCavitySubtractionProcessing,
    isDraggingSupportRef,
    editingSupportRef,
    supportHullPoints,
  } = useSupportState();
  
  // Labels state from hook
  const {
    labels,
    setLabels,
    selectedLabelId,
    setSelectedLabelId,
    waitingForLabelSectionSelection,
    setWaitingForLabelSectionSelection,
    pendingLabelConfig,
    setPendingLabelConfig,
    labelsRef,
    isDraggingLabelRef,
    labelHullPoints,
  } = useLabelState();
  
  // Force bounds recalc when any item (support, clamp, label) is first added
  const [itemBoundsUpdateTrigger, setItemBoundsUpdateTrigger] = useState(0);
  
  // Clamps state from hook
  const {
    placedClamps,
    setPlacedClamps,
    selectedClampId,
    setSelectedClampId,
    showClampDebug,
    setShowClampDebug,
    clampMinOffsets,
    setClampMinOffsets,
    clampSupportInfos,
    setClampSupportInfos,
    clampDebugPoints,
    setClampDebugPoints,
    clampPlacementMode,
    setClampPlacementMode,
    debugPerimeter,
    setDebugPerimeter,
    debugClampSilhouette,
    setDebugClampSilhouette,
    waitingForClampSectionSelection,
    setWaitingForClampSectionSelection,
    isDraggingClampRef,
    loadedClampDataRef,
    clampDebugPointsRef,
    partSilhouetteRef,
    DEBUG_SHOW_PERIMETER,
    DEBUG_SHOW_CLAMP_SILHOUETTE,
  } = useClampState();
  
  // Hole state from hook
  const {
    mountingHoles,
    setMountingHoles,
    selectedHoleId,
    setSelectedHoleId,
    editingHoleId,
    setEditingHoleId,
    isDraggingHole,
    setIsDraggingHole,
    holePlacementMode,
    setHolePlacementMode,
    holeSnapEnabled,
    setHoleSnapEnabled,
    baseplateWithHoles,
    setBaseplateWithHoles,
    holeCSGProcessing,
    setHoleCSGProcessing,
    holeCSGTrigger,
    setHoleCSGTrigger,
    waitingForHoleSectionSelection,
    setWaitingForHoleSectionSelection,
    pendingHoleConfig,
    setPendingHoleConfig,
    isDraggingHoleRef,
    mountingHolesRef,
    originalBaseplateGeoRef,
    triggerHoleCSGUpdate,
  } = useHoleState();
  
  // Baseplate handlers from hook (section bounds calculation, footprint helpers)
  const {
    getClampFootprintBounds,
    calculateOptimalSectionBounds,
    expandSectionForSupport,
  } = useBaseplateHandlers({
    clampSupportInfos,
    getSupportFootprintBounds,
  });
  
  // Baseplate effects from hook (baseTopY calculation, part count changes)
  useBaseplateEffects({
    basePlate,
    setBasePlate,
    setBaseTopY,
    basePlateMeshRef,
    multiSectionBasePlateGroupRef,
    importedParts,
    modelMeshRefs,
  });
  
  // Note: useMultiSectionSelection hook is called after updateCamera is defined (below)
  
  // Combined state for all drag operations
  const [isDraggingAnyItem, setIsDraggingAnyItem] = useState(false);
  
  // Cavity operations preview (for CSG operations)
  const [cavityPreview, setCavityPreview] = useState<THREE.Mesh | null>(null);
  
  // Offset mesh previews (for visualizing the cavity cutting brush before CSG)
  // Map from part ID to its offset mesh preview - supports multiple parts
  const [offsetMeshPreviews, setOffsetMeshPreviews] = useState<Map<string, THREE.Mesh>>(new Map());
  const [offsetMeshProcessing, setOffsetMeshProcessing] = useState(false);
  const [showOffsetPreview, setShowOffsetPreview] = useState(true); // Controls visibility of the offset mesh preview
  
  // Merged fixture mesh (baseplate + cut supports combined via CSG union)
  const [mergedFixtureMesh, setMergedFixtureMesh] = useState<THREE.Mesh | null>(null);

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

  // Note: baseTopY calculation effect moved to useBaseplateEffects hook

  // Supports stay fixed in world space - they don't move when model moves
  // The baseplate will expand to include both the model and the supports
  // Note: handleLiveTransformChange and livePositionDelta come from useModelTransform hook

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

  // Multi-section selection coordination from hook
  // NOTE: Must be called after updateCamera is defined
  useMultiSectionSelection({
    basePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    waitingForSectionSelection,
    setWaitingForSectionSelection,
    placing,
    setPlacing,
    waitingForClampSectionSelection,
    setWaitingForClampSectionSelection,
    clampPlacementMode,
    setClampPlacementMode,
    partSilhouetteRef,
    DEBUG_SHOW_CLAMP_SILHOUETTE,
    setDebugClampSilhouette,
    waitingForLabelSectionSelection,
    setWaitingForLabelSectionSelection,
    pendingLabelConfig,
    setPendingLabelConfig,
    setLabels,
    setSelectedLabelId,
    setItemBoundsUpdateTrigger,
    waitingForHoleSectionSelection,
    setWaitingForHoleSectionSelection,
    pendingHoleConfig,
    setPendingHoleConfig,
    setHolePlacementMode,
    setOrbitControlsEnabled,
    currentOrientation,
    setCurrentOrientation,
    prevOrientationRef,
    updateCamera,
    modelBounds,
    importedParts,
    modelMeshRefs,
    baseTopY,
    onPartSelected,
    onSupportSelect,
    setSelectedClampId,
    gl,
    camera,
    scene,
    raycasterRef,
  });

  // Support handlers from hook
  // NOTE: Must be called after updateCamera is defined
  const { handleSupportCreate } = useSupportHandlers({
    basePlate,
    setBasePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    supports,
    setSupports,
    placedClamps,
    labels,
    mountingHoles,
    placing,
    setPlacing,
    setWaitingForSectionSelection,
    currentOrientation,
    setCurrentOrientation,
    modelBounds,
    prevOrientationRef,
    setOrbitControlsEnabled,
    setSupportSnapEnabled,
    editingSupportRef,
    updateCamera,
    calculateOptimalSectionBounds,
    setItemBoundsUpdateTrigger,
  });

  // Hole handlers from hook
  // NOTE: Must be called after updateCamera is defined
  const { handleHoleCreate } = useHoleHandlers({
    basePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    mountingHoles,
    setMountingHoles,
    selectedHoleId,
    setSelectedHoleId,
    editingHoleId,
    setEditingHoleId,
    holePlacementMode,
    setHolePlacementMode,
    setWaitingForHoleSectionSelection,
    setPendingHoleConfig,
    setHoleSnapEnabled,
    setHoleCSGTrigger,
    currentOrientation,
    setCurrentOrientation,
    modelBounds,
    prevOrientationRef,
    setOrbitControlsEnabled,
    updateCamera,
  });

  // Clamp handlers from hook
  useClampHandlers({
    basePlate,
    setBasePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    placedClamps,
    setPlacedClamps,
    selectedClampId,
    setSelectedClampId,
    clampPlacementMode,
    setClampPlacementMode,
    clampMinOffsets,
    setClampMinOffsets,
    clampSupportInfos,
    setClampSupportInfos,
    showClampDebug,
    setShowClampDebug,
    setWaitingForClampSectionSelection,
    supports,
    labels,
    mountingHoles,
    importedParts,
    modelMeshRefs,
    partSilhouetteRef,
    loadedClampDataRef,
    baseTopY,
    setDebugClampSilhouette,
    DEBUG_SHOW_CLAMP_SILHOUETTE,
    onPartSelected,
    onSupportSelect,
    calculateOptimalSectionBounds,
    setItemBoundsUpdateTrigger,
  });

  // Label handlers from hook
  useLabelHandlers({
    basePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    labels,
    setLabels,
    selectedLabelId,
    setSelectedLabelId,
    setWaitingForLabelSectionSelection,
    setPendingLabelConfig,
    supports,
    placedClamps,
    clampSupportInfos,
    modelBounds,
    baseTopY,
    setItemBoundsUpdateTrigger,
  });

  // Clamp placement from hook (DOM-level click handler + legacy R3F handler)
  const { handleClampPlacementClick } = useClampPlacement({
    clampPlacementMode,
    setClampPlacementMode,
    basePlate,
    setBasePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    placedClamps,
    setPlacedClamps,
    setSelectedClampId,
    setClampDebugPoints,
    clampDebugPointsRef,
    partSilhouetteRef,
    supports,
    labels,
    mountingHoles,
    importedParts,
    modelMeshRefs,
    partVisibility,
    gl,
    camera,
    scene,
    raycasterRef,
    baseTopY,
    setItemBoundsUpdateTrigger,
    calculateOptimalSectionBounds,
  });

  // Cavity operations from hook (context, preview, apply, subtraction, reset)
  useCavityOperations({
    cavityPreview,
    setCavityPreview,
    mergedFixtureMesh,
    setMergedFixtureMesh,
    modifiedSupportGeometries,
    setModifiedSupportGeometries,
    offsetMeshPreviews,
    setOffsetMeshPreviews,
    setSupportsTrimPreview,
    importedParts,
    supports,
    placedClamps,
    clampSupportInfos,
    labels,
    mountingHoles,
    basePlate,
    baseTopY,
    baseplateWithHoles,
    setBaseplateWithHoles,
    setHoleCSGTrigger,
    basePlateMeshRef,
    modelMeshRefs,
    multiSectionBasePlateGroupRef,
    loadedClampDataRef,
    labelsRef,
    originalBaseplateGeoRef,
  });

  // Offset mesh preview operations from hook (generate, clear, toggle)
  useOffsetMeshPreview({
    offsetMeshPreviews,
    setOffsetMeshPreviews,
    setOffsetMeshProcessing,
    setShowOffsetPreview,
    setSupports,
    setPlacedClamps,
    importedParts,
    baseTopY,
    modelMeshRefs,
  });

  // Hole CSG operations from hook (trigger, cache, execute, sync depths)
  const { hullPointsKey } = useHoleCSG({
    basePlate,
    mountingHoles,
    setMountingHoles,
    baseplateWithHoles,
    setBaseplateWithHoles,
    holeCSGProcessing,
    setHoleCSGProcessing,
    holeCSGTrigger,
    setHoleCSGTrigger,
    isDraggingHoleRef,
    mountingHolesRef,
    originalBaseplateGeoRef,
    basePlateMeshRef,
    combinedHullPoints,
  });

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

  // Note: Part count change effect (baseplate recalculation + part lifting) moved to useBaseplateEffects hook

  // Note: Cavity context, result, and apply effects moved to useCavityOperations hook

  // Note: Offset mesh preview effects moved to useOffsetMeshPreview hook

  // FUTURE: Implement drag-and-drop for fixture components from ComponentLibrary
  // This requires: 1) Raycaster intersection with baseplate, 2) Component preview on hover, 3) Snap-to-grid
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

  // Note: Support placement start/cancel listeners moved to useSupportHandlers hook
  // Note: Hole placement start/cancel listeners and hole event handlers moved to useHoleHandlers hook
  // Note: Hole CSG System (waitForRenderCycle, scheduleCSGTrigger, performHoleCSG, depth sync) moved to useHoleCSG hook

  // Note: getClampFootprintBounds, calculateOptimalSectionBounds, expandSectionForSupport 
  // are now provided by useBaseplateHandlers hook
  
  // Note: handleSupportCreate is now provided by useSupportHandlers hook

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

  // Note: Support created/updated/delete event listeners moved to useSupportHandlers hook

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
        // For multi-section baseplates, filter supports to only include those
        // with at least 60% coverage on a baseplate section
        let finalSupports = result.supports;
        let finalMessage = result.message;
        
        if (basePlate.type === 'multi-section' && basePlate.sections && basePlate.sections.length > 0) {
          const filterResult = filterSupportsByBaseplateCoverage(
            result.supports,
            basePlate.sections
          );
          
          finalSupports = filterResult.accepted;
          finalMessage = filterResult.message;
          
          console.log('[3DScene] Multi-section baseplate filtering:', 
            `${filterResult.accepted.length} accepted, ${filterResult.rejected.length} rejected (require ≥60% coverage)`);
          
          if (filterResult.rejected.length > 0) {
            console.log('[3DScene] Rejected supports:', 
              filterResult.rejected.map(s => `${s.id} at (${s.center.x.toFixed(1)}, ${s.center.y.toFixed(1)})`).join(', '));
          }
        }
        
        if (finalSupports.length > 0) {
          // Set supports locally in 3DScene
          setSupports(finalSupports);
          
          // Notify AppShell about the batch of new supports (single event to avoid duplicates)
          window.dispatchEvent(new CustomEvent('supports-auto-placed', { 
            detail: { 
              supports: finalSupports,
              message: finalMessage 
            } 
          }));
        } else {
          console.warn('[3DScene] All auto-placed supports rejected due to insufficient baseplate coverage');
        }
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

  // Note: Label event listeners moved to useLabelHandlers hook
  // Note: Clamp placement click handlers moved to useClampPlacement hook
  // Note: Clamp event listeners moved to useClampHandlers hook

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

  // Support trim preview from hook (supports-trim-request)
  useSupportTrimPreview({
    setSupportsTrimProcessing,
    setSupportsTrimPreview,
    importedParts,
    supports,
    baseTopY,
    modelMeshRefs,
    csgEngineRef,
    buildSupportMesh,
  });

  // Baseplate operations from hook (create, update, remove, collision checks)
  const { handleSectionDrawn } = useBaseplateOperations({
    basePlate,
    setBasePlate,
    importedParts,
    selectedPartId,
    modelMeshRefs,
    modelTransform,
    setModelTransform,
    isMultiSectionDrawingMode,
    setIsMultiSectionDrawingMode,
    drawnSections,
    setDrawnSections,
    multiSectionPadding,
    setMultiSectionPadding,
    currentOrientation,
    setCurrentOrientation,
    prevOrientationRef,
    setOrbitControlsEnabled,
    updateCamera,
    modelBounds,
    supports,
    labels,
    placedClamps,
    clampSupportInfos,
    mountingHoles,
    getSupportFootprintBounds,
    isDraggingHoleRef,
    livePositionDelta,
  });

  // Note: Cavity subtraction and reset-cavity effects moved to useCavityOperations hook
  // Note: Baseplate event handlers moved to useBaseplateOperations hook

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

  // Use the export feature module for fixture export
  // Export quality can be 'fast' (for tablets), 'balanced', or 'high' (default)
  // The quality can also be overridden via the export-fixture event detail
  useExport({
    mergedFixtureMesh,
    basePlate,
    baseplateWithHoles,
    basePlateMeshRef,
    multiSectionBasePlateGroupRef,
    originalBaseplateGeoRef,
    modifiedSupportGeometries,
    supports,
    placedClamps,
    clampSupportInfos,
    loadedClampDataRef,
    labelsRef,
    baseTopY,
    // Default to 'high' quality - can be changed to 'fast' or 'balanced' for low-end devices
    // or passed via export event: window.dispatchEvent(new CustomEvent('export-fixture', { detail: { config, quality: 'fast' } }))
    exportQuality: 'high',
  });

  // Handle view reset events - delegated to useSceneReset hook
  useSceneReset({
    // Camera
    importedPartsLength: importedParts.length,
    modelBounds,
    setCurrentOrientation,
    updateCamera,
    
    // Baseplate
    setBasePlate,
    setSelectedBasePlateSectionId,
    setEditingBasePlateSectionId,
    setIsMultiSectionDrawingMode,
    setDrawnSections,
    setWaitingForSectionSelection,
    
    // Supports
    setSupports,
    setSupportsTrimPreview,
    setPlacing,
    setModifiedSupportGeometries,
    editingSupportRef,
    
    // Clamps
    setPlacedClamps,
    setSelectedClampId,
    setClampPlacementMode,
    setWaitingForClampSectionSelection,
    setClampMinOffsets,
    setClampSupportInfos,
    setClampDebugPoints,
    setDebugPerimeter,
    setDebugClampSilhouette,
    isDraggingClampRef,
    loadedClampDataRef,
    clampDebugPointsRef,
    partSilhouetteRef,
    
    // Labels
    setLabels,
    setSelectedLabelId,
    setWaitingForLabelSectionSelection,
    setPendingLabelConfig,
    isDraggingLabelRef,
    
    // Holes
    setMountingHoles,
    setSelectedHoleId,
    setEditingHoleId,
    setHolePlacementMode,
    setWaitingForHoleSectionSelection,
    setPendingHoleConfig,
    setIsDraggingHole,
    isDraggingHoleRef,
    setBaseplateWithHoles,
    originalBaseplateGeoRef,
    
    // Scene state
    setMergedFixtureMesh,
    setOffsetMeshPreviews,
  });

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
      <SceneLighting />

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
          onSectionClick={(sectionId) => {
            // Single click - select section for highlighting in properties panel
            // Also used for feature placement when in placement mode
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
            // Clear part selection when selecting a baseplate section
            onPartSelected(null);
            setSelectedBasePlateSectionId(sectionId);
          }}
          onSectionDoubleClick={(
            isMultiSectionDrawingMode || 
            holePlacementMode.active ||
            placing.active ||
            clampPlacementMode.active ||
            waitingForSectionSelection ||
            waitingForClampSectionSelection ||
            waitingForLabelSectionSelection ||
            waitingForHoleSectionSelection
          ) ? undefined : (sectionId) => {
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
                disableDoubleClick={
                  // Disable double-click for transform gizmo during any placement mode
                  placing.active || 
                  !isVisible || 
                  clampPlacementMode.active || 
                  holePlacementMode.active ||
                  isMultiSectionDrawingMode ||
                  waitingForSectionSelection ||
                  waitingForClampSectionSelection ||
                  waitingForLabelSectionSelection ||
                  waitingForHoleSectionSelection
                }
                onDoubleClick={() => {
                  // Only allow double-click to activate transform gizmo when NOT in any placement mode
                  const isAnyPlacementActive = 
                    clampPlacementMode.active || 
                    holePlacementMode.active ||
                    placing.active ||
                    isMultiSectionDrawingMode ||
                    waitingForSectionSelection ||
                    waitingForClampSectionSelection ||
                    waitingForLabelSectionSelection ||
                    waitingForHoleSectionSelection;
                  
                  if (isVisible && !isAnyPlacementActive) {
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

      {/* Supports rendering - extracted to SupportsRenderer */}
      <SupportsRenderer
        supports={supports}
        selectedSupportId={selectedSupportId}
        mergedFixtureMesh={mergedFixtureMesh}
        supportsTrimPreview={supportsTrimPreview}
        modifiedSupportGeometries={modifiedSupportGeometries}
        baseTopY={baseTopY}
        placingActive={placing.active}
        basePlate={basePlate}
        mountingHolesCount={mountingHoles.length}
        onSupportSelect={onSupportSelect}
        setSupports={setSupports}
        onDragStart={() => {
          isDraggingSupportRef.current = true;
          setIsDraggingAnyItem(true);
        }}
        onDragEnd={() => {
          isDraggingSupportRef.current = false;
          setIsDraggingAnyItem(false);
        }}
        triggerHoleCSG={() => setHoleCSGTrigger(t => t + 1)}
        isCavityApplied={isCavityApplied}
      />

      {/* Labels rendering - extracted to LabelsRenderer */}
      <LabelsRenderer
        labels={labels}
        selectedLabelId={selectedLabelId}
        mergedFixtureMesh={mergedFixtureMesh}
        basePlate={basePlate}
        mountingHolesCount={mountingHoles.length}
        setSelectedLabelId={setSelectedLabelId}
        setLabels={setLabels}
        onDragStart={() => {
          isDraggingLabelRef.current = true;
          setIsDraggingAnyItem(true);
        }}
        onDragEnd={() => {
          isDraggingLabelRef.current = false;
          setIsDraggingAnyItem(false);
        }}
        triggerHoleCSG={() => setHoleCSGTrigger(t => t + 1)}
      />

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
                // Dispatch highlight-component to navigate to clamps step
                window.dispatchEvent(new CustomEvent('highlight-component', {
                  detail: { category: 'clamp', id }
                }));
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
