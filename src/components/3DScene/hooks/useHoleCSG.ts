/**
 * useHoleCSG - Manages hole CSG operations for baseplate
 * 
 * This hook extracts hole CSG related effects from 3DScene.tsx:
 * - CSG trigger scheduling and debouncing
 * - Baseplate geometry caching
 * - Hole CSG execution via web worker
 * - Hole depth synchronization with baseplate
 * 
 * Phase 5.9 extraction - Handles all hole CSG operations:
 * - Trigger CSG when baseplate/holes change
 * - Clear cached geometry when baseplate config changes
 * - Execute CSG operation to cut holes from baseplate
 * - Sync hole depths with baseplate depth changes
 */
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { BasePlateConfig } from '@/features/baseplate';
import type { PlacedHole } from '@/features/holes';
import { createMergedHolesGeometry } from '@/features/holes';
import { performHoleCSGInWorker } from '@rapidtool/cad-core';

export interface UseHoleCSGProps {
  // Baseplate state
  basePlate: BasePlateConfig | null;
  
  // Hole state
  mountingHoles: PlacedHole[];
  setMountingHoles: React.Dispatch<React.SetStateAction<PlacedHole[]>>;
  
  // CSG state
  baseplateWithHoles: THREE.BufferGeometry | null;
  setBaseplateWithHoles: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  holeCSGProcessing: boolean;
  setHoleCSGProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  holeCSGTrigger: number;
  setHoleCSGTrigger: React.Dispatch<React.SetStateAction<number>>;
  
  // Refs
  isDraggingHoleRef: React.MutableRefObject<boolean>;
  mountingHolesRef: React.MutableRefObject<PlacedHole[]>;
  originalBaseplateGeoRef: React.MutableRefObject<THREE.BufferGeometry | null>;
  basePlateMeshRef: React.RefObject<THREE.Mesh | null>;
  
  // Hull points for dependency tracking
  combinedHullPoints: Array<{ x: number; z: number }>;
}

export interface UseHoleCSGReturn {
  /** Waits for React render cycle to complete */
  waitForRenderCycle: () => Promise<void>;
  /** Triggers CSG recalculation with delay */
  scheduleCSGTrigger: (delay?: number) => () => void;
  /** Serialized hull points for stable dependency comparison */
  hullPointsKey: string;
}

/**
 * Hook that manages all hole CSG operations
 * - Schedules CSG operations with debouncing
 * - Caches original baseplate geometry
 * - Executes CSG subtraction via web worker
 * - Syncs hole depths with baseplate depth changes
 */
export function useHoleCSG({
  basePlate,
  mountingHoles,
  setMountingHoles,
  baseplateWithHoles,
  setBaseplateWithHoles,
  holeCSGProcessing,
  setHoleCSGProcessing,
  holeCSGTrigger,
  setHoleCSGTrigger,
  isDraggingHoleRef,
  mountingHolesRef,
  originalBaseplateGeoRef,
  basePlateMeshRef,
  combinedHullPoints,
}: UseHoleCSGProps): UseHoleCSGReturn {
  
  // Track previous baseplate depth
  const prevBaseplateDepthRef = useRef(basePlate?.depth);

  // ========================================================================
  // Utility callbacks
  // ========================================================================
  
  /** Waits for React render cycle to complete. */
  const waitForRenderCycle = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }, []);

  /** Triggers CSG recalculation with delay. */
  const scheduleCSGTrigger = useCallback((delay = 150) => {
    const timer = setTimeout(() => {
      if (!isDraggingHoleRef.current) {
        setHoleCSGTrigger((prev) => prev + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [isDraggingHoleRef, setHoleCSGTrigger]);

  // ========================================================================
  // Memoized values
  // ========================================================================
  
  // Serialize hull points for stable dependency comparison
  const hullPointsKey = useMemo(() => {
    return JSON.stringify(combinedHullPoints.map(p => ({ x: Math.round(p.x * 100), z: Math.round(p.z * 100) })));
  }, [combinedHullPoints]);

  // ========================================================================
  // Handle CSG updates when baseplate or holes change (skip during drag)
  // ========================================================================
  useEffect(() => {
    if (basePlate?.type === 'multi-section' || isDraggingHoleRef.current) {
      return;
    }

    // No holes - clear CSG result
    if (mountingHoles.length === 0) {
      setBaseplateWithHoles(null);
      return;
    }

    // We have holes - trigger CSG recalculation
    // Clear existing CSG first so BasePlate renders with correct size
    setBaseplateWithHoles(null);
    
    // Schedule CSG trigger
    return scheduleCSGTrigger();
  }, [
    basePlate?.type,
    basePlate?.width,
    basePlate?.height,
    basePlate?.depth,
    combinedHullPoints,
    mountingHoles.length,
    scheduleCSGTrigger,
    // Note: baseplateWithHoles intentionally excluded to avoid infinite loop
    // Note: setBaseplateWithHoles is stable (from useState), no need to include
  ]);

  // ========================================================================
  // Clear cached original geometry when baseplate configuration changes
  // This forces re-capture of the geometry on next CSG trigger
  // ========================================================================
  useEffect(() => {
    originalBaseplateGeoRef.current = null;
    setBaseplateWithHoles(null);
  }, [basePlate?.type, basePlate?.width, basePlate?.height, basePlate?.depth, hullPointsKey]);
  // Note: Refs and setters intentionally excluded - they're stable

  // ========================================================================
  // Execute CSG operation
  // ========================================================================
  useEffect(() => {
    const performHoleCSG = async () => {
      // Skip conditions
      if (
        basePlate?.type === 'multi-section' ||
        isDraggingHoleRef.current ||
        holeCSGTrigger === 0
      ) {
        return;
      }

      const currentHoles = mountingHolesRef.current;
      if (currentHoles.length === 0) {
        setBaseplateWithHoles(null);
        return;
      }

      // Wait for geometry to be ready
      await waitForRenderCycle();

      if (isDraggingHoleRef.current) return;

      // Get source geometry - prefer cached original, fallback to mesh
      let sourceGeo: THREE.BufferGeometry | null = null;
      
      if (originalBaseplateGeoRef.current) {
        // Use cached original geometry
        sourceGeo = originalBaseplateGeoRef.current.clone();
        console.log('[HoleCSG] Using cached original geometry');
      } else {
        // No cache - capture from mesh (must be original BasePlate since baseplateWithHoles is null)
        const meshGeometry = basePlateMeshRef.current?.geometry;
        if (!meshGeometry) {
          scheduleCSGTrigger(100);
          return;
        }
        // Cache the original geometry for future CSG operations
        originalBaseplateGeoRef.current = meshGeometry.clone();
        sourceGeo = meshGeometry.clone();
        console.log('[HoleCSG] Captured and cached original geometry');
      }

      const baseplateOffset = basePlate?.position
        ? { x: basePlate.position.x, z: basePlate.position.z }
        : undefined;
      const depth = basePlate?.depth ?? 5;

      // Calculate geometry offset - accounts for asymmetric expansion when hull points
      // cause the baseplate to expand in one direction more than the other.
      // 
      // IMPORTANT: This only applies to RECTANGULAR baseplates where geometry is in local space
      // and gets translated by (geometryOffsetX, geometryOffsetZ) when hull points cause asymmetric expansion.
      //
      // For CONVEX-HULL baseplates, the geometry is created directly in WORLD space (vertices have
      // actual world coordinates) and the mesh position is (0,0,0). No geometry offset is needed.
      let geometryOffset: { x: number; z: number } | undefined;
      
      if (basePlate?.type !== 'convex-hull') {
        // Only calculate geometry offset for non-convex-hull types
        sourceGeo.computeBoundingBox();
        if (sourceGeo.boundingBox) {
          const box = sourceGeo.boundingBox;
          const geoCenterX = (box.min.x + box.max.x) / 2;
          const geoCenterZ = (box.min.z + box.max.z) / 2;
          // Only apply offset if significant (> 0.1mm)
          if (Math.abs(geoCenterX) > 0.1 || Math.abs(geoCenterZ) > 0.1) {
            geometryOffset = { x: geoCenterX, z: geoCenterZ };
            console.log('[HoleCSG] Geometry offset detected (rectangular):', geometryOffset);
          }
        }
      } else {
        console.log('[HoleCSG] Convex-hull baseplate - no geometry offset needed');
      }

      const holesWithDepth = currentHoles.map((hole) => ({
        ...hole,
        depth: hole.depth || depth,
      }));

      const holesGeo = createMergedHolesGeometry(holesWithDepth, depth, baseplateOffset, geometryOffset);
      if (!holesGeo) return;

      setHoleCSGProcessing(true);

      try {
        const result = await performHoleCSGInWorker(sourceGeo, holesGeo);

        if (isDraggingHoleRef.current) return;

        if (result) {
          setBaseplateWithHoles(result);
        }
      } catch (error) {
        console.error('[HoleCSG] Error:', error);
      } finally {
        setHoleCSGProcessing(false);
      }
    };

    performHoleCSG();
  }, [
    holeCSGTrigger,
    basePlate?.type,
    basePlate?.position,
    basePlate?.depth,
    waitForRenderCycle,
    scheduleCSGTrigger,
    // Note: Refs and setters intentionally excluded - they're stable
  ]);

  // ========================================================================
  // Sync hole depths with baseplate depth changes
  // ========================================================================
  useEffect(() => {
    const newDepth = basePlate?.depth ?? 20;
    const prevDepth = prevBaseplateDepthRef.current;

    if (prevDepth === newDepth) return;
    prevBaseplateDepthRef.current = newDepth;

    setMountingHoles((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((hole) => ({ ...hole, depth: newDepth }));
    });
  }, [basePlate?.depth, setMountingHoles]);

  return {
    waitForRenderCycle,
    scheduleCSGTrigger,
    hullPointsKey,
  };
}
