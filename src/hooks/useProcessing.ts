/**
 * Processing Hooks for Fixture App
 * 
 * Provides hooks for file processing and mesh analysis states.
 */

import { useCallback } from 'react';
import { useProcessingStore } from '@/stores';
import type { MeshAnalysisResult, MeshProcessingProgress, ProcessingResult } from '@/stores/processingStore';

/**
 * Hook for general processing state
 * Replaces: const [isProcessing, setIsProcessing] = useState(false)
 */
export function useIsProcessing() {
  const isProcessing = useProcessingStore((state) => state.isProcessing);
  const setProcessing = useProcessingStore((state) => state.setProcessing);
  
  return [isProcessing, setProcessing] as const;
}

/**
 * Hook for file error state
 * Replaces: const [fileError, setFileError] = useState<string | null>(null)
 */
export function useFileError() {
  const fileError = useProcessingStore((state) => state.fileError);
  const setFileError = useProcessingStore((state) => state.setFileError);
  
  return [fileError, setFileError] as const;
}

/**
 * Hook for mesh processing state
 * Replaces: const [isMeshProcessing, setIsMeshProcessing] = useState(false)
 */
export function useIsMeshProcessing() {
  const isMeshProcessing = useProcessingStore((state) => state.isMeshProcessing);
  const setMeshProcessing = useProcessingStore((state) => state.setMeshProcessing);
  
  return [isMeshProcessing, setMeshProcessing] as const;
}

/**
 * Hook for mesh analysis result
 * Replaces: const [meshAnalysis, setMeshAnalysis] = useState<MeshAnalysisResult | null>(null)
 */
export function useMeshAnalysis() {
  const meshAnalysis = useProcessingStore((state) => state.meshAnalysis);
  const setMeshAnalysis = useProcessingStore((state) => state.setMeshAnalysis);
  
  return [meshAnalysis, setMeshAnalysis] as const;
}

/**
 * Hook for mesh processing progress
 * Replaces: const [meshProgress, setMeshProgress] = useState<MeshProcessingProgress | null>(null)
 */
export function useMeshProgress() {
  const meshProgress = useProcessingStore((state) => state.meshProgress);
  const setMeshProgress = useProcessingStore((state) => state.setMeshProgress);
  
  return [meshProgress, setMeshProgress] as const;
}

/**
 * Hook for pending file
 * Replaces: const [pendingProcessedFile, setPendingProcessedFile] = useState<ProcessedFile | null>(null)
 */
export function usePendingFile() {
  const pendingFile = useProcessingStore((state) => state.pendingFile);
  const setPendingFile = useProcessingStore((state) => state.setPendingFile);
  
  return [pendingFile, setPendingFile] as const;
}

/**
 * Hook for processing result
 * Replaces: const [processingResult, setProcessingResult] = useState<{...} | null>(null)
 */
export function useProcessingResult() {
  const result = useProcessingStore((state) => state.result);
  const setResult = useProcessingStore((state) => state.setResult);
  
  return [result, setResult] as const;
}

/**
 * Hook for exporting state
 * Replaces: const [isExporting, setIsExporting] = useState(false)
 */
export function useIsExporting() {
  const isExporting = useProcessingStore((state) => state.isExporting);
  const setExporting = useProcessingStore((state) => state.setExporting);
  
  return [isExporting, setExporting] as const;
}

/**
 * Hook to clear all processing state
 */
export function useClearProcessing() {
  return useProcessingStore((state) => state.clear);
}

/**
 * Hook for full processing store
 */
export function useProcessing() {
  return useProcessingStore();
}
