/**
 * Type Definitions for Client-Side Storage System
 * 
 * All types for local-first design session storage, undo/redo, and cloud sync.
 */

// ============================================================================
// Core Session Types
// ============================================================================

export interface DesignSession {
  // Metadata
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  
  // Model Information
  importedModel: ImportedModel | null;
  
  // Design State (Current)
  currentState: FixtureDesignState;
  
  // History for Undo/Redo
  history: HistoryStack;
  
  // Auto-save Snapshots
  snapshots: Snapshot[];
  
  // Export History
  exports: ExportRecord[];
  
  // Cloud Sync (Optional)
  cloudSync?: CloudSyncInfo;
}

export interface ImportedModel {
  fileName: string;
  fileType: 'STL' | 'STEP' | '3MF';
  fileSize: number;
  blob: Blob;
  processedMesh: SerializedMesh;
  metadata: ModelMetadata;
}

export interface ModelMetadata {
  triangleCount: number;
  boundingBox: BoundingBox;
  volume: number;
  surfaceArea: number;
}

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

// ============================================================================
// Design State Types
// ============================================================================

export interface FixtureDesignState {
  timestamp: number;
  action: ActionInfo;
  modelTransform: Transform3D;
  baseplate: Baseplate | null;
  supports: Support[];
  clamps: Clamp[];
  booleanOps: BooleanOperation[];
  parameters: GlobalParameters;
  computed?: ComputedResults;
}

export interface ActionInfo {
  type: ActionType;
  description: string;
}

export type ActionType =
  | 'IMPORT'
  | 'ADD_SUPPORT'
  | 'REMOVE_SUPPORT'
  | 'MODIFY_SUPPORT'
  | 'ADD_CLAMP'
  | 'REMOVE_CLAMP'
  | 'MODIFY_CLAMP'
  | 'ADD_BASEPLATE'
  | 'MODIFY_BASEPLATE'
  | 'BOOLEAN_OPERATION'
  | 'ADJUST_PARAMETERS'
  | 'ROTATE_MODEL'
  | 'TRANSLATE_MODEL'
  | 'SCALE_MODEL';

export interface Transform3D {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface Baseplate {
  type: 'perforated' | 'solid' | 'grid' | 'custom';
  dimensions: {
    width: number;
    height: number;
    thickness: number;
  };
  position: [number, number, number];
  holePattern?: HolePattern;
}

export interface HolePattern {
  spacing: number;
  diameter: number;
  rows: number;
  cols: number;
}

export interface Support {
  id: string;
  type: 'rectangular' | 'cylindrical' | 'polygonal' | 'custom';
  position: [number, number, number];
  rotation: [number, number, number];
  dimensions: SupportDimensions;
  contactSurface: ContactSurface;
  mesh?: SerializedMesh;
}

export interface SupportDimensions {
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  sides?: number;
}

export interface ContactSurface {
  normal: [number, number, number];
  area: number;
  points: [number, number, number][];
}

export interface Clamp {
  id: string;
  type: 'toggle' | 'screw' | 'magnetic' | 'spring' | 'custom';
  position: [number, number, number];
  rotation: [number, number, number];
  parameters: ClampParameters;
  attachmentPoint: AttachmentPoint;
  mesh?: SerializedMesh;
}

export interface ClampParameters {
  force: number;
  openingSize: number;
  thickness: number;
}

export interface AttachmentPoint {
  targetId: string;
  localPosition: [number, number, number];
}

export interface BooleanOperation {
  type: 'subtract' | 'union' | 'intersect';
  targetId: string;
  removalDirection: [number, number, number];
  offset: number;
  simplifyHoles: boolean;
  simplifyAxes: ('X' | 'Y' | 'Z')[];
}

export interface GlobalParameters {
  globalOffset: number;
  wallThickness: number;
  supportHeight: number;
  clampForce: number;
  material: string;
}

export interface ComputedResults {
  totalVolume: number;
  estimatedPrintTime: number;
  estimatedMaterialCost: number;
  warnings: string[];
}

// ============================================================================
// Mesh Serialization
// ============================================================================

export interface SerializedMesh {
  geometry: SerializedGeometry;
  material: SerializedMaterial;
  boundingBox: BoundingBox;
}

export interface SerializedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
}

export interface SerializedMaterial {
  color: number;
  opacity: number;
  metalness?: number;
  roughness?: number;
}

// ============================================================================
// History & Undo/Redo
// ============================================================================

export interface HistoryStack {
  past: FixtureDesignState[];
  future: FixtureDesignState[];
  maxSize: number;
}

export interface HistoryItem {
  action: string;
  timestamp: number;
}

// ============================================================================
// Snapshots & Auto-Save
// ============================================================================

export interface Snapshot {
  timestamp: number;
  state: FixtureDesignState;
  thumbnail?: string;
}

// ============================================================================
// Export Records
// ============================================================================

export interface ExportRecord {
  timestamp: number;
  format: 'STL' | '3MF' | 'PDF' | 'SESSION';
  fileName: string;
  fileSize: number;
  blob?: Blob;
}

// ============================================================================
// Cloud Sync
// ============================================================================

export interface CloudSyncInfo {
  lastSyncedAt: number;
  syncStatus: 'synced' | 'pending' | 'conflict' | 'error';
  cloudVersion: number;
  localVersion: number;
}

export interface CloudSession {
  id: string;
  userId: string;
  version: number;
  compressedData: Uint8Array;
  metadata: CloudSessionMetadata;
  thumbnail?: string;
}

export interface CloudSessionMetadata {
  name: string;
  createdAt: number;
  updatedAt: number;
  fileSize: number;
  checksum: string;
}

export interface SyncResult {
  status: 'success' | 'conflict' | 'error';
  localVersion: number;
  remoteVersion: number;
  conflicts?: ConflictInfo[];
}

export interface ConflictInfo {
  field: string;
  localValue: any;
  remoteValue: any;
}

// ============================================================================
// Storage Quota & Management
// ============================================================================

export interface StorageQuota {
  used: number;
  available: number;
  total: number;
  percentage: number;
  sessions: SessionsQuota;
  recommendations: CleanupRecommendations;
}

export interface SessionsQuota {
  count: number;
  totalSize: number;
  largestSession: {
    id: string;
    size: number;
  };
}

export interface CleanupRecommendations {
  shouldCleanup: boolean;
  sessionsToRemove: string[];
  potentialSavings: number;
}

// ============================================================================
// Session Metadata (Lightweight)
// ============================================================================

export interface SessionMetadata {
  id: string;
  name: string;
  thumbnail?: string;
  updatedAt: number;
  fileSize: number;
  modelFileName?: string;
}

// ============================================================================
// Storage Errors
// ============================================================================

export enum StorageErrorType {
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  CORRUPTED_DATA = 'CORRUPTED_DATA',
  NETWORK_ERROR = 'NETWORK_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_DATA = 'INVALID_DATA',
}

export class StorageError extends Error {
  constructor(
    public type: StorageErrorType,
    message: string,
    public context?: any
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// ============================================================================
// Configuration
// ============================================================================

export interface StorageConfig {
  dbName: string;
  dbVersion: number;
  maxHistorySize: number;
  maxSnapshots: number;
  autoSaveInterval: number;
  compressionEnabled: boolean;
  cloudSyncEnabled: boolean;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  dbName: 'RapidToolFixture',
  dbVersion: 1,
  maxHistorySize: 50,
  maxSnapshots: 10,
  autoSaveInterval: 30000, // 30 seconds
  compressionEnabled: true,
  cloudSyncEnabled: false,
};
