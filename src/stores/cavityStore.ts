/**
 * Cavity Store
 * 
 * App-specific store for cavity operations in fixture design.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { CavitySettings, DEFAULT_CAVITY_SETTINGS } from '@rapidtool/cad-core';

export interface CavityState {
  /** Cavity settings */
  settings: CavitySettings;
  
  /** Whether cavity preview is generating */
  isProcessing: boolean;
  
  /** Whether cavity is being applied */
  isApplying: boolean;
  
  /** Whether a cavity preview exists */
  hasPreview: boolean;
  
  /** Whether cavity has been applied to baseplate */
  isApplied: boolean;
  
  /** Error message if any */
  error: string | null;
}

export interface CavityActions {
  /** Update cavity settings (full replacement) */
  setSettings: (settings: CavitySettings) => void;
  
  /** Update cavity settings (partial update) */
  updateSettings: (settings: Partial<CavitySettings>) => void;
  
  /** Set processing state */
  setProcessing: (isProcessing: boolean) => void;
  
  /** Set applying state */
  setApplying: (isApplying: boolean) => void;
  
  /** Set preview exists */
  setHasPreview: (hasPreview: boolean) => void;
  
  /** Set applied state */
  setApplied: (isApplied: boolean) => void;
  
  /** Set error */
  setError: (error: string | null) => void;
  
  /** Reset cavity state */
  reset: () => void;
}

export type CavityStore = CavityState & CavityActions;

const INITIAL_STATE: CavityState = {
  settings: DEFAULT_CAVITY_SETTINGS,
  isProcessing: false,
  isApplying: false,
  hasPreview: false,
  isApplied: false,
  error: null,
};

export const useCavityStore = create<CavityStore>()(
  devtools(
    immer((set) => ({
      ...INITIAL_STATE,

      setSettings: (settings) => {
        set((state) => {
          state.settings = settings;
        });
      },
      
      updateSettings: (settings) => {
        set((state) => {
          Object.assign(state.settings, settings);
        });
      },

      setProcessing: (isProcessing) => {
        set((state) => {
          state.isProcessing = isProcessing;
        });
      },

      setApplying: (isApplying) => {
        set((state) => {
          state.isApplying = isApplying;
        });
      },

      setHasPreview: (hasPreview) => {
        set((state) => {
          state.hasPreview = hasPreview;
        });
      },

      setApplied: (isApplied) => {
        set((state) => {
          state.isApplied = isApplied;
        });
      },

      setError: (error) => {
        set((state) => {
          state.error = error;
        });
      },

      reset: () => {
        set(INITIAL_STATE);
      },
    })),
    { name: 'cavity' }
  )
);

// Selectors
export const selectCavitySettings = (state: CavityStore) => state.settings;
export const selectCavityIsProcessing = (state: CavityStore) => state.isProcessing;
export const selectCavityHasPreview = (state: CavityStore) => state.hasPreview;
export const selectCavityIsApplied = (state: CavityStore) => state.isApplied;
