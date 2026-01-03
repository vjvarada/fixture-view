/**
 * File Import Module - Refactored Exports
 * 
 * Application-specific file import orchestration.
 * Note: Core services (meshAnalysis, stlParser) have been moved to @rapidtool/cad-core
 */

// Default export - FileImport component
export { default } from './index.tsx';

// Re-export from @rapidtool/cad-core for convenience
export { 
  analyzeMesh,
  repairMesh,
  decimateMesh,
  processMeshPipeline,
  parseSTL,
  validateSTLBuffer,
  type MeshAnalysisResult,
  type MeshRepairResult,
  type DecimationResult,
  type ProcessingProgress,
  type ProgressCallback,
  type PipelineOptions,
  type PipelineResult,
} from '@rapidtool/cad-core';

// Hooks
export { 
  useFileProcessing,
  type FileProcessingState,
  type FileProcessingResult,
} from './hooks/useFileProcessing';

// Types (re-export from types folder)
export type { 
  ProcessedFile, 
  FileMetadata, 
  ViewerConfig,
  ViewOrientation,
  ViewerHandle,
} from './types/index';

export { DEFAULT_VIEWER_CONFIG, SUPPORTED_FORMATS } from './types/index';
