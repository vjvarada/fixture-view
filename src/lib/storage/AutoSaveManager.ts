/**
 * Auto-Save Manager
 * 
 * Handles automatic saving of design sessions with configurable intervals.
 * Provides crash recovery and snapshot management.
 */

import { storageManager } from './StorageManager';
import { DesignSession, FixtureDesignState, Snapshot } from './types';

export interface AutoSaveConfig {
  interval: number; // Milliseconds
  maxSnapshots: number;
  idleDelay: number; // Wait time after last action before saving
  enabled: boolean;
}

const DEFAULT_CONFIG: AutoSaveConfig = {
  interval: 30000, // 30 seconds
  maxSnapshots: 10,
  idleDelay: 2000, // 2 seconds
  enabled: true,
};

export class AutoSaveManager {
  private config: AutoSaveConfig;
  private currentSessionId: string | null = null;
  private lastSaveTime: number = 0;
  private isDirty: boolean = false;
  private isSaving: boolean = false;
  private intervalId: number | null = null;
  private idleTimeoutId: number | null = null;
  private onSaveCallback?: (success: boolean) => void;

  constructor(config: Partial<AutoSaveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start auto-save for a session
   */
  start(sessionId: string, onSave?: (success: boolean) => void): void {
    this.stop(); // Stop any existing auto-save

    this.currentSessionId = sessionId;
    this.onSaveCallback = onSave;
    this.lastSaveTime = Date.now();
    this.isDirty = false;

    if (!this.config.enabled) return;

    // Set up interval-based auto-save
    this.intervalId = window.setInterval(() => {
      if (this.isDirty && !this.isSaving) {
        this.save();
      }
    }, this.config.interval);

    // Set up beforeunload handler
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  /**
   * Stop auto-save
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.idleTimeoutId !== null) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }

    window.removeEventListener('beforeunload', this.handleBeforeUnload);

    this.currentSessionId = null;
    this.onSaveCallback = undefined;
  }

  /**
   * Mark session as having unsaved changes
   */
  markDirty(): void {
    this.isDirty = true;

    // Clear existing idle timeout
    if (this.idleTimeoutId !== null) {
      clearTimeout(this.idleTimeoutId);
    }

    // Set up idle-based save
    this.idleTimeoutId = window.setTimeout(() => {
      if (this.isDirty && !this.isSaving) {
        this.save();
      }
    }, this.config.idleDelay);
  }

  /**
   * Save current session
   */
  async save(): Promise<boolean> {
    if (!this.currentSessionId || this.isSaving) return false;

    this.isSaving = true;

    try {
      const session = await storageManager.loadSession(this.currentSessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Save snapshot
      await storageManager.saveSnapshot(
        this.currentSessionId,
        session.currentState
      );

      // Update session
      await storageManager.saveSession(session);

      this.lastSaveTime = Date.now();
      this.isDirty = false;

      if (this.onSaveCallback) {
        this.onSaveCallback(true);
      }

      return true;
    } catch (error) {
      console.error('Auto-save failed:', error);
      
      if (this.onSaveCallback) {
        this.onSaveCallback(false);
      }

      return false;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Force immediate save
   */
  async forceSave(): Promise<boolean> {
    this.isDirty = true;
    return this.save();
  }

  /**
   * Get last save time
   */
  getLastSaveTime(): number {
    return this.lastSaveTime;
  }

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  /**
   * Check if currently saving
   */
  isSavingNow(): boolean {
    return this.isSaving;
  }

  /**
   * Handle browser beforeunload event
   */
  private handleBeforeUnload = (e: BeforeUnloadEvent): string | undefined => {
    if (this.isDirty) {
      const message = 'You have unsaved changes. Are you sure you want to leave?';
      e.preventDefault();
      e.returnValue = message;
      
      // Try to save before leaving
      this.forceSave();
      
      return message;
    }
    return undefined;
  };

  /**
   * Load latest snapshot for recovery
   */
  async loadLatest(sessionId: string): Promise<FixtureDesignState | null> {
    const snapshots = await storageManager.loadSnapshots(sessionId);
    return snapshots.length > 0 ? snapshots[0].state : null;
  }

  /**
   * List all snapshots for a session
   */
  async listSnapshots(sessionId: string): Promise<Snapshot[]> {
    return storageManager.loadSnapshots(sessionId);
  }

  /**
   * Restore from a specific snapshot
   */
  async restoreSnapshot(
    sessionId: string,
    timestamp: number
  ): Promise<FixtureDesignState | null> {
    const snapshots = await storageManager.loadSnapshots(sessionId);
    const snapshot = snapshots.find((s) => s.timestamp === timestamp);
    return snapshot ? snapshot.state : null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoSaveConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart if currently running
    if (this.currentSessionId) {
      const sessionId = this.currentSessionId;
      const callback = this.onSaveCallback;
      this.start(sessionId, callback);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoSaveConfig {
    return { ...this.config };
  }
}

// Singleton instance
export const autoSaveManager = new AutoSaveManager();
