/**
 * useSupportTrimPreview - Manages support trim preview generation
 * 
 * This hook extracts the support trim preview event listener from 3DScene.tsx:
 * - Listen for supports-trim-request events
 * - Generate trimmed support preview meshes using CSG operations
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import type { ProcessedFile } from '@/modules/FileImport';
import type { AnySupport } from '../types';
import type { CSGEngine } from '@rapidtool/cad-core';
import { createOffsetMesh, extractVertices } from '@rapidtool/cad-core';

export interface UseSupportTrimPreviewParams {
  // State setters
  setSupportsTrimProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setSupportsTrimPreview: React.Dispatch<React.SetStateAction<THREE.Mesh[]>>;
  
  // Data
  importedParts: ProcessedFile[];
  supports: AnySupport[];
  baseTopY: number;
  
  // Refs
  modelMeshRefs: React.MutableRefObject<Map<string, React.RefObject<THREE.Mesh | null>>>;
  csgEngineRef: React.MutableRefObject<CSGEngine | null>;
  
  // Callbacks
  buildSupportMesh: (support: AnySupport, baseTopY: number) => THREE.Mesh | null;
}

export interface UseSupportTrimPreviewReturn {
  // No return values needed - all operations are event-driven
}

export function useSupportTrimPreview({
  setSupportsTrimProcessing,
  setSupportsTrimPreview,
  importedParts,
  supports,
  baseTopY,
  modelMeshRefs,
  csgEngineRef,
  buildSupportMesh,
}: UseSupportTrimPreviewParams): UseSupportTrimPreviewReturn {

  useEffect(() => {
    const handler = async (e: CustomEvent) => {
      const { depth, offset, removalDirection, useModel, useAdvancedOffset, advancedOffsetOptions } = e.detail || {};
      const MIN_SPINNER_MS = 800;
      const startTime = performance.now();
      setSupportsTrimProcessing(true);
      // Yield once so React can render the spinner before heavy CSG work
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      try {
        if (!useModel) {
          setSupportsTrimPreview([]);
          return;
        }

        // Use first part's mesh for support trimming (or could use all parts)
        const firstPartRef = importedParts.length > 0 ? modelMeshRefs.current.get(importedParts[0].id) : null;
        const modelMesh = firstPartRef?.current;
        if (!modelMesh || supports.length === 0) {
          setSupportsTrimPreview([]);
          return;
        }

        const engine = csgEngineRef.current;
        if (!engine) {
          setSupportsTrimPreview([]);
          return;
        }

        const dir = (removalDirection instanceof THREE.Vector3)
          ? removalDirection.clone().normalize()
          : new THREE.Vector3(0, -1, 0);

        let cutterMesh: THREE.Mesh | null = modelMesh;

        if (useAdvancedOffset && advancedOffsetOptions) {
          try {
            const geo = modelMesh.geometry as THREE.BufferGeometry;
            geo.computeBoundingBox();
            const box = geo.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
            const size = box.getSize(new THREE.Vector3());
            const span = Math.max(size.x, size.z);

            // Clamp pixelsPerUnit to a safe upper bound and estimate the
            // heightmap resolution. If the target resolution is too large,
            // skip GPU offset and fall back to the raw model to avoid
            // exhausting WebGL resources.
            const requestedPPU = advancedOffsetOptions.pixelsPerUnit ?? 6;
            const safePPU = Math.min(requestedPPU, 8);
            const estimatedPixels = span * safePPU;

            if (!Number.isFinite(estimatedPixels) || estimatedPixels > 1600) {
              console.warn('Skipping GPU offset for supports trim: target resolution too large', {
                span,
                safePPU,
                estimatedPixels,
              });
              cutterMesh = modelMesh;
            } else {
              const vertices = extractVertices(geo);
              const result = await createOffsetMesh(vertices, {
                offsetDistance: advancedOffsetOptions.offsetDistance ?? (Math.abs(offset) || 0.2),
                pixelsPerUnit: safePPU,
                rotationXZ: advancedOffsetOptions.rotationXZ ?? 0,
                rotationYZ: advancedOffsetOptions.rotationYZ ?? 0,
              });
              cutterMesh = new THREE.Mesh(result.geometry, modelMesh.material as THREE.Material);
            }
          } catch (err) {
            console.error('Advanced offset failed, falling back to normal trimming:', err);
            cutterMesh = modelMesh;
          }
        }

        const previewMeshes: THREE.Mesh[] = [];

        supports.forEach((s) => {
          const baseMesh = buildSupportMesh(s, baseTopY);
          if (!baseMesh || !cutterMesh) return;

          // Option A: only trim in a local band measured from the top of the
          // support downward by at most the requested Resolution (depth).
          // This keeps the effective sweep confined near the model contact
          // region even when supports are much taller than the model.
          const supportHeight = (s as any).height ?? 0;
          const requestedDepth = typeof depth === 'number' ? depth : 10;
          const maxLocalDepth = supportHeight > 0 ? supportHeight : requestedDepth;
          const effectiveDepth = Math.max(0, Math.min(requestedDepth, maxLocalDepth));

          try {
            const result = engine.createNegativeSpace(
              baseMesh,
              [cutterMesh],
              dir,
              {
                depth: effectiveDepth,
                angle: 0,
                offset: useAdvancedOffset ? 0 : (typeof offset === 'number' ? offset : 0),
              }
            );

            if (result && result.isMesh) {
              // Derive preview color from the original support material so the
              // trimmed geometry visually reads as the same support, just in a
              // translucent highlight, instead of inheriting the model color.
              let previewColor = new THREE.Color(0x6b7280);
              const baseMat = baseMesh.material as any;
              if (baseMat && baseMat.color && baseMat.color.isColor) {
                previewColor = baseMat.color.clone();
              }

              const previewMaterial = new THREE.MeshStandardMaterial({
                color: previewColor,
                transparent: true,
                opacity: 0.6,
                roughness: 0.5,
                metalness: 0.1,
                depthWrite: false,
              });
              (result as THREE.Mesh).material = previewMaterial;
              previewMeshes.push(result as THREE.Mesh);
            }
          } catch (err) {
            console.error('Error computing trimmed support preview:', err);
          }
        });

        setSupportsTrimPreview(previewMeshes);
      } finally {
        const elapsed = performance.now() - startTime;
        const remaining = MIN_SPINNER_MS - elapsed;
        if (remaining > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        }
        setSupportsTrimProcessing(false);
      }
    };

    window.addEventListener('supports-trim-request', handler as EventListener);
    return () => window.removeEventListener('supports-trim-request', handler as EventListener);
  }, [supports, baseTopY, buildSupportMesh, importedParts, modelMeshRefs, csgEngineRef, setSupportsTrimProcessing, setSupportsTrimPreview]);

  return {};
}
