import { useCallback, useEffect, MutableRefObject } from 'react';
import type { AnySupport, SupportType, FootprintBounds } from '@/features/supports';
import { getSupportFootprintBounds } from '@/features/supports';
import type { PlacedClamp } from '@/features/clamps';
import type { LabelConfig } from '@/features/labels';
import type { PlacedHole } from '@/features/holes';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';
import type { ViewOrientation } from '../types';
import type * as THREE from 'three';

export interface UseSupportHandlersParams {
  // State
  basePlate: BasePlateConfig | null;
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  selectedBasePlateSectionId: string | null;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  supports: AnySupport[];
  setSupports: React.Dispatch<React.SetStateAction<AnySupport[]>>;
  placedClamps: PlacedClamp[];
  labels: LabelConfig[];
  mountingHoles: PlacedHole[];
  
  // Placement state
  placing: { active: boolean; type: SupportType | null; initParams: Record<string, unknown> };
  setPlacing: React.Dispatch<React.SetStateAction<{ active: boolean; type: SupportType | null; initParams: Record<string, unknown> }>>;
  setWaitingForSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Camera state
  currentOrientation: ViewOrientation;
  setCurrentOrientation: React.Dispatch<React.SetStateAction<ViewOrientation>>;
  modelBounds: THREE.Box3 | null;
  prevOrientationRef: MutableRefObject<ViewOrientation>;
  
  // Controls
  setOrbitControlsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setSupportSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Refs
  editingSupportRef: MutableRefObject<AnySupport | null>;
  
  // Callbacks
  updateCamera: (view: ViewOrientation, bounds: THREE.Box3 | null) => void;
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

export function useSupportHandlers({
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
}: UseSupportHandlersParams) {
  
  // Handle support creation - expands baseplate sections as needed
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
  }, [
    modelBounds, updateCamera, calculateOptimalSectionBounds, basePlate, 
    selectedBasePlateSectionId, supports, placedClamps, labels, mountingHoles,
    setBasePlate, setPlacing, setOrbitControlsEnabled, setSelectedBasePlateSectionId,
    setCurrentOrientation, prevOrientationRef, editingSupportRef
  ]);

  // Listen for support placement start/cancel
  useEffect(() => {
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
      // Clear selected baseplate section when cancelling placement
      setSelectedBasePlateSectionId(null);
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
  }, [
    currentOrientation, updateCamera, modelBounds, basePlate, selectedBasePlateSectionId,
    setWaitingForSectionSelection, setPlacing, setCurrentOrientation, setOrbitControlsEnabled,
    setSupportSnapEnabled, prevOrientationRef, editingSupportRef
  ]);

  // Persist created supports in scene
  useEffect(() => {
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
  }, [setSupports, editingSupportRef, setItemBoundsUpdateTrigger]);

  // Listen for support updates from properties panel
  useEffect(() => {
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
  }, [setSupports, editingSupportRef]);

  return {
    handleSupportCreate,
  };
}
