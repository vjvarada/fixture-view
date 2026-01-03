/**
 * useModelTransform - Hook for managing model transform state and live transform tracking
 * Extracted from 3DScene.tsx for modularity
 * 
 * Phase 5.6.3 extraction
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { BasePlateConfig } from '@/features/baseplate';

// Reusable temp vector for world position calculations
const tempVec = new THREE.Vector3();

export interface LiveTransformData {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  bounds: THREE.Box3;
  pivotClosed?: boolean;
}

export interface UseModelTransformProps {
  selectedPartId: string | null;
  basePlate: BasePlateConfig | null;
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh>>>;
}

export interface UseModelTransformReturn {
  // State
  modelTransform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  };
  setModelTransform: React.Dispatch<React.SetStateAction<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  }>>;
  liveTransform: LiveTransformData | null;
  setLiveTransform: React.Dispatch<React.SetStateAction<LiveTransformData | null>>;
  
  // Refs
  pivotClosingRef: React.MutableRefObject<boolean>;
  
  // Callbacks
  handleLiveTransformChange: (transform: LiveTransformData | null) => void;
  
  // Computed
  livePositionDelta: { x: number; z: number } | null;
}

/**
 * Hook to manage model transform state and live transform tracking during pivot control manipulation
 */
export function useModelTransform({
  selectedPartId,
  basePlate,
  modelMeshRefs,
}: UseModelTransformProps): UseModelTransformReturn {
  // Local state to track the selected part's transform (for property panel sync and grid positioning)
  const [modelTransform, setModelTransform] = useState({
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    scale: new THREE.Vector3(1, 1, 1),
  });

  // Live transform state - when pivot controls are active, this tracks the model's live position/bounds
  const [liveTransform, setLiveTransform] = useState<LiveTransformData | null>(null);
  
  // Track whether we're in the process of closing (to ignore spurious transforms)
  const pivotClosingRef = useRef(false);

  // Handle live transform from PivotControls
  // Supports stay fixed, but we track the transform for baseplate live updates
  const handleLiveTransformChange = useCallback((transform: LiveTransformData | null) => {
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
  }, [basePlate, selectedPartId, modelMeshRefs]);
  
  // Compute live position delta from the pivot transform for baseplate
  const livePositionDelta = useMemo(() => {
    if (!liveTransform) return null;
    
    // liveTransform.position is already the delta from pivot origin
    return {
      x: liveTransform.position.x,
      z: liveTransform.position.z,
    };
  }, [liveTransform]);

  // Emit initial transform when a new file is loaded
  useEffect(() => {
    // When a new file is loaded, emit the initial transform with isInitial flag
    // This allows the Properties panel to store the initial position for reset functionality
    if (selectedPartId) {
      const timer = setTimeout(() => {
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
      return () => clearTimeout(timer);
    }
  }, [selectedPartId]); // Note: intentionally not including modelTransform to avoid loops

  return {
    // State
    modelTransform,
    setModelTransform,
    liveTransform,
    setLiveTransform,
    
    // Refs
    pivotClosingRef,
    
    // Callbacks
    handleLiveTransformChange,
    
    // Computed
    livePositionDelta,
  };
}
