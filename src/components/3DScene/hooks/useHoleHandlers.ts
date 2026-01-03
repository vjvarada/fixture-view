import { useCallback, useEffect, MutableRefObject } from 'react';
import type { PlacedHole, HoleConfig } from '@/features/holes';
import type { BasePlateConfig } from '@/features/baseplate';
import type { ViewOrientation } from '../types';
import type * as THREE from 'three';

export interface UseHoleHandlersParams {
  // State
  basePlate: BasePlateConfig | null;
  selectedBasePlateSectionId: string | null;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  mountingHoles: PlacedHole[];
  setMountingHoles: React.Dispatch<React.SetStateAction<PlacedHole[]>>;
  selectedHoleId: string | null;
  setSelectedHoleId: React.Dispatch<React.SetStateAction<string | null>>;
  editingHoleId: string | null;
  setEditingHoleId: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Placement state
  holePlacementMode: { active: boolean; config: HoleConfig | null; depth: number };
  setHolePlacementMode: React.Dispatch<React.SetStateAction<{ active: boolean; config: HoleConfig | null; depth: number }>>;
  setWaitingForHoleSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingHoleConfig: React.Dispatch<React.SetStateAction<{ config: HoleConfig; depth: number } | null>>;
  setHoleSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  
  // CSG trigger
  setHoleCSGTrigger: React.Dispatch<React.SetStateAction<number>>;
  
  // Camera state
  currentOrientation: ViewOrientation;
  setCurrentOrientation: React.Dispatch<React.SetStateAction<ViewOrientation>>;
  modelBounds: THREE.Box3 | null;
  prevOrientationRef: MutableRefObject<ViewOrientation>;
  
  // Controls
  setOrbitControlsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Callbacks
  updateCamera: (view: ViewOrientation, bounds: THREE.Box3 | null) => void;
}

export function useHoleHandlers({
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
}: UseHoleHandlersParams) {
  
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
  }, [
    modelBounds, updateCamera, basePlate, selectedBasePlateSectionId,
    setSelectedBasePlateSectionId, setHolePlacementMode, setOrbitControlsEnabled,
    setCurrentOrientation, prevOrientationRef
  ]);

  // Listen for mounting hole placement start/cancel
  useEffect(() => {
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
      // Clear selected baseplate section when cancelling placement
      setSelectedBasePlateSectionId(null);
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
  }, [
    currentOrientation, updateCamera, modelBounds, basePlate?.depth, basePlate?.type, 
    selectedBasePlateSectionId, setWaitingForHoleSectionSelection, setPendingHoleConfig,
    setOrbitControlsEnabled, setCurrentOrientation, setHolePlacementMode, setHoleSnapEnabled,
    prevOrientationRef
  ]);

  // Sync holes from AppShell
  useEffect(() => {
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
  }, [editingHoleId, setMountingHoles, setHoleCSGTrigger]);

  // Sync selected hole ID from AppShell
  useEffect(() => {
    const handleHoleSelected = (e: CustomEvent) => {
      const holeId = e.detail as string | null;
      setSelectedHoleId(holeId);
    };
    
    window.addEventListener('hole-selected', handleHoleSelected as EventListener);
    return () => {
      window.removeEventListener('hole-selected', handleHoleSelected as EventListener);
    };
  }, [setSelectedHoleId]);

  // Handle hole edit request (double-click or button click to show transform controls)
  useEffect(() => {
    const handleHoleEditRequest = (e: CustomEvent) => {
      const holeId = e.detail as string;
      setSelectedHoleId(holeId);
      setEditingHoleId(holeId);
    };
    
    window.addEventListener('hole-edit-request', handleHoleEditRequest as EventListener);
    return () => {
      window.removeEventListener('hole-edit-request', handleHoleEditRequest as EventListener);
    };
  }, [setSelectedHoleId, setEditingHoleId]);

  // Listen for hole updates from properties panel
  useEffect(() => {
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
  }, [editingHoleId, setMountingHoles, setHoleCSGTrigger]);

  return {
    handleHoleCreate,
  };
}
