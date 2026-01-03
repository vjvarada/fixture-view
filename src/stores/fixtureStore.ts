/**
 * Fixture Store
 * 
 * App-specific store for fixture entity data.
 * Manages parts, supports, clamps, labels, holes, and baseplate.
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  ProcessedFile,
  AnySupport,
  PlacedClamp,
  LabelConfig,
  PlacedHole,
  BaseplateConfig,
  BaseplateSection,
} from './types';

export interface FixtureState {
  /** Project name (displayed in title bar, used for export and labels) */
  projectName: string;
  
  /** Imported parts */
  parts: ProcessedFile[];
  
  /** Part visibility map */
  partVisibility: Record<string, boolean>;
  
  /** Part colors map */
  partColors: Record<string, string>;
  
  /** Placed supports */
  supports: AnySupport[];
  
  /** Placed clamps */
  clamps: PlacedClamp[];
  
  /** Labels */
  labels: LabelConfig[];
  
  /** Mounting holes */
  holes: PlacedHole[];
  
  /** Baseplate configuration */
  baseplate: BaseplateConfig | null;
  
  /** Whether baseplate is visible */
  baseplateVisible: boolean;
}

export interface FixtureActions {
  // Project name
  setProjectName: (name: string) => void;
  
  // Parts
  addPart: (part: ProcessedFile) => void;
  removePart: (id: string) => void;
  updatePart: (id: string, data: Partial<ProcessedFile>) => void;
  setParts: (parts: ProcessedFile[]) => void;
  setPartVisibility: (id: string, visible: boolean) => void;
  setPartColor: (id: string, color: string) => void;
  
  // Supports
  addSupport: (support: AnySupport) => void;
  removeSupport: (id: string) => void;
  updateSupport: (id: string, data: Partial<AnySupport>) => void;
  setSupports: (supports: AnySupport[]) => void;
  clearSupports: () => void;
  
  // Clamps
  addClamp: (clamp: PlacedClamp) => void;
  removeClamp: (id: string) => void;
  updateClamp: (id: string, data: Partial<PlacedClamp>) => void;
  setClamps: (clamps: PlacedClamp[]) => void;
  
  // Labels
  addLabel: (label: LabelConfig) => void;
  removeLabel: (id: string) => void;
  updateLabel: (id: string, data: Partial<LabelConfig>) => void;
  
  // Holes
  addHole: (hole: PlacedHole) => void;
  removeHole: (id: string) => void;
  updateHole: (id: string, data: Partial<PlacedHole>) => void;
  
  // Baseplate
  setBaseplate: (configOrUpdater: BaseplateConfig | null | ((prev: BaseplateConfig | null) => BaseplateConfig | null)) => void;
  updateBaseplate: (data: Partial<BaseplateConfig>) => void;
  addBaseplateSection: (section: BaseplateSection) => void;
  updateBaseplateSection: (id: string, data: Partial<BaseplateSection>) => void;
  removeBaseplateSection: (id: string) => void;
  setBaseplateVisible: (visible: boolean) => void;
  
  // Bulk operations
  reset: () => void;
  getSnapshot: () => FixtureState;
  loadSnapshot: (snapshot: Partial<FixtureState>) => void;
}

export type FixtureStore = FixtureState & FixtureActions;

const INITIAL_STATE: FixtureState = {
  projectName: 'Untitled',
  parts: [],
  partVisibility: {},
  partColors: {},
  supports: [],
  clamps: [],
  labels: [],
  holes: [],
  baseplate: null,
  baseplateVisible: true,
};

export const useFixtureStore = create<FixtureStore>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        ...INITIAL_STATE,

        // Project name
        setProjectName: (name) => {
          set((state) => {
            state.projectName = name;
          });
        },

        // Parts
        addPart: (part) => {
          set((state) => {
            state.parts.push(part);
            state.partVisibility[part.id] = true;
          });
        },
        
        removePart: (id) => {
          set((state) => {
            state.parts = state.parts.filter((p) => p.id !== id);
            delete state.partVisibility[id];
            delete state.partColors[id];
          });
        },
        
        updatePart: (id, data) => {
          set((state) => {
            const idx = state.parts.findIndex((p) => p.id === id);
            if (idx !== -1) {
              Object.assign(state.parts[idx], data);
            }
          });
        },
        
        setParts: (parts) => {
          set((state) => {
            state.parts = parts;
            // Initialize visibility for new parts
            parts.forEach((p) => {
              if (!(p.id in state.partVisibility)) {
                state.partVisibility[p.id] = true;
              }
            });
          });
        },
        
        setPartVisibility: (id, visible) => {
          set((state) => {
            state.partVisibility[id] = visible;
          });
        },
        
        setPartColor: (id, color) => {
          set((state) => {
            state.partColors[id] = color;
          });
        },

        // Supports
        addSupport: (support) => {
          set((state) => {
            state.supports.push(support);
          });
        },
        
        removeSupport: (id) => {
          set((state) => {
            state.supports = state.supports.filter((s) => s.id !== id);
          });
        },
        
        updateSupport: (id, data) => {
          set((state) => {
            const idx = state.supports.findIndex((s) => s.id === id);
            if (idx !== -1) {
              Object.assign(state.supports[idx], data);
            }
          });
        },
        
        setSupports: (supports) => {
          set((state) => {
            state.supports = supports;
          });
        },
        
        clearSupports: () => {
          set((state) => {
            state.supports = [];
          });
        },

        // Clamps
        addClamp: (clamp) => {
          set((state) => {
            state.clamps.push(clamp);
          });
        },
        
        removeClamp: (id) => {
          set((state) => {
            state.clamps = state.clamps.filter((c) => c.id !== id);
          });
        },
        
        updateClamp: (id, data) => {
          set((state) => {
            const idx = state.clamps.findIndex((c) => c.id === id);
            if (idx !== -1) {
              Object.assign(state.clamps[idx], data);
            }
          });
        },
        
        setClamps: (clamps) => {
          set((state) => {
            state.clamps = clamps;
          });
        },

        // Labels
        addLabel: (label) => {
          set((state) => {
            state.labels.push(label);
          });
        },
        
        removeLabel: (id) => {
          set((state) => {
            state.labels = state.labels.filter((l) => l.id !== id);
          });
        },
        
        updateLabel: (id, data) => {
          set((state) => {
            const idx = state.labels.findIndex((l) => l.id === id);
            if (idx !== -1) {
              Object.assign(state.labels[idx], data);
            }
          });
        },

        // Holes
        addHole: (hole) => {
          set((state) => {
            state.holes.push(hole);
          });
        },
        
        removeHole: (id) => {
          set((state) => {
            state.holes = state.holes.filter((h) => h.id !== id);
          });
        },
        
        updateHole: (id, data) => {
          set((state) => {
            const idx = state.holes.findIndex((h) => h.id === id);
            if (idx !== -1) {
              Object.assign(state.holes[idx], data);
            }
          });
        },

        // Baseplate
        setBaseplate: (configOrUpdater) => {
          set((state) => {
            // Support both direct value and functional update
            if (typeof configOrUpdater === 'function') {
              state.baseplate = configOrUpdater(state.baseplate);
            } else {
              state.baseplate = configOrUpdater;
            }
          });
        },
        
        updateBaseplate: (data) => {
          set((state) => {
            if (state.baseplate) {
              Object.assign(state.baseplate, data);
            }
          });
        },
        
        addBaseplateSection: (section) => {
          set((state) => {
            if (state.baseplate) {
              if (!state.baseplate.sections) {
                state.baseplate.sections = [];
              }
              state.baseplate.sections.push(section);
            }
          });
        },
        
        updateBaseplateSection: (id, data) => {
          set((state) => {
            if (state.baseplate && state.baseplate.sections) {
              const idx = state.baseplate.sections.findIndex((s) => s.id === id);
              if (idx !== -1) {
                Object.assign(state.baseplate.sections[idx], data);
              }
            }
          });
        },
        
        removeBaseplateSection: (id) => {
          set((state) => {
            if (state.baseplate && state.baseplate.sections) {
              state.baseplate.sections = state.baseplate.sections.filter((s) => s.id !== id);
            }
          });
        },
        
        setBaseplateVisible: (visible) => {
          set((state) => {
            state.baseplateVisible = visible;
          });
        },

        // Bulk operations
        reset: () => {
          set(INITIAL_STATE);
        },
        
        getSnapshot: () => {
          const state = get();
          // Return serializable snapshot (exclude THREE.js objects)
          return {
            parts: state.parts.map((p) => ({ ...p, geometry: undefined, mesh: undefined })) as ProcessedFile[],
            partVisibility: { ...state.partVisibility },
            partColors: { ...state.partColors },
            supports: [...state.supports],
            clamps: [...state.clamps],
            labels: [...state.labels],
            holes: [...state.holes],
            baseplate: state.baseplate ? { ...state.baseplate } : null,
            baseplateVisible: state.baseplateVisible,
          };
        },
        
        loadSnapshot: (snapshot) => {
          set((state) => {
            if (snapshot.projectName !== undefined) state.projectName = snapshot.projectName;
            if (snapshot.parts) state.parts = snapshot.parts;
            if (snapshot.partVisibility) state.partVisibility = snapshot.partVisibility;
            if (snapshot.partColors) state.partColors = snapshot.partColors;
            if (snapshot.supports) state.supports = snapshot.supports;
            if (snapshot.clamps) state.clamps = snapshot.clamps;
            if (snapshot.labels) state.labels = snapshot.labels;
            if (snapshot.holes) state.holes = snapshot.holes;
            if (snapshot.baseplate !== undefined) state.baseplate = snapshot.baseplate;
            if (snapshot.baseplateVisible !== undefined) state.baseplateVisible = snapshot.baseplateVisible;
          });
        },
      }))
    ),
    { name: 'fixture' }
  )
);

// Selectors
export const selectProjectName = (state: FixtureStore) => state.projectName;
export const selectParts = (state: FixtureStore) => state.parts;
export const selectSupports = (state: FixtureStore) => state.supports;
export const selectClamps = (state: FixtureStore) => state.clamps;
export const selectLabels = (state: FixtureStore) => state.labels;
export const selectHoles = (state: FixtureStore) => state.holes;
export const selectBaseplate = (state: FixtureStore) => state.baseplate;
export const selectBaseplateVisible = (state: FixtureStore) => state.baseplateVisible;
