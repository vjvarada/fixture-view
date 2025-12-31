/**
 * useCavityOperations - Manages cavity operations including CSG subtraction
 * 
 * This hook extracts cavity-related event listeners from 3DScene.tsx:
 * - Cavity context request/dispatch
 * - Cavity operation result preview
 * - Cavity apply
 * - Execute cavity subtraction (CSG operations)
 * - Reset cavity handler
 */

import { useEffect, useCallback, useRef } from 'react';
import * as THREE from 'three';
import type { ProcessedFile } from '@/modules/FileImport';
import type { AnySupport } from '../types';
import type { PlacedClamp, ClampSupportInfo, LoadedClampData } from './useClampState';
import type { LabelConfig } from '@/features/labels/types';
import type { PlacedHole } from '@/features/holes/types';
import { buildClampSupportGeometryAtOrigin, buildLabelGeometry } from '../utils/csgUtils';
import { buildFullSupportGeometry } from '@/features/supports';
import { createMergedHolesGeometry } from '@/features/holes';
import { performBatchCSGSubtractionInWorker, performBatchCSGUnionInWorker, performHoleCSGInWorker, analyzeMesh, repairMesh, cleanupCSGResult } from '@rapidtool/cad-core';

export interface UseCavityOperationsParams {
  // State
  cavityPreview: THREE.Mesh | null;
  setCavityPreview: React.Dispatch<React.SetStateAction<THREE.Mesh | null>>;
  mergedFixtureMesh: THREE.Mesh | null;
  setMergedFixtureMesh: React.Dispatch<React.SetStateAction<THREE.Mesh | null>>;
  modifiedSupportGeometries: Map<string, THREE.BufferGeometry>;
  setModifiedSupportGeometries: React.Dispatch<React.SetStateAction<Map<string, THREE.BufferGeometry>>>;
  offsetMeshPreviews: Map<string, THREE.Mesh>;
  setOffsetMeshPreviews: React.Dispatch<React.SetStateAction<Map<string, THREE.Mesh>>>;
  setSupportsTrimPreview: React.Dispatch<React.SetStateAction<THREE.Mesh[]>>;
  
  // Data
  importedParts: ProcessedFile[];
  supports: AnySupport[];
  placedClamps: PlacedClamp[];
  clampSupportInfos: Map<string, ClampSupportInfo>;
  labels: LabelConfig[];
  mountingHoles: PlacedHole[];
  basePlate: any;
  baseTopY: number;
  baseplateWithHoles: THREE.BufferGeometry | null;
  setBaseplateWithHoles: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  setHoleCSGTrigger: React.Dispatch<React.SetStateAction<number>>;
  
  // Refs
  basePlateMeshRef: React.RefObject<THREE.Mesh | null>;
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh | null>>>;
  multiSectionBasePlateGroupRef: React.RefObject<THREE.Group | null>;
  loadedClampDataRef: React.MutableRefObject<Map<string, LoadedClampData>>;
  labelsRef: React.MutableRefObject<LabelConfig[]>;
  originalBaseplateGeoRef: React.MutableRefObject<THREE.BufferGeometry | null>;
}

export interface UseCavityOperationsReturn {
  // No return values needed - all operations are event-driven
}

export function useCavityOperations({
  cavityPreview,
  setCavityPreview,
  mergedFixtureMesh,
  setMergedFixtureMesh,
  modifiedSupportGeometries,
  setModifiedSupportGeometries,
  offsetMeshPreviews,
  setOffsetMeshPreviews,
  setSupportsTrimPreview,
  importedParts,
  supports,
  placedClamps,
  clampSupportInfos,
  labels,
  mountingHoles,
  basePlate,
  baseTopY,
  baseplateWithHoles,
  setBaseplateWithHoles,
  setHoleCSGTrigger,
  basePlateMeshRef,
  modelMeshRefs,
  multiSectionBasePlateGroupRef,
  loadedClampDataRef,
  labelsRef,
  originalBaseplateGeoRef,
}: UseCavityOperationsParams): UseCavityOperationsReturn {

  // Cavity context request/dispatch
  useEffect(() => {
    const handleRequestContext = () => {
      const base = basePlateMeshRef.current || null;
      
      // Collect all part meshes
      const partMeshes: THREE.Mesh[] = [];
      importedParts.forEach(part => {
        const ref = modelMeshRefs.current.get(part.id);
        if (ref?.current) {
          partMeshes.push(ref.current);
        }
      });
      
      let baseMesh: THREE.Mesh | null = null;
      let tools: THREE.Mesh[] = [];
      if (base && partMeshes.length > 0) {
        baseMesh = base; // default: baseplate as base
        tools = partMeshes;
      } else if (base) {
        baseMesh = base;
        tools = [];
      } else if (partMeshes.length > 0) {
        baseMesh = partMeshes[0];
        tools = partMeshes.slice(1);
      }
      window.dispatchEvent(new CustomEvent('cavity-context', { detail: { baseMesh, fixtureComponents: tools } }));
    };
    window.addEventListener('request-cavity-context', handleRequestContext as EventListener);
    return () => window.removeEventListener('request-cavity-context', handleRequestContext as EventListener);
  }, [importedParts]);

  // Listen for cavity operation result to show preview
  useEffect(() => {
    const handleCavityResult = (e: CustomEvent) => {
      const { mesh, mode } = e.detail || {};
      if (mesh && mesh.isMesh) {
        // Make preview material translucent
        if (mesh.material && 'transparent' in mesh.material) {
          (mesh.material as any).transparent = true;
          (mesh.material as any).opacity = 0.35;
          (mesh.material as any).depthWrite = false;
        }
        setCavityPreview(mesh as THREE.Mesh);
      }
    };
    window.addEventListener('cavity-operation-result', handleCavityResult as EventListener);
    return () => window.removeEventListener('cavity-operation-result', handleCavityResult as EventListener);
  }, []);

  // Apply final cavity: replace baseplate geometry and clear preview
  useEffect(() => {
    const handleApply = (e: CustomEvent) => {
      const { mesh } = e.detail || {};
      if (!mesh || !mesh.isMesh) return;
      // Prefer replacing baseplate if present, otherwise first part
      const firstPartRef = importedParts.length > 0 ? modelMeshRefs.current.get(importedParts[0].id) : null;
      const target = basePlateMeshRef.current || firstPartRef?.current;
      if (target && mesh.geometry) {
        const old = target.geometry;
        target.geometry = mesh.geometry;
        old?.dispose?.();
        target.updateMatrixWorld(true, true);
        setCavityPreview(null);
        // notify undo system
        window.dispatchEvent(new CustomEvent('viewer-state-changed', { detail: { type: 'cavity-apply' } }));
      }
    };
    window.addEventListener('cavity-apply', handleApply as EventListener);
    return () => window.removeEventListener('cavity-apply', handleApply as EventListener);
  }, [importedParts]);

  // Handle cavity subtraction - cut supports with ALL offset meshes using web worker
  useEffect(() => {
    const handleExecuteCavitySubtraction = async (e: CustomEvent) => {
      const { settings } = e.detail || {};
      const clearanceTolerance = settings?.offsetDistance ?? 0.5;
      
      // Extract CSG cleanup settings from cavity settings
      const csgMinVolume = settings?.csgMinVolume ?? 1.0;
      const csgMinThickness = settings?.csgMinThickness ?? 0.5;
      const csgMinTriangles = settings?.csgMinTriangles ?? 5;
      const csgEnableLocalThickness = settings?.csgEnableLocalThickness ?? true;
      
      console.log('[useCavityOperations] CSG Cleanup settings:', {
        csgMinVolume,
        csgMinThickness,
        csgMinTriangles,
        csgEnableLocalThickness,
        settingsProvided: !!settings
      });
      
      if (offsetMeshPreviews.size === 0) {
        console.warn('[useCavityOperations] No offset mesh previews available for cavity subtraction');
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { success: false, error: 'No offset mesh previews available' }
        }));
        return;
      }

      const hasSupports = supports && supports.length > 0;
      const hasClampSupports = placedClamps && placedClamps.length > 0;
      
      if (!hasSupports && !hasClampSupports) {
        console.warn('[useCavityOperations] No supports (regular or clamp) available for cavity subtraction');
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { success: false, error: 'No supports available' }
        }));
        return;
      }

      try {
        // Collect all cutter geometries from all offset mesh previews (one per part)
        const cutterGeometries: THREE.BufferGeometry[] = [];
        
        for (const [partId, offsetMesh] of offsetMeshPreviews) {
          console.log(`[useCavityOperations] Preparing cutter geometry for part ${partId}`);
          
          // Get the cutter (offset mesh) geometry in world space
          const cutterGeometry = offsetMesh.geometry.clone();
          offsetMesh.updateMatrixWorld(true);
          cutterGeometry.applyMatrix4(offsetMesh.matrixWorld);
          
          // Prepare cutter geometry
          if (!cutterGeometry.index) {
            const posAttr = cutterGeometry.getAttribute('position');
            const vertexCount = posAttr.count;
            const indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
            cutterGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
          if (!cutterGeometry.getAttribute('uv')) {
            const position = cutterGeometry.getAttribute('position');
            const uvArray = new Float32Array(position.count * 2);
            cutterGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
          }
          cutterGeometry.computeVertexNormals();
          
          cutterGeometries.push(cutterGeometry);
        }
        
        console.log(`[useCavityOperations] Prepared ${cutterGeometries.length} cutter geometries for ${offsetMeshPreviews.size} parts`);

        // Prepare regular support geometries for batch processing
        const supportsToProcess: Array<{ id: string; geometry: THREE.BufferGeometry; isClampSupport?: boolean }> = [];
        
        for (const support of supports) {
          const supportGeometry = buildFullSupportGeometry(support, baseTopY, false);
          if (!supportGeometry) continue;
          
          // Prepare support geometry for CSG
          if (!supportGeometry.index) {
            const posAttr = supportGeometry.getAttribute('position');
            const vertexCount = posAttr.count;
            const indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
            supportGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
          if (!supportGeometry.getAttribute('uv')) {
            const position = supportGeometry.getAttribute('position');
            const uvArray = new Float32Array(position.count * 2);
            supportGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
          }
          supportGeometry.computeVertexNormals();
          
          supportsToProcess.push({ id: support.id, geometry: supportGeometry, isClampSupport: false });
        }

        // === ADD CLAMP SUPPORTS ===
        // Build clamp support geometries and add them to the processing list
        for (const clamp of placedClamps) {
          const clampData = loadedClampDataRef.current.get(clamp.id);
          const supportInfo = clampSupportInfos.get(clamp.id);
          
          if (!clampData?.supportInfo || !supportInfo) {
            console.log(`[useCavityOperations] Skipping clamp ${clamp.id} - no support info`);
            continue;
          }
          
          // Build clamp support geometry using the same logic as ClampSupportMesh
          const polygon = clampData.supportInfo.polygon;
          const mountSurfaceLocalY = clampData.supportInfo.mountSurfaceLocalY;
          const fixturePointY = clampData.supportInfo.fixturePointY;
          
          // Calculate support height
          const mountSurfaceWorldY = clamp.position.y + (mountSurfaceLocalY - fixturePointY);
          const supportHeight = Math.max(1.0, mountSurfaceWorldY - baseTopY);
          
          // Build geometry at origin
          const clampSupportGeometry = buildClampSupportGeometryAtOrigin(polygon, supportHeight, 2);
          if (!clampSupportGeometry) continue;
          
          // Transform to world position (same logic as ClampSupportMesh)
          const worldRotationY = THREE.MathUtils.degToRad(clamp.rotation.y);
          const transformMatrix = new THREE.Matrix4()
            .makeRotationY(worldRotationY)
            .setPosition(clamp.position.x, baseTopY, clamp.position.z);
          clampSupportGeometry.applyMatrix4(transformMatrix);
          
          // Prepare for CSG
          if (!clampSupportGeometry.index) {
            const posAttr = clampSupportGeometry.getAttribute('position');
            const vertexCount = posAttr.count;
            const indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
            clampSupportGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
          if (!clampSupportGeometry.getAttribute('uv')) {
            const position = clampSupportGeometry.getAttribute('position');
            const uvArray = new Float32Array(position.count * 2);
            clampSupportGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
          }
          clampSupportGeometry.computeVertexNormals();
          
          supportsToProcess.push({ 
            id: `clamp-support-${clamp.id}`, 
            geometry: clampSupportGeometry, 
            isClampSupport: true 
          });
          
          console.log(`[useCavityOperations] Added clamp support for ${clamp.id}, height: ${supportHeight.toFixed(2)}mm`);
        }

        if (supportsToProcess.length === 0) {
          window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
            detail: { success: false, error: 'No valid support geometries' }
          }));
          return;
        }

        // For each support, we need to subtract ALL cutter geometries (all part cavities)
        // Process supports sequentially, and for each support, subtract all cutters
        console.log(`[useCavityOperations] Starting batch CSG subtraction for ${supportsToProcess.length} supports (${supports.length} regular + ${placedClamps.length} clamp) against ${cutterGeometries.length} cutters...`);
        
        const allResultGeometries = new Map<string, THREE.BufferGeometry>();
        const totalOperations = supportsToProcess.length * cutterGeometries.length;
        let completedOperations = 0;
        
        for (const supportItem of supportsToProcess) {
          let currentSupportGeometry = supportItem.geometry;
          
          // Subtract each cutter from this support sequentially
          for (let cutterIdx = 0; cutterIdx < cutterGeometries.length; cutterIdx++) {
            const cutterGeometry = cutterGeometries[cutterIdx];
            
            window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
              detail: { 
                current: completedOperations + 1, 
                total: totalOperations, 
                supportId: supportItem.id, 
                stage: `Cutting ${supportItem.isClampSupport ? 'clamp ' : ''}support with part ${cutterIdx + 1}/${cutterGeometries.length}`
              }
            }));
            
            try {
              // Perform CSG subtraction for this support against this cutter
              const singleSupportArray = [{ id: supportItem.id, geometry: currentSupportGeometry }];
              const result = await performBatchCSGSubtractionInWorker(
                singleSupportArray,
                cutterGeometry,
                (current, total, supportId, stage) => {
                  // Progress is already being reported above
                }
              );
              
              if (result.has(supportItem.id)) {
                // Replace the support geometry with the result for the next iteration
                if (currentSupportGeometry !== supportItem.geometry) {
                  currentSupportGeometry.dispose(); // Dispose intermediate result
                }
                currentSupportGeometry = result.get(supportItem.id)!;
                // Note: No intermediate cleanup - we'll clean up the final merged result
              }
            } catch (err) {
              console.warn(`[useCavityOperations] CSG subtraction failed for support ${supportItem.id} with cutter ${cutterIdx}:`, err);
            }
            
            completedOperations++;
          }
          
          // Store the final result for this support
          allResultGeometries.set(supportItem.id, currentSupportGeometry);
          
          // INCREMENTAL UPDATE: Show this cut support immediately as it's ready (only for regular supports)
          // This provides visual feedback while other supports are still being processed
          if (!supportItem.isClampSupport) {
            setModifiedSupportGeometries(prev => {
              const updated = new Map(prev);
              updated.set(supportItem.id, currentSupportGeometry);
              return updated;
            });
          }
          
          console.log(`[useCavityOperations] Support ${supportItem.id} cut complete (${allResultGeometries.size}/${supportsToProcess.length})`);
        }

        const successCount = allResultGeometries.size;
        const errorCount = supportsToProcess.length - successCount;

        // Clean up individual support geometries - repair bad triangles from CSG operations
        console.log('[useCavityOperations] Cleaning up individual support geometries...');
        const cleanedGeometries = new Map<string, THREE.BufferGeometry>();
        
        for (const [supportId, geometry] of allResultGeometries) {
          try {
            const analysis = await analyzeMesh(geometry);
            if (analysis.hasDegenerateFaces || !analysis.isManifold) {
              console.log(`[useCavityOperations] Repairing support ${supportId}: degenerate=${analysis.hasDegenerateFaces}, manifold=${analysis.isManifold}`);
              const repairResult = await repairMesh(geometry);
              if (repairResult.success && repairResult.geometry) {
                cleanedGeometries.set(supportId, repairResult.geometry);
                geometry.dispose(); // Dispose the original unrepaired geometry
              } else {
                cleanedGeometries.set(supportId, geometry); // Keep original if repair fails
              }
            } else {
              cleanedGeometries.set(supportId, geometry);
            }
          } catch (err) {
            console.warn(`[useCavityOperations] Failed to analyze/repair support ${supportId}:`, err);
            cleanedGeometries.set(supportId, geometry);
          }
        }
        
        // Update state with cleaned geometries (only for regular supports)
        const regularSupportGeometries = new Map<string, THREE.BufferGeometry>();
        cleanedGeometries.forEach((geom, id) => {
          if (!id.startsWith('clamp-support-')) {
            regularSupportGeometries.set(id, geom);
          }
        });
        setModifiedSupportGeometries(regularSupportGeometries);

        if (successCount > 0) {
          // Clear all offset mesh previews
          offsetMeshPreviews.forEach(mesh => {
            mesh.geometry?.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
              } else {
                mesh.material.dispose();
              }
            }
          });
          setOffsetMeshPreviews(new Map());
          
          // === STEP 2: Union all cut supports with baseplate ===
          console.log(`[useCavityOperations] Starting CSG union of ${cleanedGeometries.size} supports with baseplate...`);
          
          window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
            detail: { 
              current: 0, 
              total: cleanedGeometries.size + 1, 
              stage: 'Merging supports with baseplate...'
            }
          }));
          
          // Get baseplate geometry if available
          // For regular baseplates: use baseplateWithHoles if it exists (holes already cut), otherwise use original baseplate
          // For multi-section baseplates: collect all section geometries (which already have holes from useSectionHoleCSG)
          let baseplateGeometry: THREE.BufferGeometry | undefined;
          let useBaseplateWithHoles = baseplateWithHoles !== null;
          const isMultiSection = basePlate?.type === 'multi-section';
          
          if (isMultiSection && multiSectionBasePlateGroupRef.current) {
            // === MULTI-SECTION BASEPLATE ===
            // Collect all section geometries from the group
            // These already have holes cut via useSectionHoleCSG
            console.log('[useCavityOperations] Collecting multi-section baseplate geometries...');
            
            const sectionGeometries: THREE.BufferGeometry[] = [];
            multiSectionBasePlateGroupRef.current.updateMatrixWorld(true);
            
            multiSectionBasePlateGroupRef.current.traverse((child) => {
              if (child instanceof THREE.Mesh && child.geometry) {
                // Clone and transform to world space
                const sectionGeo = child.geometry.clone();
                child.updateMatrixWorld(true);
                sectionGeo.applyMatrix4(child.matrixWorld);
                sectionGeometries.push(sectionGeo);
              }
            });
            
            if (sectionGeometries.length > 0) {
              console.log(`[useCavityOperations] Found ${sectionGeometries.length} multi-section baseplate sections`);
              
              // Union all sections together into one geometry
              if (sectionGeometries.length === 1) {
                baseplateGeometry = sectionGeometries[0];
              } else {
                // Merge all section geometries using BufferGeometryUtils
                const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
                
                // Prepare each geometry for merging
                for (const geo of sectionGeometries) {
                  if (!geo.index) {
                    const posAttr = geo.getAttribute('position');
                    const vertexCount = posAttr.count;
                    const indices = new Uint32Array(vertexCount);
                    for (let i = 0; i < vertexCount; i++) indices[i] = i;
                    geo.setIndex(new THREE.BufferAttribute(indices, 1));
                  }
                  if (!geo.getAttribute('uv')) {
                    const position = geo.getAttribute('position');
                    const uvArray = new Float32Array(position.count * 2);
                    geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                  }
                  geo.computeVertexNormals();
                }
                
                const mergedGeo = mergeGeometries(sectionGeometries, false);
                if (mergedGeo) {
                  baseplateGeometry = mergedGeo;
                  // Dispose individual section geometries after merging
                  sectionGeometries.forEach(geo => geo.dispose());
                  console.log('[useCavityOperations] Merged multi-section baseplate geometries');
                } else {
                  // Fallback: use just the first section
                  baseplateGeometry = sectionGeometries[0];
                  for (let i = 1; i < sectionGeometries.length; i++) {
                    sectionGeometries[i].dispose();
                  }
                  console.warn('[useCavityOperations] Failed to merge multi-section geometries, using first section only');
                }
              }
              
              // Multi-section baseplates already have holes cut, so skip hole subtraction later
              useBaseplateWithHoles = true;
              console.log('[useCavityOperations] Using multi-section baseplate (holes already cut per section)');
            }
          } else if (useBaseplateWithHoles && baseplateWithHoles) {
            // === REGULAR BASEPLATE WITH HOLES ===
            // Use the baseplate geometry that already has holes cut
            // This geometry is already in local space, need to transform to world space
            baseplateGeometry = baseplateWithHoles.clone();
            if (basePlateMeshRef.current) {
              basePlateMeshRef.current.updateMatrixWorld(true);
              baseplateGeometry.applyMatrix4(basePlateMeshRef.current.matrixWorld);
            }
            console.log('[useCavityOperations] Using baseplateWithHoles (holes already cut)');
          } else if (basePlateMeshRef.current) {
            // === REGULAR BASEPLATE WITHOUT HOLES ===
            basePlateMeshRef.current.updateMatrixWorld(true);
            baseplateGeometry = basePlateMeshRef.current.geometry.clone();
            
            // Cache the baseplate geometry for export BEFORE applying world transform
            // This ensures originalBaseplateGeoRef is always in LOCAL space (consistent with useHoleCSG)
            // The export code will apply basePlate.position to convert to world space
            if (!originalBaseplateGeoRef.current) {
              originalBaseplateGeoRef.current = baseplateGeometry.clone();
              console.log('[useCavityOperations] Cached baseplate geometry for export (LOCAL space)');
            }
            
            // Now apply world transform for cavity CSG operations
            baseplateGeometry.applyMatrix4(basePlateMeshRef.current.matrixWorld);
            console.log('[useCavityOperations] Using original baseplate geometry');
          }
          
          if (baseplateGeometry) {
            // Ensure baseplate geometry has proper attributes for CSG
            if (!baseplateGeometry.index) {
              const posAttr = baseplateGeometry.getAttribute('position');
              const vertexCount = posAttr.count;
              const indices = new Uint32Array(vertexCount);
              for (let i = 0; i < vertexCount; i++) indices[i] = i;
              baseplateGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
            }
            if (!baseplateGeometry.getAttribute('uv')) {
              const position = baseplateGeometry.getAttribute('position');
              const uvArray = new Float32Array(position.count * 2);
              baseplateGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            baseplateGeometry.computeVertexNormals();
          }
          
          // Prepare geometries for union (including all cut supports - regular and clamp)
          const geometriesForUnion: Array<{ id: string; geometry: THREE.BufferGeometry }> = [];
          cleanedGeometries.forEach((geom, supportId) => {
            // Ensure geometry has proper attributes for CSG
            if (!geom.index) {
              const posAttr = geom.getAttribute('position');
              const vertexCount = posAttr.count;
              const indices = new Uint32Array(vertexCount);
              for (let i = 0; i < vertexCount; i++) indices[i] = i;
              geom.setIndex(new THREE.BufferAttribute(indices, 1));
            }
            if (!geom.getAttribute('uv')) {
              const position = geom.getAttribute('position');
              const uvArray = new Float32Array(position.count * 2);
              geom.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            geometriesForUnion.push({ id: supportId, geometry: geom });
          });
          
          // === ADD LABELS TO UNION ===
          // Use labelsRef.current to get the latest labels (avoid stale closure)
          const currentLabels = labelsRef.current;
          console.log(`[useCavityOperations] Labels ref:`, currentLabels, `Count: ${currentLabels?.length ?? 0}`);
          if (currentLabels && currentLabels.length > 0) {
            console.log(`[useCavityOperations] Adding ${currentLabels.length} labels to union...`);
            window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
              detail: { current: 0, total: currentLabels.length, stage: 'Building label geometries...' }
            }));
            
            for (let i = 0; i < currentLabels.length; i++) {
              const label = currentLabels[i];
              console.log(`[useCavityOperations] Building geometry for label ${i + 1}/${currentLabels.length}: "${label.text}" at`, label.position);
              try {
                const labelGeometry = await buildLabelGeometry(label);
                console.log(`[useCavityOperations] Label geometry result for "${label.text}":`, labelGeometry ? 'SUCCESS' : 'NULL');
                if (labelGeometry) {
                  // Prepare label geometry for CSG
                  if (!labelGeometry.index) {
                    const posAttr = labelGeometry.getAttribute('position');
                    const vertexCount = posAttr.count;
                    const indices = new Uint32Array(vertexCount);
                    for (let j = 0; j < vertexCount; j++) indices[j] = j;
                    labelGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
                  }
                  if (!labelGeometry.getAttribute('uv')) {
                    const position = labelGeometry.getAttribute('position');
                    const uvArray = new Float32Array(position.count * 2);
                    labelGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                  }
                  labelGeometry.computeVertexNormals();
                  
                  console.log(`[useCavityOperations] Label geometry stats - vertices: ${labelGeometry.getAttribute('position').count}, hasIndex: ${!!labelGeometry.index}`);
                  geometriesForUnion.push({ id: `label-${label.id}`, geometry: labelGeometry });
                  console.log(`[useCavityOperations] Added label: ${label.text}, total geometries for union: ${geometriesForUnion.length}`);
                }
              } catch (err) {
                console.warn(`[useCavityOperations] Failed to build label geometry for "${label.text}":`, err);
              }
            }
          } else {
            console.log(`[useCavityOperations] No labels to add to union`);
          }
          
          // Log final geometries being sent to union
          console.log(`[useCavityOperations] Sending ${geometriesForUnion.length} geometries to union worker:`, 
            geometriesForUnion.map(g => ({ id: g.id, vertices: g.geometry.getAttribute('position')?.count }))
          );
          
          try {
            const mergedGeometry = await performBatchCSGUnionInWorker(
              geometriesForUnion,
              baseplateGeometry,
              (current, total, stage) => {
                console.log(`[useCavityOperations] Union Progress: ${current}/${total} - ${stage}`);
                window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                  detail: { current, total, stage: `Merging: ${stage}` }
                }));
              }
            );
            
            if (mergedGeometry) {
              // === STEP 3: SUBTRACT FIXTURE CUTOUTS FROM ALL CLAMPS ===
              // This ensures any clamp cutouts that overlap with supports are properly cut
              let finalGeometry = mergedGeometry;
              
              if (placedClamps.length > 0) {
                console.log(`[useCavityOperations] Subtracting fixture cutouts from ${placedClamps.length} clamps...`);
                window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                  detail: { current: 0, total: placedClamps.length, stage: 'Subtracting clamp fixture cutouts...' }
                }));
                
                for (let i = 0; i < placedClamps.length; i++) {
                  const clamp = placedClamps[i];
                  const clampData = loadedClampDataRef.current.get(clamp.id);
                  
                  if (!clampData?.fixtureCutoutsGeometry) {
                    console.log(`[useCavityOperations] No fixture cutouts for clamp ${clamp.id}`);
                    continue;
                  }
                  
                  window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                    detail: { 
                      current: i + 1, 
                      total: placedClamps.length, 
                      stage: `Cutting fixture cutouts ${i + 1}/${placedClamps.length}...` 
                    }
                  }));
                  
                  try {
                    // Clone and transform cutouts to world space
                    const cutoutsGeometry = clampData.fixtureCutoutsGeometry.clone();
                    
                    // Transform cutouts: first offset from fixture point, then rotate and position
                    const fpCenter = clampData.fixturePointTopCenter;
                    cutoutsGeometry.translate(-fpCenter.x, -fpCenter.y, -fpCenter.z);
                    
                    // Apply clamp world transform
                    const worldRotationY = THREE.MathUtils.degToRad(clamp.rotation.y);
                    const transformMatrix = new THREE.Matrix4()
                      .makeRotationY(worldRotationY)
                      .setPosition(clamp.position.x, clamp.position.y, clamp.position.z);
                    cutoutsGeometry.applyMatrix4(transformMatrix);
                    
                    // Prepare for CSG
                    if (!cutoutsGeometry.index) {
                      const posAttr = cutoutsGeometry.getAttribute('position');
                      const vertexCount = posAttr.count;
                      const indices = new Uint32Array(vertexCount);
                      for (let j = 0; j < vertexCount; j++) indices[j] = j;
                      cutoutsGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
                    }
                    if (!cutoutsGeometry.getAttribute('uv')) {
                      const position = cutoutsGeometry.getAttribute('position');
                      const uvArray = new Float32Array(position.count * 2);
                      cutoutsGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                    }
                    cutoutsGeometry.computeVertexNormals();
                    
                    // Perform CSG subtraction
                    const subtractionResult = await performBatchCSGSubtractionInWorker(
                      [{ id: 'fixture', geometry: finalGeometry }],
                      cutoutsGeometry,
                      () => {}
                    );
                    
                    if (subtractionResult.has('fixture')) {
                      finalGeometry.dispose();
                      finalGeometry = subtractionResult.get('fixture')!;
                      console.log(`[useCavityOperations] Subtracted fixture cutouts for clamp ${clamp.id}`);
                    }
                    
                    cutoutsGeometry.dispose();
                  } catch (err) {
                    console.warn(`[useCavityOperations] Failed to subtract fixture cutouts for clamp ${clamp.id}:`, err);
                  }
                }
              }
              
              // === STEP 3.5: SUBTRACT MOUNTING HOLES ===
              // Skip this step if we already used baseplateWithHoles (holes already cut into baseplate)
              if (mountingHoles.length > 0 && !useBaseplateWithHoles) {
                console.log(`[useCavityOperations] Subtracting ${mountingHoles.length} mounting holes from fixture...`);
                window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                  detail: { current: 85, total: 100, stage: 'Cutting mounting holes...' }
                }));
                
                try {
                  // For final geometry which is in world space, we need world-space holes
                  // baseTopY is already the world Y of the baseplate top surface
                  // Hole positions are stored in world space (x, z) in the position Vector2
                  // No offset needed since finalGeometry is in world space
                  
                  // Ensure all holes have correct depth (use baseplate depth for through holes)
                  const baseplateDepth = basePlate?.depth ?? 20;
                  const holesWithCorrectDepth = mountingHoles.map(hole => ({
                    ...hole,
                    depth: hole.depth || baseplateDepth
                  }));
                  
                  console.log(`[useCavityOperations] Creating hole geometry with baseTopY=${baseTopY}, baseplateDepth=${baseplateDepth}`, 
                    holesWithCorrectDepth.map(h => ({
                      id: h.id,
                      type: h.type,
                      diameter: h.diameter,
                      depth: h.depth,
                      position: { x: h.position.x, z: h.position.y }
                    }))
                  );
                  
                  // Create holes in world space - no offset needed since finalGeometry is in world space
                  const holesGeometry = createMergedHolesGeometry(holesWithCorrectDepth, baseTopY, undefined);
                  
                  if (holesGeometry) {
                    // Ensure proper geometry attributes for CSG
                    if (!holesGeometry.index) {
                      const posAttr = holesGeometry.getAttribute('position');
                      const vertexCount = posAttr.count;
                      const indices = new Uint32Array(vertexCount);
                      for (let i = 0; i < vertexCount; i++) indices[i] = i;
                      holesGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
                    }
                    if (!holesGeometry.getAttribute('uv')) {
                      const position = holesGeometry.getAttribute('position');
                      const uvArray = new Float32Array(position.count * 2);
                      holesGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                    }
                    holesGeometry.computeVertexNormals();
                    
                    // Perform CSG subtraction
                    const subtractionResult = await performBatchCSGSubtractionInWorker(
                      [{ id: 'fixture', geometry: finalGeometry }],
                      holesGeometry,
                      () => {}
                    );
                    
                    if (subtractionResult.has('fixture')) {
                      finalGeometry.dispose();
                      finalGeometry = subtractionResult.get('fixture')!;
                      console.log(`[useCavityOperations] Subtracted ${mountingHoles.length} mounting holes`);
                    }
                    
                    holesGeometry.dispose();
                  }
                } catch (err) {
                  console.warn('[useCavityOperations] Failed to subtract mounting holes:', err);
                }
              }
              
              // STEP 4: Display the final merged geometry IMMEDIATELY
              // This gives instant visual feedback while cleanup runs in background
              console.log('[useCavityOperations] Displaying final merged geometry...');
              
              // Create merged fixture mesh with amber color
              const amberMaterial = new THREE.MeshStandardMaterial({
                color: 0xFFBF00, // Amber
                metalness: 0.1,
                roughness: 0.6,
                side: THREE.DoubleSide,
              });
              
              // Dispose old merged fixture if exists
              if (mergedFixtureMesh) {
                mergedFixtureMesh.geometry?.dispose();
                if (mergedFixtureMesh.material) {
                  if (Array.isArray(mergedFixtureMesh.material)) {
                    mergedFixtureMesh.material.forEach(m => m.dispose());
                  } else {
                    mergedFixtureMesh.material.dispose();
                  }
                }
              }
              
              const rawFixtureMesh = new THREE.Mesh(finalGeometry.clone(), amberMaterial);
              rawFixtureMesh.name = 'merged-fixture';
              rawFixtureMesh.castShadow = true;
              rawFixtureMesh.receiveShadow = true;
              
              setMergedFixtureMesh(rawFixtureMesh);
              console.log(`[useCavityOperations] Final merged fixture displayed with ${finalGeometry.getAttribute('position').count / 3} vertices`);
              
              // STEP 5: Run manifold analysis, repair, and cleanup in background
              // This happens asynchronously and updates the mesh when complete
              window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                detail: { current: 90, total: 100, stage: 'Starting background cleanup...' }
              }));
              
              // Run cleanup in a setTimeout to allow the UI to update first
              // Capture finalGeometry for the async closure
              const geometryToClean = finalGeometry;
              setTimeout(async () => {
                try {
                  console.log('[useCavityOperations] Starting background manifold analysis and cleanup...');
                  
                  // Step 5a: Analyze the mesh for manifold issues
                  const analysisResult = await analyzeMesh(geometryToClean);
                  console.log('[useCavityOperations] Mesh analysis:', {
                    isManifold: analysisResult.isManifold,
                    hasDegenerateFaces: analysisResult.hasDegenerateFaces,
                    hasNonManifoldEdges: analysisResult.hasNonManifoldEdges,
                    vertexCount: analysisResult.vertexCount,
                    triangleCount: analysisResult.triangleCount,
                  });
                  
                  let workingGeometry = geometryToClean;
                  
                  // Step 5b: Repair if needed
                  if (analysisResult.hasDegenerateFaces || !analysisResult.isManifold || analysisResult.hasNonManifoldEdges) {
                    console.log('[useCavityOperations] Repairing mesh...');
                    window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                      detail: { current: 93, total: 100, stage: 'Repairing mesh...' }
                    }));
                    
                    const repairResult = await repairMesh(workingGeometry);
                    if (repairResult.success && repairResult.geometry) {
                      workingGeometry = repairResult.geometry;
                      console.log('[useCavityOperations] Mesh repair completed:', repairResult.actions);
                    }
                  }
                  
                  // Step 5c: CSG Cleanup - remove small components and degenerate triangles
                  console.log('[useCavityOperations] Running CSG cleanup...');
                  window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                    detail: { current: 96, total: 100, stage: 'Cleaning up artifacts...' }
                  }));
                  
                  const cleanupResult = await cleanupCSGResult(workingGeometry, {
                    minVolume: csgMinVolume,
                    minTriangles: csgMinTriangles,
                    minTriangleArea: 0.0001, // More aggressive: 0.0001 mm² (was 0.001)
                    keepLargestN: 0,
                    minThickness: csgMinThickness,
                    vertexMergeTolerance: 0.001, // Tighter tolerance for better component detection
                  });
                  
                  let cleanedGeometry = workingGeometry;
                  
                  if (cleanupResult.success && cleanupResult.geometry) {
                    cleanedGeometry = cleanupResult.geometry;
                    console.log('[useCavityOperations] CSG cleanup result:', {
                      originalTriangles: cleanupResult.originalTriangles,
                      finalTriangles: cleanupResult.finalTriangles,
                      componentsFound: cleanupResult.componentsFound,
                      componentsRemoved: cleanupResult.componentsRemoved,
                      degenerateTrianglesRemoved: cleanupResult.degenerateTrianglesRemoved,
                      actions: cleanupResult.actions,
                    });
                  }
                  
                  // Step 5d: Update the displayed mesh with cleaned geometry
                  if (cleanedGeometry !== geometryToClean) {
                    console.log('[useCavityOperations] Updating fixture with cleaned geometry...');
                    
                    const cleanedMaterial = new THREE.MeshStandardMaterial({
                      color: 0xFFBF00, // Amber
                      metalness: 0.1,
                      roughness: 0.6,
                      side: THREE.DoubleSide,
                    });
                    
                    const cleanedFixtureMesh = new THREE.Mesh(cleanedGeometry, cleanedMaterial);
                    cleanedFixtureMesh.name = 'merged-fixture';
                    cleanedFixtureMesh.castShadow = true;
                    cleanedFixtureMesh.receiveShadow = true;
                    
                    setMergedFixtureMesh(prevMesh => {
                      // Dispose the old raw mesh
                      if (prevMesh) {
                        prevMesh.geometry?.dispose();
                        if (prevMesh.material) {
                          if (Array.isArray(prevMesh.material)) {
                            prevMesh.material.forEach(m => m.dispose());
                          } else {
                            prevMesh.material.dispose();
                          }
                        }
                      }
                      return cleanedFixtureMesh;
                    });
                    
                    console.log(`[useCavityOperations] Cleaned fixture updated with ${cleanedGeometry.getAttribute('position').count / 3} vertices`);
                  }
                  
                  window.dispatchEvent(new CustomEvent('cavity-subtraction-progress', {
                    detail: { current: 100, total: 100, stage: 'Cleanup complete' }
                  }));
                  
                } catch (cleanupErr) {
                  console.error('[useCavityOperations] Background cleanup failed:', cleanupErr);
                  // Keep the raw geometry - it's already displayed
                }
              }, 100); // Small delay to let UI render first
            } else {
              console.warn('[useCavityOperations] CSG union returned no result');
            }
            
            // Clean up baseplate geometry clone
            baseplateGeometry?.dispose();
          } catch (unionErr) {
            console.error('[useCavityOperations] CSG union failed:', unionErr);
          }
        }
        
        // Clean up cutter geometries
        cutterGeometries.forEach(geom => geom.dispose());
        
        console.log(`[useCavityOperations] Batch CSG completed: ${successCount} success, ${errorCount} failed`);
        
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { 
            success: successCount > 0, 
            successCount, 
            errorCount,
            totalSupports: supports.length + placedClamps.length,
            totalClampSupports: placedClamps.length,
            totalLabels: labelsRef.current?.length || 0,
            totalParts: offsetMeshPreviews.size
          }
        }));

      } catch (err) {
        console.error('[useCavityOperations] Cavity subtraction failed:', err);
        window.dispatchEvent(new CustomEvent('cavity-subtraction-complete', {
          detail: { success: false, error: String(err) }
        }));
      }
    };

    window.addEventListener('execute-cavity-subtraction', handleExecuteCavitySubtraction as EventListener);
    return () => {
      window.removeEventListener('execute-cavity-subtraction', handleExecuteCavitySubtraction as EventListener);
    };
  }, [offsetMeshPreviews, supports, basePlate, baseTopY, placedClamps, clampSupportInfos, labels, mountingHoles, baseplateWithHoles]);

  // Handle reset cavity event
  useEffect(() => {
    const handleResetCavity = () => {
      console.log('[useCavityOperations] Resetting cavity - clearing merged fixture and restoring original supports');
      
      // Dispose and clear the merged fixture mesh
      if (mergedFixtureMesh) {
        mergedFixtureMesh.geometry?.dispose();
        if (mergedFixtureMesh.material) {
          if (Array.isArray(mergedFixtureMesh.material)) {
            mergedFixtureMesh.material.forEach(m => m.dispose());
          } else {
            mergedFixtureMesh.material.dispose();
          }
        }
        setMergedFixtureMesh(null);
      }
      
      // Dispose and clear modified support geometries to restore original supports
      modifiedSupportGeometries.forEach((geometry) => {
        geometry.dispose();
      });
      setModifiedSupportGeometries(new Map());
      
      // Clear the trimmed supports preview to show original supports again
      setSupportsTrimPreview([]);
      
      // Clear all offset mesh previews
      offsetMeshPreviews.forEach(mesh => {
        mesh.geometry?.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      setOffsetMeshPreviews(new Map());
      
      // Re-trigger hole CSG if there are holes - needed for both single and multi-section baseplates
      // Clear baseplateWithHoles first so original baseplate geometry is captured fresh
      setBaseplateWithHoles(null);
      // Trigger CSG recalculation after a short delay to allow geometry to re-render
      setTimeout(() => {
        setHoleCSGTrigger(prev => prev + 1);
      }, 100);
      
      console.log('[useCavityOperations] Cavity reset complete - supports restored to original state, hole CSG retriggered');
    };

    window.addEventListener('reset-cavity', handleResetCavity as EventListener);
    return () => {
      window.removeEventListener('reset-cavity', handleResetCavity as EventListener);
    };
  }, [mergedFixtureMesh, offsetMeshPreviews, modifiedSupportGeometries, setBaseplateWithHoles, setHoleCSGTrigger]);

  return {};
}
