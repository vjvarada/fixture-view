/**
 * IndexedDB Storage Manager
 * 
 * Core storage layer for local-first design sessions.
 * Handles all IndexedDB operations with proper error handling and type safety.
 */

import {
  DesignSession,
  SessionMetadata,
  Snapshot,
  ExportRecord,
  StorageQuota,
  StorageError,
  StorageErrorType,
  StorageConfig,
  DEFAULT_STORAGE_CONFIG,
  FixtureDesignState,
} from './types';

export class StorageManager {
  private db: IDBDatabase | null = null;
  private config: StorageConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
  }

  /**
   * Initialize IndexedDB database
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);

      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.PERMISSION_DENIED,
            'Failed to open IndexedDB'
          )
        );
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionsStore.createIndex('name', 'name', { unique: false });
          sessionsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          sessionsStore.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('snapshots')) {
          const snapshotsStore = db.createObjectStore('snapshots', {
            keyPath: ['sessionId', 'timestamp'],
          });
          snapshotsStore.createIndex('sessionId', 'sessionId', { unique: false });
        }

        if (!db.objectStoreNames.contains('exports')) {
          const exportsStore = db.createObjectStore('exports', { keyPath: 'id' });
          exportsStore.createIndex('sessionId', 'sessionId', { unique: false });
          exportsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'key' });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInit(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) {
      throw new StorageError(
        StorageErrorType.PERMISSION_DENIED,
        'Database not initialized'
      );
    }
    return this.db;
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  /**
   * Save a design session
   */
  async saveSession(session: DesignSession): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');

      const updatedSession = {
        ...session,
        updatedAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      const request = store.put(updatedSession);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        if (request.error?.name === 'QuotaExceededError') {
          reject(
            new StorageError(
              StorageErrorType.QUOTA_EXCEEDED,
              'Storage quota exceeded. Please free up space.',
              { sessionId: session.id }
            )
          );
        } else {
          reject(
            new StorageError(
              StorageErrorType.INVALID_DATA,
              'Failed to save session',
              { error: request.error }
            )
          );
        }
      };
    });
  }

  /**
   * Load a design session by ID
   */
  async loadSession(id: string): Promise<DesignSession | null> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(id);

      request.onsuccess = () => {
        const session = request.result as DesignSession | undefined;
        if (session) {
          // Update last accessed time
          this.updateLastAccessed(id).catch(console.error);
        }
        resolve(session || null);
      };

      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.INVALID_DATA,
            'Failed to load session',
            { sessionId: id }
          )
        );
      };
    });
  }

  /**
   * Update last accessed timestamp
   */
  private async updateLastAccessed(id: string): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const session = getRequest.result;
        if (session) {
          session.lastAccessedAt = Date.now();
          store.put(session);
        }
        resolve();
      };

      getRequest.onerror = () => reject();
    });
  }

  /**
   * List all sessions (metadata only)
   */
  async listSessions(): Promise<SessionMetadata[]> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.openCursor();
      const sessions: SessionMetadata[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const session = cursor.value as DesignSession;
          sessions.push({
            id: session.id,
            name: session.name,
            thumbnail: session.snapshots[0]?.thumbnail,
            updatedAt: session.updatedAt,
            fileSize: this.estimateSessionSize(session),
            modelFileName: session.importedModel?.fileName,
          });
          cursor.continue();
        } else {
          // Sort by most recently updated
          sessions.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(sessions);
        }
      };

      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.INVALID_DATA,
            'Failed to list sessions'
          )
        );
      };
    });
  }

  /**
   * Delete a session and all related data
   */
  async deleteSession(id: string): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ['sessions', 'snapshots', 'exports'],
        'readwrite'
      );

      // Delete session
      const sessionsStore = transaction.objectStore('sessions');
      sessionsStore.delete(id);

      // Delete snapshots
      const snapshotsStore = transaction.objectStore('snapshots');
      const snapshotsIndex = snapshotsStore.index('sessionId');
      const snapshotsRequest = snapshotsIndex.openCursor(IDBKeyRange.only(id));

      snapshotsRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // Delete exports
      const exportsStore = transaction.objectStore('exports');
      const exportsIndex = exportsStore.index('sessionId');
      const exportsRequest = exportsIndex.openCursor(IDBKeyRange.only(id));

      exportsRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.INVALID_DATA,
            'Failed to delete session',
            { sessionId: id }
          )
        );
      };
    });
  }

  // ============================================================================
  // Snapshot Operations
  // ============================================================================

  /**
   * Save an auto-save snapshot
   */
  async saveSnapshot(sessionId: string, state: FixtureDesignState): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['snapshots'], 'readwrite');
      const store = transaction.objectStore('snapshots');

      const snapshot = {
        sessionId,
        timestamp: Date.now(),
        state,
      };

      const request = store.put(snapshot);

      request.onsuccess = () => {
        // Prune old snapshots
        this.pruneSnapshots(sessionId).catch(console.error);
        resolve();
      };

      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.QUOTA_EXCEEDED,
            'Failed to save snapshot',
            { sessionId }
          )
        );
      };
    });
  }

  /**
   * Load all snapshots for a session
   */
  async loadSnapshots(sessionId: string): Promise<Snapshot[]> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['snapshots'], 'readonly');
      const store = transaction.objectStore('snapshots');
      const index = store.index('sessionId');
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      const snapshots: Snapshot[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          snapshots.push(cursor.value);
          cursor.continue();
        } else {
          // Sort by timestamp descending
          snapshots.sort((a, b) => b.timestamp - a.timestamp);
          resolve(snapshots);
        }
      };

      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.INVALID_DATA,
            'Failed to load snapshots',
            { sessionId }
          )
        );
      };
    });
  }

  /**
   * Prune old snapshots, keeping only the most recent N
   */
  private async pruneSnapshots(sessionId: string): Promise<void> {
    const snapshots = await this.loadSnapshots(sessionId);
    if (snapshots.length <= this.config.maxSnapshots) return;

    const db = await this.ensureInit();
    const transaction = db.transaction(['snapshots'], 'readwrite');
    const store = transaction.objectStore('snapshots');

    // Delete oldest snapshots
    const toDelete = snapshots.slice(this.config.maxSnapshots);
    toDelete.forEach((snapshot) => {
      store.delete([sessionId, snapshot.timestamp]);
    });
  }

  // ============================================================================
  // Export Operations
  // ============================================================================

  /**
   * Save an export record
   */
  async saveExport(sessionId: string, exportData: ExportRecord): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['exports'], 'readwrite');
      const store = transaction.objectStore('exports');

      const exportRecord = {
        id: `${sessionId}_${Date.now()}`,
        sessionId,
        ...exportData,
      };

      const request = store.put(exportRecord);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.QUOTA_EXCEEDED,
            'Failed to save export',
            { sessionId }
          )
        );
      };
    });
  }

  /**
   * Load all exports for a session
   */
  async loadExports(sessionId: string): Promise<ExportRecord[]> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['exports'], 'readonly');
      const store = transaction.objectStore('exports');
      const index = store.index('sessionId');
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      const exports: ExportRecord[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          exports.push(cursor.value);
          cursor.continue();
        } else {
          // Sort by timestamp descending
          exports.sort((a, b) => b.timestamp - a.timestamp);
          resolve(exports);
        }
      };

      request.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.INVALID_DATA,
            'Failed to load exports',
            { sessionId }
          )
        );
      };
    });
  }

  // ============================================================================
  // Storage Quota Management
  // ============================================================================

  /**
   * Get current storage quota information
   */
  async getQuota(): Promise<StorageQuota> {
    if (!navigator.storage || !navigator.storage.estimate) {
      throw new StorageError(
        StorageErrorType.PERMISSION_DENIED,
        'Storage API not supported'
      );
    }

    const estimate = await navigator.storage.estimate();
    const used = estimate.usage || 0;
    const total = estimate.quota || 0;
    const available = total - used;
    const percentage = total > 0 ? (used / total) * 100 : 0;

    const sessions = await this.listSessions();
    const totalSize = sessions.reduce((sum, s) => sum + s.fileSize, 0);
    const largestSession = sessions.reduce(
      (max, s) => (s.fileSize > max.size ? { id: s.id, size: s.fileSize } : max),
      { id: '', size: 0 }
    );

    // Recommendations
    const shouldCleanup = percentage > 80;
    const oldSessions = sessions.filter(
      (s) => Date.now() - s.updatedAt > 90 * 24 * 60 * 60 * 1000 // 90 days
    );

    return {
      used,
      available,
      total,
      percentage,
      sessions: {
        count: sessions.length,
        totalSize,
        largestSession,
      },
      recommendations: {
        shouldCleanup,
        sessionsToRemove: oldSessions.map((s) => s.id),
        potentialSavings: oldSessions.reduce((sum, s) => sum + s.fileSize, 0),
      },
    };
  }

  /**
   * Cleanup old or unused sessions
   */
  async cleanup(strategy: 'oldest' | 'largest' | 'unused' = 'oldest'): Promise<number> {
    const sessions = await this.listSessions();
    let toDelete: string[] = [];

    switch (strategy) {
      case 'oldest':
        // Delete sessions not accessed in 90 days
        toDelete = sessions
          .filter((s) => Date.now() - s.updatedAt > 90 * 24 * 60 * 60 * 1000)
          .map((s) => s.id);
        break;

      case 'largest':
        // Delete largest sessions first
        toDelete = sessions
          .sort((a, b) => b.fileSize - a.fileSize)
          .slice(0, Math.ceil(sessions.length * 0.2)) // Top 20%
          .map((s) => s.id);
        break;

      case 'unused':
        // Delete sessions not accessed in 30 days
        toDelete = sessions
          .filter((s) => Date.now() - s.updatedAt > 30 * 24 * 60 * 60 * 1000)
          .map((s) => s.id);
        break;
    }

    for (const id of toDelete) {
      await this.deleteSession(id);
    }

    return toDelete.length;
  }

  /**
   * Clear all data (factory reset)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureInit();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ['sessions', 'snapshots', 'exports', 'preferences'],
        'readwrite'
      );

      transaction.objectStore('sessions').clear();
      transaction.objectStore('snapshots').clear();
      transaction.objectStore('exports').clear();
      transaction.objectStore('preferences').clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        reject(
          new StorageError(
            StorageErrorType.INVALID_DATA,
            'Failed to clear all data'
          )
        );
      };
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Estimate session size in bytes
   */
  private estimateSessionSize(session: DesignSession): number {
    const json = JSON.stringify(session);
    return new Blob([json]).size;
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

// Singleton instance
export const storageManager = new StorageManager();
