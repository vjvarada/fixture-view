// ============================================
// Cavity CSG Web Worker
// Handles CPU-intensive CSG subtraction operations
// ============================================

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

// Message types
export interface CSGWorkerInput {
  type: 'subtract-single' | 'subtract-batch';
  id: string;
  data: {
    // For single subtraction
    supportGeometry?: {
      positions: Float32Array;
      normals?: Float32Array;
      indices?: Uint32Array;
    };
    cutterGeometry?: {
      positions: Float32Array;
      normals?: Float32Array;
      indices?: Uint32Array;
    };
    supportId?: string;
    
    // For batch subtraction
    supports?: Array<{
      id: string;
      positions: Float32Array;
      normals?: Float32Array;
      indices?: Uint32Array;
    }>;
    cutter?: {
      positions: Float32Array;
      normals?: Float32Array;
      indices?: Uint32Array;
    };
  };
}

export interface CSGWorkerOutput {
  type: 'subtraction-result' | 'batch-result' | 'progress' | 'error';
  id: string;
  data?: {
    supportId?: string;
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    vertexCount: number;
    triangleCount: number;
  };
  batchData?: Array<{
    supportId: string;
    success: boolean;
    positions?: Float32Array;
    normals?: Float32Array;
    indices?: Uint32Array;
    vertexCount?: number;
    triangleCount?: number;
    error?: string;
  }>;
  progress?: {
    current: number;
    total: number;
    stage: string;
    supportId?: string;
  };
  error?: string;
}

// Helper to create BufferGeometry from arrays
function createGeometryFromArrays(
  positions: Float32Array,
  normals?: Float32Array,
  indices?: Uint32Array
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  if (normals && normals.length > 0) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  }
  
  if (indices && indices.length > 0) {
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  } else {
    // Create indices if not provided
    const vertexCount = positions.length / 3;
    const indexArray = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indexArray[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  }
  
  // Ensure UV attribute exists for CSG
  if (!geometry.getAttribute('uv')) {
    const position = geometry.getAttribute('position');
    const uvArray = new Float32Array(position.count * 2);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }
  
  geometry.computeVertexNormals();
  return geometry;
}

// Extract geometry data for transfer
function extractGeometryData(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position').array as Float32Array;
  const normals = geometry.getAttribute('normal')?.array as Float32Array || new Float32Array(0);
  const indices = geometry.index?.array as Uint32Array || new Uint32Array(0);
  
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3
  };
}

// Process single CSG subtraction
function processSingleSubtraction(
  supportData: CSGWorkerInput['data']['supportGeometry'],
  cutterData: CSGWorkerInput['data']['cutterGeometry']
): CSGWorkerOutput['data'] | null {
  if (!supportData || !cutterData) return null;
  
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  
  // Create geometries
  const supportGeometry = createGeometryFromArrays(
    supportData.positions,
    supportData.normals,
    supportData.indices
  );
  
  const cutterGeometry = createGeometryFromArrays(
    cutterData.positions,
    cutterData.normals,
    cutterData.indices
  );
  
  // Create brushes
  const supportBrush = new Brush(supportGeometry);
  supportBrush.updateMatrixWorld();
  // Prepare BVH and half-edge structures for CSG
  supportBrush.prepareGeometry();
  
  const cutterBrush = new Brush(cutterGeometry);
  cutterBrush.updateMatrixWorld();
  // Prepare BVH and half-edge structures for CSG
  cutterBrush.prepareGeometry();
  
  // Perform CSG subtraction
  const resultBrush = evaluator.evaluate(supportBrush, cutterBrush, SUBTRACTION);
  
  if (!resultBrush || !resultBrush.geometry) {
    return null;
  }
  
  const resultGeometry = resultBrush.geometry.clone();
  resultGeometry.computeVertexNormals();
  
  return extractGeometryData(resultGeometry);
}

// Process batch CSG subtraction
function processBatchSubtraction(
  supports: CSGWorkerInput['data']['supports'],
  cutterData: CSGWorkerInput['data']['cutter'],
  progressCallback: (current: number, total: number, supportId: string) => void
): CSGWorkerOutput['batchData'] {
  if (!supports || !cutterData) {
    console.error('[CSGWorker] Invalid input: supports or cutterData is null');
    return [];
  }
  
  console.log(`[CSGWorker] Starting batch subtraction: ${supports.length} supports`);
  console.log(`[CSGWorker] Cutter positions: ${cutterData.positions.length / 3} vertices`);
  
  // Create evaluator once and reuse for all operations
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  
  // Create cutter geometry once (reuse for all supports)
  const cutterGeometry = createGeometryFromArrays(
    cutterData.positions,
    cutterData.normals,
    cutterData.indices
  );
  
  const cutterBrush = new Brush(cutterGeometry);
  cutterBrush.updateMatrixWorld();
  // IMPORTANT: Prepare BVH and half-edge structures upfront for the cutter
  // This builds the MeshBVH once for reuse across all support subtractions
  cutterBrush.prepareGeometry();
  
  const results: CSGWorkerOutput['batchData'] = [];
  
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i];
    progressCallback(i + 1, supports.length, support.id);
    
    console.log(`[CSGWorker] Processing support ${i + 1}/${supports.length}: ${support.id}, positions: ${support.positions.length / 3} vertices`);
    
    try {
      // Create support geometry
      const supportGeometry = createGeometryFromArrays(
        support.positions,
        support.normals,
        support.indices
      );
      
      const supportBrush = new Brush(supportGeometry);
      supportBrush.updateMatrixWorld();
      // Prepare BVH for each support
      supportBrush.prepareGeometry();
      
      // Perform CSG subtraction
      const resultBrush = evaluator.evaluate(supportBrush, cutterBrush, SUBTRACTION);
      
      if (resultBrush && resultBrush.geometry) {
        const resultGeometry = resultBrush.geometry;
        
        // Check if result geometry has valid data
        const posAttr = resultGeometry.getAttribute('position');
        if (!posAttr || posAttr.count === 0) {
          results.push({
            supportId: support.id,
            success: false,
            error: 'CSG result has no position data'
          });
          supportGeometry.dispose();
          continue;
        }
        
        // Only compute normals if they don't exist or are invalid
        if (!resultGeometry.getAttribute('normal') || 
            resultGeometry.getAttribute('normal').count !== posAttr.count) {
          resultGeometry.computeVertexNormals();
        }
        
        const data = extractGeometryData(resultGeometry);
        
        // Verify extracted data
        if (data.positions.length === 0) {
          results.push({
            supportId: support.id,
            success: false,
            error: 'Extracted positions array is empty'
          });
          supportGeometry.dispose();
          continue;
        }
        
        results.push({
          supportId: support.id,
          success: true,
          ...data
        });
        
        // Dispose support geometry to free memory
        supportGeometry.dispose();
      } else {
        results.push({
          supportId: support.id,
          success: false,
          error: `CSG operation returned ${resultBrush ? 'brush without geometry' : 'null'}`
        });
      }
    } catch (error) {
      results.push({
        supportId: support.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Clean up
  cutterGeometry.dispose();
  
  return results;
}

// Worker message handler
self.onmessage = (e: MessageEvent<CSGWorkerInput>) => {
  const { type, id, data } = e.data;
  
  if (type === 'subtract-single') {
    try {
      const result = processSingleSubtraction(data.supportGeometry, data.cutterGeometry);
      
      if (result) {
        const transferables: Transferable[] = [
          result.positions.buffer as ArrayBuffer,
          result.normals.buffer as ArrayBuffer,
          result.indices.buffer as ArrayBuffer
        ];
        
        (self as unknown as Worker).postMessage(
          {
            type: 'subtraction-result',
            id,
            data: {
              ...result,
              supportId: data.supportId
            }
          } as CSGWorkerOutput,
          transferables
        );
      } else {
        (self as unknown as Worker).postMessage({
          type: 'error',
          id,
          error: 'CSG subtraction returned no result'
        } as CSGWorkerOutput);
      }
    } catch (error) {
      (self as unknown as Worker).postMessage({
        type: 'error',
        id,
        error: error instanceof Error ? error.message : String(error)
      } as CSGWorkerOutput);
    }
  } else if (type === 'subtract-batch') {
    try {
      const progressCallback = (current: number, total: number, supportId: string) => {
        (self as unknown as Worker).postMessage({
          type: 'progress',
          id,
          progress: {
            current,
            total,
            stage: `Processing support ${current}/${total}`,
            supportId
          }
        } as CSGWorkerOutput);
      };
      
      const results = processBatchSubtraction(data.supports, data.cutter, progressCallback);
      
      // Collect all transferable buffers
      const transferables: Transferable[] = [];
      results.forEach(r => {
        if (r.positions) transferables.push(r.positions.buffer as ArrayBuffer);
        if (r.normals) transferables.push(r.normals.buffer as ArrayBuffer);
        if (r.indices) transferables.push(r.indices.buffer as ArrayBuffer);
      });
      
      (self as unknown as Worker).postMessage(
        {
          type: 'batch-result',
          id,
          batchData: results
        } as CSGWorkerOutput,
        transferables
      );
    } catch (error) {
      (self as unknown as Worker).postMessage({
        type: 'error',
        id,
        error: error instanceof Error ? error.message : String(error)
      } as CSGWorkerOutput);
    }
  }
};

export {};
