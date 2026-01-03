/**
 * Placement Hooks for Fixture App
 * 
 * Provides hooks for placement mode states (supports, holes, baseplate drawing).
 */

import { useCallback } from 'react';
import { usePlacementStore } from '@/stores';
import type { SupportType, HoleConfig, BaseplateSection } from '@/stores/types';

/**
 * Hook for support placement mode
 * Replaces: const [isPlacementMode, setIsPlacementMode] = useState(false)
 */
export function useSupportPlacementMode() {
  const isActive = usePlacementStore((state) => state.support.isActive);
  const start = usePlacementStore((state) => state.startSupportPlacement);
  const cancel = usePlacementStore((state) => state.cancelSupportPlacement);
  
  // Backward compatible setter
  const setIsPlacementMode = useCallback((value: boolean) => {
    if (value) {
      start();
    } else {
      cancel();
    }
  }, [start, cancel]);
  
  return [isActive, setIsPlacementMode, { start, cancel }] as const;
}

/**
 * Hook for selected support type
 * Replaces: const [selectedSupportType, setSelectedSupportType] = useState<SupportType>('cylindrical')
 */
export function useSelectedSupportType() {
  const selectedType = usePlacementStore((state) => state.support.selectedType);
  const setType = usePlacementStore((state) => state.setSupportType);
  
  return [selectedType, setType] as const;
}

/**
 * Hook for hole placement mode
 * Replaces: const [isHolePlacementMode, setIsHolePlacementMode] = useState(false)
 */
export function useHolePlacementMode() {
  const isActive = usePlacementStore((state) => state.hole.isActive);
  const start = usePlacementStore((state) => state.startHolePlacement);
  const cancel = usePlacementStore((state) => state.cancelHolePlacement);
  
  // Backward compatible setter
  const setIsHolePlacementMode = useCallback((value: boolean) => {
    if (!value) {
      cancel();
    }
    // For true, use start() with config
  }, [cancel]);
  
  return [isActive, setIsHolePlacementMode, { start, cancel }] as const;
}

/**
 * Hook for pending hole config
 * Replaces: const [pendingHoleConfig, setPendingHoleConfig] = useState<HoleConfig | null>(null)
 */
export function usePendingHoleConfig() {
  const pendingConfig = usePlacementStore((state) => state.hole.pendingConfig);
  const startPlacement = usePlacementStore((state) => state.startHolePlacement);
  const cancelPlacement = usePlacementStore((state) => state.cancelHolePlacement);
  
  // Backward compatible setter
  const setPendingHoleConfig = useCallback((config: HoleConfig | null) => {
    if (config) {
      startPlacement(config);
    } else {
      cancelPlacement();
    }
  }, [startPlacement, cancelPlacement]);
  
  return [pendingConfig, setPendingHoleConfig] as const;
}

/**
 * Hook for baseplate drawing mode
 * Replaces: const [isBaseplateDrawingMode, setIsBaseplateDrawingMode] = useState(false)
 */
export function useBaseplateDrawingMode() {
  const isDrawingMode = usePlacementStore((state) => state.baseplate.isDrawingMode);
  const start = usePlacementStore((state) => state.startBaseplateDrawing);
  const stop = usePlacementStore((state) => state.stopBaseplateDrawing);
  
  // Backward compatible setter
  const setIsBaseplateDrawingMode = useCallback((value: boolean) => {
    if (value) {
      start();
    } else {
      stop();
    }
  }, [start, stop]);
  
  return [isDrawingMode, setIsBaseplateDrawingMode, { start, stop }] as const;
}

/**
 * Hook for drawn baseplate sections
 * Replaces: const [drawnBaseplateSections, setDrawnBaseplateSections] = useState<Array<...>>([])
 */
export function useDrawnBaseplateSections() {
  const sections = usePlacementStore((state) => state.baseplate.drawnSections);
  const addSection = usePlacementStore((state) => state.addDrawnSection);
  const removeSection = usePlacementStore((state) => state.removeDrawnSection);
  const clearSections = usePlacementStore((state) => state.clearDrawnSections);
  
  // Backward compatible setter
  const setDrawnBaseplateSections = useCallback((
    value: BaseplateSection[] | ((prev: BaseplateSection[]) => BaseplateSection[])
  ) => {
    if (typeof value === 'function') {
      // For function updates, we need to get current state and apply
      const current = usePlacementStore.getState().baseplate.drawnSections;
      const newSections = value(current);
      // Clear and re-add
      clearSections();
      newSections.forEach(s => addSection(s));
    } else {
      clearSections();
      value.forEach(s => addSection(s));
    }
  }, [addSection, clearSections]);
  
  return [sections, setDrawnBaseplateSections, { addSection, removeSection, clearSections }] as const;
}

/**
 * Hook for baseplate params
 * Replaces: const [currentBaseplateParams, setCurrentBaseplateParams] = useState<{ padding: number; height: number }>({ padding: 5, height: 4 })
 */
export function useBaseplateParams() {
  const params = usePlacementStore((state) => state.baseplate.params);
  const setParams = usePlacementStore((state) => state.setBaseplateParams);
  
  return [params, setParams] as const;
}

/**
 * Hook to check if any placement mode is active
 */
export function useIsAnyPlacementActive() {
  const supportActive = usePlacementStore((state) => state.support.isActive);
  const holeActive = usePlacementStore((state) => state.hole.isActive);
  const baseplateDrawing = usePlacementStore((state) => state.baseplate.isDrawingMode);
  
  return supportActive || holeActive || baseplateDrawing;
}

/**
 * Hook for full placement store
 */
export function usePlacement() {
  return usePlacementStore();
}
