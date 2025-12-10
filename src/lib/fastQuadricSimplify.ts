/**
 * Fast Quadric Mesh Simplification - WASM Wrapper
 * 
 * Wraps the WASM build of Fast-Quadric-Mesh-Simplification for use with THREE.js geometries.
 * @see https://github.com/MyMiniFactory/Fast-Quadric-Mesh-Simplification
 */

import * as THREE from 'three';

// Module interface for Emscripten-compiled WASM
interface SimplifyModule {
  ccall: (name: string, returnType: string | null, argTypes: string[], args: any[]) => any;
  FS_createDataFile: (parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void;
  FS_readFile: (path: string) => Uint8Array;
  FS_unlink: (path: string) => void;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

let moduleInstance: SimplifyModule | null = null;
let moduleLoading: Promise<SimplifyModule> | null = null;

/**
 * Load the WASM module (singleton)
 */
async function loadModule(): Promise<SimplifyModule> {
  if (moduleInstance) return moduleInstance;
  if (moduleLoading) return moduleLoading;

  moduleLoading = new Promise((resolve, reject) => {
    // Create Module object that Emscripten will use
    const Module: any = {
      print: (text: string) => console.log('[Simplify]', text),
      printErr: (text: string) => console.warn('[Simplify]', text),
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return '/fast-simplify.wasm';
        }
        return path;
      },
      onRuntimeInitialized: () => {
        moduleInstance = Module as SimplifyModule;
        resolve(moduleInstance);
      }
    };

    // Expose Module globally for the script
    (window as any).Module = Module;

    // Load the JS glue code
    const script = document.createElement('script');
    script.src = '/fast-simplify.js';
    script.onerror = () => reject(new Error('Failed to load fast-simplify.js'));
    document.head.appendChild(script);
  });

  return moduleLoading;
}

/**
 * Convert THREE.BufferGeometry to binary STL format
 */
function geometryToSTL(geometry: THREE.BufferGeometry): Uint8Array {
  const positions = geometry.getAttribute('position');
  const indices = geometry.index;
  
  let triangleCount: number;
  let getTriangle: (i: number) => [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  
  if (indices) {
    triangleCount = indices.count / 3;
    getTriangle = (i: number) => {
      const i0 = indices.getX(i * 3);
      const i1 = indices.getX(i * 3 + 1);
      const i2 = indices.getX(i * 3 + 2);
      return [
        new THREE.Vector3(positions.getX(i0), positions.getY(i0), positions.getZ(i0)),
        new THREE.Vector3(positions.getX(i1), positions.getY(i1), positions.getZ(i1)),
        new THREE.Vector3(positions.getX(i2), positions.getY(i2), positions.getZ(i2))
      ];
    };
  } else {
    triangleCount = positions.count / 3;
    getTriangle = (i: number) => {
      const idx = i * 3;
      return [
        new THREE.Vector3(positions.getX(idx), positions.getY(idx), positions.getZ(idx)),
        new THREE.Vector3(positions.getX(idx + 1), positions.getY(idx + 1), positions.getZ(idx + 1)),
        new THREE.Vector3(positions.getX(idx + 2), positions.getY(idx + 2), positions.getZ(idx + 2))
      ];
    };
  }
  
  // Binary STL format:
  // - 80 bytes header
  // - 4 bytes triangle count (uint32)
  // - For each triangle:
  //   - 12 bytes normal (3 x float32)
  //   - 36 bytes vertices (3 vertices x 3 floats x 4 bytes)
  //   - 2 bytes attribute byte count (uint16, usually 0)
  const bufferSize = 80 + 4 + triangleCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const dataView = new DataView(buffer);
  
  // Header (80 bytes)
  const header = 'Binary STL generated for Fast-Quadric-Mesh-Simplification';
  for (let i = 0; i < 80; i++) {
    dataView.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  
  // Triangle count
  dataView.setUint32(80, triangleCount, true);
  
  // Triangles
  let offset = 84;
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  
  for (let i = 0; i < triangleCount; i++) {
    const [v0, v1, v2] = getTriangle(i);
    
    // Compute normal
    edge1.subVectors(v1, v0);
    edge2.subVectors(v2, v0);
    normal.crossVectors(edge1, edge2).normalize();
    
    // Write normal
    dataView.setFloat32(offset, normal.x, true); offset += 4;
    dataView.setFloat32(offset, normal.y, true); offset += 4;
    dataView.setFloat32(offset, normal.z, true); offset += 4;
    
    // Write vertices
    dataView.setFloat32(offset, v0.x, true); offset += 4;
    dataView.setFloat32(offset, v0.y, true); offset += 4;
    dataView.setFloat32(offset, v0.z, true); offset += 4;
    
    dataView.setFloat32(offset, v1.x, true); offset += 4;
    dataView.setFloat32(offset, v1.y, true); offset += 4;
    dataView.setFloat32(offset, v1.z, true); offset += 4;
    
    dataView.setFloat32(offset, v2.x, true); offset += 4;
    dataView.setFloat32(offset, v2.y, true); offset += 4;
    dataView.setFloat32(offset, v2.z, true); offset += 4;
    
    // Attribute byte count
    dataView.setUint16(offset, 0, true); offset += 2;
  }
  
  return new Uint8Array(buffer);
}

/**
 * Parse binary STL to THREE.BufferGeometry
 */
function stlToGeometry(stlData: Uint8Array): THREE.BufferGeometry {
  const dataView = new DataView(stlData.buffer, stlData.byteOffset, stlData.byteLength);
  
  // Read triangle count
  const triangleCount = dataView.getUint32(80, true);
  
  // Pre-allocate arrays
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  
  let offset = 84;
  let posIdx = 0;
  let normIdx = 0;
  
  for (let i = 0; i < triangleCount; i++) {
    // Read normal
    const nx = dataView.getFloat32(offset, true); offset += 4;
    const ny = dataView.getFloat32(offset, true); offset += 4;
    const nz = dataView.getFloat32(offset, true); offset += 4;
    
    // Read vertices
    for (let v = 0; v < 3; v++) {
      positions[posIdx++] = dataView.getFloat32(offset, true); offset += 4;
      positions[posIdx++] = dataView.getFloat32(offset, true); offset += 4;
      positions[posIdx++] = dataView.getFloat32(offset, true); offset += 4;
      
      normals[normIdx++] = nx;
      normals[normIdx++] = ny;
      normals[normIdx++] = nz;
    }
    
    // Skip attribute byte count
    offset += 2;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  
  return geometry;
}

export interface SimplifyOptions {
  /** Target reduction ratio (0.0 to 1.0). 0.5 means reduce to 50% of triangles. */
  ratio: number;
  /** Progress callback */
  onProgress?: (stage: string, percent: number, message: string) => void;
}

export interface SimplifyResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  originalTriangles: number;
  finalTriangles: number;
  reductionPercent: number;
  error?: string;
}

/**
 * Simplify a THREE.BufferGeometry using Fast Quadric Mesh Simplification (WASM)
 */
export async function simplifyGeometry(
  geometry: THREE.BufferGeometry,
  options: SimplifyOptions
): Promise<SimplifyResult> {
  const { ratio, onProgress } = options;
  
  const positions = geometry.getAttribute('position');
  const indices = geometry.index;
  const originalTriangles = indices ? indices.count / 3 : positions.count / 3;
  
  try {
    onProgress?.('loading', 0, 'Loading WASM module...');
    const module = await loadModule();
    
    onProgress?.('converting', 20, 'Converting geometry to STL...');
    const stlData = geometryToSTL(geometry);
    
    onProgress?.('writing', 30, 'Writing to virtual filesystem...');
    const inputFile = 'input.stl';
    const outputFile = 'output.stl';
    
    // Clean up any existing files
    try { module.FS_unlink(inputFile); } catch {}
    try { module.FS_unlink(outputFile); } catch {}
    
    // Write input file to virtual FS
    module.FS_createDataFile('.', inputFile, stlData, true, true);
    
    onProgress?.('simplifying', 40, 'Running simplification...');
    
    // Call the simplify function: simplify(input_path, ratio, output_path)
    const result = module.ccall(
      'simplify',
      'number',
      ['string', 'number', 'string'],
      [inputFile, ratio, outputFile]
    );
    
    if (result !== 0) {
      throw new Error(`Simplification failed with code ${result}`);
    }
    
    onProgress?.('reading', 80, 'Reading result...');
    
    // Read the output file
    const outputData = module.FS_readFile(outputFile);
    
    onProgress?.('parsing', 90, 'Parsing simplified mesh...');
    
    // Convert back to geometry
    const simplifiedGeometry = stlToGeometry(outputData);
    
    // Clean up virtual filesystem
    try { module.FS_unlink(inputFile); } catch {}
    try { module.FS_unlink(outputFile); } catch {}
    
    const finalTriangles = simplifiedGeometry.getAttribute('position').count / 3;
    const reductionPercent = ((originalTriangles - finalTriangles) / originalTriangles) * 100;
    
    onProgress?.('complete', 100, 'Simplification complete');
    
    return {
      success: true,
      geometry: simplifiedGeometry,
      originalTriangles,
      finalTriangles,
      reductionPercent
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fast Quadric Simplification error:', error);
    return {
      success: false,
      geometry: null,
      originalTriangles,
      finalTriangles: 0,
      reductionPercent: 0,
      error: errorMessage
    };
  }
}
