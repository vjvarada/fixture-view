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
}) => {
  const { camera, size, gl, scene } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  
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

  // Note: Support placement start/cancel listeners moved to useSupportHandlers hook
  // Note: Hole placement start/cancel listeners and hole event handlers moved to useHoleHandlers hook

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
