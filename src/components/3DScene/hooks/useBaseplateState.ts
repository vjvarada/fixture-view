/**
 * useBaseplateState - Hook for managing baseplate configuration and state
 * Extracted from 3DScene.tsx for modularity
 */
import { useState, useRef } from 'react';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate';

export interface UseBaseplateStateReturn {
  // State
  basePlate: BasePlateConfig | null;
  isMultiSectionDrawingMode: boolean;
  drawnSections: BasePlateSection[];
  multiSectionPadding: number;
  baseTopY: number;
  selectedBasePlateSectionId: string | null;
  editingBasePlateSectionId: string | null;
  waitingForSectionSelection: boolean;
  
  // Setters
  setBasePlate: React.Dispatch<React.SetStateAction<BasePlateConfig | null>>;
  setIsMultiSectionDrawingMode: React.Dispatch<React.SetStateAction<boolean>>;
  setDrawnSections: React.Dispatch<React.SetStateAction<BasePlateSection[]>>;
  setMultiSectionPadding: React.Dispatch<React.SetStateAction<number>>;
  setBaseTopY: React.Dispatch<React.SetStateAction<number>>;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  setWaitingForSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Refs
  basePlateMeshRef: React.RefObject<THREE.Mesh>;
  isDraggingBasePlateSectionRef: React.MutableRefObject<boolean>;
  
  // Computed
  isMultiSectionBaseplate: boolean;
}

import * as THREE from 'three';

/**
 * Hook to manage all baseplate-related state in 3DScene
 */
export function useBaseplateState(): UseBaseplateStateReturn {
  // Baseplate state
  const [basePlate, setBasePlate] = useState<BasePlateConfig | null>(null);
  const [isMultiSectionDrawingMode, setIsMultiSectionDrawingMode] = useState(false);
  const [drawnSections, setDrawnSections] = useState<BasePlateSection[]>([]);
  const [multiSectionPadding, setMultiSectionPadding] = useState(0);
  const [baseTopY, setBaseTopY] = useState<number>(0);
  
  // Section selection state
  const [selectedBasePlateSectionId, setSelectedBasePlateSectionId] = useState<string | null>(null);
  const [editingBasePlateSectionId, setEditingBasePlateSectionId] = useState<string | null>(null);
  const [waitingForSectionSelection, setWaitingForSectionSelection] = useState(false);
  
  // Refs
  const basePlateMeshRef = useRef<THREE.Mesh>(null);
  const isDraggingBasePlateSectionRef = useRef(false);
  
  // Computed
  const isMultiSectionBaseplate = drawnSections.length > 0;

  return {
    // State
    basePlate,
    isMultiSectionDrawingMode,
    drawnSections,
    multiSectionPadding,
    baseTopY,
    selectedBasePlateSectionId,
    editingBasePlateSectionId,
    waitingForSectionSelection,
    
    // Setters
    setBasePlate,
    setIsMultiSectionDrawingMode,
    setDrawnSections,
    setMultiSectionPadding,
    setBaseTopY,
    setSelectedBasePlateSectionId,
    setEditingBasePlateSectionId,
    setWaitingForSectionSelection,
    
    // Refs
    basePlateMeshRef,
    isDraggingBasePlateSectionRef,
    
    // Computed
    isMultiSectionBaseplate,
  };
}
