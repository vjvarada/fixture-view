/**
 * Crash Recovery System
 * 
 * Detects unclean shutdowns and provides recovery mechanisms for design sessions.
 */

import { storageManager } from './StorageManager';
import { DesignSession, SessionMetadata } from './types';

const CRASH_FLAG_KEY = 'rapidtool_crash_flag';
const ACTIVE_SESSION_KEY = 'rapidtool_active_session';

export interface RecoverableSession {
  id: string;
  name: string;
  lastSaved: number;
  thumbnail?: string;
}

export class CrashRecovery {
  /**
   * Mark application as running (set crash flag)
   */
  markRunning(): void {
    localStorage.setItem(CRASH_FLAG_KEY, Date.now().toString());
  }

  /**
   * Mark application as cleanly shut down (clear crash flag)
   */
  markCleanShutdown(): void {
    localStorage.removeItem(CRASH_FLAG_KEY);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }

  /**
   * Detect if previous session crashed
   */
  detectCrash(): boolean {
    const crashFlag = localStorage.getItem(CRASH_FLAG_KEY);
    return crashFlag !== null;
  }

  /**
   * Set currently active session
   */
  setActiveSession(sessionId: string): void {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  }

  /**
   * Clear active session
   */
  clearActiveSession(): void {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }

  /**
   * Get sessions that can be recovered
   */
  async getRecoverableSessions(): Promise<RecoverableSession[]> {
    const activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
    
    if (!activeSessionId) {
      return [];
    }

    try {
      const session = await storageManager.loadSession(activeSessionId);
      
      if (!session) {
        return [];
      }

      const snapshots = await storageManager.loadSnapshots(activeSessionId);
      const latestSnapshot = snapshots[0];

      return [
        {
          id: session.id,
          name: session.name,
          lastSaved: latestSnapshot?.timestamp || session.updatedAt,
          thumbnail: latestSnapshot?.thumbnail,
        },
      ];
    } catch (error) {
      console.error('Failed to get recoverable sessions:', error);
      return [];
    }
  }

  /**
   * Recover a session
   */
  async recoverSession(sessionId: string): Promise<DesignSession | null> {
    try {
      const session = await storageManager.loadSession(sessionId);
      
      if (!session) {
        return null;
      }

      // Load latest snapshot if available
      const snapshots = await storageManager.loadSnapshots(sessionId);
      if (snapshots.length > 0) {
        session.currentState = snapshots[0].state;
      }

      return session;
    } catch (error) {
      console.error('Failed to recover session:', error);
      return null;
    }
  }

  /**
   * Clear recovery data for a session
   */
  clearRecovery(sessionId: string): void {
    const activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (activeSessionId === sessionId) {
      this.clearActiveSession();
    }
  }

  /**
   * Initialize crash detection on app startup
   */
  initialize(): {
    crashed: boolean;
    recoverableSessions: Promise<RecoverableSession[]>;
  } {
    const crashed = this.detectCrash();
    
    // Mark as running for next crash detection
    this.markRunning();

    // Set up clean shutdown handler
    window.addEventListener('beforeunload', () => {
      // Don't clear crash flag here - only clear on clean shutdown
    });

    return {
      crashed,
      recoverableSessions: crashed ? this.getRecoverableSessions() : Promise.resolve([]),
    };
  }
}

// Singleton instance
export const crashRecovery = new CrashRecovery();
