/**
 * Fixture Data Hooks for Fixture App
 * 
 * Provides hooks for fixture entity data (parts, supports, clamps, labels, holes, baseplate).
 */

import { useCallback } from 'react';
import { useFixtureStore } from '@/stores';
import type { 
  ProcessedFile, 
  AnySupport, 
  PlacedClamp, 
  LabelConfig, 
  PlacedHole,
  BaseplateConfig 
} from '@/stores/types';

// ─────────────────────────────────────────────────────────────────────────────
// Project Name
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for project name
 * Used for title bar display, default label text, and export filename
 */
export function useProjectName() {
  const projectName = useFixtureStore((state) => state.projectName);
  const setProjectName = useFixtureStore((state) => state.setProjectName);
  
  return [projectName, setProjectName] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for imported parts
 * Replaces: const [importedParts, setImportedParts] = useState<ProcessedFile[]>([])
 */
export function useImportedParts() {
  const parts = useFixtureStore((state) => state.parts);
  const setParts = useFixtureStore((state) => state.setParts);
  const addPart = useFixtureStore((state) => state.addPart);
  const removePart = useFixtureStore((state) => state.removePart);
  const updatePart = useFixtureStore((state) => state.updatePart);
  
  // Backward compatible setter
  const setImportedParts = useCallback((
    value: ProcessedFile[] | ((prev: ProcessedFile[]) => ProcessedFile[])
  ) => {
    if (typeof value === 'function') {
      const current = useFixtureStore.getState().parts;
      setParts(value(current));
    } else {
      setParts(value);
    }
  }, [setParts]);
  
  return [parts, setImportedParts, { addPart, removePart, updatePart }] as const;
}

/**
 * Hook for part visibility
 * Replaces: const [partVisibility, setPartVisibility] = useState<Map<string, boolean>>(new Map())
 */
export function usePartVisibility() {
  const visibility = useFixtureStore((state) => state.partVisibility);
  const setVisibility = useFixtureStore((state) => state.setPartVisibility);
  
  // Convert Record to Map for backward compatibility
  const visibilityMap = new Map(Object.entries(visibility));
  
  // Backward compatible setter that handles Map
  const setPartVisibility = useCallback((
    value: Map<string, boolean> | ((prev: Map<string, boolean>) => Map<string, boolean>)
  ) => {
    if (typeof value === 'function') {
      const currentMap = new Map(Object.entries(useFixtureStore.getState().partVisibility));
      const newMap = value(currentMap);
      // Update each entry
      newMap.forEach((visible, id) => setVisibility(id, visible));
    } else {
      value.forEach((visible, id) => setVisibility(id, visible));
    }
  }, [setVisibility]);
  
  return [visibilityMap, setPartVisibility, setVisibility] as const;
}

/**
 * Hook for model colors
 * Replaces: const [modelColors, setModelColors] = useState<Map<string, string>>(new Map())
 */
export function useModelColors() {
  const colors = useFixtureStore((state) => state.partColors);
  const setColor = useFixtureStore((state) => state.setPartColor);
  
  // Convert Record to Map for backward compatibility
  const colorsMap = new Map(Object.entries(colors));
  
  // Backward compatible setter
  const setModelColors = useCallback((
    value: Map<string, string> | ((prev: Map<string, string>) => Map<string, string>)
  ) => {
    if (typeof value === 'function') {
      const currentMap = new Map(Object.entries(useFixtureStore.getState().partColors));
      const newMap = value(currentMap);
      newMap.forEach((color, id) => setColor(id, color));
    } else {
      value.forEach((color, id) => setColor(id, color));
    }
  }, [setColor]);
  
  return [colorsMap, setModelColors, setColor] as const;
}

/**
 * Hook for baseplate visibility
 * Replaces: const [baseplateVisible, setBaseplateVisible] = useState(true)
 */
export function useBaseplateVisible() {
  const visible = useFixtureStore((state) => state.baseplateVisible);
  const setVisible = useFixtureStore((state) => state.setBaseplateVisible);
  
  return [visible, setVisible] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for supports
 * Replaces: const [supports, setSupports] = useState<AnySupport[]>([])
 */
export function useSupports() {
  const supports = useFixtureStore((state) => state.supports);
  const setSupports = useFixtureStore((state) => state.setSupports);
  const addSupport = useFixtureStore((state) => state.addSupport);
  const removeSupport = useFixtureStore((state) => state.removeSupport);
  const updateSupport = useFixtureStore((state) => state.updateSupport);
  const clearSupports = useFixtureStore((state) => state.clearSupports);
  
  // Backward compatible setter
  const setSupportsCompat = useCallback((
    value: AnySupport[] | ((prev: AnySupport[]) => AnySupport[])
  ) => {
    if (typeof value === 'function') {
      const current = useFixtureStore.getState().supports;
      setSupports(value(current));
    } else {
      setSupports(value);
    }
  }, [setSupports]);
  
  return [supports, setSupportsCompat, { addSupport, removeSupport, updateSupport, clearSupports }] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for labels
 * Replaces: const [labels, setLabels] = useState<Array<{...}>>([])
 */
export function useLabels() {
  const labels = useFixtureStore((state) => state.labels);
  const addLabel = useFixtureStore((state) => state.addLabel);
  const removeLabel = useFixtureStore((state) => state.removeLabel);
  const updateLabel = useFixtureStore((state) => state.updateLabel);
  
  // Backward compatible setter
  const setLabels = useCallback((
    value: LabelConfig[] | ((prev: LabelConfig[]) => LabelConfig[])
  ) => {
    const store = useFixtureStore.getState();
    if (typeof value === 'function') {
      const newLabels = value(store.labels);
      // Clear existing and add new
      store.labels.forEach(l => store.removeLabel(l.id));
      newLabels.forEach(l => store.addLabel(l));
    } else {
      store.labels.forEach(l => store.removeLabel(l.id));
      value.forEach(l => store.addLabel(l));
    }
  }, []);
  
  return [labels, setLabels, { addLabel, removeLabel, updateLabel }] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clamps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for clamps
 * Replaces: const [clamps, setClamps] = useState<PlacedClamp[]>([])
 */
export function useClamps() {
  const clamps = useFixtureStore((state) => state.clamps);
  const setClamps = useFixtureStore((state) => state.setClamps);
  const addClamp = useFixtureStore((state) => state.addClamp);
  const removeClamp = useFixtureStore((state) => state.removeClamp);
  const updateClamp = useFixtureStore((state) => state.updateClamp);
  
  // Backward compatible setter
  const setClampsCompat = useCallback((
    value: PlacedClamp[] | ((prev: PlacedClamp[]) => PlacedClamp[])
  ) => {
    if (typeof value === 'function') {
      const current = useFixtureStore.getState().clamps;
      setClamps(value(current));
    } else {
      setClamps(value);
    }
  }, [setClamps]);
  
  return [clamps, setClampsCompat, { addClamp, removeClamp, updateClamp }] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mounting Holes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for mounting holes
 * Replaces: const [mountingHoles, setMountingHoles] = useState<PlacedHole[]>([])
 */
export function useMountingHoles() {
  const holes = useFixtureStore((state) => state.holes);
  const addHole = useFixtureStore((state) => state.addHole);
  const removeHole = useFixtureStore((state) => state.removeHole);
  const updateHole = useFixtureStore((state) => state.updateHole);
  
  // Backward compatible setter
  const setMountingHoles = useCallback((
    value: PlacedHole[] | ((prev: PlacedHole[]) => PlacedHole[])
  ) => {
    const store = useFixtureStore.getState();
    if (typeof value === 'function') {
      const newHoles = value(store.holes);
      // Clear existing and add new
      store.holes.forEach(h => store.removeHole(h.id));
      newHoles.forEach(h => store.addHole(h));
    } else {
      store.holes.forEach(h => store.removeHole(h.id));
      value.forEach(h => store.addHole(h));
    }
  }, []);
  
  return [holes, setMountingHoles, { addHole, removeHole, updateHole }] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Baseplate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for current baseplate
 * Replaces: const [currentBaseplate, setCurrentBaseplate] = useState<{...} | null>(null)
 */
export function useCurrentBaseplate() {
  const baseplate = useFixtureStore((state) => state.baseplate);
  const setBaseplate = useFixtureStore((state) => state.setBaseplate);
  const updateBaseplate = useFixtureStore((state) => state.updateBaseplate);
  const addSection = useFixtureStore((state) => state.addBaseplateSection);
  const updateSection = useFixtureStore((state) => state.updateBaseplateSection);
  const removeSection = useFixtureStore((state) => state.removeBaseplateSection);
  
  return [baseplate, setBaseplate, { updateBaseplate, addSection, updateSection, removeSection }] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to reset all fixture data
 */
export function useResetFixture() {
  return useFixtureStore((state) => state.reset);
}

/**
 * Hook for fixture snapshots (undo/redo support)
 */
export function useFixtureSnapshot() {
  const getSnapshot = useFixtureStore((state) => state.getSnapshot);
  const loadSnapshot = useFixtureStore((state) => state.loadSnapshot);
  
  return { getSnapshot, loadSnapshot };
}

/**
 * Hook for full fixture store
 */
export function useFixture() {
  return useFixtureStore();
}
