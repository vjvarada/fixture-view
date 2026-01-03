/**
 * Transform Control Hooks
 * 
 * Shared hooks for orbit control management and cursor styling
 * during transform operations.
 */

import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { setOrbitControlsEnabled, resetGroupTransform } from '@/lib/transformUtils';

// ============================================================================
// Orbit Control Lock Hook
// ============================================================================

interface UseOrbitControlLockReturn {
  /** Call when drag starts */
  lockOrbitControls: () => void;
  /** Call when drag ends */
  unlockOrbitControls: () => void;
}

/**
 * Manages orbit control locking during drag operations.
 * Prevents camera movement while transforming objects.
 */
export function useOrbitControlLock(): UseOrbitControlLockReturn {
  const lockOrbitControls = useCallback(() => {
    setOrbitControlsEnabled(false);
  }, []);

  const unlockOrbitControls = useCallback(() => {
    setOrbitControlsEnabled(true);
  }, []);

  return { lockOrbitControls, unlockOrbitControls };
}

// ============================================================================
// Pivot Reset Hook
// ============================================================================

interface UsePivotResetReturn {
  /** Ref to attach to the pivot group */
  pivotRef: React.RefObject<THREE.Group>;
  /** Call after drag ends to reset accumulated transforms */
  resetPivot: () => void;
}

/**
 * Manages pivot group reset after drag operations.
 * CRITICAL: Prevents jitter by resetting accumulated transforms.
 */
export function usePivotReset(): UsePivotResetReturn {
  const pivotRef = useRef<THREE.Group>(null);

  const resetPivot = useCallback(() => {
    resetGroupTransform(pivotRef.current);
  }, []);

  return { pivotRef, resetPivot };
}

// ============================================================================
// Transform Cursor Hook
// ============================================================================

interface UseTransformCursorReturn {
  /** Call when hovering over gizmo */
  setGrabCursor: () => void;
  /** Call when dragging starts */
  setGrabbingCursor: () => void;
  /** Call when drag ends or hover ends */
  resetCursor: () => void;
}

/**
 * Manages cursor styling during transform operations.
 */
export function useTransformCursor(): UseTransformCursorReturn {
  const setGrabCursor = useCallback(() => {
    document.body.style.cursor = 'grab';
  }, []);

  const setGrabbingCursor = useCallback(() => {
    document.body.style.cursor = 'grabbing';
  }, []);

  const resetCursor = useCallback(() => {
    document.body.style.cursor = '';
  }, []);

  return { setGrabCursor, setGrabbingCursor, resetCursor };
}

// ============================================================================
// Combined Transform Control Hook
// ============================================================================

interface UseTransformControlsOptions {
  /** Called when drag starts */
  onDragStart?: () => void;
  /** Called when drag ends */
  onDragEnd?: () => void;
}

interface UseTransformControlsReturn extends UseOrbitControlLockReturn, UsePivotResetReturn, UseTransformCursorReturn {
  /** Handles drag start - locks orbit, sets cursor, calls callback */
  handleDragStart: () => void;
  /** Handles drag end - unlocks orbit, resets cursor/pivot, calls callback */
  handleDragEnd: () => void;
}

/**
 * Combined hook for common transform control behaviors.
 * Includes orbit locking, pivot reset, and cursor management.
 */
export function useTransformControls(
  options: UseTransformControlsOptions = {}
): UseTransformControlsReturn {
  const { onDragStart, onDragEnd } = options;
  
  const { lockOrbitControls, unlockOrbitControls } = useOrbitControlLock();
  const { pivotRef, resetPivot } = usePivotReset();
  const { setGrabCursor, setGrabbingCursor, resetCursor } = useTransformCursor();

  const handleDragStart = useCallback(() => {
    lockOrbitControls();
    setGrabbingCursor();
    onDragStart?.();
  }, [lockOrbitControls, setGrabbingCursor, onDragStart]);

  const handleDragEnd = useCallback(() => {
    unlockOrbitControls();
    resetCursor();
    resetPivot();
    onDragEnd?.();
  }, [unlockOrbitControls, resetCursor, resetPivot, onDragEnd]);

  return {
    lockOrbitControls,
    unlockOrbitControls,
    pivotRef,
    resetPivot,
    setGrabCursor,
    setGrabbingCursor,
    resetCursor,
    handleDragStart,
    handleDragEnd,
  };
}
