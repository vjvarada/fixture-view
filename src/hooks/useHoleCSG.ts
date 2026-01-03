/**
 * useHoleCSG Hook
 *
 * Shared hook for managing hole CSG (Constructive Solid Geometry) operations
 * on baseplates. Handles the workflow of cutting holes into baseplate geometries
 * with proper timing to avoid race conditions during drag operations.
 *
 * @module hooks/useHoleCSG
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import type { PlacedHole } from '@/features/holes';
import { createMergedHolesGeometry } from '@/features/holes';
import { performHoleCSGInWorker } from '../lib/workers';

/** Configuration for the hook */
interface UseHoleCSGConfig {
  /** Current baseplate depth for hole calculations */
  baseplateDepth: number;
  /** Baseplate position offset for hole coordinate transformation */
  baseplateOffset?: { x: number; z: number };
  /** Geometry center offset (for asymmetric baseplate expansion) */
  geometryOffset?: { x: number; z: number };
  /** Whether this is a multi-section baseplate (uses different geometry source) */
  isMultiSection?: boolean;
}

/** Return type of the useHoleCSG hook */
interface UseHoleCSGReturn {
  /** Geometry with holes cut out (null = show original) */
  geometryWithHoles: THREE.BufferGeometry | null;
  /** Whether CSG operation is currently in progress */
  isProcessing: boolean;
  /** Whether a hole is currently being dragged */
  isDragging: boolean;
  /** Start dragging - clears CSG result */
  startDragging: () => void;
  /** Stop dragging - triggers CSG recalculation */
  stopDragging: () => void;
  /** Manually trigger CSG recalculation */
  triggerCSG: () => void;
  /** Clear the CSG result (show original geometry) */
  clearCSG: () => void;
}

/**
 * Waits for React render cycle to complete using double requestAnimationFrame.
 * This ensures geometry capture happens after all effects have run.
 */
function waitForRenderCycle(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

/**
 * Hook for managing CSG hole operations on baseplates.
 *
 * @param holes - Array of holes to cut
 * @param config - Configuration options
 * @param getSourceGeometry - Function to get the current baseplate geometry
 * @returns CSG state and control functions
 */
export function useHoleCSG(
  holes: PlacedHole[],
  config: UseHoleCSGConfig,
  getSourceGeometry: () => THREE.BufferGeometry | null
): UseHoleCSGReturn {
  const [geometryWithHoles, setGeometryWithHoles] = useState<THREE.BufferGeometry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [csgTrigger, setCsgTrigger] = useState(0);

  const isDraggingRef = useRef(false);
  const holesRef = useRef(holes);
  holesRef.current = holes;

  const startDragging = useCallback(() => {
    isDraggingRef.current = true;
    setGeometryWithHoles(null);
  }, []);

  const stopDragging = useCallback(() => {
    isDraggingRef.current = false;
    // Trigger CSG after render cycle completes
    setTimeout(() => {
      setCsgTrigger((prev) => prev + 1);
    }, 150);
  }, []);

  const triggerCSG = useCallback(() => {
    setCsgTrigger((prev) => prev + 1);
  }, []);

  const clearCSG = useCallback(() => {
    setGeometryWithHoles(null);
  }, []);

  // Main CSG execution effect
  useEffect(() => {
    const performCSG = async () => {
      // Skip if dragging or no trigger
      if (isDraggingRef.current || csgTrigger === 0) {
        return;
      }

      const currentHoles = holesRef.current;

      // No holes - clear result
      if (currentHoles.length === 0) {
        setGeometryWithHoles(null);
        return;
      }

      // Wait for render to complete
      await waitForRenderCycle();

      // Check drag state again after waiting
      if (isDraggingRef.current) {
        return;
      }

      const sourceGeometry = getSourceGeometry();
      if (!sourceGeometry) {
        // Retry after delay if geometry not available
        setTimeout(() => {
          setCsgTrigger((prev) => prev + 1);
        }, 100);
        return;
      }

      // Prepare holes with correct depth
      const holesWithDepth = currentHoles.map((hole) => ({
        ...hole,
        depth: hole.depth || config.baseplateDepth,
      }));

      const holesGeometry = createMergedHolesGeometry(
        holesWithDepth,
        config.baseplateDepth,
        config.baseplateOffset,
        config.geometryOffset
      );

      if (!holesGeometry) {
        return;
      }

      setIsProcessing(true);

      try {
        const result = await performHoleCSGInWorker(
          sourceGeometry.clone(),
          holesGeometry
        );

        // Verify we didn't start dragging during CSG
        if (isDraggingRef.current) {
          return;
        }

        if (result) {
          setGeometryWithHoles(result);
        }
      } catch (error) {
        console.error('[useHoleCSG] CSG operation failed:', error);
      } finally {
        setIsProcessing(false);
      }
    };

    performCSG();
  }, [csgTrigger, config.baseplateDepth, config.baseplateOffset, getSourceGeometry]);

  return {
    geometryWithHoles,
    isProcessing,
    isDragging: isDraggingRef.current,
    startDragging,
    stopDragging,
    triggerCSG,
    clearCSG,
  };
}

/**
 * Computes hull points around holes for baseplate expansion.
 * Each hole generates 8 perimeter points with margin for coverage.
 *
 * @param holes - Array of placed holes
 * @param margin - Additional margin around hole edge (default: 3mm)
 * @returns Array of hull points
 */
export function computeHoleHullPoints(
  holes: PlacedHole[],
  margin = 3.0
): Array<{ x: number; z: number }> {
  const POINTS_PER_HOLE = 8;
  const points: Array<{ x: number; z: number }> = [];

  for (const hole of holes) {
    const holeX = Number(hole.position?.x) || 0;
    const holeZ = Number(hole.position?.y) || 0; // position.y is Z in world coords
    const radius = (Number(hole.diameter) || 6) / 2;
    const outerRadius = radius + margin;

    for (let i = 0; i < POINTS_PER_HOLE; i++) {
      const angle = (i / POINTS_PER_HOLE) * Math.PI * 2;
      points.push({
        x: holeX + Math.cos(angle) * outerRadius,
        z: holeZ + Math.sin(angle) * outerRadius,
      });
    }
  }

  return points;
}

/**
 * Compares two hull point arrays for equality within tolerance.
 *
 * @param a - First array
 * @param b - Second array
 * @param tolerance - Comparison tolerance (default: 0.001)
 * @returns True if arrays are equal within tolerance
 */
export function areHullPointsEqual(
  a: Array<{ x: number; z: number }>,
  b: Array<{ x: number; z: number }>,
  tolerance = 0.001
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (
      Math.abs(a[i].x - b[i].x) > tolerance ||
      Math.abs(a[i].z - b[i].z) > tolerance
    ) {
      return false;
    }
  }

  return true;
}
