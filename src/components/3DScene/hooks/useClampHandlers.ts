import { useCallback, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { PlacedClamp, ClampPlacementModeState, ClampSupportInfo, LoadedClampData } from './useClampState';
import type { AnySupport } from '@/features/supports';
import type { LabelConfig } from '@/features/labels';
import type { PlacedHole } from '@/features/holes';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';
import type { ProcessedFile } from '@/modules/FileImport/types';

export interface UseClampHandlersParams {
  // State
  basePlate: BasePlateConfig | null;
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  selectedBasePlateSectionId: string | null;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Clamp state
  placedClamps: PlacedClamp[];
  setPlacedClamps: React.Dispatch<React.SetStateAction<PlacedClamp[]>>;
  selectedClampId: string | null;
  setSelectedClampId: React.Dispatch<React.SetStateAction<string | null>>;
  clampPlacementMode: ClampPlacementModeState;
  setClampPlacementMode: React.Dispatch<React.SetStateAction<ClampPlacementModeState>>;
  clampMinOffsets: Map<string, number>;
  setClampMinOffsets: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  clampSupportInfos: Map<string, ClampSupportInfo>;
  setClampSupportInfos: React.Dispatch<React.SetStateAction<Map<string, ClampSupportInfo>>>;
  showClampDebug: boolean;
  setShowClampDebug: React.Dispatch<React.SetStateAction<boolean>>;
  setWaitingForClampSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Other item state
  supports: AnySupport[];
  labels: LabelConfig[];
  mountingHoles: PlacedHole[];
  
  // Scene refs
  importedParts: ProcessedFile[];
  modelMeshRefs: MutableRefObject<Map<string, React.RefObject<THREE.Mesh>>>;
  partSilhouetteRef: MutableRefObject<Array<{ x: number; z: number }> | null>;
  loadedClampDataRef: MutableRefObject<Map<string, LoadedClampData>>;
  
  // Callbacks
  baseTopY: number;
  setDebugClampSilhouette: React.Dispatch<React.SetStateAction<Array<{ x: number; z: number }> | null>>;
  DEBUG_SHOW_CLAMP_SILHOUETTE: boolean;
  onPartSelected: (partId: string | null) => void;
  onSupportSelect?: (supportId: string | null) => void;
  calculateOptimalSectionBounds: (
    section: BasePlateSection,
    sectionSupports: AnySupport[],
    sectionClamps: PlacedClamp[],
    padding: number,
    sectionLabels?: LabelConfig[],
    sectionHoles?: PlacedHole[]
  ) => BasePlateSection;
  
  // Item bounds trigger
  setItemBoundsUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
}

export function useClampHandlers({
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
}: UseClampHandlersParams) {

  // Clamp event listeners
  useEffect(() => {
    const onClampPlace = (e: CustomEvent) => {
      const { clampModelId, position } = e.detail as { clampModelId: string; position?: { x: number; y: number; z: number } };
      
      // Default minimum placement offset (will be updated when clamp data loads)
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
      
      // Create a mutable copy of updates to avoid mutating frozen Zustand state
      const mutableUpdates = { ...updates };
      
      // Enforce minimum Y position if we have the offset for this clamp
      if (mutableUpdates.position) {
        mutableUpdates.position = { ...mutableUpdates.position };
        const minOffset = clampMinOffsets.get(clampId) ?? 15; // Default 15mm
        const minY = baseTopY + minOffset;
        mutableUpdates.position.y = Math.max(mutableUpdates.position.y, minY);
      }
      
      // Update clamp state - reactive effect will handle bounds recalculation
      setPlacedClamps(prev => prev.map(c => c.id === clampId ? { ...c, ...mutableUpdates } : c));
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
      if (supportInfo) {
        setClampSupportInfos(prev => new Map(prev).set(clampId, {
          polygon: supportInfo.polygon,
          localCenter: { x: 0, y: 0 },
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
      // Clear selected baseplate section when cancelling placement
      setSelectedBasePlateSectionId(null);
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
  }, [
    selectedClampId, baseTopY, clampMinOffsets, importedParts, basePlate, selectedBasePlateSectionId,
    setPlacedClamps, setSelectedClampId, setClampMinOffsets, setClampSupportInfos, setShowClampDebug,
    setClampPlacementMode, setWaitingForClampSectionSelection, setItemBoundsUpdateTrigger,
    modelMeshRefs, partSilhouetteRef, loadedClampDataRef, setDebugClampSilhouette,
    DEBUG_SHOW_CLAMP_SILHOUETTE, onPartSelected, onSupportSelect
  ]);

  return {};
}
