/**
 * useOffsetMeshPreview - Manages offset mesh preview generation
 * 
 * This hook extracts offset mesh preview event listeners from 3DScene.tsx:
 * - Generate offset mesh preview
 * - Clear offset mesh preview
 * - Toggle offset preview visibility
 */

import { useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { ProcessedFile } from '@/modules/FileImport';
import type { AnySupport } from '../types';
import type { PlacedClamp } from './useClampState';
import { createOffsetMesh, extractVertices, decimateMesh, laplacianSmooth } from '@rapidtool/cad-core';

// Decimation target for offset mesh (to keep GPU happy)
const OFFSET_MESH_DECIMATION_TARGET = 50000;

export interface UseOffsetMeshPreviewParams {
  // State
  offsetMeshPreviews: Map<string, THREE.Mesh>;
  setOffsetMeshPreviews: React.Dispatch<React.SetStateAction<Map<string, THREE.Mesh>>>;
  setOffsetMeshProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOffsetPreview: React.Dispatch<React.SetStateAction<boolean>>;
  setSupports: React.Dispatch<React.SetStateAction<AnySupport[]>>;
  setPlacedClamps: React.Dispatch<React.SetStateAction<PlacedClamp[]>>;
  
  // Data
  importedParts: ProcessedFile[];
  baseTopY: number;
  
  // Refs
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh | null>>>;
}

export interface UseOffsetMeshPreviewReturn {
  // No return values needed - all operations are event-driven
}

export function useOffsetMeshPreview({
  offsetMeshPreviews,
  setOffsetMeshPreviews,
  setOffsetMeshProcessing,
  setShowOffsetPreview,
  setSupports,
  setPlacedClamps,
  importedParts,
  baseTopY,
  modelMeshRefs,
}: UseOffsetMeshPreviewParams): UseOffsetMeshPreviewReturn {

  useEffect(() => {
    const handleGenerateOffsetMesh = async (e: CustomEvent) => {
      const { settings } = e.detail || {};
      if (!settings || !settings.enabled) {
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
        return;
      }

      if (importedParts.length === 0) {
        console.warn('[3DScene] Cannot generate offset mesh: no parts loaded');
        setOffsetMeshPreviews(new Map());
        return;
      }

      setOffsetMeshProcessing(true);
      
      // Calculate how much to move the parts up to achieve clearance from baseplate
      // The goal is to have at least `clearanceTolerance` gap between part bottom and baseplate top
      const clearanceTolerance = settings.offsetDistance ?? 0.5;
      
      // Find the lowest point across all parts
      let globalMinY = Infinity;
      for (const part of importedParts) {
        const partRef = modelMeshRefs.current.get(part.id);
        const modelMesh = partRef?.current;
        if (!modelMesh) continue;
        
        modelMesh.updateMatrixWorld(true);
        const geometry = modelMesh.geometry as THREE.BufferGeometry;
        const tempGeometry = geometry.clone();
        tempGeometry.applyMatrix4(modelMesh.matrixWorld);
        tempGeometry.computeBoundingBox();
        const partMinY = tempGeometry.boundingBox?.min.y ?? baseTopY;
        tempGeometry.dispose();
        
        globalMinY = Math.min(globalMinY, partMinY);
      }
      
      if (globalMinY === Infinity) globalMinY = baseTopY;
      
      // Calculate current gap between lowest part and baseplate top
      const currentGap = globalMinY - baseTopY;
      
      // Determine how much to move up:
      // - If currentGap >= clearanceTolerance: no movement needed (already has enough clearance)
      // - If currentGap < clearanceTolerance: move up by (clearanceTolerance - currentGap)
      const moveUpAmount = Math.max(0, clearanceTolerance - currentGap);
      
      if (moveUpAmount > 0) {
        // Move ALL parts UP by the calculated amount
        importedParts.forEach(part => {
          const partRef = modelMeshRefs.current.get(part.id);
          if (partRef?.current) {
            partRef.current.position.y += moveUpAmount;
            partRef.current.updateMatrixWorld(true);
          }
        });
        
        // Extend all support heights by the same amount
        // This ensures supports still reach the (now elevated) parts
        setSupports(prev => prev.map(s => ({
          ...s,
          height: (s as any).height + moveUpAmount
        } as AnySupport)));
        
        // Move all clamps UP by the same amount
        // This ensures clamps maintain their relative position to the elevated parts
        setPlacedClamps(prev => prev.map(c => ({
          ...c,
          position: { ...c.position, y: c.position.y + moveUpAmount }
        })));
      }

      // Process each part sequentially to generate offset meshes
      const newOffsetMeshes = new Map<string, THREE.Mesh>();
      const totalParts = importedParts.length;
      let processedParts = 0;

      try {
        for (const part of importedParts) {
          const partRef = modelMeshRefs.current.get(part.id);
          const modelMesh = partRef?.current;
          if (!modelMesh) {
            console.warn(`[3DScene] Skipping part ${part.id}: no mesh found`);
            continue;
          }

          console.log(`[3DScene] Processing offset mesh for part ${processedParts + 1}/${totalParts}: ${part.metadata?.name || part.id}`);
          
          // Dispatch progress for this part
          window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
            detail: { 
              current: processedParts, 
              total: totalParts, 
              stage: `Processing part ${processedParts + 1}/${totalParts}...` 
            }
          }));

          // Update world matrix to ensure transforms are current
          modelMesh.updateMatrixWorld(true);

          // Get the geometry and extract vertices
          const geometry = modelMesh.geometry as THREE.BufferGeometry;
          
          // We need to apply the world transform to the vertices before processing
          // Create a clone of the geometry with world-space vertices
          const worldGeometry = geometry.clone();
          worldGeometry.applyMatrix4(modelMesh.matrixWorld);
          
          const vertices = extractVertices(worldGeometry);
          
          // Calculate safe resolution
          worldGeometry.computeBoundingBox();
          const box = worldGeometry.boundingBox ?? new THREE.Box3();
          const size = box.getSize(new THREE.Vector3());
          const span = Math.max(size.x, size.y, size.z);
          
          // Clamp pixelsPerUnit to avoid GPU memory issues
          const requestedPPU = settings.pixelsPerUnit ?? 6;
          const safePPU = Math.min(requestedPPU, 8);
          const estimatedPixels = span * safePPU;
          
          if (!Number.isFinite(estimatedPixels) || estimatedPixels > 2000) {
            console.warn(`[3DScene] Offset mesh resolution clamped for GPU limits (part ${part.id})`);
          }

          // Yield to browser before heavy computation
          await new Promise(resolve => setTimeout(resolve, 0));

          const offsetDistance = settings.offsetDistance ?? 0.5;
          
          // Zero offset is fully supported - the heightmap projection will use the
          // part mesh directly without Minkowski sum expansion. This creates
          // directional/extractable cutting volumes that match the exact part shape.
          const isZeroOffset = offsetDistance <= 0.001;
          
          if (isZeroOffset) {
            console.log(`[3DScene] Zero offset mode: using part mesh directly for heightmap projection (no Minkowski sum)`);
          }
          
          let finalGeometry: THREE.BufferGeometry;
          let finalTriangleCount: number;
          let processingTime = 0;
          
          // === HEIGHTMAP-BASED OFFSET MESH GENERATION ===
          // Always use heightmap projection for directional cutting capability
          // For zero offset, the heightmap projects the part mesh directly without Minkowski expansion
          // This ensures extractable cavities that match the exact part shape
          const result = await createOffsetMesh(vertices, {
            offsetDistance: offsetDistance,
            pixelsPerUnit: Math.min(safePPU, 2000 / span),
            rotationXZ: settings.rotationXZ ?? 0,
            rotationYZ: settings.rotationYZ ?? 0,
            fillHoles: settings.fillHoles ?? true,
            progressCallback: (current, total, stage) => {
              // Dispatch progress event for UI updates (scale to part progress)
              const partProgress = (processedParts + (current / total)) / totalParts;
              const stageLabel = isZeroOffset ? `${stage} (exact fit)` : stage;
              window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
                detail: { 
                  current: Math.round(partProgress * 100), 
                  total: 100, 
                  stage: `Part ${processedParts + 1}/${totalParts}: ${stageLabel}` 
                }
              }));
            },
          });

          // Yield to browser after heavy computation
          await new Promise(resolve => setTimeout(resolve, 0));

          if (!result.geometry) {
            console.warn(`[3DScene] Offset mesh generation returned no geometry for part ${part.id}`);
            worldGeometry.dispose();
            processedParts++;
            continue;
          }
          
          finalGeometry = result.geometry;
          finalTriangleCount = result.metadata.triangleCount;
          processingTime = result.metadata.processingTime;
          
          // Process offset mesh based on settings
          const shouldDecimate = settings.enableDecimation !== false && result.metadata.triangleCount > OFFSET_MESH_DECIMATION_TARGET;
          const shouldSmooth = settings.enableSmoothing !== false;
          
          if (shouldDecimate || shouldSmooth) {
            let currentGeometry = result.geometry;
            
            // === Step 1: Decimation (if enabled and needed) ===
            if (shouldDecimate) {
              window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
                detail: { 
                  current: Math.round((processedParts + 0.7) / totalParts * 100), 
                  total: 100, 
                  stage: `Part ${processedParts + 1}/${totalParts}: Decimating mesh...` 
                }
              }));
              
              // Yield to browser before decimation
              await new Promise(resolve => setTimeout(resolve, 0));
              
              // decimateMesh expects non-indexed geometry, so convert if needed
              let geometryToDecimate = currentGeometry;
              if (currentGeometry.index) {
                geometryToDecimate = currentGeometry.toNonIndexed();
                currentGeometry.dispose();
                currentGeometry = geometryToDecimate;
              }
              
              const decimationResult = await decimateMesh(
                geometryToDecimate,
                OFFSET_MESH_DECIMATION_TARGET
              );
              
              if (decimationResult.success && decimationResult.geometry) {
                currentGeometry.dispose();
                currentGeometry = decimationResult.geometry;
                finalTriangleCount = Math.round(decimationResult.finalTriangles);
              }
            }
            
            // === Step 2: Smoothing (if enabled) ===
            if (shouldSmooth) {
              const iterations = settings.smoothingIterations ?? 10;
              const strength = settings.smoothingStrength ?? 0;
              const quality = settings.smoothingQuality ?? true;
              const debugColors = settings.debugSmoothingColors ?? false;
              const tiltXZ = settings.rotationXZ ?? 0;
              const tiltYZ = settings.rotationYZ ?? 0;
              
              const strengthLabel = strength === 0 ? 'Taubin' : strength === 1 ? 'Laplacian' : `${(strength * 100).toFixed(0)}%`;
              
              window.dispatchEvent(new CustomEvent('offset-mesh-preview-progress', {
                detail: { 
                  current: Math.round((processedParts + 0.85) / totalParts * 100), 
                  total: 100, 
                  stage: `Part ${processedParts + 1}/${totalParts}: Smoothing mesh (${iterations} iter, ${strengthLabel})...` 
                }
              }));
              
              // Yield to browser before smoothing
              await new Promise(resolve => setTimeout(resolve, 0));
              
              // Use blended Taubin/Laplacian smoothing based on trCAD approach
              // Pass tilt angles so smoothing can classify vertices correctly
              const smoothingResult = await laplacianSmooth(
                currentGeometry,
                {
                  iterations,
                  strength,
                  quality,
                  debugColors,
                  tiltXZ,
                  tiltYZ,
                }
              );
              
              if (smoothingResult.success && smoothingResult.geometry) {
                currentGeometry.dispose();
                currentGeometry = smoothingResult.geometry;
                // Update triangle count after smoothing (smoothing outputs non-indexed)
                finalTriangleCount = Math.round(currentGeometry.getAttribute('position').count / 3);
              }
            }
            
            finalGeometry = currentGeometry;
          }
          
          // === CREATE PREVIEW MESH ===
          // Check if geometry has vertex colors (from debug mode)
          const hasVertexColors = finalGeometry.hasAttribute('color');
          
          // Create preview material - use vertex colors for debug, or translucent blue normally
          // Use the same blue color for both zero offset and normal offset modes
          const previewMaterial = hasVertexColors
            ? new THREE.MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: settings.previewOpacity ?? 0.8, // Higher opacity for debug colors
                side: THREE.DoubleSide,
                depthWrite: false,
              })
            : new THREE.MeshStandardMaterial({
                color: 0x3b82f6, // Blue-500 for visibility (same for zero and normal offset)
                transparent: true,
                opacity: settings.previewOpacity ?? 0.3,
                side: THREE.DoubleSide,
                depthWrite: false,
                roughness: 0.5,
                metalness: 0.1,
              });
          
          if (hasVertexColors) {
            console.log('[3DScene] Debug colors enabled - vertex classification visualization:');
            console.log('  RED: WALL vertices (smoothed in X-Z)');
            console.log('  GREEN: TOP_SURFACE_BOUNDARY vertices (smoothed in X-Z)');
            console.log('  BLUE: TOP_SURFACE_INTERIOR vertices (NOT smoothed)');
            console.log('  YELLOW: BOTTOM_SURFACE vertices (NOT smoothed)');
          }

          const previewMesh = new THREE.Mesh(finalGeometry, previewMaterial);
          
          // The mesh is already in world space (we applied the transform before processing)
          // No need to apply transform again
          previewMesh.name = `offset-mesh-preview-${part.id}`;
          
          const modeLabel = isZeroOffset ? 'zero offset' : 'offset';
          console.log(`[3DScene] Cavity preview mesh (${modeLabel}) generated for part ${part.id}: ${finalTriangleCount} triangles in ${processingTime.toFixed(0)}ms`);
          
          newOffsetMeshes.set(part.id, previewMesh);
          
          // INCREMENTAL UPDATE: Show this mesh immediately as it's ready
          // This provides visual feedback while other parts are still processing
          setOffsetMeshPreviews(prev => {
            const updated = new Map(prev);
            updated.set(part.id, previewMesh);
            return updated;
          });

          // Clean up cloned geometry
          worldGeometry.dispose();
          processedParts++;
        }

        // All parts processed - dispose any old meshes that are no longer needed
        // (meshes from parts that were removed)
        offsetMeshPreviews.forEach((mesh, partId) => {
          if (!newOffsetMeshes.has(partId)) {
            mesh.geometry?.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
              } else {
                mesh.material.dispose();
              }
            }
          }
        });
        
        // Final state is already set incrementally, but ensure consistency
        setOffsetMeshPreviews(newOffsetMeshes);
        
        // Notify completion
        window.dispatchEvent(new CustomEvent('offset-mesh-preview-complete', { 
          detail: { success: true, partsProcessed: newOffsetMeshes.size, totalParts } 
        }));
        
        console.log(`[3DScene] Offset mesh generation complete: ${newOffsetMeshes.size}/${totalParts} parts processed`);
        
      } catch (err) {
        console.error('[3DScene] Failed to generate offset mesh preview:', err);
        // Clear any partial results
        newOffsetMeshes.forEach(mesh => {
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
        window.dispatchEvent(new CustomEvent('offset-mesh-preview-complete', { 
          detail: { success: false, error: err } 
        }));
      } finally {
        setOffsetMeshProcessing(false);
      }
    };

    const handleClearOffsetMesh = () => {
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
    };

    const handleToggleOffsetPreview = (e: CustomEvent<{ visible: boolean }>) => {
      setShowOffsetPreview(e.detail.visible);
    };

    window.addEventListener('generate-offset-mesh-preview', handleGenerateOffsetMesh as EventListener);
    window.addEventListener('clear-offset-mesh-preview', handleClearOffsetMesh as EventListener);
    window.addEventListener('toggle-offset-preview', handleToggleOffsetPreview as EventListener);
    
    return () => {
      window.removeEventListener('generate-offset-mesh-preview', handleGenerateOffsetMesh as EventListener);
      window.removeEventListener('clear-offset-mesh-preview', handleClearOffsetMesh as EventListener);
      window.removeEventListener('toggle-offset-preview', handleToggleOffsetPreview as EventListener);
    };
  }, [importedParts, offsetMeshPreviews, baseTopY, modelMeshRefs, setOffsetMeshPreviews, setOffsetMeshProcessing, setShowOffsetPreview, setSupports, setPlacedClamps]);

  return {};
}
