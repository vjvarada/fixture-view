/**
 * React Hook for Design Session Management
 * 
 * Provides a complete interface for managing design sessions with undo/redo,
 * auto-save, and crash recovery.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { storageManager } from './StorageManager';
import { autoSaveManager } from './AutoSaveManager';
import { UndoRedoManager } from './UndoRedoManager';
import {
  DesignSession,
  FixtureDesignState,
  SessionMetadata,
  HistoryItem,
  ActionType,
} from './types';

export interface UseDesignSessionResult {
  // Session state
  session: DesignSession | null;
  currentState: FixtureDesignState | null;
  isLoading: boolean;
  error: Error | null;
  
  // Dirty state
  isDirty: boolean;
  lastSaved: Date | null;
  isSaving: boolean;
  
  // Session operations
  createSession: (name: string) => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  saveSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  closeSession: () => void;
  
  // State operations
  updateState: (newState: FixtureDesignState) => void;
  pushAction: (actionType: ActionType, description: string, newState: FixtureDesignState) => void;
  
  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  history: {
    past: HistoryItem[];
    current: HistoryItem | null;
    future: HistoryItem[];
  };
  
  // Snapshots
  createSnapshot: () => Promise<void>;
  restoreSnapshot: (timestamp: number) => Promise<void>;
}

export function useDesignSession(): UseDesignSessionResult {
  const [session, setSession] = useState<DesignSession | null>(null);
  const [currentState, setCurrentState] = useState<FixtureDesignState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const undoRedoManager = useRef(new UndoRedoManager());
  const [history, setHistory] = useState<{
    past: HistoryItem[];
    current: HistoryItem | null;
    future: HistoryItem[];
  }>({
    past: [],
    current: null,
    future: [],
  });

  // Initialize storage on mount
  useEffect(() => {
    storageManager.init().catch((err) => {
      setError(err);
      console.error('Failed to initialize storage:', err);
    });

    return () => {
      // Clean shutdown
      autoSaveManager.stop();
    };
  }, []);

  // Update history when undo/redo state changes
  const updateHistory = useCallback(() => {
    setHistory(undoRedoManager.current.getHistory());
  }, []);

  // Create a new session
  const createSession = useCallback(async (name: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const initialState: FixtureDesignState = {
        timestamp: Date.now(),
        action: {
          type: 'IMPORT',
          description: 'Session created',
        },
        modelTransform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        baseplate: null,
        supports: [],
        clamps: [],
        booleanOps: [],
        parameters: {
          globalOffset: 0.5,
          wallThickness: 2,
          supportHeight: 10,
          clampForce: 50,
          material: 'PLA',
        },
      };

      const newSession: DesignSession = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastAccessedAt: Date.now(),
        importedModel: null,
        currentState: initialState,
        history: {
          past: [],
          future: [],
          maxSize: 50,
        },
        snapshots: [],
        exports: [],
      };

      await storageManager.saveSession(newSession);
      
      setSession(newSession);
      setCurrentState(initialState);
      setIsDirty(false);
      setLastSaved(new Date());
      
      undoRedoManager.current.init(initialState);
      updateHistory();
      
      // Start auto-save
      autoSaveManager.start(newSession.id, (success) => {
        if (success) {
          setLastSaved(new Date());
          setIsDirty(false);
        }
      });
    } catch (err) {
      setError(err as Error);
      console.error('Failed to create session:', err);
    } finally {
      setIsLoading(false);
    }
  }, [updateHistory]);

  // Load an existing session
  const loadSession = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedSession = await storageManager.loadSession(id);
      
      if (!loadedSession) {
        throw new Error('Session not found');
      }

      setSession(loadedSession);
      setCurrentState(loadedSession.currentState);
      setIsDirty(false);
      setLastSaved(new Date(loadedSession.updatedAt));
      
      // Initialize undo/redo with session history
      undoRedoManager.current.import({
        past: loadedSession.history.past,
        current: loadedSession.currentState,
        future: loadedSession.history.future,
      });
      updateHistory();
      
      // Start auto-save
      autoSaveManager.start(loadedSession.id, (success) => {
        if (success) {
          setLastSaved(new Date());
          setIsDirty(false);
        }
      });
    } catch (err) {
      setError(err as Error);
      console.error('Failed to load session:', err);
    } finally {
      setIsLoading(false);
    }
  }, [updateHistory]);

  // Save current session
  const saveSession = useCallback(async () => {
    if (!session || !currentState) return;

    setIsSaving(true);
    setError(null);

    try {
      const historyExport = undoRedoManager.current.export();
      
      const updatedSession: DesignSession = {
        ...session,
        currentState,
        history: {
          past: historyExport.past,
          future: historyExport.future,
          maxSize: 50,
        },
        updatedAt: Date.now(),
      };

      await storageManager.saveSession(updatedSession);
      
      setSession(updatedSession);
      setIsDirty(false);
      setLastSaved(new Date());
    } catch (err) {
      setError(err as Error);
      console.error('Failed to save session:', err);
    } finally {
      setIsSaving(false);
    }
  }, [session, currentState]);

  // Delete a session
  const deleteSession = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await storageManager.deleteSession(id);
      
      if (session?.id === id) {
        setSession(null);
        setCurrentState(null);
        autoSaveManager.stop();
      }
    } catch (err) {
      setError(err as Error);
      console.error('Failed to delete session:', err);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  // Close current session
  const closeSession = useCallback(() => {
    if (isDirty) {
      saveSession();
    }
    
    autoSaveManager.stop();
    setSession(null);
    setCurrentState(null);
    setIsDirty(false);
    undoRedoManager.current.clear();
    updateHistory();
  }, [isDirty, saveSession, updateHistory]);

  // Update state without creating history entry
  const updateState = useCallback((newState: FixtureDesignState) => {
    setCurrentState(newState);
    setIsDirty(true);
    autoSaveManager.markDirty();
  }, []);

  // Push a new action (creates history entry)
  const pushAction = useCallback(
    (actionType: ActionType, description: string, newState: FixtureDesignState) => {
      const stateWithAction: FixtureDesignState = {
        ...newState,
        timestamp: Date.now(),
        action: {
          type: actionType,
          description,
        },
      };

      undoRedoManager.current.pushState(stateWithAction);
      setCurrentState(stateWithAction);
      setIsDirty(true);
      updateHistory();
      autoSaveManager.markDirty();
    },
    [updateHistory]
  );

  // Undo
  const undo = useCallback(() => {
    const previousState = undoRedoManager.current.undo();
    if (previousState) {
      setCurrentState(previousState);
      setIsDirty(true);
      updateHistory();
      autoSaveManager.markDirty();
    }
  }, [updateHistory]);

  // Redo
  const redo = useCallback(() => {
    const nextState = undoRedoManager.current.redo();
    if (nextState) {
      setCurrentState(nextState);
      setIsDirty(true);
      updateHistory();
      autoSaveManager.markDirty();
    }
  }, [updateHistory]);

  // Create snapshot
  const createSnapshot = useCallback(async () => {
    if (!session || !currentState) return;

    try {
      await storageManager.saveSnapshot(session.id, currentState);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to create snapshot:', err);
    }
  }, [session, currentState]);

  // Restore snapshot
  const restoreSnapshot = useCallback(
    async (timestamp: number) => {
      if (!session) return;

      try {
        const restoredState = await autoSaveManager.restoreSnapshot(
          session.id,
          timestamp
        );
        
        if (restoredState) {
          undoRedoManager.current.pushState(restoredState);
          setCurrentState(restoredState);
          setIsDirty(true);
          updateHistory();
        }
      } catch (err) {
        setError(err as Error);
        console.error('Failed to restore snapshot:', err);
      }
    },
    [session, updateHistory]
  );

  return {
    // Session state
    session,
    currentState,
    isLoading,
    error,
    
    // Dirty state
    isDirty,
    lastSaved,
    isSaving,
    
    // Session operations
    createSession,
    loadSession,
    saveSession,
    deleteSession,
    closeSession,
    
    // State operations
    updateState,
    pushAction,
    
    // Undo/Redo
    undo,
    redo,
    canUndo: undoRedoManager.current.canUndo(),
    canRedo: undoRedoManager.current.canRedo(),
    history,
    
    // Snapshots
    createSnapshot,
    restoreSnapshot,
  };
}
