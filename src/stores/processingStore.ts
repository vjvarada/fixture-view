/**
 * Processing Store
 * 
 * App-specific store for file processing, mesh analysis, and export operations.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface MeshAnalysisResult {
  triangleCount: number;
  vertexCount: number;
  isClosed: boolean;
  hasNonManifold: boolean;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  surfaceArea: number;
  volume: number;
  recommendations: string[];
}

export interface MeshProcessingProgress {
  stage: 'analyzing' | 'simplifying' | 'optimizing' | 'complete';
  progress: number;
  message: string;
}

export interface ProcessingResult {
  status: 'success' | 'error';
  message?: string;
  data?: unknown;
}

export interface ProcessingState {
  /** General file processing state */
  isProcessing: boolean;
  
  /** File error message */
  fileError: string | null;
  
  /** Mesh processing state */
  isMeshProcessing: boolean;
  
  /** Mesh analysis result */
  meshAnalysis: MeshAnalysisResult | null;
  
  /** Mesh processing progress */
  meshProgress: MeshProcessingProgress | null;
  
  /** Pending file awaiting unit confirmation */
  pendingFile: {
    name: string;
    size: number;
    data: unknown;
  } | null;
  
  /** Processing result */
  result: ProcessingResult | null;
  
  /** Export state */
  isExporting: boolean;
  exportError: string | null;
}

export interface ProcessingActions {
  /** Set general processing state */
  setProcessing: (isProcessing: boolean) => void;
  
  /** Set file error */
  setFileError: (error: string | null) => void;
  
  /** Set mesh processing state */
  setMeshProcessing: (isProcessing: boolean) => void;
  
  /** Set mesh analysis */
  setMeshAnalysis: (analysis: MeshAnalysisResult | null) => void;
  
  /** Set mesh progress */
  setMeshProgress: (progress: MeshProcessingProgress | null) => void;
  
  /** Set pending file */
  setPendingFile: (file: ProcessingState['pendingFile']) => void;
  
  /** Set processing result */
  setResult: (result: ProcessingResult | null) => void;
  
  /** Set exporting state */
  setExporting: (isExporting: boolean) => void;
  
  /** Set export error */
  setExportError: (error: string | null) => void;
  
  /** Clear all processing state */
  clear: () => void;
}

export type ProcessingStore = ProcessingState & ProcessingActions;

const INITIAL_STATE: ProcessingState = {
  isProcessing: false,
  fileError: null,
  isMeshProcessing: false,
  meshAnalysis: null,
  meshProgress: null,
  pendingFile: null,
  result: null,
  isExporting: false,
  exportError: null,
};

export const useProcessingStore = create<ProcessingStore>()(
  devtools(
    immer((set) => ({
      ...INITIAL_STATE,

      setProcessing: (isProcessing) => {
        set((state) => {
          state.isProcessing = isProcessing;
        });
      },

      setFileError: (error) => {
        set((state) => {
          state.fileError = error;
        });
      },

      setMeshProcessing: (isProcessing) => {
        set((state) => {
          state.isMeshProcessing = isProcessing;
        });
      },

      setMeshAnalysis: (analysis) => {
        set((state) => {
          state.meshAnalysis = analysis;
        });
      },

      setMeshProgress: (progress) => {
        set((state) => {
          state.meshProgress = progress;
        });
      },

      setPendingFile: (file) => {
        set((state) => {
          state.pendingFile = file;
        });
      },

      setResult: (result) => {
        set((state) => {
          state.result = result;
        });
      },

      setExporting: (isExporting) => {
        set((state) => {
          state.isExporting = isExporting;
        });
      },

      setExportError: (error) => {
        set((state) => {
          state.exportError = error;
        });
      },

      clear: () => {
        set(INITIAL_STATE);
      },
    })),
    { name: 'processing' }
  )
);

// Selectors
export const selectIsProcessing = (state: ProcessingStore) => state.isProcessing;
export const selectFileError = (state: ProcessingStore) => state.fileError;
export const selectMeshAnalysis = (state: ProcessingStore) => state.meshAnalysis;
export const selectMeshProgress = (state: ProcessingStore) => state.meshProgress;
export const selectIsExporting = (state: ProcessingStore) => state.isExporting;
