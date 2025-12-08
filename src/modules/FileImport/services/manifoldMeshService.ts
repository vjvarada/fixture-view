/**
 * Manifold Mesh Service
 * 
 * Provides robust mesh repair and decimation using Manifold3D library.
 * Manifold3D is a high-quality geometry library that guarantees manifold output
 * and provides robust mesh operations.
 * 
 * Key features:
 * - Proper mesh repair (makes meshes watertight/manifold)
 * - Topology-preserving mesh simplification
 * - Robust handling of non-manifold edges
 * - Fallback to vertex clustering for non-manifold meshes
 */

import * as THREE from 'three';
import Module from 'manifold-3d';
import { decimateMesh as fallbackDecimateMesh } from './meshAnalysisService';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ManifoldRepairResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  originalTriangles: number;
  finalTriangles: number;
  wasRepaired: boolean;
  actions: string[];
  error?: string;
}

export interface ManifoldDecimationResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  originalTriangles: number;
  finalTriangles: number;
  reductionPercent: number;
  error?: string;
}

export interface ManifoldProcessResult {
  success: boolean;
  geometry: THREE.BufferGeometry | null;
  originalTriangles: number;
  finalTriangles: number;
  wasRepaired: boolean;
  wasDecimated: boolean;
  reductionPercent: number;
  actions: string[];
  error?: string;
}

export interface ManifoldProgressCallback {
  (progress: {
    stage: 'initializing' | 'repairing' | 'decimating' | 'finalizing' | 'complete';
    progress: number;
    message: string;
  }): void;
}

// ============================================================================
// Manifold Module Management
// ============================================================================

let manifoldModule: any = null;
let moduleInitPromise: Promise<any> | null = null;

/**
 * Yield to the UI thread to allow React to re-render
 * This is crucial for showing progress updates during heavy processing
 */
async function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Initialize the Manifold WASM module (singleton pattern)
 */
async function getManifoldModule(): Promise<any> {
  if (manifoldModule) {
    return manifoldModule;
  }
  
  if (moduleInitPromise) {
    return moduleInitPromise;
  }
  
  moduleInitPromise = Module().then((wasm: any) => {
    // Call setup() to initialize the module
    wasm.setup();
    manifoldModule = wasm;
    console.log('[ManifoldMeshService] ✓ Manifold3D WASM module initialized');
    return wasm;
  });
  
  return moduleInitPromise;
}

// ============================================================================
// Geometry Conversion Utilities
// ============================================================================

/**
 * Convert THREE.BufferGeometry to Manifold Mesh format
 * Based on the official three.ts example
 */
function threeGeometryToManifoldMesh(geometry: THREE.BufferGeometry, wasm: any): any {
  const { Mesh } = wasm;
  
  const positionAttr = geometry.getAttribute('position');
  const positions = positionAttr.array as Float32Array;
  
  // Manifold uses vertProperties for vertex data (interleaved)
  const vertProperties = new Float32Array(positions);
  
  // Generate triangle indices
  // For non-indexed geometry, each vertex is unique
  let triVerts: Uint32Array;
  if (geometry.index) {
    triVerts = new Uint32Array(geometry.index.array);
  } else {
    const vertexCount = positions.length / 3;
    triVerts = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      triVerts[i] = i;
    }
  }
  
  // Create the Mesh using the correct API
  const mesh = new Mesh({
    numProp: 3, // x, y, z per vertex
    vertProperties,
    triVerts,
  });
  
  // Call merge() to combine vertices with nearly identical positions
  // This is necessary for Manifold to work properly
  mesh.merge();
  
  return mesh;
}

/**
 * Convert Manifold Mesh back to THREE.BufferGeometry
 * Based on the official three.ts example
 */
function manifoldMeshToThreeGeometry(mesh: any): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  
  // Get vertex positions from vertProperties
  const vertProperties = mesh.vertProperties;
  const triVerts = mesh.triVerts;
  const numProp = mesh.numProp;
  
  // Check if we have indexed geometry
  if (triVerts && triVerts.length > 0) {
    // Create non-indexed geometry for simplicity
    const numTris = triVerts.length / 3;
    const positions = new Float32Array(numTris * 9);
    
    for (let i = 0; i < numTris; i++) {
      const i0 = triVerts[i * 3];
      const i1 = triVerts[i * 3 + 1];
      const i2 = triVerts[i * 3 + 2];
      
      // Vertex 0
      positions[i * 9 + 0] = vertProperties[i0 * numProp];
      positions[i * 9 + 1] = vertProperties[i0 * numProp + 1];
      positions[i * 9 + 2] = vertProperties[i0 * numProp + 2];
      
      // Vertex 1
      positions[i * 9 + 3] = vertProperties[i1 * numProp];
      positions[i * 9 + 4] = vertProperties[i1 * numProp + 1];
      positions[i * 9 + 5] = vertProperties[i1 * numProp + 2];
      
      // Vertex 2
      positions[i * 9 + 6] = vertProperties[i2 * numProp];
      positions[i * 9 + 7] = vertProperties[i2 * numProp + 1];
      positions[i * 9 + 8] = vertProperties[i2 * numProp + 2];
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  } else {
    // Direct vertex properties
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertProperties, 3));
  }
  
  geometry.computeVertexNormals();
  
  // Compute bounds tree if available
  if (typeof (geometry as any).computeBoundsTree === 'function') {
    (geometry as any).computeBoundsTree();
  }
  
  return geometry;
}

// ============================================================================
// Core Manifold Operations
// ============================================================================

/**
 * Repair a mesh using Manifold3D
 * 
 * Manifold3D will attempt to make the mesh manifold (watertight).
 * If the input mesh is already valid, it returns quickly.
 */
export async function repairMeshWithManifold(
  geometry: THREE.BufferGeometry,
  onProgress?: ManifoldProgressCallback
): Promise<ManifoldRepairResult> {
  const startTime = performance.now();
  const actions: string[] = [];
  
  try {
    onProgress?.({ stage: 'initializing', progress: 0, message: 'Loading Manifold3D...' });
    await yieldToUI();
    
    const wasm = await getManifoldModule();
    const { Manifold } = wasm;
    
    onProgress?.({ stage: 'repairing', progress: 10, message: 'Converting geometry...' });
    await yieldToUI();
    
    const positionAttr = geometry.getAttribute('position');
    const originalTriangles = positionAttr.count / 3;
    
    console.log(`[ManifoldMeshService] Starting repair. Original triangles: ${originalTriangles.toLocaleString()}`);
    
    // Convert to Manifold Mesh format
    const mesh = threeGeometryToManifoldMesh(geometry, wasm);
    
    onProgress?.({ stage: 'repairing', progress: 30, message: 'Creating Manifold...' });
    await yieldToUI();
    
    // Try to create a Manifold from the mesh
    // This will attempt to repair non-manifold geometry
    let manifold: any;
    let wasRepaired = false;
    
    try {
      // Manifold constructor will merge vertices and try to create valid manifold
      manifold = new Manifold(mesh);
      
      const status = manifold.status();
      if (status !== 0) { // 0 = NoError
        console.log('[ManifoldMeshService] Direct manifold creation had issues, status:', status);
        wasRepaired = true;
        actions.push('Manifold attempted automatic repair');
      }
      
      // Check if manifold is empty (failed)
      if (manifold.isEmpty()) {
        throw new Error('Created manifold is empty - mesh may be too damaged to repair');
      }
      
    } catch (err) {
      mesh.delete?.();
      throw err;
    }
    
    onProgress?.({ stage: 'repairing', progress: 70, message: 'Extracting repaired mesh...' });
    await yieldToUI();
    
    // Get the repaired mesh
    const repairedMesh = manifold.getMesh();
    const finalTriangles = manifold.numTri();
    
    if (finalTriangles !== originalTriangles) {
      actions.push(`Triangle count: ${originalTriangles.toLocaleString()} → ${finalTriangles.toLocaleString()}`);
      wasRepaired = true;
    }
    
    onProgress?.({ stage: 'finalizing', progress: 85, message: 'Converting back to Three.js...' });
    await yieldToUI();
    
    // Convert back to THREE.BufferGeometry
    const repairedGeometry = manifoldMeshToThreeGeometry(repairedMesh);
    
    // Cleanup WASM objects
    repairedMesh.delete?.();
    manifold.delete();
    mesh.delete?.();
    
    onProgress?.({ stage: 'complete', progress: 100, message: 'Repair complete' });
    await yieldToUI();
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[ManifoldMeshService] ✓ Repair complete in ${duration}s. Final triangles: ${finalTriangles.toLocaleString()}`);
    
    if (wasRepaired) {
      actions.push('Mesh successfully repaired with Manifold3D');
    } else {
      actions.push('Mesh was already valid');
    }
    
    return {
      success: true,
      geometry: repairedGeometry,
      originalTriangles,
      finalTriangles,
      wasRepaired,
      actions,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown repair error';
    console.error('[ManifoldMeshService] ✗ Repair failed:', errorMessage);
    
    return {
      success: false,
      geometry: null,
      originalTriangles: 0,
      finalTriangles: 0,
      wasRepaired: false,
      actions,
      error: errorMessage,
    };
  }
}

/**
 * Decimate (simplify) a mesh using Manifold3D's Simplify method
 * 
 * This uses topology-preserving simplification that guarantees
 * the output remains manifold while reducing triangle count.
 */
export async function decimateMeshWithManifold(
  geometry: THREE.BufferGeometry,
  targetTriangles: number,
  onProgress?: ManifoldProgressCallback,
  force: boolean = false // Force decimation even if below target
): Promise<ManifoldDecimationResult> {
  const startTime = performance.now();
  
  try {
    onProgress?.({ stage: 'initializing', progress: 0, message: 'Loading Manifold3D...' });
    await yieldToUI();
    
    const wasm = await getManifoldModule();
    const { Manifold } = wasm;
    
    onProgress?.({ stage: 'decimating', progress: 10, message: 'Converting geometry...' });
    await yieldToUI();
    
    const positionAttr = geometry.getAttribute('position');
    const originalTriangles = positionAttr.count / 3;
    
    console.log(`[ManifoldMeshService] Starting decimation. Original: ${originalTriangles.toLocaleString()}, Target: ${targetTriangles.toLocaleString()}, Force: ${force}`);
    
    // Skip if already below target (unless force is true)
    if (originalTriangles <= targetTriangles && !force) {
      console.log('[ManifoldMeshService] Mesh already below target, skipping decimation');
      return {
        success: true,
        geometry: geometry.clone(),
        originalTriangles,
        finalTriangles: originalTriangles,
        reductionPercent: 0,
      };
    }
    
    // Convert to Manifold Mesh format
    const mesh = threeGeometryToManifoldMesh(geometry, wasm);
    
    onProgress?.({ stage: 'decimating', progress: 25, message: 'Creating Manifold...' });
    await yieldToUI();
    
    // Create Manifold from mesh
    let manifold = new Manifold(mesh);
    
    const status = manifold.status();
    if (status !== 0) { // 0 = NoError
      console.log('[ManifoldMeshService] Warning: mesh has issues, status:', status);
    }
    
    if (manifold.isEmpty()) {
      mesh.delete?.();
      manifold.delete();
      throw new Error('Cannot decimate - mesh could not be converted to valid manifold');
    }
    
    onProgress?.({ stage: 'decimating', progress: 40, message: 'Computing simplification tolerance...' });
    await yieldToUI();
    
    // Calculate tolerance based on bounding box and target reduction
    const bbox = manifold.boundingBox();
    const bboxSize = new THREE.Vector3(
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2]
    );
    const maxDim = Math.max(bboxSize.x, bboxSize.y, bboxSize.z);
    
    // Tolerance determines how much simplification happens
    // Higher tolerance = more simplification
    // We use an iterative approach to reach target
    let tolerance = maxDim * 0.001; // Start with small tolerance
    const maxTolerance = maxDim * 0.1; // Max 10% of bounding box
    let simplified = manifold;
    let currentTriangles = manifold.numTri();
    let iterations = 0;
    const maxIterations = 10;
    
    onProgress?.({ stage: 'decimating', progress: 50, message: 'Simplifying mesh...' });
    await yieldToUI();
    
    while (currentTriangles > targetTriangles && tolerance < maxTolerance && iterations < maxIterations) {
      // Simplify with current tolerance
      const newSimplified = simplified.simplify(tolerance);
      const newTriangles = newSimplified.numTri();
      
      console.log(`[ManifoldMeshService] Iteration ${iterations + 1}: tolerance=${tolerance.toFixed(6)}, triangles=${newTriangles.toLocaleString()}`);
      
      // Clean up old manifold if not the original
      if (simplified !== manifold) {
        simplified.delete();
      }
      
      simplified = newSimplified;
      currentTriangles = newTriangles;
      
      // Increase tolerance for next iteration
      tolerance *= 2;
      iterations++;
      
      const progress = 50 + Math.min(40, (iterations / maxIterations) * 40);
      onProgress?.({ 
        stage: 'decimating', 
        progress, 
        message: `Simplifying... ${currentTriangles.toLocaleString()} triangles` 
      });
      
      // Yield to UI to show progress update
      await yieldToUI();
    }
    
    onProgress?.({ stage: 'finalizing', progress: 90, message: 'Converting back to Three.js...' });
    await yieldToUI();
    
    // Get final mesh
    const simplifiedMesh = simplified.getMesh();
    const finalTriangles = simplified.numTri();
    
    // Convert back to THREE.BufferGeometry
    const decimatedGeometry = manifoldMeshToThreeGeometry(simplifiedMesh);
    
    // Cleanup WASM objects
    simplifiedMesh.delete?.();
    if (simplified !== manifold) {
      simplified.delete();
    }
    manifold.delete();
    mesh.delete?.();
    
    const reductionPercent = ((originalTriangles - finalTriangles) / originalTriangles) * 100;
    
    onProgress?.({ stage: 'complete', progress: 100, message: 'Decimation complete' });
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[ManifoldMeshService] ✓ Decimation complete in ${duration}s. Reduction: ${reductionPercent.toFixed(1)}%`);
    console.log(`[ManifoldMeshService]   Original: ${originalTriangles.toLocaleString()} → Final: ${finalTriangles.toLocaleString()}`);
    
    return {
      success: true,
      geometry: decimatedGeometry,
      originalTriangles,
      finalTriangles,
      reductionPercent,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown decimation error';
    console.error('[ManifoldMeshService] ✗ Decimation failed:', errorMessage);
    
    return {
      success: false,
      geometry: null,
      originalTriangles: 0,
      finalTriangles: 0,
      reductionPercent: 0,
      error: errorMessage,
    };
  }
}

/**
 * Combined repair and decimation operation
 * 
 * This is the most robust approach - first repair to ensure manifoldness,
 * then decimate to reduce triangle count while preserving topology.
 */
export async function repairAndDecimateMesh(
  geometry: THREE.BufferGeometry,
  targetTriangles: number,
  options: {
    repair?: boolean;
    decimate?: boolean;
    forceDecimate?: boolean; // Force decimation even if below target (for large files)
  } = { repair: true, decimate: true, forceDecimate: false },
  onProgress?: ManifoldProgressCallback
): Promise<ManifoldProcessResult> {
  const startTime = performance.now();
  const actions: string[] = [];
  
  const positionAttr = geometry.getAttribute('position');
  const originalTriangles = positionAttr.count / 3;
  
  console.log('[ManifoldMeshService] ═══════════════════════════════════════════');
  console.log('[ManifoldMeshService] Starting mesh processing');
  console.log(`[ManifoldMeshService]   Original triangles: ${originalTriangles.toLocaleString()}`);
  console.log(`[ManifoldMeshService]   Target triangles: ${targetTriangles.toLocaleString()}`);
  console.log(`[ManifoldMeshService]   Repair: ${options.repair}, Decimate: ${options.decimate}`);
  console.log('[ManifoldMeshService] ═══════════════════════════════════════════');
  
  let currentGeometry = geometry;
  let wasRepaired = false;
  let wasDecimated = false;
  let finalTriangles = originalTriangles;
  
  try {
    // Step 1: Repair if requested
    if (options.repair) {
      onProgress?.({ stage: 'repairing', progress: 5, message: 'Starting repair...' });
      await yieldToUI();
      
      const repairResult = await repairMeshWithManifold(
        currentGeometry,
        (p) => {
          const mappedProgress = 5 + (p.progress * 0.4); // 5-45%
          onProgress?.({ ...p, progress: mappedProgress });
        }
      );
      
      if (repairResult.success && repairResult.geometry) {
        currentGeometry = repairResult.geometry;
        wasRepaired = repairResult.wasRepaired;
        finalTriangles = repairResult.finalTriangles;
        actions.push(...repairResult.actions);
      } else if (!repairResult.success) {
        console.warn('[ManifoldMeshService] Repair failed, continuing with original geometry');
        actions.push(`Repair skipped: ${repairResult.error}`);
      }
    }
    
    // Step 2: Decimate if requested and (triangle count is above target OR forceDecimate is true)
    const shouldDecimate = options.decimate && (finalTriangles > targetTriangles || options.forceDecimate);
    if (shouldDecimate) {
      onProgress?.({ stage: 'decimating', progress: 50, message: 'Starting decimation...' });
      await yieldToUI();
      
      // First try Manifold3D decimation
      let decimateResult = await decimateMeshWithManifold(
        currentGeometry,
        targetTriangles,
        (p) => {
          const mappedProgress = 50 + (p.progress * 0.4); // 50-90%
          onProgress?.({ ...p, progress: mappedProgress });
        },
        options.forceDecimate // Pass force flag
      );
      
      // If Manifold fails, use fallback vertex clustering decimation
      if (!decimateResult.success || !decimateResult.geometry) {
        console.log('[ManifoldMeshService] Manifold decimation failed, trying fallback vertex clustering...');
        onProgress?.({ stage: 'decimating', progress: 55, message: 'Using fallback decimation...' });
        await yieldToUI();
        
        const fallbackResult = await fallbackDecimateMesh(
          currentGeometry,
          targetTriangles,
          (p) => {
            const mappedProgress = 55 + (p.progress * 0.35); // 55-90%
            onProgress?.({ stage: 'decimating', progress: mappedProgress, message: p.message || 'Decimating...' });
          }
        );
        
        if (fallbackResult.success && fallbackResult.geometry) {
          decimateResult = {
            success: true,
            geometry: fallbackResult.geometry,
            originalTriangles: fallbackResult.originalTriangles,
            finalTriangles: fallbackResult.finalTriangles,
            reductionPercent: fallbackResult.reductionPercent,
          };
          actions.push('Used fallback vertex clustering (mesh was non-manifold)');
          
          // Try to repair the decimated mesh - it might be manifold now with fewer triangles
          // Always attempt this if repair was requested, since the original repair failed
          if (options.repair) {
            console.log('[ManifoldMeshService] Attempting repair on decimated mesh (original was non-manifold)...');
            onProgress?.({ stage: 'repairing', progress: 90, message: 'Repairing decimated mesh...' });
            await yieldToUI();
            
            const postRepairResult = await repairMeshWithManifold(
              fallbackResult.geometry,
              (p) => {
                const mappedProgress = 90 + (p.progress * 0.08); // 90-98%
                onProgress?.({ ...p, progress: mappedProgress });
              }
            );
            
            if (postRepairResult.success && postRepairResult.geometry) {
              // Use the repaired geometry
              decimateResult.geometry = postRepairResult.geometry;
              decimateResult.finalTriangles = postRepairResult.finalTriangles;
              wasRepaired = true;
              actions.push('Post-decimation repair successful (mesh is now manifold)');
              console.log('[ManifoldMeshService] ✓ Post-decimation repair successful');
            } else {
              console.log('[ManifoldMeshService] Post-decimation repair failed:', postRepairResult.error);
              actions.push('Post-decimation repair skipped (mesh still non-manifold)');
            }
          }
        }
      }
      
      if (decimateResult.success && decimateResult.geometry) {
        // Dispose previous geometry if it was repaired
        if (wasRepaired && currentGeometry !== geometry) {
          currentGeometry.dispose();
        }
        currentGeometry = decimateResult.geometry;
        wasDecimated = decimateResult.reductionPercent > 0;
        finalTriangles = decimateResult.finalTriangles;
        actions.push(`Decimated: ${decimateResult.originalTriangles.toLocaleString()} → ${decimateResult.finalTriangles.toLocaleString()} triangles (${decimateResult.reductionPercent.toFixed(1)}% reduction)`);
      } else if (!decimateResult.success) {
        console.warn('[ManifoldMeshService] Both decimation methods failed');
        actions.push(`Decimation failed: ${decimateResult.error}`);
      }
    }
    
    onProgress?.({ stage: 'complete', progress: 100, message: 'Processing complete' });
    
    const reductionPercent = ((originalTriangles - finalTriangles) / originalTriangles) * 100;
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    
    console.log('[ManifoldMeshService] ═══════════════════════════════════════════');
    console.log('[ManifoldMeshService] ✓ Processing complete');
    console.log(`[ManifoldMeshService]   Duration: ${duration}s`);
    console.log(`[ManifoldMeshService]   Original: ${originalTriangles.toLocaleString()} triangles`);
    console.log(`[ManifoldMeshService]   Final: ${finalTriangles.toLocaleString()} triangles`);
    console.log(`[ManifoldMeshService]   Reduction: ${reductionPercent.toFixed(1)}%`);
    console.log(`[ManifoldMeshService]   Repaired: ${wasRepaired}`);
    console.log(`[ManifoldMeshService]   Decimated: ${wasDecimated}`);
    console.log('[ManifoldMeshService] ═══════════════════════════════════════════');
    
    return {
      success: true,
      geometry: currentGeometry,
      originalTriangles,
      finalTriangles,
      wasRepaired,
      wasDecimated,
      reductionPercent,
      actions,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ManifoldMeshService] ✗ Processing failed:', errorMessage);
    
    return {
      success: false,
      geometry: null,
      originalTriangles,
      finalTriangles: 0,
      wasRepaired: false,
      wasDecimated: false,
      reductionPercent: 0,
      actions,
      error: errorMessage,
    };
  }
}

/**
 * Pre-initialize the Manifold module
 * Call this early in the app lifecycle to avoid delays when first using the service
 */
export async function initManifold(): Promise<boolean> {
  try {
    await getManifoldModule();
    return true;
  } catch (error) {
    console.error('[ManifoldMeshService] Failed to initialize:', error);
    return false;
  }
}
