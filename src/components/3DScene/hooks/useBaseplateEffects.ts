/**
 * useBaseplateEffects Hook
 * 
 * Manages baseplate-related side effects:
 * - baseTopY calculation (top surface Y position for support placement)
 * - Part count change effects (recalculating baseplate when parts added/removed)
 * - Part lifting when colliding with baseplate
 * 
 * Part of Phase 5.7: Baseplate System extraction
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ProcessedFile } from '@/modules/FileImport';
import type { BasePlateConfig } from '@/features/baseplate/types';

interface UseBaseplateEffectsParams {
  /** Current baseplate configuration */
  basePlate: BasePlateConfig | null;
  /** Setter for baseplate state */
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  /** Setter for baseTopY state */
  setBaseTopY: React.Dispatch<React.SetStateAction<number>>;
  /** Reference to baseplate mesh */
  basePlateMeshRef: React.RefObject<THREE.Mesh | null>;
  /** Reference to multi-section baseplate group */
  multiSectionBasePlateGroupRef: React.RefObject<THREE.Group | null>;
  /** Array of imported parts */
  importedParts: ProcessedFile[];
  /** Map of part IDs to mesh refs */
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh | null>>>;
}

interface UseBaseplateEffectsReturn {
  // Currently no return values - effects run automatically
  // Future: could expose manual trigger functions if needed
}

/**
 * Hook that manages baseplate-related side effects
 * 
 * @param params - Configuration parameters
 * @returns Currently empty - effects run automatically
 */
export function useBaseplateEffects({
  basePlate,
  setBasePlate,
  setBaseTopY,
  basePlateMeshRef,
  multiSectionBasePlateGroupRef,
  importedParts,
  modelMeshRefs,
}: UseBaseplateEffectsParams): UseBaseplateEffectsReturn {
  
  // Track previous part count for detecting additions/removals
  const prevPartCountRef = useRef(importedParts.length);

  // =========================================================================
  // Effect: Calculate baseTopY from baseplate mesh
  // Ensures supports use the baseplate TOP surface, not bottom
  // =========================================================================
  useEffect(() => {
    const updateTopY = () => {
      const mesh = basePlateMeshRef.current;
      const multiSectionGroup = multiSectionBasePlateGroupRef.current;
      // Fallback to basePlate.depth when mesh is not visible
      const fallbackTopY = basePlate?.depth ?? 5;
      
      // For multi-section baseplates, use the group
      if (multiSectionGroup && basePlate?.type === 'multi-section') {
        multiSectionGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(multiSectionGroup);
        if (!box.isEmpty()) {
          const newTopY = box.max.y;
          setBaseTopY(prev => Math.abs(prev - newTopY) < 0.001 ? prev : newTopY);
          return;
        }
      }
      
      if (!mesh) { 
        setBaseTopY(prev => Math.abs(prev - fallbackTopY) < 0.001 ? prev : fallbackTopY); 
        return; 
      }
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) { 
        setBaseTopY(prev => Math.abs(prev - fallbackTopY) < 0.001 ? prev : fallbackTopY); 
        return; 
      }
      const newTopY = box.max.y;
      // Only update if the value actually changed (with small tolerance)
      setBaseTopY(prev => Math.abs(prev - newTopY) < 0.001 ? prev : newTopY);
    };
    
    updateTopY();
    const id = setInterval(updateTopY, 250);
    return () => clearInterval(id);
  }, [basePlate?.depth, basePlate?.type, basePlateMeshRef, multiSectionBasePlateGroupRef, setBaseTopY]);

  // =========================================================================
  // Effect: Trigger baseplate recalculation when parts are added/removed
  // Also lifts parts above the baseplate after recalculation
  // =========================================================================
  useEffect(() => {
    const prevCount = prevPartCountRef.current;
    const currentCount = importedParts.length;
    prevPartCountRef.current = currentCount;
    
    // Only trigger if we have a baseplate and parts were added
    if (basePlate && currentCount > prevCount) {
      // Delay to ensure new mesh refs are populated and baseplate is updated
      const timeoutId = setTimeout(() => {
        // Force baseplate to recalculate for convex-hull type
        if (basePlate.type === 'convex-hull') {
          setBasePlate(prev => prev ? { ...prev } : null);
        }
        
        // After another short delay, lift any parts that collide with the baseplate
        setTimeout(() => {
          const baseplateMesh = basePlateMeshRef.current;
          if (!baseplateMesh) return;
          
          baseplateMesh.updateMatrixWorld(true);
          const baseplateBox = new THREE.Box3().setFromObject(baseplateMesh);
          const baseplateTopY = baseplateBox.max.y;
          
          // Temp vector for world position calculations
          const tempVec = new THREE.Vector3();
          
          // Check each part and lift if needed
          importedParts.forEach(part => {
            const ref = modelMeshRefs.current.get(part.id);
            if (ref?.current) {
              ref.current.updateMatrixWorld(true);
              const partBox = new THREE.Box3().setFromObject(ref.current);
              const partBottomY = partBox.min.y;
              
              // If part's bottom is below baseplate top, lift it
              if (partBottomY < baseplateTopY) {
                const offsetY = baseplateTopY - partBottomY;
                ref.current.position.y += offsetY;
                ref.current.updateMatrixWorld(true);
                
                // Emit transform update
                ref.current.getWorldPosition(tempVec);
                window.dispatchEvent(new CustomEvent('model-transform-updated', {
                  detail: {
                    position: tempVec.clone(),
                    rotation: ref.current.rotation.clone(),
                    partId: part.id,
                  },
                }));
              }
            }
          });
        }, 100);
      }, 200);
      return () => clearTimeout(timeoutId);
    } else if (basePlate?.type === 'convex-hull' && prevCount !== currentCount) {
      // Parts were removed - just recalculate baseplate
      const timeoutId = setTimeout(() => {
        setBasePlate(prev => prev ? { ...prev } : null);
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [importedParts.length, basePlate, basePlateMeshRef, modelMeshRefs, setBasePlate]);

  return {};
}

export type { UseBaseplateEffectsParams, UseBaseplateEffectsReturn };
