// ============================================
// Workers Module Exports
// ============================================

export { 
  performBatchCSGSubtractionInWorker,
  performCSGSubtractionInWorker,
  extractGeometryForWorker,
  reconstructGeometry,
  terminateWorkers
} from './workerManager';

export type { CSGWorkerInput, CSGWorkerOutput } from './csgWorker';
export type { OffsetMeshWorkerInput, OffsetMeshWorkerOutput } from './offsetMeshWorker';
