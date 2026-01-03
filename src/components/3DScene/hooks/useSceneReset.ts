/**
 * useSceneReset - Hook for handling scene reset and Three.js memory cleanup
 * Extracted from 3DScene.tsx for modularity
 */
import { useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { ViewOrientation } from './useSceneState';
import type { BoundsSummary } from '../types';
import type { SupportPlacingState } from './useSupportState';
import type { ClampPlacementModeState, ClampSupportInfo, LoadedClampData, ClampDebugPointsState } from './useClampState';
import type { HolePlacementModeState } from './useHoleState';
import type { LabelConfig } from '@/features/labels';
import type { AnySupport } from '@/features/supports';
import type { PlacedHole, HoleConfig } from '@/features/holes';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';

export interface UseSceneResetParams {
  // Camera
  importedPartsLength: number;
  modelBounds: BoundsSummary | null;
  setCurrentOrientation: React.Dispatch<React.SetStateAction<ViewOrientation>>;
  updateCamera: (orientation: ViewOrientation, bounds: BoundsSummary | null) => void;
  
  // Baseplate
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsMultiSectionDrawingMode: React.Dispatch<React.SetStateAction<boolean>>;
  setDrawnSections: React.Dispatch<React.SetStateAction<BasePlateSection[]>>;
  setWaitingForSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Supports
  setSupports: React.Dispatch<React.SetStateAction<AnySupport[]>>;
  setSupportsTrimPreview: React.Dispatch<React.SetStateAction<THREE.Mesh[]>>;
  setPlacing: React.Dispatch<React.SetStateAction<SupportPlacingState>>;
  setModifiedSupportGeometries: React.Dispatch<React.SetStateAction<Map<string, THREE.BufferGeometry>>>;
  editingSupportRef: React.MutableRefObject<AnySupport | null>;
  
  // Clamps
  setPlacedClamps: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedClampId: React.Dispatch<React.SetStateAction<string | null>>;
  setClampPlacementMode: React.Dispatch<React.SetStateAction<ClampPlacementModeState>>;
  setWaitingForClampSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setClampMinOffsets: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setClampSupportInfos: React.Dispatch<React.SetStateAction<Map<string, ClampSupportInfo>>>;
  setClampDebugPoints: React.Dispatch<React.SetStateAction<ClampDebugPointsState | null>>;
  setDebugPerimeter: React.Dispatch<React.SetStateAction<Array<{ x: number; z: number }> | null>>;
  setDebugClampSilhouette: React.Dispatch<React.SetStateAction<Array<{ x: number; z: number }> | null>>;
  isDraggingClampRef: React.MutableRefObject<boolean>;
  loadedClampDataRef: React.MutableRefObject<Map<string, LoadedClampData>>;
  clampDebugPointsRef: React.MutableRefObject<any>;
  partSilhouetteRef: React.MutableRefObject<Array<{ x: number; z: number }> | null>;
  
  // Labels
  setLabels: React.Dispatch<React.SetStateAction<LabelConfig[]>>;
  setSelectedLabelId: React.Dispatch<React.SetStateAction<string | null>>;
  setWaitingForLabelSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingLabelConfig: React.Dispatch<React.SetStateAction<LabelConfig | null>>;
  isDraggingLabelRef: React.MutableRefObject<boolean>;
  
  // Holes
  setMountingHoles: React.Dispatch<React.SetStateAction<PlacedHole[]>>;
  setSelectedHoleId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingHoleId: React.Dispatch<React.SetStateAction<string | null>>;
  setHolePlacementMode: React.Dispatch<React.SetStateAction<HolePlacementModeState>>;
  setWaitingForHoleSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingHoleConfig: React.Dispatch<React.SetStateAction<{ config: HoleConfig; depth: number } | null>>;
  setIsDraggingHole: React.Dispatch<React.SetStateAction<boolean>>;
  isDraggingHoleRef: React.MutableRefObject<boolean>;
  setBaseplateWithHoles: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  originalBaseplateGeoRef: React.MutableRefObject<THREE.BufferGeometry | null>;
  
  // Scene state
  setMergedFixtureMesh: React.Dispatch<React.SetStateAction<THREE.Mesh | null>>;
  setOffsetMeshPreviews: React.Dispatch<React.SetStateAction<Map<string, THREE.Mesh>>>;
}

/**
 * Dispose a Three.js mesh properly (geometry + materials)
 */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry?.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => m.dispose());
    } else {
      mesh.material.dispose();
    }
  }
}

/**
 * Hook to handle scene reset with proper Three.js memory cleanup
 */
export function useSceneReset(params: UseSceneResetParams): void {
  const {
    // Camera
    importedPartsLength,
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
  } = params;

  const handleViewReset = useCallback(() => {
    // === Reset camera ===
    if (importedPartsLength > 0) {
      setCurrentOrientation('iso');
      updateCamera('iso', modelBounds);
    } else {
      setCurrentOrientation('iso');
      updateCamera('iso', null);
    }

    // === Clear baseplate and supports ===
    setBasePlate(null);
    setSupports([]);
    setSupportsTrimPreview([]);
    setPlacing({ active: false, type: null });
    editingSupportRef.current = null;
    
    // Clear modified support geometries with proper disposal
    setModifiedSupportGeometries(prev => {
      prev.forEach(geo => geo?.dispose());
      return new Map();
    });
    
    // === Clear clamps ===
    setPlacedClamps([]);
    setSelectedClampId(null);
    setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
    setWaitingForClampSectionSelection(false);
    setClampMinOffsets(new Map());
    setClampDebugPoints(null);
    setDebugPerimeter(null);
    setDebugClampSilhouette(null);
    isDraggingClampRef.current = false;
    clampDebugPointsRef.current = null;
    partSilhouetteRef.current = null;
    
    // Dispose clamp support geometries
    setClampSupportInfos(prev => {
      prev.forEach(info => {
        info.geometry?.dispose();
      });
      return new Map();
    });
    
    // Clear loaded clamp data with proper Three.js disposal
    loadedClampDataRef.current.forEach(clampData => {
      clampData.geometry?.dispose();
      if (clampData.material) {
        if (Array.isArray(clampData.material)) {
          clampData.material.forEach(m => m.dispose());
        } else {
          clampData.material.dispose();
        }
      }
    });
    loadedClampDataRef.current.clear();
    
    // === Clear labels ===
    setLabels([]);
    setSelectedLabelId(null);
    setWaitingForLabelSectionSelection(false);
    setPendingLabelConfig(null);
    isDraggingLabelRef.current = false;
    
    // === Clear mounting holes ===
    setMountingHoles([]);
    setSelectedHoleId(null);
    setEditingHoleId(null);
    setHolePlacementMode({ active: false, config: null, depth: 0 });
    setWaitingForHoleSectionSelection(false);
    setPendingHoleConfig(null);
    setIsDraggingHole(false);
    isDraggingHoleRef.current = false;
    
    // Clear baseplate with holes geometry
    setBaseplateWithHoles(prev => {
      prev?.dispose();
      return null;
    });
    
    // Clear original baseplate geometry ref
    if (originalBaseplateGeoRef.current) {
      originalBaseplateGeoRef.current.dispose();
      originalBaseplateGeoRef.current = null;
    }
    
    // === Clear merged fixture mesh ===
    setMergedFixtureMesh(prev => {
      if (prev) {
        disposeMesh(prev);
      }
      return null;
    });
    
    // === Clear all offset mesh previews ===
    setOffsetMeshPreviews(prev => {
      prev.forEach(mesh => disposeMesh(mesh));
      return new Map();
    });
    
    // === Clear selection and editing states ===
    setSelectedBasePlateSectionId(null);
    setEditingBasePlateSectionId(null);
    
    // === Clear multi-section drawing mode ===
    setIsMultiSectionDrawingMode(false);
    setDrawnSections([]);
    setWaitingForSectionSelection(false);
    
    // === Force garbage collection hint ===
    if (typeof window !== 'undefined' && (window as any).gc) {
      try {
        (window as any).gc();
      } catch (e) {
        // GC not available
      }
    }
  }, [
    importedPartsLength,
    modelBounds,
    setCurrentOrientation,
    updateCamera,
    setBasePlate,
    setSupports,
    setSupportsTrimPreview,
    setPlacing,
    setModifiedSupportGeometries,
    setPlacedClamps,
    setSelectedClampId,
    setClampPlacementMode,
    setWaitingForClampSectionSelection,
    setClampMinOffsets,
    setClampSupportInfos,
    setClampDebugPoints,
    setDebugPerimeter,
    setDebugClampSilhouette,
    setLabels,
    setSelectedLabelId,
    setWaitingForLabelSectionSelection,
    setPendingLabelConfig,
    setMountingHoles,
    setSelectedHoleId,
    setEditingHoleId,
    setHolePlacementMode,
    setWaitingForHoleSectionSelection,
    setPendingHoleConfig,
    setIsDraggingHole,
    setBaseplateWithHoles,
    setMergedFixtureMesh,
    setOffsetMeshPreviews,
    setSelectedBasePlateSectionId,
    setEditingBasePlateSectionId,
    setIsMultiSectionDrawingMode,
    setDrawnSections,
    setWaitingForSectionSelection,
  ]);

  // Listen for viewer-reset events
  useEffect(() => {
    window.addEventListener('viewer-reset', handleViewReset);
    return () => window.removeEventListener('viewer-reset', handleViewReset);
  }, [handleViewReset]);
}
