/**
 * useClampPlacement Hook
 * 
 * Handles clamp placement click interactions in the 3D scene.
 * Includes both DOM-level click handler (bypasses R3F) and legacy R3F handler.
 * 
 * Extracted from 3DScene.tsx to reduce component complexity.
 */

import { useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate/types';
import type { ProcessedFile } from '@/modules/FileImport';
import type { AnySupport } from '@/features/supports/types';
import type { PlacedClamp, ClampSupportInfo } from '@/features/clamps/types';
import type { PlacedHole } from '@/features/holes/types';
import type { LabelConfig } from '@/features/labels/types';
import type { ClampPlacementModeState, ClampDebugPointsState } from './useClampState';

interface UseClampPlacementParams {
  // Placement mode state
  clampPlacementMode: ClampPlacementModeState;
  setClampPlacementMode: React.Dispatch<React.SetStateAction<ClampPlacementModeState>>;
  
  // Baseplate state
  basePlate: BasePlateConfig | null;
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  selectedBasePlateSectionId: string | null;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Clamps state
  placedClamps: PlacedClamp[];
  setPlacedClamps: React.Dispatch<React.SetStateAction<PlacedClamp[]>>;
  setSelectedClampId: React.Dispatch<React.SetStateAction<string | null>>;
  setClampDebugPoints: React.Dispatch<React.SetStateAction<ClampDebugPointsState | null>>;
  clampDebugPointsRef: React.MutableRefObject<ClampDebugPointsState | null>;
  partSilhouetteRef: React.MutableRefObject<Array<{ x: number; y: number }> | null>;
  
  // Related items
  supports: AnySupport[];
  labels: LabelConfig[];
  mountingHoles: PlacedHole[];
  
  // Parts
  importedParts: ProcessedFile[];
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh | null>>>;
  partVisibility: Map<string, boolean>;
  
  // Scene refs
  gl: THREE.WebGLRenderer;
  camera: THREE.Camera;
  scene: THREE.Scene;
  raycasterRef: React.MutableRefObject<THREE.Raycaster>;
  
  // Positioning
  baseTopY: number;
  
  // Bounds update
  setItemBoundsUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
  
  // Handlers
  calculateOptimalSectionBounds: (
    section: BasePlateSection,
    sectionSupports: AnySupport[],
    sectionClamps: PlacedClamp[],
    padding: number,
    sectionLabels?: LabelConfig[],
    sectionHoles?: PlacedHole[]
  ) => BasePlateSection;
}

interface UseClampPlacementReturn {
  handleClampPlacementClick: (e: ThreeEvent<MouseEvent>, partMesh: THREE.Object3D) => void;
}

/**
 * Hook that manages clamp placement click interactions.
 * 
 * Provides:
 * - DOM-level click handler for clamp placement (bypasses R3F event system)
 * - Legacy R3F handler for backward compatibility
 */
export function useClampPlacement({
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
}: UseClampPlacementParams): UseClampPlacementReturn {
  
  // DOM-level click handler for clamp placement mode
  // This bypasses R3F's event system which can be blocked by PivotControls
  useEffect(() => {
    if (!clampPlacementMode.active) return;
    
    const handleCanvasClick = (event: MouseEvent) => {
      console.log('[ClampPlacement] Canvas click detected');
      
      if (!clampPlacementMode.active || !clampPlacementMode.clampModelId) {
        console.log('[ClampPlacement] Not in active placement mode');
        return;
      }
      
      // Calculate normalized device coordinates
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      
      // Set up raycaster
      raycasterRef.current.setFromCamera(mouse, camera);
      
      // Get all part meshes to test against
      const partMeshes: THREE.Mesh[] = [];
      importedParts.forEach(part => {
        const meshRef = modelMeshRefs.current.get(part.id);
        if (meshRef?.current && partVisibility.get(part.id) !== false) {
          partMeshes.push(meshRef.current);
        }
      });
      
      console.log('[ClampPlacement] Raycasting against', partMeshes.length, 'part meshes');
      
      // IMPORTANT: Check parts FIRST before baseplates
      // This ensures clicking on a part that's above a baseplate hits the part, not the baseplate
      let partIntersects: THREE.Intersection[] = [];
      if (partMeshes.length > 0) {
        partIntersects = raycasterRef.current.intersectObjects(partMeshes, false);
      }
      
      // If we hit a part, proceed with clamp placement (don't check baseplates)
      if (partIntersects.length > 0) {
        // Part was clicked - continue with clamp placement below
        console.log('[ClampPlacement] Hit part, proceeding with placement');
      } else {
        // No part hit - for multi-section baseplates, check if user clicked on a baseplate section
        if (basePlate?.type === 'multi-section' && basePlate.sections) {
          // Get baseplate group reference and check intersections
          const baseplateObjects: THREE.Object3D[] = [];
          scene.traverse((obj) => {
            if (obj.userData.isBaseplateSection) {
              baseplateObjects.push(obj);
            }
          });
          
          if (baseplateObjects.length > 0) {
            const baseplateIntersects = raycasterRef.current.intersectObjects(baseplateObjects, false);
            if (baseplateIntersects.length > 0) {
              // User clicked on a baseplate section - select it
              const sectionMesh = baseplateIntersects[0].object;
              const sectionId = sectionMesh.userData.sectionId;
              if (sectionId) {
                console.log('[ClampPlacement] Section selected:', sectionId);
                setSelectedBasePlateSectionId(sectionId);
                window.dispatchEvent(new CustomEvent('baseplate-section-selected', {
                  detail: { sectionId }
                }));
                // Don't proceed with clamp placement, just select the section
                return;
              }
            }
          }
        }
        
        // No part or baseplate hit
        console.log('[ClampPlacement] No intersection with parts or baseplates');
        return;
      }
      
      // Use the partIntersects we already calculated above
      const intersects = partIntersects;
      
      console.log('[ClampPlacement] Intersections found:', intersects.length);
      
      if (intersects.length === 0) {
        console.log('[ClampPlacement] No intersection with parts');
        return;
      }
      
      const intersection = intersects[0];
      const clickPoint = intersection.point.clone();
      const surfaceNormal = intersection.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
      const partMesh = intersection.object;
      
      console.log('[ClampPlacement] Hit point:', { x: clickPoint.x, y: clickPoint.y, z: clickPoint.z });
      
      // Transform normal to world space
      if (partMesh instanceof THREE.Mesh) {
        surfaceNormal.transformDirection(partMesh.matrixWorld);
      }
      
      // Get minimum placement offset for this clamp type (default 15mm)
      const minPlacementOffset = 15;
      
      console.log('[ClampPlacement] Loading clampPlacement module...');
      
      // Notify UI that processing has started
      window.dispatchEvent(new CustomEvent('clamp-processing-start'));
      window.dispatchEvent(new CustomEvent('clamp-progress', { 
        detail: { stage: 'loading', progress: 10, message: 'Loading placement module...' } 
      }));
      
      import('@/features/clamps/utils/clampPlacement').then(({ calculateVerticalClampPlacement }) => {
        console.log('[ClampPlacement] Module loaded, calculating placement...');
        
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'computing', progress: 30, message: 'Computing optimal position...' } 
        }));
        
        const silhouette = partSilhouetteRef.current || [];
        
        const result = calculateVerticalClampPlacement({
          clickPoint,
          surfaceNormal,
          partMesh,
          allPartMeshes: partMeshes,
          partSilhouette: silhouette,
          existingSupports: supports,
          existingClamps: placedClamps,
          baseTopY,
          minPlacementOffset,
          clampCategory: clampPlacementMode.clampCategory as 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push',
        });
        
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'positioning', progress: 60, message: 'Positioning clamp support...' } 
        }));
        
        console.log('[ClampPlacement] Placement result:', result);
        console.log('[ClampPlacement] Debug points:', result.debugPoints);
        console.log('[ClampPlacement] Silhouette points count:', silhouette.length);
        
        // Store debug points for visualization (including silhouette for red outline)
        if (result.debugPoints) {
          console.log('[ClampPlacement] Setting debug points with silhouette:', silhouette.length, 'points');
          // Store in ref immediately for sync access in onClampDataLoaded (include silhouette!)
          clampDebugPointsRef.current = {
            ...result.debugPoints,
            silhouette: silhouette, // IMPORTANT: Store silhouette for 2D collision check
          };
          setClampDebugPoints({
            ...result.debugPoints,
            silhouette: silhouette, // Store silhouette for red outline visualization
          });
        }
        
        if (result.success) {
          // For multi-section baseplates, require section selection first
          if (basePlate?.type === 'multi-section' && !selectedBasePlateSectionId) {
            console.warn('Cannot place clamp: Please select a baseplate section first');
            window.dispatchEvent(new CustomEvent('clamp-progress', { 
              detail: { stage: 'idle', progress: 0, message: 'Please select a section first' } 
            }));
            return;
          }

          window.dispatchEvent(new CustomEvent('clamp-progress', { 
            detail: { stage: 'csg', progress: 80, message: 'Generating support geometry...' } 
          }));
          
          const newClamp: PlacedClamp = {
            id: `clamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            clampModelId: clampPlacementMode.clampModelId!,
            position: { x: result.position.x, y: result.position.y, z: result.position.z },
            rotation: result.rotation,
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
          
          // Exit placement mode and notify UI
          setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
          partSilhouetteRef.current = null;
          
          // Clear selected section after clamp placement
          setSelectedBasePlateSectionId(null);
          
          window.dispatchEvent(new CustomEvent('clamp-progress', { 
            detail: { stage: 'idle', progress: 100, message: 'Clamp placed successfully' } 
          }));
          window.dispatchEvent(new CustomEvent('clamp-placed', { detail: newClamp }));
        } else {
          console.log('[ClampPlacement] Placement failed:', result.reason);
          window.dispatchEvent(new CustomEvent('clamp-progress', { 
            detail: { stage: 'idle', progress: 0, message: '' } 
          }));
        }
      }).catch(err => {
        console.error('[ClampPlacement] Error loading module:', err);
        window.dispatchEvent(new CustomEvent('clamp-progress', { 
          detail: { stage: 'idle', progress: 0, message: '' } 
        }));
      });
    };
    
    console.log('[ClampPlacement] Adding canvas click listener');
    gl.domElement.addEventListener('click', handleCanvasClick);
    
    return () => {
      console.log('[ClampPlacement] Removing canvas click listener');
      gl.domElement.removeEventListener('click', handleCanvasClick);
    };
  }, [
    clampPlacementMode,
    gl,
    camera,
    scene,
    raycasterRef,
    importedParts,
    modelMeshRefs,
    partVisibility,
    supports,
    placedClamps,
    baseTopY,
    basePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    setPlacedClamps,
    setSelectedClampId,
    setClampPlacementMode,
    setClampDebugPoints,
    clampDebugPointsRef,
    partSilhouetteRef,
    setItemBoundsUpdateTrigger,
  ]);

  // Handle clamp placement click on a part (legacy R3F handler - keeping for reference)
  const handleClampPlacementClick = useCallback((e: ThreeEvent<MouseEvent>, partMesh: THREE.Object3D) => {
    console.log('[ClampPlacement] handleClampPlacementClick called', {
      placementModeActive: clampPlacementMode.active,
      clampModelId: clampPlacementMode.clampModelId,
      clampCategory: clampPlacementMode.clampCategory
    });
    
    if (!clampPlacementMode.active || !clampPlacementMode.clampModelId) {
      console.log('[ClampPlacement] Exiting early - placement mode not active or no clamp selected');
      return;
    }
    
    e.stopPropagation();
    
    // Get intersection details
    const intersection = e.intersections[0];
    if (!intersection) {
      console.log('[ClampPlacement] No intersection found');
      return;
    }
    
    const clickPoint = intersection.point.clone();
    const surfaceNormal = intersection.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
    
    console.log('[ClampPlacement] Click details:', {
      clickPoint: { x: clickPoint.x, y: clickPoint.y, z: clickPoint.z },
      surfaceNormal: { x: surfaceNormal.x, y: surfaceNormal.y, z: surfaceNormal.z }
    });
    
    // Transform normal to world space
    if (intersection.object instanceof THREE.Mesh) {
      surfaceNormal.transformDirection(intersection.object.matrixWorld);
    }
    
    // Get minimum placement offset for this clamp type (default 15mm)
    const minPlacementOffset = 15;
    
    // For vertical clamps, we need to:
    // 1. Position fixture point on/near the click point
    // 2. Calculate rotation so support is outside part silhouette
    // 3. Ensure Y position respects fixture cutout clearance
    
    console.log('[ClampPlacement] Loading clampPlacement module...');
    
    import('@/features/clamps/utils/clampPlacement').then(({ calculateVerticalClampPlacement, isPointInsidePolygon }) => {
      console.log('[ClampPlacement] Module loaded');
      const silhouette = partSilhouetteRef.current || [];
      console.log('[ClampPlacement] Silhouette points:', silhouette.length);
      
      // Get all part meshes
      const allPartMeshes = importedParts
        .map(p => modelMeshRefs.current.get(p.id)?.current)
        .filter((m): m is THREE.Mesh => m !== null);
      
      console.log('[ClampPlacement] All part meshes count:', allPartMeshes.length);
      
      const result = calculateVerticalClampPlacement({
        clickPoint,
        surfaceNormal,
        partMesh,
        allPartMeshes,
        partSilhouette: silhouette,
        existingSupports: supports,
        existingClamps: placedClamps,
        baseTopY,
        minPlacementOffset,
        clampCategory: clampPlacementMode.clampCategory as 'Toggle Clamps Vertical' | 'Toggle Clamps Side Push',
      });
      
      console.log('[ClampPlacement] Placement result:', result);
      
      if (result.success) {
        // Create the clamp at calculated position
        const newClamp: PlacedClamp = {
          id: `clamp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          clampModelId: clampPlacementMode.clampModelId!,
          position: { x: result.position.x, y: result.position.y, z: result.position.z },
          rotation: result.rotation,
          scale: { x: 1, y: 1, z: 1 },
          sectionId: selectedBasePlateSectionId ?? undefined,  // Assign sectionId for multi-section baseplates
        };
        
        setPlacedClamps(prev => [...prev, newClamp]);
        setSelectedClampId(newClamp.id);
        
        // Force bounds recalculation after clamp is added to state
        if (newClamp.sectionId) {
          setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
        }
        
        // Auto-expand baseplate section if this is a multi-section baseplate
        if (newClamp.sectionId) {
          setBasePlate(prev => {
            if (!prev || prev.type !== 'multi-section' || !prev.sections || prev.sections.length === 0) {
              return prev;
            }

            const sectionId = newClamp.sectionId!;
            const section = prev.sections.find(s => s.id === sectionId);
            if (!section) return prev;

            const padding = prev.padding ?? 5;

            // Filter all items by sectionId (including the new clamp)
            const sectionSupports = supports.filter(s => s.sectionId === sectionId);
            const sectionClamps = [...placedClamps, newClamp].filter(c => c.sectionId === sectionId);
            const sectionLabels = labels.filter(l => l.sectionId === sectionId);
            const sectionHoles = mountingHoles.filter(h => h.sectionId === sectionId);

            // Calculate optimal bounds
            const optimizedSection = calculateOptimalSectionBounds(
              section, sectionSupports, sectionClamps, padding, sectionLabels, sectionHoles
            );

            const sectionIndex = prev.sections.findIndex(s => s.id === sectionId);
            if (sectionIndex === -1) return prev;

            const updatedSections = prev.sections.map((s, i) =>
              i === sectionIndex ? optimizedSection : s
            );

            // Dispatch event to notify AppShell
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
          });
        }
        
        // Exit placement mode and notify UI
        setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
        partSilhouetteRef.current = null;
        
        window.dispatchEvent(new CustomEvent('clamp-placed', { detail: newClamp }));
      } else {
        console.log('[ClampPlacement] Placement failed:', result.reason);
      }
    }).catch(err => {
      console.error('[ClampPlacement] Error loading module:', err);
    });
  }, [
    clampPlacementMode,
    importedParts,
    modelMeshRefs,
    supports,
    placedClamps,
    baseTopY,
    selectedBasePlateSectionId,
    labels,
    mountingHoles,
    calculateOptimalSectionBounds,
    setPlacedClamps,
    setSelectedClampId,
    setClampPlacementMode,
    setBasePlate,
    partSilhouetteRef,
    setItemBoundsUpdateTrigger,
  ]);

  return {
    handleClampPlacementClick,
  };
}

export type { UseClampPlacementParams, UseClampPlacementReturn };
export default useClampPlacement;
