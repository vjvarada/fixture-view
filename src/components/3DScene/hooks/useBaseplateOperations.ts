/**
 * useBaseplateOperations - Hook for baseplate event handling and operations
 * Extracted from 3DScene.tsx for modularity
 * 
 * Phase 5.8 extraction - Handles all baseplate-related events:
 * - create-baseplate
 * - baseplate-deselected, cancel-baseplate, update-baseplate, remove-baseplate
 * - baseplate-section-removed
 * - baseplate-drawing-mode-changed
 * - check-baseplate-collision, check-baseplate-collision-delayed
 * - set-part-to-baseplate
 */
import * as React from 'react';
import * as THREE from 'three';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';
import { mergeOverlappingSections } from '@/features/baseplate';
import type { ProcessedFile } from '@/modules/FileImport/types';
import type { ViewOrientation } from '@/modules/FileImport/types';
import type { AnySupport, FootprintBounds } from '@/features/supports';
import type { PlacedClamp, ClampSupportInfo } from '@/features/clamps';
import type { LabelConfig } from '@/features/labels';
import type { PlacedHole } from '@/features/holes';
import { getActualMinYFromMesh } from '../utils/geometryUtils';

// Reusable temp vector for world position calculations
const tempVec = new THREE.Vector3();

export interface UseBaseplateOperationsProps {
  // State and setters
  basePlate: BasePlateConfig | null;
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  importedParts: ProcessedFile[];
  selectedPartId: string | null;
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh>>>;
  
  // Transform state
  modelTransform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  };
  setModelTransform: (transform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  }) => void;
  
  // Multi-section drawing mode
  isMultiSectionDrawingMode: boolean;
  setIsMultiSectionDrawingMode: React.Dispatch<React.SetStateAction<boolean>>;
  drawnSections: BasePlateSection[];
  setDrawnSections: React.Dispatch<React.SetStateAction<BasePlateSection[]>>;
  multiSectionPadding: number;
  setMultiSectionPadding: React.Dispatch<React.SetStateAction<number>>;
  
  // Camera/orientation
  currentOrientation: ViewOrientation;
  setCurrentOrientation: React.Dispatch<React.SetStateAction<ViewOrientation>>;
  prevOrientationRef: React.MutableRefObject<ViewOrientation>;
  setOrbitControlsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  updateCamera: (orientation: ViewOrientation, modelBounds: THREE.Box3) => void;
  modelBounds: THREE.Box3;
  
  // Item footprints for bounds calculation
  supports: AnySupport[];
  labels: LabelConfig[];
  placedClamps: PlacedClamp[];
  clampSupportInfos: Map<string, ClampSupportInfo>;
  mountingHoles: PlacedHole[];
  getSupportFootprintBounds: (support: AnySupport) => FootprintBounds;
  
  // Drag flags
  isDraggingHoleRef: React.MutableRefObject<boolean>;
  livePositionDelta: THREE.Vector3;
}

export interface UseBaseplateOperationsReturn {
  /** Callback for when a section is drawn in multi-section mode */
  handleSectionDrawn: (section: BasePlateSection) => void;
}

/**
 * Hook that manages all baseplate-related event handlers
 * - Listens for create/update/remove baseplate events
 * - Handles collision detection and part lifting
 * - Manages multi-section drawing mode
 */
export function useBaseplateOperations({
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
}: UseBaseplateOperationsProps): UseBaseplateOperationsReturn {

  // ========================================================================
  // Handle base plate creation events
  // ========================================================================
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
  }, [importedParts, selectedPartId, basePlate, setBasePlate, setDrawnSections, setIsMultiSectionDrawingMode, setOrbitControlsEnabled, setModelTransform, modelMeshRefs]);

  // ========================================================================
  // Handle base plate deselection/cancellation/update
  // ========================================================================
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

    const handleRemoveBaseplate = () => {
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
  }, [basePlate, importedParts, selectedPartId, setBasePlate, setModelTransform, modelMeshRefs]);

  // ========================================================================
  // Handle section removal and updates (separate effect with functional updates)
  // ========================================================================
  React.useEffect(() => {
    const handleSectionRemoved = (e: CustomEvent<{ sectionId: string; sections: BasePlateSection[] }>) => {
      // Use functional update to avoid stale closure issues
      setBasePlate(prev => {
        if (!prev || prev.type !== 'multi-section') return prev;
        
        const sections = e.detail.sections;
        if (!sections || sections.length === 0) {
          return prev;
        }
        
        return {
          ...prev,
          sections,
          // Recalculate overall bounds
          width: Math.max(...sections.map(s => s.maxX)) - Math.min(...sections.map(s => s.minX)),
          height: Math.max(...sections.map(s => s.maxZ)) - Math.min(...sections.map(s => s.minZ)),
        };
      });
    };

    // Handle section bounds update (from properties panel)
    const handleSectionUpdated = (e: CustomEvent<{ 
      basePlateId: string; 
      sectionId: string; 
      newBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
      source?: string;
    }>) => {
      const { sectionId, newBounds, source } = e.detail;
      
      // Use functional update to avoid stale closure issues
      setBasePlate(prev => {
        if (!prev || prev.type !== 'multi-section' || !prev.sections) return prev;
        
        // Update the section with new bounds
        // If from properties panel, also update original* values to prevent auto-resize snap-back
        const updatedSections = prev.sections.map(s => {
          if (s.id !== sectionId) return s;
          
          const updated = { ...s, ...newBounds };
          
          // When user manually changes bounds from properties panel, treat this as the new "original"
          // This prevents the auto-resize effect from snapping back to old values
          if (source === 'properties-panel') {
            updated.originalWidth = newBounds.maxX - newBounds.minX;
            updated.originalDepth = newBounds.maxZ - newBounds.minZ;
            updated.originalCenterX = (newBounds.minX + newBounds.maxX) / 2;
            updated.originalCenterZ = (newBounds.minZ + newBounds.maxZ) / 2;
          }
          
          return updated;
        });
        
        return {
          ...prev,
          sections: updatedSections,
          // Recalculate overall bounds
          width: Math.max(...updatedSections.map(s => s.maxX)) - Math.min(...updatedSections.map(s => s.minX)),
          height: Math.max(...updatedSections.map(s => s.maxZ)) - Math.min(...updatedSections.map(s => s.minZ)),
        };
      });
    };

    window.addEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
    window.addEventListener('baseplate-section-updated', handleSectionUpdated as EventListener);

    return () => {
      window.removeEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
      window.removeEventListener('baseplate-section-updated', handleSectionUpdated as EventListener);
    };
  }, [setBasePlate]); // Only depends on setBasePlate which is stable

  // ========================================================================
  // Handle multi-section baseplate drawing mode
  // ========================================================================
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
  }, [currentOrientation, updateCamera, modelBounds, setIsMultiSectionDrawingMode, setMultiSectionPadding, setCurrentOrientation, setOrbitControlsEnabled, prevOrientationRef]);

  // ========================================================================
  // Handle section drawn - forward to AppShell
  // ========================================================================
  const handleSectionDrawn = React.useCallback((section: BasePlateSection) => {
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
  }, [setDrawnSections]);

  // ========================================================================
  // Sync drawn sections from AppShell events (for removal)
  // ========================================================================
  React.useEffect(() => {
    const handleSectionRemoved = () => {
      // Re-sync sections from the event if needed
      // For now, the sections are managed locally and synced via events
    };

    window.addEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
    return () => window.removeEventListener('baseplate-section-removed', handleSectionRemoved as EventListener);
  }, []);

  // ========================================================================
  // Update rectangular baseplate size and position when model transform changes
  // DEBOUNCED: Clamp drag causes frequent placedClamps updates
  // ========================================================================
  React.useEffect(() => {
    if (!basePlate) return;
    // Allow update if there are imported parts OR clamps with support info
    if (importedParts.length === 0 && placedClamps.length === 0) return;
    
    // Only update for rectangular-type baseplates
    // Convex-hull recalculates its geometry from modelGeometry/modelMatrixWorld props automatically
    // Multi-section baseplates have their own bounds calculated from sections
    if (basePlate.type === 'convex-hull' || basePlate.type === 'multi-section') return;
    
    // Skip during hole drag to prevent updates during gizmo manipulation
    if (isDraggingHoleRef.current) return;
    
    // Debounce the expensive calculation
    const timeoutId = setTimeout(() => {
      // Skip if we started dragging during debounce
      if (isDraggingHoleRef.current) return;
      
      // Compute combined bounding box of all parts
      const box = new THREE.Box3();
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          ref.current.updateMatrixWorld(true);
          const partBox = new THREE.Box3().setFromObject(ref.current);
          box.union(partBox);
        }
      });
      
      // Expand the bounding box to include support footprints
      for (const support of supports) {
        const footprintBounds = getSupportFootprintBounds(support);
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
      const HOLE_MARGIN = 3.0;
      for (const hole of mountingHoles) {
        const holeX = Number(hole.position?.x) || 0;
        const holeZ = Number(hole.position?.y) || 0;
        const radius = (Number(hole.diameter) || 6) / 2;
        const outerRadius = radius + HOLE_MARGIN;
        
        box.min.x = Math.min(box.min.x, holeX - outerRadius);
        box.max.x = Math.max(box.max.x, holeX + outerRadius);
        box.min.z = Math.min(box.min.z, holeZ - outerRadius);
        box.max.z = Math.max(box.max.z, holeZ + outerRadius);
      }
      
      // Expand the bounding box to include label footprints
      for (const label of labels) {
        // Use actual computed dimensions if available, otherwise estimate
        let textWidth: number;
        let textHeight: number;
        
        if (label.computedWidth !== undefined && label.computedHeight !== undefined) {
          textWidth = label.computedWidth;
          textHeight = label.computedHeight;
        } else {
          // Fallback estimate with conservative factor
          textWidth = label.text.length * label.fontSize * 0.5;
          textHeight = label.fontSize;
        }
        const padding = 5;
        
        const rot = label.rotation;
        const rotationAngle = typeof rot === 'object' ? ((rot as any).z || 0) : 0;
        
        const halfW = textWidth / 2 + padding;
        const halfH = textHeight / 2 + padding;
        const cos = Math.cos(rotationAngle);
        const sin = Math.sin(rotationAngle);
        
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
      const newHeight = size.z + currentPadding * 2;
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
  }, [modelTransform.position, modelTransform.rotation, basePlate?.type, supports, labels, livePositionDelta, placedClamps, clampSupportInfos, mountingHoles, basePlate, importedParts, getSupportFootprintBounds, isDraggingHoleRef, modelMeshRefs, setBasePlate]);

  // ========================================================================
  // Handle check-baseplate-collision event
  // (triggered when position is reset from Properties panel)
  // ========================================================================
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
  }, [basePlate, modelMeshRefs]);

  // ========================================================================
  // Handle delayed baseplate collision check
  // (runs AFTER pivot controls finish baking transform)
  // ========================================================================
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
  }, [basePlate, modelMeshRefs]);

  // ========================================================================
  // Handle set-part-to-baseplate event
  // (positions part so its bottom touches baseplate top)
  // ========================================================================
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
  }, [basePlate, modelMeshRefs]);

  return {
    handleSectionDrawn,
  };
}
