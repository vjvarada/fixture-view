/**
 * useMultiSectionSelection Hook
 * 
 * Manages section selection workflow for multi-section baseplates.
 * Handles the coordination between "waiting for selection" states and
 * completing the placement workflow once a section is selected.
 * 
 * Features:
 * - DOM click handler for section selection during placement modes
 * - Coordinating support/clamp/label/hole placement with section selection
 * - ESC key handlers to cancel section selection
 * 
 * Part of Phase 5.7: Baseplate System extraction
 */

import { useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate/types';
import type { SupportType, AnySupport } from '@/features/supports/types';

// Placement state type (from useSupportState)
interface SupportPlacingState {
  active: boolean;
  type: SupportType | null;
  initParams: Record<string, unknown>;
}

// Clamp placement state type
interface ClampPlacementModeState {
  active: boolean;
  clampModelId: string | null;
  clampCategory: string | null;
}

// Hole placement state type
interface HolePlacementModeState {
  active: boolean;
  config: unknown | null;
  depth: number;
}

interface UseMultiSectionSelectionParams {
  // Baseplate state
  basePlate: BasePlateConfig | null;
  selectedBasePlateSectionId: string | null;
  setSelectedBasePlateSectionId: (id: string | null) => void;
  
  // Support placement waiting state
  waitingForSectionSelection: boolean;
  setWaitingForSectionSelection: (waiting: boolean) => void;
  placing: SupportPlacingState;
  setPlacing: (state: SupportPlacingState) => void;
  
  // Clamp placement waiting state
  waitingForClampSectionSelection: boolean;
  setWaitingForClampSectionSelection: (waiting: boolean) => void;
  clampPlacementMode: ClampPlacementModeState;
  setClampPlacementMode: (state: ClampPlacementModeState) => void;
  partSilhouetteRef: React.MutableRefObject<unknown>;
  DEBUG_SHOW_CLAMP_SILHOUETTE: boolean;
  setDebugClampSilhouette: (silhouette: unknown) => void;
  
  // Label placement waiting state
  waitingForLabelSectionSelection: boolean;
  setWaitingForLabelSectionSelection: (waiting: boolean) => void;
  pendingLabelConfig: unknown | null;
  setPendingLabelConfig: (config: unknown | null) => void;
  // Label state setters for direct placement
  setLabels: React.Dispatch<React.SetStateAction<Array<unknown>>>;
  setSelectedLabelId: (id: string | null) => void;
  setItemBoundsUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
  
  // Hole placement waiting state
  waitingForHoleSectionSelection: boolean;
  setWaitingForHoleSectionSelection: (waiting: boolean) => void;
  pendingHoleConfig: { config: unknown; depth: number } | null;
  setPendingHoleConfig: (config: { config: unknown; depth: number } | null) => void;
  setHolePlacementMode: (state: HolePlacementModeState) => void;
  
  // Orbit controls
  setOrbitControlsEnabled: (enabled: boolean) => void;
  
  // Camera/view management
  currentOrientation: string;
  setCurrentOrientation: (orientation: string) => void;
  prevOrientationRef: React.MutableRefObject<string>;
  updateCamera: (orientation: string, bounds: unknown) => void;
  modelBounds: unknown;
  
  // Part/Selection management
  importedParts: Array<{ id: string }>;
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh | null>>>;
  baseTopY: number;
  onPartSelected: (id: string | null) => void;
  onSupportSelect?: (id: string | null) => void;
  setSelectedClampId: (id: string | null) => void;
  
  // Three.js refs
  gl: THREE.WebGLRenderer;
  camera: THREE.Camera;
  scene: THREE.Scene;
  raycasterRef: React.MutableRefObject<THREE.Raycaster>;
}

interface UseMultiSectionSelectionReturn {
  // Currently no return values - effects manage state internally
}

/**
 * Hook that manages section selection workflow for multi-section baseplates
 */
export function useMultiSectionSelection({
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
}: UseMultiSectionSelectionParams): UseMultiSectionSelectionReturn {
  
  // =========================================================================
  // DOM-level click handler for section selection during support placement
  // This allows clicking through parts/supports/clamps to select baseplate sections
  // =========================================================================
  useEffect(() => {
    if (!waitingForSectionSelection) return;

    const handleCanvasClick = (event: MouseEvent) => {
      if (basePlate?.type !== 'multi-section' || !basePlate.sections) return;

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
  }, [waitingForSectionSelection, basePlate, gl, camera, scene, raycasterRef, setSelectedBasePlateSectionId]);

  // =========================================================================
  // DOM-level click handler for section selection during LABEL/HOLE placement
  // This allows clicking through parts/supports/clamps to select baseplate sections
  // =========================================================================
  useEffect(() => {
    if (!waitingForLabelSectionSelection && !waitingForHoleSectionSelection) return;

    const handleCanvasClick = (event: MouseEvent) => {
      if (basePlate?.type !== 'multi-section' || !basePlate.sections) return;

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
            console.log('[LabelHolePlacement] Section selected via DOM click:', sectionId);
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
  }, [waitingForLabelSectionSelection, waitingForHoleSectionSelection, basePlate, gl, camera, scene, raycasterRef, setSelectedBasePlateSectionId]);

  // =========================================================================
  // Handle section selection completion for SUPPORT placement
  // =========================================================================
  useEffect(() => {
    if (waitingForSectionSelection && selectedBasePlateSectionId && placing.type) {
      // Section selected, now start support placement
      setWaitingForSectionSelection(false);
      setOrbitControlsEnabled(false);
      setPlacing({ active: true, type: placing.type, initParams: placing.initParams });
    }
  }, [waitingForSectionSelection, selectedBasePlateSectionId, placing.type, placing.initParams, setWaitingForSectionSelection, setOrbitControlsEnabled, setPlacing]);

  // Handle ESC key to cancel support section selection
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
  }, [waitingForSectionSelection, updateCamera, modelBounds, setWaitingForSectionSelection, setPlacing, setOrbitControlsEnabled, setCurrentOrientation, prevOrientationRef]);

  // =========================================================================
  // Handle section selection completion for CLAMP placement
  // =========================================================================
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
  }, [waitingForClampSectionSelection, selectedBasePlateSectionId, clampPlacementMode, importedParts, baseTopY, onPartSelected, onSupportSelect, setWaitingForClampSectionSelection, setClampPlacementMode, setSelectedClampId, modelMeshRefs, partSilhouetteRef, DEBUG_SHOW_CLAMP_SILHOUETTE, setDebugClampSilhouette]);

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
  }, [waitingForClampSectionSelection, setWaitingForClampSectionSelection, setClampPlacementMode, partSilhouetteRef]);

  // =========================================================================
  // Handle section selection completion for LABEL placement
  // =========================================================================
  useEffect(() => {
    if (waitingForLabelSectionSelection && selectedBasePlateSectionId && pendingLabelConfig) {
      console.log('[LabelPlacement] Section selected, placing label directly');
      setWaitingForLabelSectionSelection(false);
      
      // Get the section bounds
      const section = basePlate?.type === 'multi-section' && basePlate.sections
        ? basePlate.sections.find(s => s.id === selectedBasePlateSectionId)
        : null;
      
      if (section) {
        // Cast to any to access LabelConfig properties
        const label = pendingLabelConfig as {
          id: string;
          text: string;
          fontSize: number;
          depth: number;
          font: string;
          position: THREE.Vector3;
          rotation: THREE.Euler;
          sectionId?: string;
        };
        
        // Position label at the center-front of the section
        const sectionCenterX = (section.minX + section.maxX) / 2;
        const sectionFrontZ = section.maxZ;
        
        const labelY = baseTopY;
        const labelX = sectionCenterX;
        const labelZ = sectionFrontZ + label.fontSize / 2;
        
        const newLabel = {
          ...label,
          sectionId: selectedBasePlateSectionId,
          position: new THREE.Vector3(labelX, labelY, labelZ),
          rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
        };
        
        // Add label directly to state
        setLabels(prev => [...prev, newLabel]);
        setSelectedLabelId(newLabel.id);
        
        // Force bounds recalculation
        setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
        
        // Clear selected section after label placement
        setSelectedBasePlateSectionId(null);
        
        // Dispatch events for other listeners
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
      }
      
      setPendingLabelConfig(null);
    }
  }, [waitingForLabelSectionSelection, selectedBasePlateSectionId, pendingLabelConfig, basePlate, baseTopY, setWaitingForLabelSectionSelection, setPendingLabelConfig, setLabels, setSelectedLabelId, setItemBoundsUpdateTrigger, setSelectedBasePlateSectionId]);

  // =========================================================================
  // Handle section selection completion for HOLE placement
  // =========================================================================
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
  }, [waitingForHoleSectionSelection, selectedBasePlateSectionId, pendingHoleConfig, currentOrientation, updateCamera, modelBounds, basePlate, setWaitingForHoleSectionSelection, setPendingHoleConfig, setOrbitControlsEnabled, setCurrentOrientation, prevOrientationRef, setHolePlacementMode]);

  // Handle ESC key to cancel label/hole section selection
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
  }, [waitingForLabelSectionSelection, waitingForHoleSectionSelection, setWaitingForLabelSectionSelection, setPendingLabelConfig, setWaitingForHoleSectionSelection, setPendingHoleConfig]);

  return {};
}

export type { UseMultiSectionSelectionParams, UseMultiSectionSelectionReturn };
