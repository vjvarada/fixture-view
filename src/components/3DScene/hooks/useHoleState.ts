/**
 * useHoleState - Hook for managing mounting hole placement and state
 * Extracted from 3DScene.tsx for modularity
 */
import { useState, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedHole, HoleConfig } from '@/features/holes';

export interface HolePlacementModeState {
  active: boolean;
  config: HoleConfig | null;
  depth: number;
}

export interface UseHoleStateReturn {
  // State
  mountingHoles: PlacedHole[];
  selectedHoleId: string | null;
  editingHoleId: string | null;
  isDraggingHole: boolean;
  holePlacementMode: HolePlacementModeState;
  holeSnapEnabled: boolean;
  baseplateWithHoles: THREE.BufferGeometry | null;
  holeCSGProcessing: boolean;
  holeCSGTrigger: number;
  waitingForHoleSectionSelection: boolean;
  pendingHoleConfig: { config: HoleConfig; depth: number } | null;
  
  // Setters
  setMountingHoles: React.Dispatch<React.SetStateAction<PlacedHole[]>>;
  setSelectedHoleId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingHoleId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsDraggingHole: React.Dispatch<React.SetStateAction<boolean>>;
  setHolePlacementMode: React.Dispatch<React.SetStateAction<HolePlacementModeState>>;
  setHoleSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setBaseplateWithHoles: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  setHoleCSGProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setHoleCSGTrigger: React.Dispatch<React.SetStateAction<number>>;
  setWaitingForHoleSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingHoleConfig: React.Dispatch<React.SetStateAction<{ config: HoleConfig; depth: number } | null>>;
  
  // Refs
  isDraggingHoleRef: React.MutableRefObject<boolean>;
  mountingHolesRef: React.MutableRefObject<PlacedHole[]>;
  originalBaseplateGeoRef: React.MutableRefObject<THREE.BufferGeometry | null>;
  
  // Actions
  triggerHoleCSGUpdate: () => void;
}

/**
 * Hook to manage all mounting hole-related state in 3DScene
 */
export function useHoleState(): UseHoleStateReturn {
  // Mounting holes state
  const [mountingHoles, setMountingHoles] = useState<PlacedHole[]>([]);
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null);
  const [editingHoleId, setEditingHoleId] = useState<string | null>(null);
  const [isDraggingHole, setIsDraggingHole] = useState(false);
  
  // Hole placement mode
  const [holePlacementMode, setHolePlacementMode] = useState<HolePlacementModeState>({
    active: false,
    config: null,
    depth: 20,
  });
  const [holeSnapEnabled, setHoleSnapEnabled] = useState(true);
  
  // Section selection waiting state
  const [waitingForHoleSectionSelection, setWaitingForHoleSectionSelection] = useState(false);
  const [pendingHoleConfig, setPendingHoleConfig] = useState<{ config: HoleConfig; depth: number } | null>(null);
  
  // CSG state for holes
  const [baseplateWithHoles, setBaseplateWithHoles] = useState<THREE.BufferGeometry | null>(null);
  const [holeCSGProcessing, setHoleCSGProcessing] = useState(false);
  const [holeCSGTrigger, setHoleCSGTrigger] = useState(0);
  
  // Refs
  const isDraggingHoleRef = useRef(false);
  const mountingHolesRef = useRef<PlacedHole[]>([]);
  mountingHolesRef.current = mountingHoles;
  const originalBaseplateGeoRef = useRef<THREE.BufferGeometry | null>(null);
  
  // Action to trigger CSG update
  const triggerHoleCSGUpdate = () => {
    setHoleCSGTrigger(prev => prev + 1);
  };

  return {
    // State
    mountingHoles,
    selectedHoleId,
    editingHoleId,
    isDraggingHole,
    holePlacementMode,
    holeSnapEnabled,
    baseplateWithHoles,
    holeCSGProcessing,
    holeCSGTrigger,
    waitingForHoleSectionSelection,
    pendingHoleConfig,
    
    // Setters
    setMountingHoles,
    setSelectedHoleId,
    setEditingHoleId,
    setIsDraggingHole,
    setHolePlacementMode,
    setHoleSnapEnabled,
    setBaseplateWithHoles,
    setHoleCSGProcessing,
    setHoleCSGTrigger,
    setWaitingForHoleSectionSelection,
    setPendingHoleConfig,
    
    // Refs
    isDraggingHoleRef,
    mountingHolesRef,
    originalBaseplateGeoRef,
    
    // Actions
    triggerHoleCSGUpdate,
  };
}
