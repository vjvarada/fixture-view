import { useMemo } from 'react';
import * as THREE from 'three';
import type { TransformComponentType } from '../types';
import { calculateGizmoPosition, calculateGizmoScale } from '../utils';

export interface UseGizmoPositionOptions {
  componentType: TransformComponentType;
  data: Record<string, unknown>;
  customScale?: number | 'auto';
}

export interface UseGizmoPositionReturn {
  gizmoPosition: THREE.Vector3;
  gizmoScale: number;
}

/**
 * Hook to calculate gizmo position and scale based on component type.
 * 
 * Each component type has specific positioning logic:
 * - Support: At TOP of support mesh
 * - Clamp: At fixture point world position
 * - Hole: Above baseplate surface
 * - Label: Above label mesh
 * - Baseplate: Above ground at section center
 * - Part: At mesh world position
 */
export function useGizmoPosition(options: UseGizmoPositionOptions): UseGizmoPositionReturn {
  const { componentType, data, customScale } = options;
  
  const gizmoPosition = useMemo(() => {
    return calculateGizmoPosition(componentType, data);
  }, [componentType, data]);
  
  const gizmoScale = useMemo(() => {
    if (customScale !== undefined && customScale !== 'auto') {
      return customScale;
    }
    return calculateGizmoScale(componentType, data);
  }, [componentType, data, customScale]);
  
  return {
    gizmoPosition,
    gizmoScale,
  };
}
