import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { setOrbitControlsEnabled, resetPivotMatrix } from '../utils';

export interface DragState {
  isDragging: boolean;
  dragStartPosition: THREE.Vector3 | null;
}

export interface UseDragStateOptions {
  disableOrbitOnDrag?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export interface UseDragStateReturn {
  isDraggingRef: React.MutableRefObject<boolean>;
  dragStartPosRef: React.MutableRefObject<THREE.Vector3 | null>;
  handleDragStart: (currentPosition: THREE.Vector3) => void;
  handleDragEnd: (pivotRef: React.RefObject<THREE.Object3D>) => void;
  getDisplayPosition: (currentPosition: THREE.Vector3) => THREE.Vector3;
}

/**
 * Hook to manage drag state for transform controls.
 * 
 * CRITICAL: This implements the "drag start position lock" pattern
 * that prevents jittering during drag operations.
 * 
 * Pattern:
 * 1. On drag start: Lock the display position
 * 2. During drag: Use locked position for display (prevents feedback loop)
 * 3. On drag end: Reset pivot matrix to identity
 */
export function useDragState(options: UseDragStateOptions = {}): UseDragStateReturn {
  const { disableOrbitOnDrag = true, onDragStart, onDragEnd } = options;
  
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<THREE.Vector3 | null>(null);
  
  const handleDragStart = useCallback((currentPosition: THREE.Vector3) => {
    isDraggingRef.current = true;
    // LOCK the display position to prevent feedback loop
    dragStartPosRef.current = currentPosition.clone();
    
    if (disableOrbitOnDrag) {
      setOrbitControlsEnabled(false);
    }
    
    onDragStart?.();
  }, [disableOrbitOnDrag, onDragStart]);
  
  const handleDragEnd = useCallback((pivotRef: React.RefObject<THREE.Object3D>) => {
    isDraggingRef.current = false;
    dragStartPosRef.current = null;
    
    // CRITICAL: Reset pivot to identity after drag
    if (pivotRef.current) {
      resetPivotMatrix(pivotRef.current);
    }
    
    if (disableOrbitOnDrag) {
      setOrbitControlsEnabled(true);
    }
    
    onDragEnd?.();
  }, [disableOrbitOnDrag, onDragEnd]);
  
  const getDisplayPosition = useCallback((currentPosition: THREE.Vector3): THREE.Vector3 => {
    // During drag, use the LOCKED position for display
    if (isDraggingRef.current && dragStartPosRef.current) {
      return dragStartPosRef.current;
    }
    return currentPosition;
  }, []);
  
  return {
    isDraggingRef,
    dragStartPosRef,
    handleDragStart,
    handleDragEnd,
    getDisplayPosition,
  };
}
