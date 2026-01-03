/**
 * Dialog Hooks for Fixture App
 * 
 * Provides hooks for dialog state management.
 */

import { useCallback } from 'react';
import { useDialogStore } from '@/stores';

/**
 * Hook for units dialog state
 * Replaces: const [isUnitsDialogOpen, setIsUnitsDialogOpen] = useState(false)
 */
export function useUnitsDialog() {
  const isOpen = useDialogStore((state) => state.unitsDialog.isOpen);
  const open = useDialogStore((state) => state.openUnitsDialog);
  const close = useDialogStore((state) => state.closeUnitsDialog);
  
  // Backward compatible setter
  const setIsOpen = useCallback((value: boolean) => {
    if (value) {
      open();
    } else {
      close();
    }
  }, [open, close]);
  
  return [isOpen, setIsOpen, { open, close }] as const;
}

/**
 * Hook for optimization dialog state
 * Replaces: const [isOptimizationDialogOpen, setIsOptimizationDialogOpen] = useState(false)
 */
export function useOptimizationDialog() {
  const isOpen = useDialogStore((state) => state.optimizationDialog.isOpen);
  const open = useDialogStore((state) => state.openOptimizationDialog);
  const close = useDialogStore((state) => state.closeOptimizationDialog);
  
  // Backward compatible setter
  const setIsOpen = useCallback((value: boolean) => {
    if (value) {
      open();
    } else {
      close();
    }
  }, [open, close]);
  
  return [isOpen, setIsOpen, { open, close }] as const;
}

/**
 * Hook for export dialog state
 */
export function useExportDialog() {
  const exportDialog = useDialogStore((state) => state.exportDialog);
  const open = useDialogStore((state) => state.openExportDialog);
  const close = useDialogStore((state) => state.closeExportDialog);
  
  return { isOpen: exportDialog.isOpen, format: exportDialog.format, open, close };
}

/**
 * Hook for baseplate config dialog state
 */
export function useBaseplateConfigDialog() {
  const isOpen = useDialogStore((state) => state.baseplateConfigDialog.isOpen);
  const open = useDialogStore((state) => state.openBaseplateConfigDialog);
  const close = useDialogStore((state) => state.closeBaseplateConfigDialog);
  
  return { isOpen, open, close };
}

/**
 * Hook for confirmation dialog
 */
export function useConfirmDialog() {
  const dialog = useDialogStore((state) => state.confirmDialog);
  const open = useDialogStore((state) => state.openConfirmDialog);
  const close = useDialogStore((state) => state.closeConfirmDialog);
  
  return { ...dialog, open, close };
}

/**
 * Hook for the full dialog store
 */
export function useDialogs() {
  return useDialogStore();
}
