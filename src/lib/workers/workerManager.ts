// ============================================
// Worker Manager
// Utility for managing web workers for heavy computations
// ============================================

import type { CSGWorkerInput, CSGWorkerOutput } from './csgWorker';

// Worker pool for CSG operations
let csgWorker: Worker | null = null;
let csgWorkerPromises: Map<string, { resolve: (value: any) => void; reject: (error: any) => void }> = new Map();

/**
 * Get or create the CSG worker
 */
function getCSGWorker(): Worker {
  if (!csgWorker) {
    csgWorker = new Worker(
      new URL('./csgWorker.ts', import.meta.url),
      { type: 'module' }
    );
    
    csgWorker.onmessage = (e: MessageEvent<CSGWorkerOutput>) => {
      const { type, id, data, batchData, error } = e.data;
      const promise = csgWorkerPromises.get(id);
      
      if (!promise) return;
      
      if (type === 'error') {
        promise.reject(new Error(error));
        csgWorkerPromises.delete(id);
      } else if (type === 'subtraction-result' || type === 'batch-result' || type === 'union-result') {
        promise.resolve(data || batchData);
        csgWorkerPromises.delete(id);
      } else if (type === 'progress') {
        // Progress updates are handled separately via callbacks
      }
    };
    
    csgWorker.onerror = (error) => {
      console.error('[CSGWorker] Error:', error);
      // Reject all pending promises
      csgWorkerPromises.forEach((promise) => {
        promise.reject(error);
      });
      csgWorkerPromises.clear();
    };
  }
  
  return csgWorker;
}

/**
 * Generate unique ID for worker requests
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract geometry data for transfer to worker
 */
export function extractGeometryForWorker(geometry: THREE.BufferGeometry): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
} {
  const posAttr = geometry.getAttribute('position');
  const normAttr = geometry.getAttribute('normal');
  const indexAttr = geometry.index;
  
  const positions = new Float32Array(posAttr.array);
  const normals = normAttr ? new Float32Array(normAttr.array) : new Float32Array(0);
  const indices = indexAttr ? new Uint32Array(indexAttr.array) : new Uint32Array(0);
  
  return { positions, normals, indices };
}

/**
 * Reconstruct geometry from worker result
 */
export function reconstructGeometry(data: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  
  if (data.normals.length > 0) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  }
  
  if (data.indices.length > 0) {
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  }
  
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  
  return geometry;
}

/**
 * Perform batch CSG subtraction in a web worker
 */
export async function performBatchCSGSubtractionInWorker(
  supports: Array<{
    id: string;
    geometry: THREE.BufferGeometry;
  }>,
  cutterGeometry: THREE.BufferGeometry,
  onProgress?: (current: number, total: number, supportId: string, stage?: string) => void
): Promise<Map<string, THREE.BufferGeometry>> {
  const worker = getCSGWorker();
  const id = generateId();
  
  // Prepare data for transfer
  const supportsData = supports.map(s => ({
    id: s.id,
    ...extractGeometryForWorker(s.geometry)
  }));
  
  const cutterData = extractGeometryForWorker(cutterGeometry);
  
  // Set up progress handler
  const progressHandler = (e: MessageEvent<CSGWorkerOutput>) => {
    if (e.data.id === id && e.data.type === 'progress' && e.data.progress && onProgress) {
      onProgress(
        e.data.progress.current,
        e.data.progress.total,
        e.data.progress.supportId || '',
        'csg' // Stage: CSG operations in worker
      );
    }
  };
  
  worker.addEventListener('message', progressHandler);
  
  return new Promise((resolve, reject) => {
    csgWorkerPromises.set(id, {
      resolve: (batchData: CSGWorkerOutput['batchData']) => {
        worker.removeEventListener('message', progressHandler);
        
        const resultMap = new Map<string, THREE.BufferGeometry>();
        
        if (batchData) {
          const total = batchData.length;
          for (let i = 0; i < batchData.length; i++) {
            const result = batchData[i];
            // Report reconstruction progress
            if (onProgress) {
              onProgress(i + 1, total, result.supportId, 'reconstruct');
            }
            
            if (result.success && result.positions && result.normals && result.indices) {
              const geometry = reconstructGeometry({
                positions: result.positions,
                normals: result.normals,
                indices: result.indices
              });
              resultMap.set(result.supportId, geometry);
            } else if (!result.success) {
              // Log the error for debugging
              console.warn(`[CSGWorker] Failed to process support ${result.supportId}: ${result.error}`);
            }
          }
        }
        
        resolve(resultMap);
      },
      reject: (error) => {
        worker.removeEventListener('message', progressHandler);
        reject(error);
      }
    });
    
    // Collect transferable buffers
    const transferables: Transferable[] = [];
    supportsData.forEach(s => {
      transferables.push(s.positions.buffer as ArrayBuffer);
      transferables.push(s.normals.buffer as ArrayBuffer);
      transferables.push(s.indices.buffer as ArrayBuffer);
    });
    transferables.push(cutterData.positions.buffer as ArrayBuffer);
    transferables.push(cutterData.normals.buffer as ArrayBuffer);
    transferables.push(cutterData.indices.buffer as ArrayBuffer);
    
    // Send message to worker
    worker.postMessage(
      {
        type: 'subtract-batch',
        id,
        data: {
          supports: supportsData,
          cutter: cutterData
        }
      } as CSGWorkerInput,
      transferables
    );
  });
}

/**
 * Perform single CSG subtraction in a web worker
 */
export async function performCSGSubtractionInWorker(
  supportGeometry: THREE.BufferGeometry,
  cutterGeometry: THREE.BufferGeometry,
  supportId?: string
): Promise<THREE.BufferGeometry | null> {
  const worker = getCSGWorker();
  const id = generateId();
  
  const supportData = extractGeometryForWorker(supportGeometry);
  const cutterData = extractGeometryForWorker(cutterGeometry);
  
  return new Promise((resolve, reject) => {
    csgWorkerPromises.set(id, {
      resolve: (data: CSGWorkerOutput['data']) => {
        if (data && data.positions && data.normals && data.indices) {
          const geometry = reconstructGeometry({
            positions: data.positions,
            normals: data.normals,
            indices: data.indices
          });
          resolve(geometry);
        } else {
          resolve(null);
        }
      },
      reject
    });
    
    // Collect transferable buffers
    const transferables: Transferable[] = [
      supportData.positions.buffer as ArrayBuffer,
      supportData.normals.buffer as ArrayBuffer,
      supportData.indices.buffer as ArrayBuffer,
      cutterData.positions.buffer as ArrayBuffer,
      cutterData.normals.buffer as ArrayBuffer,
      cutterData.indices.buffer as ArrayBuffer
    ];
    
    // Send message to worker
    worker.postMessage(
      {
        type: 'subtract-single',
        id,
        data: {
          supportGeometry: supportData,
          cutterGeometry: cutterData,
          supportId
        }
      } as CSGWorkerInput,
      transferables
    );
  });
}

/**
 * Perform batch CSG union in a web worker (combine multiple geometries into one)
 */
export async function performBatchCSGUnionInWorker(
  geometries: Array<{
    id: string;
    geometry: THREE.BufferGeometry;
  }>,
  baseplateGeometry?: THREE.BufferGeometry,
  onProgress?: (current: number, total: number, stage: string) => void
): Promise<THREE.BufferGeometry | null> {
  console.log('[performBatchCSGUnionInWorker] Starting union with', geometries.length, 'geometries');
  
  // Log each geometry being sent
  geometries.forEach((g, i) => {
    const pos = g.geometry.getAttribute('position');
    const norm = g.geometry.getAttribute('normal');
    const idx = g.geometry.index;
    console.log(`[performBatchCSGUnionInWorker] Geometry ${i} (${g.id}):`, {
      hasPosition: !!pos,
      positionCount: pos?.count || 0,
      hasNormal: !!norm,
      normalCount: norm?.count || 0,
      hasIndex: !!idx,
      indexCount: idx?.count || 0
    });
  });
  
  const worker = getCSGWorker();
  const id = generateId();
  
  // Prepare geometries for transfer
  const geometriesData = geometries.map(g => {
    const extracted = extractGeometryForWorker(g.geometry);
    console.log(`[performBatchCSGUnionInWorker] Extracted ${g.id}:`, {
      positionsLength: extracted.positions.length,
      normalsLength: extracted.normals.length,
      indicesLength: extracted.indices.length
    });
    return {
      id: g.id,
      ...extracted
    };
  });
  
  const baseplateData = baseplateGeometry ? extractGeometryForWorker(baseplateGeometry) : undefined;
  if (baseplateData) {
    console.log('[performBatchCSGUnionInWorker] Baseplate data:', {
      positionsLength: baseplateData.positions.length,
      normalsLength: baseplateData.normals.length,
      indicesLength: baseplateData.indices.length
    });
  }
  
  // Set up progress handler
  const progressHandler = (e: MessageEvent<CSGWorkerOutput>) => {
    if (e.data.id === id && e.data.type === 'progress' && e.data.progress && onProgress) {
      onProgress(
        e.data.progress.current,
        e.data.progress.total,
        e.data.progress.stage || ''
      );
    }
  };
  
  worker.addEventListener('message', progressHandler);
  
  return new Promise((resolve, reject) => {
    csgWorkerPromises.set(id, {
      resolve: (data: CSGWorkerOutput['data']) => {
        worker.removeEventListener('message', progressHandler);
        
        if (data && data.positions && data.normals && data.indices) {
          const geometry = reconstructGeometry({
            positions: data.positions,
            normals: data.normals,
            indices: data.indices
          });
          resolve(geometry);
        } else {
          resolve(null);
        }
      },
      reject: (error) => {
        worker.removeEventListener('message', progressHandler);
        reject(error);
      }
    });
    
    // Collect transferable buffers
    const transferables: Transferable[] = [];
    geometriesData.forEach(g => {
      transferables.push(g.positions.buffer as ArrayBuffer);
      transferables.push(g.normals.buffer as ArrayBuffer);
      transferables.push(g.indices.buffer as ArrayBuffer);
    });
    if (baseplateData) {
      transferables.push(baseplateData.positions.buffer as ArrayBuffer);
      transferables.push(baseplateData.normals.buffer as ArrayBuffer);
      transferables.push(baseplateData.indices.buffer as ArrayBuffer);
    }
    
    // Send message to worker
    worker.postMessage(
      {
        type: 'union-batch',
        id,
        data: {
          supports: geometriesData,
          cutter: baseplateData
        }
      } as CSGWorkerInput,
      transferables
    );
  });
}

/**
 * Terminate all workers and clean up
 */
export function terminateWorkers(): void {
  if (csgWorker) {
    csgWorker.terminate();
    csgWorker = null;
    csgWorkerPromises.clear();
  }
  if (clampCSGWorker) {
    clampCSGWorker.terminate();
    clampCSGWorker = null;
    clampCSGWorkerPromises.clear();
  }
}

// ============================================
// Clamp CSG Worker
// ============================================

// Worker pool for clamp CSG operations
let clampCSGWorker: Worker | null = null;
let clampCSGWorkerPromises: Map<string, {
  resolve: (value: THREE.BufferGeometry | null) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}> = new Map();

/**
 * Get or create the clamp CSG worker
 */
function getClampCSGWorker(): Worker {
  if (!clampCSGWorker) {
    clampCSGWorker = new Worker(
      new URL('./clampCSGWorker.ts', import.meta.url),
      { type: 'module' }
    );
    
    clampCSGWorker.onmessage = (e: MessageEvent) => {
      const { type, id, payload, progress, error } = e.data;
      const promise = clampCSGWorkerPromises.get(id);
      
      if (!promise) return;
      
      if (type === 'csg-error') {
        promise.reject(new Error(error));
        clampCSGWorkerPromises.delete(id);
      } else if (type === 'csg-progress' && promise.onProgress) {
        promise.onProgress(progress);
      } else if (type === 'csg-result') {
        if (payload) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
          
          if (payload.indices) {
            geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));
          }
          
          if (payload.normals) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3));
          } else {
            geometry.computeVertexNormals();
          }
          
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          
          promise.resolve(geometry);
        } else {
          promise.resolve(null);
        }
        clampCSGWorkerPromises.delete(id);
      }
    };
    
    clampCSGWorker.onerror = (error) => {
      console.error('[ClampCSGWorker] Error:', error);
      clampCSGWorkerPromises.forEach((promise) => {
        promise.reject(new Error('Worker error'));
      });
      clampCSGWorkerPromises.clear();
    };
  }
  
  return clampCSGWorker;
}

/**
 * Serialize a BufferGeometry for transfer to worker
 */
export function serializeGeometryForClampWorker(geometry: THREE.BufferGeometry): {
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
} {
  const posAttr = geometry.getAttribute('position');
  const positions = new Float32Array(posAttr.array);
  
  const result: { positions: Float32Array; indices?: Uint32Array; normals?: Float32Array } = {
    positions,
  };
  
  if (geometry.index) {
    result.indices = new Uint32Array(geometry.index.array);
  }
  
  const normAttr = geometry.getAttribute('normal');
  if (normAttr) {
    result.normals = new Float32Array(normAttr.array);
  }
  
  return result;
}

/**
 * Perform clamp CSG subtraction in a web worker
 * Used to subtract fixture cutouts from support geometry
 * Note: cutoutsGeometry should already have the Y offset applied
 */
export async function performClampCSGInWorker(
  supportGeometry: THREE.BufferGeometry,
  cutoutsGeometry: THREE.BufferGeometry | null,
  onProgress?: (progress: number) => void
): Promise<THREE.BufferGeometry | null> {
  // If no cutouts, return support geometry as-is (no worker needed)
  if (!cutoutsGeometry) {
    return supportGeometry.clone();
  }
  
  const worker = getClampCSGWorker();
  const id = generateId();
  
  const supportData = serializeGeometryForClampWorker(supportGeometry);
  const cutoutsData = serializeGeometryForClampWorker(cutoutsGeometry);
  
  return new Promise((resolve, reject) => {
    clampCSGWorkerPromises.set(id, {
      resolve,
      reject,
      onProgress,
    });
    
    // Collect transferable buffers
    const transferables: Transferable[] = [
      supportData.positions.buffer,
    ];
    if (supportData.indices) {
      transferables.push(supportData.indices.buffer);
    }
    if (supportData.normals) {
      transferables.push(supportData.normals.buffer);
    }
    
    transferables.push(cutoutsData.positions.buffer);
    if (cutoutsData.indices) {
      transferables.push(cutoutsData.indices.buffer);
    }
    if (cutoutsData.normals) {
      transferables.push(cutoutsData.normals.buffer);
    }
    
    // Send message to worker
    worker.postMessage(
      {
        type: 'compute-csg',
        id,
        payload: {
          supportGeometryData: supportData,
          cutoutsGeometryData: cutoutsData,
        },
      },
      transferables
    );
  });
}

// Need to import THREE for type definitions
import * as THREE from 'three';
