/**
 * useSupportState - Hook for managing support placement and state
 * Extracted from 3DScene.tsx for modularity
 */
import { useState, useRef, useMemo } from 'react';
import * as THREE from 'three';
import type { AnySupport, SupportType } from '@/features/supports';
import { getSupportFootprintPoints } from '@/features/supports';

export interface SupportPlacingState {
  active: boolean;
  type: SupportType | null;
  initParams?: Record<string, number>;
}

export interface UseSupportStateReturn {
  // State
  placing: SupportPlacingState;
  supports: AnySupport[];
  supportsTrimPreview: THREE.Mesh[];
  supportsTrimProcessing: boolean;
  supportSnapEnabled: boolean;
  modifiedSupportGeometries: Map<string, THREE.BufferGeometry>;
  cavitySubtractionProcessing: boolean;
  
  // Setters
  setPlacing: React.Dispatch<React.SetStateAction<SupportPlacingState>>;
  setSupports: React.Dispatch<React.SetStateAction<AnySupport[]>>;
  setSupportsTrimPreview: React.Dispatch<React.SetStateAction<THREE.Mesh[]>>;
  setSupportsTrimProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setSupportSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setModifiedSupportGeometries: React.Dispatch<React.SetStateAction<Map<string, THREE.BufferGeometry>>>;
  setCavitySubtractionProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Refs
  isDraggingSupportRef: React.MutableRefObject<boolean>;
  editingSupportRef: React.MutableRefObject<AnySupport | null>;
  
  // Computed
  supportHullPoints: Array<{ x: number; z: number }>;
}

/**
 * Hook to manage all support-related state in 3DScene
 */
export function useSupportState(): UseSupportStateReturn {
  // Support placement state
  const [placing, setPlacing] = useState<SupportPlacingState>({ 
    active: false, 
    type: null 
  });
  const [supports, setSupports] = useState<AnySupport[]>([]);
  const [supportsTrimPreview, setSupportsTrimPreview] = useState<THREE.Mesh[]>([]);
  const [supportsTrimProcessing, setSupportsTrimProcessing] = useState(false);
  
  // Support snap alignment state
  const [supportSnapEnabled, setSupportSnapEnabled] = useState(true);
  
  // Modified support geometries (after cavity subtraction)
  const [modifiedSupportGeometries, setModifiedSupportGeometries] = useState<Map<string, THREE.BufferGeometry>>(new Map());
  const [cavitySubtractionProcessing, setCavitySubtractionProcessing] = useState(false);
  
  // Refs for drag tracking
  const isDraggingSupportRef = useRef(false);
  const editingSupportRef = useRef<AnySupport | null>(null);
  
  // Calculate all support footprint points for convex hull calculation
  const prevSupportHullPointsRef = useRef<Array<{ x: number; z: number }>>([]);
  const supportHullPoints = useMemo(() => {
    const points: Array<{ x: number; z: number }> = [];
    for (const support of supports) {
      const footprintPoints = getSupportFootprintPoints(support);
      points.push(...footprintPoints);
    }
    
    // Check if points are the same as before to avoid unnecessary updates
    const prev = prevSupportHullPointsRef.current;
    if (prev.length === points.length) {
      let same = true;
      for (let i = 0; i < points.length && same; i++) {
        if (Math.abs(prev[i].x - points[i].x) > 0.001 || Math.abs(prev[i].z - points[i].z) > 0.001) {
          same = false;
        }
      }
      if (same) return prev;
    }
    
    prevSupportHullPointsRef.current = points;
    return points;
  }, [supports]);

  return {
    // State
    placing,
    supports,
    supportsTrimPreview,
    supportsTrimProcessing,
    supportSnapEnabled,
    modifiedSupportGeometries,
    cavitySubtractionProcessing,
    
    // Setters
    setPlacing,
    setSupports,
    setSupportsTrimPreview,
    setSupportsTrimProcessing,
    setSupportSnapEnabled,
    setModifiedSupportGeometries,
    setCavitySubtractionProcessing,
    
    // Refs
    isDraggingSupportRef,
    editingSupportRef,
    
    // Computed
    supportHullPoints,
  };
}
