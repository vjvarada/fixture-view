/**
 * useClampState - Hook for managing clamp placement and state
 * Extracted from 3DScene.tsx for modularity
 */
import { useState, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedClamp } from '@/features/clamps';

export interface ClampPlacementModeState {
  active: boolean;
  clampModelId: string | null;
  clampCategory: string | null;
}

export interface ClampDebugPointsState {
  closestBoundaryPoint: { x: number; y: number; z: number };
  fixturePoint: { x: number; y: number; z: number };
  estimatedSupportCenter: { x: number; y: number; z: number };
  silhouette?: Array<{ x: number; z: number }>;
}

export interface ClampSupportInfo {
  polygon: Array<[number, number]>;
  localCenter: { x: number; y: number };
  fixturePointY?: number;
  mountSurfaceLocalY?: number;
}

export interface LoadedClampData {
  fixtureCutoutsGeometry: THREE.BufferGeometry | null;
  fixturePointTopCenter: THREE.Vector3;
  supportInfo: {
    polygon: Array<[number, number]>;
    mountSurfaceLocalY: number;
    fixturePointY: number;
  } | null;
}

export interface UseClampStateReturn {
  // State
  placedClamps: PlacedClamp[];
  selectedClampId: string | null;
  showClampDebug: boolean;
  clampMinOffsets: Map<string, number>;
  clampSupportInfos: Map<string, ClampSupportInfo>;
  clampDebugPoints: ClampDebugPointsState | null;
  clampPlacementMode: ClampPlacementModeState;
  debugPerimeter: Array<{ x: number; z: number }> | null;
  debugClampSilhouette: Array<{ x: number; z: number }> | null;
  waitingForClampSectionSelection: boolean;
  
  // Setters
  setPlacedClamps: React.Dispatch<React.SetStateAction<PlacedClamp[]>>;
  setSelectedClampId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowClampDebug: React.Dispatch<React.SetStateAction<boolean>>;
  setClampMinOffsets: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setClampSupportInfos: React.Dispatch<React.SetStateAction<Map<string, ClampSupportInfo>>>;
  setClampDebugPoints: React.Dispatch<React.SetStateAction<ClampDebugPointsState | null>>;
  setClampPlacementMode: React.Dispatch<React.SetStateAction<ClampPlacementModeState>>;
  setDebugPerimeter: React.Dispatch<React.SetStateAction<Array<{ x: number; z: number }> | null>>;
  setDebugClampSilhouette: React.Dispatch<React.SetStateAction<Array<{ x: number; z: number }> | null>>;
  setWaitingForClampSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Refs
  isDraggingClampRef: React.MutableRefObject<boolean>;
  loadedClampDataRef: React.MutableRefObject<Map<string, LoadedClampData>>;
  clampDebugPointsRef: React.MutableRefObject<{
    closestBoundaryPoint: { x: number; y: number; z: number };
    fixturePoint: { x: number; y: number; z: number };
    estimatedSupportCenter: { x: number; y: number; z: number };
    silhouette: Array<{ x: number; z: number }>;
  } | null>;
  partSilhouetteRef: React.MutableRefObject<Array<{ x: number; z: number }> | null>;
  
  // Constants
  DEBUG_SHOW_PERIMETER: boolean;
  DEBUG_SHOW_CLAMP_SILHOUETTE: boolean;
}

/**
 * Hook to manage all clamp-related state in 3DScene
 */
export function useClampState(): UseClampStateReturn {
  // Clamps state
  const [placedClamps, setPlacedClamps] = useState<PlacedClamp[]>([]);
  const [selectedClampId, setSelectedClampId] = useState<string | null>(null);
  const [showClampDebug, setShowClampDebug] = useState(false);
  
  // Track minimum placement offsets for each clamp
  const [clampMinOffsets, setClampMinOffsets] = useState<Map<string, number>>(new Map());
  
  // Track clamp support info for each clamp
  const [clampSupportInfos, setClampSupportInfos] = useState<Map<string, ClampSupportInfo>>(new Map());
  
  // Debug: clamp placement debug points
  const [clampDebugPoints, setClampDebugPoints] = useState<ClampDebugPointsState | null>(null);
  
  // Clamp placement mode state
  const [clampPlacementMode, setClampPlacementMode] = useState<ClampPlacementModeState>({
    active: false,
    clampModelId: null,
    clampCategory: null,
  });
  
  // Debug perimeter/silhouette visualization
  const [debugPerimeter, setDebugPerimeter] = useState<Array<{ x: number; z: number }> | null>(null);
  const [debugClampSilhouette, setDebugClampSilhouette] = useState<Array<{ x: number; z: number }> | null>(null);
  
  // Section selection waiting state
  const [waitingForClampSectionSelection, setWaitingForClampSectionSelection] = useState(false);
  
  // Refs
  const isDraggingClampRef = useRef(false);
  const loadedClampDataRef = useRef<Map<string, LoadedClampData>>(new Map());
  const clampDebugPointsRef = useRef<{
    closestBoundaryPoint: { x: number; y: number; z: number };
    fixturePoint: { x: number; y: number; z: number };
    estimatedSupportCenter: { x: number; y: number; z: number };
    silhouette: Array<{ x: number; z: number }>;
  } | null>(null);
  const partSilhouetteRef = useRef<Array<{ x: number; z: number }> | null>(null);
  
  // Debug constants
  const DEBUG_SHOW_PERIMETER = false;
  const DEBUG_SHOW_CLAMP_SILHOUETTE = false;

  return {
    // State
    placedClamps,
    selectedClampId,
    showClampDebug,
    clampMinOffsets,
    clampSupportInfos,
    clampDebugPoints,
    clampPlacementMode,
    debugPerimeter,
    debugClampSilhouette,
    waitingForClampSectionSelection,
    
    // Setters
    setPlacedClamps,
    setSelectedClampId,
    setShowClampDebug,
    setClampMinOffsets,
    setClampSupportInfos,
    setClampDebugPoints,
    setClampPlacementMode,
    setDebugPerimeter,
    setDebugClampSilhouette,
    setWaitingForClampSectionSelection,
    
    // Refs
    isDraggingClampRef,
    loadedClampDataRef,
    clampDebugPointsRef,
    partSilhouetteRef,
    
    // Constants
    DEBUG_SHOW_PERIMETER,
    DEBUG_SHOW_CLAMP_SILHOUETTE,
  };
}
