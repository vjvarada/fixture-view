/**
 * History Hooks for Fixture App
 * 
 * Provides hooks for undo/redo functionality.
 */

import { useCallback } from 'react';
import { useHistoryStore } from '@rapidtool/cad-ui';

/**
 * Hook for undo stack
 * Replaces: const [undoStack, setUndoStack] = useState<any[]>([])
 */
export function useUndoStack() {
  const undoStack = useHistoryStore((state) => state.undoStack);
  const push = useHistoryStore((state) => state.push);
  const undo = useHistoryStore((state) => state.undo);
  const clear = useHistoryStore((state) => state.clear);
  
  // Backward compatible setter
  const setUndoStack = useCallback((
    value: any[] | ((prev: any[]) => any[])
  ) => {
    // For setting the stack directly, we'd need to clear and re-push
    // This is a simplified compatibility layer
    if (typeof value === 'function') {
      const current = useHistoryStore.getState().undoStack;
      const newStack = value(current);
      // If clearing, clear the store
      if (newStack.length === 0) {
        clear();
      }
    } else if (value.length === 0) {
      clear();
    }
  }, [clear]);
  
  return [undoStack, setUndoStack, { push, undo }] as const;
}

/**
 * Hook for redo stack
 * Replaces: const [redoStack, setRedoStack] = useState<any[]>([])
 */
export function useRedoStack() {
  const redoStack = useHistoryStore((state) => state.redoStack);
  const redo = useHistoryStore((state) => state.redo);
  const clear = useHistoryStore((state) => state.clear);
  
  // Backward compatible setter
  const setRedoStack = useCallback((
    value: any[] | ((prev: any[]) => any[])
  ) => {
    // Simplified compatibility layer
    if (typeof value === 'function') {
      const current = useHistoryStore.getState().redoStack;
      const newStack = value(current);
      if (newStack.length === 0) {
        // Can't clear just redo stack, but this handles the common case
      }
    }
  }, []);
  
  return [redoStack, setRedoStack, { redo }] as const;
}

/**
 * Hook for undo/redo actions
 */
export function useUndoRedo() {
  const canUndo = useHistoryStore((state) => state.undoStack.length > 0);
  const canRedo = useHistoryStore((state) => state.redoStack.length > 0);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const push = useHistoryStore((state) => state.push);
  const clear = useHistoryStore((state) => state.clear);
  
  return { canUndo, canRedo, undo, redo, push, clear };
}

/**
 * Hook for full history store
 */
export function useHistory() {
  return useHistoryStore();
}
