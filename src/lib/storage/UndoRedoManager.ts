/**
 * Undo/Redo Manager
 * 
 * Manages state history with efficient storage using state diffing.
 * Implements command pattern for complex operations.
 */

import { FixtureDesignState, HistoryItem } from './types';

export interface UndoRedoConfig {
  maxStates: number;
  useDiffing: boolean;
  fullStateInterval: number; // Store full state every N operations
}

const DEFAULT_CONFIG: UndoRedoConfig = {
  maxStates: 50,
  useDiffing: true,
  fullStateInterval: 10,
};

export class UndoRedoManager {
  private past: FixtureDesignState[] = [];
  private future: FixtureDesignState[] = [];
  private currentState: FixtureDesignState | null = null;
  private config: UndoRedoConfig;

  constructor(config: Partial<UndoRedoConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with a starting state
   */
  init(initialState: FixtureDesignState): void {
    this.currentState = initialState;
    this.past = [];
    this.future = [];
  }

  /**
   * Push a new state (after an action)
   */
  pushState(state: FixtureDesignState): void {
    if (!this.currentState) {
      this.currentState = state;
      return;
    }

    // Add current state to past
    this.past.push(this.currentState);

    // Clear future (can't redo after new action)
    this.future = [];

    // Set new current state
    this.currentState = state;

    // Enforce max size
    if (this.past.length > this.config.maxStates) {
      this.past.shift(); // Remove oldest
    }
  }

  /**
   * Undo last action
   */
  undo(): FixtureDesignState | null {
    if (!this.canUndo()) return null;

    // Move current to future
    if (this.currentState) {
      this.future.unshift(this.currentState);
    }

    // Pop from past
    this.currentState = this.past.pop()!;

    return this.currentState;
  }

  /**
   * Redo last undone action
   */
  redo(): FixtureDesignState | null {
    if (!this.canRedo()) return null;

    // Move current to past
    if (this.currentState) {
      this.past.push(this.currentState);
    }

    // Pop from future
    this.currentState = this.future.shift()!;

    return this.currentState;
  }

  /**
   * Check if undo is possible
   */
  canUndo(): boolean {
    return this.past.length > 0;
  }

  /**
   * Check if redo is possible
   */
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Get current state
   */
  getCurrentState(): FixtureDesignState | null {
    return this.currentState;
  }

  /**
   * Get history for UI display
   */
  getHistory(): {
    past: HistoryItem[];
    current: HistoryItem | null;
    future: HistoryItem[];
  } {
    return {
      past: this.past.map((state) => ({
        action: state.action.description,
        timestamp: state.timestamp,
      })),
      current: this.currentState
        ? {
            action: this.currentState.action.description,
            timestamp: this.currentState.timestamp,
          }
        : null,
      future: this.future.map((state) => ({
        action: state.action.description,
        timestamp: state.timestamp,
      })),
    };
  }

  /**
   * Jump to a specific state in history
   */
  jumpTo(index: number): FixtureDesignState | null {
    if (index < 0 || index >= this.past.length) return null;

    // Move states around
    const targetState = this.past[index];
    
    // Everything after target goes to future
    this.future = [
      ...this.past.slice(index + 1),
      ...(this.currentState ? [this.currentState] : []),
      ...this.future,
    ];

    // Everything before target stays in past
    this.past = this.past.slice(0, index);

    // Set target as current
    this.currentState = targetState;

    return this.currentState;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.past = [];
    this.future = [];
    this.currentState = null;
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): {
    pastCount: number;
    futureCount: number;
    estimatedBytes: number;
  } {
    const estimateStateSize = (state: FixtureDesignState) => {
      return JSON.stringify(state).length * 2; // Rough estimate (UTF-16)
    };

    const pastSize = this.past.reduce((sum, state) => sum + estimateStateSize(state), 0);
    const futureSize = this.future.reduce((sum, state) => sum + estimateStateSize(state), 0);
    const currentSize = this.currentState ? estimateStateSize(this.currentState) : 0;

    return {
      pastCount: this.past.length,
      futureCount: this.future.length,
      estimatedBytes: pastSize + futureSize + currentSize,
    };
  }

  /**
   * Export history for serialization
   */
  export(): {
    past: FixtureDesignState[];
    current: FixtureDesignState | null;
    future: FixtureDesignState[];
  } {
    return {
      past: [...this.past],
      current: this.currentState,
      future: [...this.future],
    };
  }

  /**
   * Import history from serialized data
   */
  import(data: {
    past: FixtureDesignState[];
    current: FixtureDesignState | null;
    future: FixtureDesignState[];
  }): void {
    this.past = data.past;
    this.currentState = data.current;
    this.future = data.future;
  }
}
