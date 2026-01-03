/**
 * Dialog Store
 * 
 * App-specific store for modal dialog states.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface DialogState {
  /** Units confirmation dialog */
  unitsDialog: {
    isOpen: boolean;
    pendingFileId?: string;
  };
  
  /** Mesh optimization dialog */
  optimizationDialog: {
    isOpen: boolean;
  };
  
  /** Export options dialog */
  exportDialog: {
    isOpen: boolean;
    format?: 'stl' | 'step' | 'obj';
  };
  
  /** Baseplate configuration dialog */
  baseplateConfigDialog: {
    isOpen: boolean;
  };
  
  /** Confirmation dialog (generic) */
  confirmDialog: {
    isOpen: boolean;
    title?: string;
    message?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  };
}

export interface DialogActions {
  // Units dialog
  openUnitsDialog: (pendingFileId?: string) => void;
  closeUnitsDialog: () => void;
  
  // Optimization dialog
  openOptimizationDialog: () => void;
  closeOptimizationDialog: () => void;
  
  // Export dialog
  openExportDialog: (format?: DialogState['exportDialog']['format']) => void;
  closeExportDialog: () => void;
  
  // Baseplate config dialog
  openBaseplateConfigDialog: () => void;
  closeBaseplateConfigDialog: () => void;
  
  // Confirm dialog
  openConfirmDialog: (options: {
    title?: string;
    message?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }) => void;
  closeConfirmDialog: () => void;
  
  // Close all
  closeAll: () => void;
}

export type DialogStore = DialogState & DialogActions;

const INITIAL_STATE: DialogState = {
  unitsDialog: { isOpen: false },
  optimizationDialog: { isOpen: false },
  exportDialog: { isOpen: false },
  baseplateConfigDialog: { isOpen: false },
  confirmDialog: { isOpen: false },
};

export const useDialogStore = create<DialogStore>()(
  devtools(
    immer((set) => ({
      ...INITIAL_STATE,

      // Units dialog
      openUnitsDialog: (pendingFileId) => {
        set((state) => {
          state.unitsDialog = { isOpen: true, pendingFileId };
        });
      },

      closeUnitsDialog: () => {
        set((state) => {
          state.unitsDialog = { isOpen: false };
        });
      },

      // Optimization dialog
      openOptimizationDialog: () => {
        set((state) => {
          state.optimizationDialog.isOpen = true;
        });
      },

      closeOptimizationDialog: () => {
        set((state) => {
          state.optimizationDialog.isOpen = false;
        });
      },

      // Export dialog
      openExportDialog: (format) => {
        set((state) => {
          state.exportDialog = { isOpen: true, format };
        });
      },

      closeExportDialog: () => {
        set((state) => {
          state.exportDialog = { isOpen: false };
        });
      },

      // Baseplate config dialog
      openBaseplateConfigDialog: () => {
        set((state) => {
          state.baseplateConfigDialog.isOpen = true;
        });
      },

      closeBaseplateConfigDialog: () => {
        set((state) => {
          state.baseplateConfigDialog.isOpen = false;
        });
      },

      // Confirm dialog
      openConfirmDialog: (options) => {
        set((state) => {
          state.confirmDialog = { isOpen: true, ...options };
        });
      },

      closeConfirmDialog: () => {
        set((state) => {
          state.confirmDialog = { isOpen: false };
        });
      },

      // Close all
      closeAll: () => {
        set(INITIAL_STATE);
      },
    })),
    { name: 'dialog' }
  )
);

// Selectors
export const selectUnitsDialogOpen = (state: DialogStore) => state.unitsDialog.isOpen;
export const selectOptimizationDialogOpen = (state: DialogStore) => state.optimizationDialog.isOpen;
export const selectExportDialogOpen = (state: DialogStore) => state.exportDialog.isOpen;
export const selectConfirmDialogOpen = (state: DialogStore) => state.confirmDialog.isOpen;
