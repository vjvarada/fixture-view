/**
 * usePartManagement - Hook for managing imported parts, their refs, bounds, and colors
 * Extracted from 3DScene.tsx for modularity
 * 
 * Phase 5.6.1 extraction
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import type { ProcessedFile } from '@/modules/FileImport/types';
import type { BoundsSummary } from '../types';

export interface UsePartManagementProps {
  importedParts: ProcessedFile[];
  onModelColorAssigned?: (modelId: string, color: string) => void;
}

export interface UsePartManagementReturn {
  // Refs
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh>>>;
  partInitialOffsetsRef: React.MutableRefObject<Map<string, THREE.Vector3>>;
  
  // State
  modelDimensions: { x?: number; y?: number; z?: number } | undefined;
  setModelDimensions: React.Dispatch<React.SetStateAction<{ x?: number; y?: number; z?: number } | undefined>>;
  modelColors: Map<string, string>;
  setModelColors: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  modelBounds: BoundsSummary | null;
  setModelBounds: React.Dispatch<React.SetStateAction<BoundsSummary | null>>;
  partBounds: Map<string, BoundsSummary>;
  setPartBounds: React.Dispatch<React.SetStateAction<Map<string, BoundsSummary>>>;
  
  // Callbacks
  getPartMeshRef: (partId: string) => React.RefObject<THREE.Mesh>;
  recalculateCombinedBounds: () => void;
  
  // Derived values
  selectedPartMeshRef: React.RefObject<THREE.Mesh> | null;
  firstPart: ProcessedFile | null;
}

/**
 * Hook to manage imported parts, their mesh refs, bounds calculations, and colors
 */
export function usePartManagement({
  importedParts,
  onModelColorAssigned,
}: UsePartManagementProps): UsePartManagementReturn {
  // Store refs for each model mesh by part ID
  const modelMeshRefs = useRef<Map<string, React.RefObject<THREE.Mesh>>>(new Map());
  
  // Store initial offsets for each part (persists across renders to prevent position reset)
  const partInitialOffsetsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  
  // State
  const [modelDimensions, setModelDimensions] = useState<{ x?: number; y?: number; z?: number } | undefined>();
  const [modelColors, setModelColors] = useState<Map<string, string>>(new Map());
  const [modelBounds, setModelBounds] = useState<BoundsSummary | null>(null);
  const [partBounds, setPartBounds] = useState<Map<string, BoundsSummary>>(new Map());
  
  // Get or create a ref for a part
  const getPartMeshRef = useCallback((partId: string) => {
    if (!modelMeshRefs.current.has(partId)) {
      // Use createRef to create a new ref object
      const newRef = { current: null } as React.RefObject<THREE.Mesh>;
      modelMeshRefs.current.set(partId, newRef);
    }
    return modelMeshRefs.current.get(partId)!;
  }, []);
  
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

  // Get the first part (for backward compatibility with single-file operations)
  const firstPart = importedParts.length > 0 ? importedParts[0] : null;

  return {
    // Refs
    modelMeshRefs,
    partInitialOffsetsRef,
    
    // State
    modelDimensions,
    setModelDimensions,
    modelColors,
    setModelColors,
    modelBounds,
    setModelBounds,
    partBounds,
    setPartBounds,
    
    // Callbacks
    getPartMeshRef,
    recalculateCombinedBounds,
    
    // Derived values (selectedPartMeshRef needs to be computed by caller since it depends on selectedPartId)
    selectedPartMeshRef: null, // Will be overridden by caller
    firstPart,
  };
}
