/**
 * Selection Hooks for Fixture App
 * 
 * Provides backward-compatible hooks for migrating from useState to useSelectionStore.
 * These hooks provide the same interface as the old useState-based selection.
 */

import { useCallback } from 'react';
import { useSelectionStore } from '@rapidtool/cad-ui';

// Selection categories used in fixture app
export const SELECTION_CATEGORIES = {
  PART: 'part',
  SUPPORT: 'support',
  CLAMP: 'clamp',
  LABEL: 'label',
  HOLE: 'hole',
  BASEPLATE_SECTION: 'baseplate-section',
} as const;

type SelectionCategory = typeof SELECTION_CATEGORIES[keyof typeof SELECTION_CATEGORIES];

/**
 * Hook to get selected ID for a specific category
 * Replaces: const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
 */
export function useSelectedId(category: SelectionCategory) {
  const selected = useSelectionStore((state) => state.selected);
  const select = useSelectionStore((state) => state.select);
  
  const selectedId = selected?.category === category ? selected.id : null;
  
  const setSelectedId = useCallback((id: string | null) => {
    if (id) {
      select(category, id);
    } else {
      // Clear if this category is currently selected
      if (selected?.category === category) {
        select(category, null);
      }
    }
  }, [category, select, selected?.category]);
  
  return [selectedId, setSelectedId] as const;
}

/**
 * Hook for part selection
 * Replaces: const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
 */
export function useSelectedPart() {
  return useSelectedId(SELECTION_CATEGORIES.PART);
}

/**
 * Hook for support selection
 * Replaces: const [selectedSupportId, setSelectedSupportId] = useState<string | null>(null)
 */
export function useSelectedSupport() {
  return useSelectedId(SELECTION_CATEGORIES.SUPPORT);
}

/**
 * Hook for clamp selection  
 * Replaces: const [selectedClampId, setSelectedClampId] = useState<string | null>(null)
 */
export function useSelectedClamp() {
  return useSelectedId(SELECTION_CATEGORIES.CLAMP);
}

/**
 * Hook for label selection
 * Replaces: const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null)
 */
export function useSelectedLabel() {
  return useSelectedId(SELECTION_CATEGORIES.LABEL);
}

/**
 * Hook for hole selection
 * Replaces: const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null)
 */
export function useSelectedHole() {
  return useSelectedId(SELECTION_CATEGORIES.HOLE);
}

/**
 * Hook for baseplate section selection
 * Replaces: const [selectedBasePlateSectionId, setSelectedBasePlateSectionId] = useState<string | null>(null)
 */
export function useSelectedBaseplateSection() {
  return useSelectedId(SELECTION_CATEGORIES.BASEPLATE_SECTION);
}

/**
 * Hook to check what type of item is currently selected
 * Useful for conditional rendering based on selection type
 */
export function useSelectionType() {
  const selected = useSelectionStore((state) => state.selected);
  return selected?.category as SelectionCategory | null;
}

/**
 * Hook to clear all selection
 */
export function useClearSelection() {
  const clear = useSelectionStore((state) => state.clear);
  return clear;
}

/**
 * Hook for the full selection store (for advanced use cases)
 */
export function useSelection() {
  return useSelectionStore();
}
