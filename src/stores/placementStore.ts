/**
 * Placement Store
 * 
 * App-specific store for placement modes (supports, holes, etc.)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { SupportType, HoleConfig, BaseplateSection } from './types';

export interface PlacementState {
  /** Support placement mode */
  support: {
    isActive: boolean;
    selectedType: SupportType;
  };
  
  /** Hole placement mode */
  hole: {
    isActive: boolean;
    pendingConfig: HoleConfig | null;
  };
  
  /** Baseplate drawing mode */
  baseplate: {
    isDrawingMode: boolean;
    params: { padding: number; height: number };
    drawnSections: BaseplateSection[];
  };
}

export interface PlacementActions {
  // Support placement
  startSupportPlacement: (type?: SupportType) => void;
  cancelSupportPlacement: () => void;
  setSupportType: (type: SupportType) => void;
  
  // Hole placement
  startHolePlacement: (config: HoleConfig) => void;
  cancelHolePlacement: () => void;
  
  // Baseplate drawing
  startBaseplateDrawing: (params?: { padding: number; height: number }) => void;
  stopBaseplateDrawing: () => void;
  setBaseplateParams: (params: { padding: number; height: number }) => void;
  addDrawnSection: (section: BaseplateSection) => void;
  removeDrawnSection: (id: string) => void;
  clearDrawnSections: () => void;
  
  // Reset all
  resetAll: () => void;
}

export type PlacementStore = PlacementState & PlacementActions;

const INITIAL_STATE: PlacementState = {
  support: {
    isActive: false,
    selectedType: 'cylindrical',
  },
  hole: {
    isActive: false,
    pendingConfig: null,
  },
  baseplate: {
    isDrawingMode: false,
    params: { padding: 5, height: 4 },
    drawnSections: [],
  },
};

export const usePlacementStore = create<PlacementStore>()(
  devtools(
    immer((set) => ({
      ...INITIAL_STATE,

      // Support placement
      startSupportPlacement: (type = 'cylindrical') => {
        set((state) => {
          state.support.isActive = true;
          state.support.selectedType = type;
          // Cancel other placements
          state.hole.isActive = false;
        });
      },

      cancelSupportPlacement: () => {
        set((state) => {
          state.support.isActive = false;
        });
      },

      setSupportType: (type) => {
        set((state) => {
          state.support.selectedType = type;
        });
      },

      // Hole placement
      startHolePlacement: (config) => {
        set((state) => {
          state.hole.isActive = true;
          state.hole.pendingConfig = config;
          // Cancel other placements
          state.support.isActive = false;
        });
      },

      cancelHolePlacement: () => {
        set((state) => {
          state.hole.isActive = false;
          state.hole.pendingConfig = null;
        });
      },

      // Baseplate drawing
      startBaseplateDrawing: (params) => {
        set((state) => {
          state.baseplate.isDrawingMode = true;
          if (params) {
            state.baseplate.params = params;
          }
        });
      },

      stopBaseplateDrawing: () => {
        set((state) => {
          state.baseplate.isDrawingMode = false;
        });
      },

      setBaseplateParams: (params) => {
        set((state) => {
          state.baseplate.params = params;
        });
      },

      addDrawnSection: (section) => {
        set((state) => {
          state.baseplate.drawnSections.push(section);
        });
      },

      removeDrawnSection: (id) => {
        set((state) => {
          state.baseplate.drawnSections = state.baseplate.drawnSections.filter(
            (s) => s.id !== id
          );
        });
      },

      clearDrawnSections: () => {
        set((state) => {
          state.baseplate.drawnSections = [];
        });
      },

      // Reset all
      resetAll: () => {
        set(INITIAL_STATE);
      },
    })),
    { name: 'placement' }
  )
);

// Selectors
export const selectSupportPlacement = (state: PlacementStore) => state.support;
export const selectHolePlacement = (state: PlacementStore) => state.hole;
export const selectBaseplatePlacement = (state: PlacementStore) => state.baseplate;
export const selectIsAnyPlacementActive = (state: PlacementStore) =>
  state.support.isActive || state.hole.isActive;
