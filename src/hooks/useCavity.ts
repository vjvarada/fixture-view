/**
 * Cavity Hooks for Fixture App
 * 
 * Provides hooks for cavity operation states.
 */

import { useCallback } from 'react';
import { useCavityStore } from '@/stores';
import type { CavitySettings } from '@rapidtool/cad-core';

/**
 * Hook for cavity clearance
 * Replaces: const [cavityClearance, setCavityClearance] = useState(0.5)
 */
export function useCavityClearance() {
  const clearance = useCavityStore((state) => state.clearance);
  const setClearance = useCavityStore((state) => state.setClearance);
  
  return [clearance, setClearance] as const;
}

/**
 * Hook for cavity settings
 * Replaces: const [cavitySettings, setCavitySettings] = useState<CavitySettings>(DEFAULT_CAVITY_SETTINGS)
 */
export function useCavitySettings() {
  const settings = useCavityStore((state) => state.settings);
  const setSettings = useCavityStore((state) => state.setSettings);
  const updateSettings = useCavityStore((state) => state.updateSettings);
  
  // Backward compatible setter that handles both full replacement and partial updates
  const setCavitySettings = useCallback((
    value: CavitySettings | ((prev: CavitySettings) => CavitySettings)
  ) => {
    if (typeof value === 'function') {
      const current = useCavityStore.getState().settings;
      setSettings(value(current));
    } else {
      setSettings(value);
    }
  }, [setSettings]);
  
  return [settings, setCavitySettings, { updateSettings }] as const;
}

/**
 * Hook for cavity processing state
 * Replaces: const [isCavityProcessing, setIsCavityProcessing] = useState(false)
 */
export function useIsCavityProcessing() {
  const isProcessing = useCavityStore((state) => state.isProcessing);
  const setProcessing = useCavityStore((state) => state.setProcessing);
  
  return [isProcessing, setProcessing] as const;
}

/**
 * Hook for applying cavity state
 * Replaces: const [isApplyingCavity, setIsApplyingCavity] = useState(false)
 */
export function useIsApplyingCavity() {
  const isApplying = useCavityStore((state) => state.isApplying);
  const setApplying = useCavityStore((state) => state.setApplying);
  
  return [isApplying, setApplying] as const;
}

/**
 * Hook for cavity preview state
 * Replaces: const [hasCavityPreview, setHasCavityPreview] = useState(false)
 */
export function useHasCavityPreview() {
  const hasPreview = useCavityStore((state) => state.hasPreview);
  const setHasPreview = useCavityStore((state) => state.setHasPreview);
  
  return [hasPreview, setHasPreview] as const;
}

/**
 * Hook for cavity applied state
 * Replaces: const [isCavityApplied, setIsCavityApplied] = useState(false)
 */
export function useIsCavityApplied() {
  const isApplied = useCavityStore((state) => state.isApplied);
  const setApplied = useCavityStore((state) => state.setApplied);
  
  return [isApplied, setApplied] as const;
}

/**
 * Hook to reset cavity state
 */
export function useResetCavity() {
  return useCavityStore((state) => state.reset);
}

/**
 * Hook for full cavity store
 */
export function useCavity() {
  return useCavityStore();
}
