/**
 * Export Service
 * 
 * Handles the STL export process including CSG union and file generation.
 * Optimized for performance on less powerful devices with:
 * - Geometry decimation options
 * - Chunked processing with idle callbacks
 * - Memory-efficient cleanup
 * - Multiple quality presets (fast/balanced/high)
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  meshToSTL,
  downloadFile,
  generateExportFilename,
  performRealCSGUnionInWorker,
  type ExportConfig,
} from '@rapidtool/cad-core';
import type { 
  ExportGeometryCollection, 
  ExportProgressCallback,
  ExportResult,
  ExportServiceConfig,
} from '../types';
import { getExportConfigForQuality } from '../types';
import {
  yieldToMain,
  optimizeGeometriesForExport,
  getTotalTriangleCount,
  disposeGeometries,
} from '../utils/geometryOptimizer';

/**
 * Performs CSG union on baseplate and supports
 * With chunked processing for better UI responsiveness
 */
async function performBaseplateSupportsUnion(
  baseplateAndSupports: THREE.BufferGeometry[],
  config: ExportServiceConfig,
  onProgress?: ExportProgressCallback
): Promise<THREE.BufferGeometry | null> {
  if (baseplateAndSupports.length === 0) {
    return null;
  }
  
  if (baseplateAndSupports.length === 1) {
    return baseplateAndSupports[0];
  }
  
  console.log(`[Export] Performing CSG union on baseplate + ${baseplateAndSupports.length - 1} supports...`);
  onProgress?.({ 
    stage: 'manifold', 
    progress: 10, 
    message: `CSG union: baseplate + ${baseplateAndSupports.length - 1} supports...` 
  });
  
  try {
    // Process in batches for better memory management on low-end devices
    const batchSize = config.csgBatchSize;
    const totalParts = baseplateAndSupports.length;
    
    const geomsForWorker = baseplateAndSupports.map((geom, idx) => ({
      id: idx === 0 ? 'baseplate' : `support-${idx}`,
      geometry: geom
    }));
    
    // Yield before heavy operation if using chunked processing
    if (config.useChunkedProcessing) {
      await yieldToMain();
    }
    
    const result = await performRealCSGUnionInWorker(
      geomsForWorker,
      undefined,
      async (current, total, stage) => {
        const progress = 10 + ((current / total) * 25); // 10-35%
        onProgress?.({ 
          stage: 'manifold', 
          progress, 
          message: `CSG union: ${stage} (${current}/${total})` 
        });
        
        // Yield periodically during long operations
        if (config.useChunkedProcessing && current % batchSize === 0) {
          await yieldToMain();
        }
      }
    );
    
    if (result) {
      console.log('[Export] Baseplate + supports CSG union succeeded - manifold geometry created');
      return result;
    }
  } catch (error) {
    console.error('[Export] Baseplate + supports CSG union failed:', error);
  }
  
  return null;
}

/**
 * Performs fast geometry merge with vertex welding
 * Optimized with chunked processing for UI responsiveness
 */
async function performFastMerge(
  geometries: THREE.BufferGeometry[],
  config: ExportServiceConfig,
  onProgress?: ExportProgressCallback
): Promise<THREE.BufferGeometry | null> {
  if (geometries.length === 0) {
    return null;
  }
  
  console.log('[Export] Merging final geometries...');
  onProgress?.({ stage: 'manifold', progress: 45, message: 'Merging final geometries...' });
  
  try {
    // Normalize all geometries before merging
    const normalizedGeometries: THREE.BufferGeometry[] = [];
    const chunkSize = config.chunkSize;
    
    for (let i = 0; i < geometries.length; i++) {
      const geom = geometries[i];
      const nonIndexed = geom.index ? geom.toNonIndexed() : geom.clone();
      if (nonIndexed.getAttribute('uv')) {
        nonIndexed.deleteAttribute('uv');
      }
      if (nonIndexed.getAttribute('uv2')) {
        nonIndexed.deleteAttribute('uv2');
      }
      normalizedGeometries.push(nonIndexed);
      
      // Yield periodically for UI responsiveness
      if (config.useChunkedProcessing && i % 5 === 0) {
        await yieldToMain();
      }
    }
    
    onProgress?.({ 
      stage: 'manifold', 
      progress: 50, 
      message: `Merging ${normalizedGeometries.length} geometries...` 
    });
    
    // Yield before heavy merge operation
    if (config.useChunkedProcessing) {
      await yieldToMain();
    }
    
    const merged = mergeGeometries(normalizedGeometries, false);
    
    if (merged) {
      onProgress?.({ stage: 'manifold', progress: 60, message: 'Welding vertices...' });
      
      // Yield before vertex welding (can be expensive)
      if (config.useChunkedProcessing) {
        await yieldToMain();
      }
      
      const welded = mergeVertices(merged, config.vertexMergeTolerance);
      welded.computeVertexNormals();
      
      console.log(`[Export] Final merge succeeded: ${welded.getAttribute('position').count} vertices`);
      
      // Cleanup temporary geometries
      disposeGeometries(normalizedGeometries);
      
      return welded;
    }
  } catch (error) {
    console.error('[Export] Final merge failed:', error);
  }
  
  return null;
}

/**
 * Performs full CSG union as fallback
 * With chunked processing for UI responsiveness
 */
async function performFullCSGUnion(
  geometries: THREE.BufferGeometry[],
  config: ExportServiceConfig,
  onProgress?: ExportProgressCallback
): Promise<THREE.BufferGeometry | null> {
  console.log('[Export] Falling back to full CSG union...');
  onProgress?.({ stage: 'manifold', progress: 70, message: 'Trying full CSG union (fallback)...' });
  
  // Yield before heavy operation
  if (config.useChunkedProcessing) {
    await yieldToMain();
  }
  
  try {
    const geometriesForWorker = geometries.map((geom, idx) => ({
      id: `export-part-${idx}`,
      geometry: geom
    }));
    
    const batchSize = config.csgBatchSize;
    
    const result = await performRealCSGUnionInWorker(
      geometriesForWorker,
      undefined,
      async (current, total, stage) => {
        const progress = 70 + ((current / total) * 20); // 70-90%
        onProgress?.({ 
          stage: 'manifold', 
          progress, 
          message: `CSG Union: ${stage} (${current}/${total})` 
        });
        
        // Yield periodically
        if (config.useChunkedProcessing && current % batchSize === 0) {
          await yieldToMain();
        }
      }
    );
    
    if (result) {
      console.log('[Export] CSG union succeeded!');
      return result;
    }
  } catch (error) {
    console.error('[Export] CSG union failed:', error);
  }
  
  return null;
}

/**
 * Generates and downloads STL file(s)
 */
function generateSTLFiles(
  exportGeometry: THREE.BufferGeometry,
  config: ExportConfig,
  isMultiSection: boolean,
  sectionCount: number,
  onProgress?: ExportProgressCallback
): ExportResult {
  onProgress?.({ stage: 'exporting', progress: 95, message: 'Generating STL file...' });
  
  // Create a temporary mesh for STL export
  const exportMesh = new THREE.Mesh(
    exportGeometry, 
    new THREE.MeshStandardMaterial()
  );
  
  try {
    if (isMultiSection && config.splitParts && sectionCount > 1) {
      // Export parts individually for multi-section baseplate
      for (let i = 0; i < sectionCount; i++) {
        const filename = generateExportFilename({
          filename: config.filename,
          sectionNumber: i + 1,
        }, config.format);
        
        onProgress?.({ 
          stage: 'exporting', 
          progress: 85 + ((i / sectionCount) * 10), 
          message: `Exporting ${filename}...` 
        });
        
        const stlData = meshToSTL(exportMesh, config.options);
        downloadFile(stlData, filename, 'application/sla');
      }
      
      console.log(`[Export] Exported ${sectionCount} section files`);
      return { success: true, filesExported: sectionCount };
    } else {
      // Export as single file
      const filename = generateExportFilename({
        filename: config.filename,
      }, config.format);
      
      const stlData = meshToSTL(exportMesh, config.options);
      downloadFile(stlData, filename, 'application/sla');
      
      console.log(`[Export] Exported single file: ${filename}`);
      return { success: true, filename, filesExported: 1 };
    }
  } catch (error) {
    console.error('[Export] STL generation failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'STL generation failed' 
    };
  }
}

/**
 * Main export function with optimization support
 * 
 * @param geometryCollection - Collection of geometries to export
 * @param config - Export configuration (filename, format, etc.)
 * @param fallbackGeometry - Fallback geometry if processing fails
 * @param sectionCount - Number of sections (for multi-section baseplates)
 * @param serviceConfig - Service configuration (quality, CSG options, etc.)
 * @param onProgress - Progress callback
 */
export async function exportFixture(
  geometryCollection: ExportGeometryCollection,
  config: ExportConfig,
  fallbackGeometry: THREE.BufferGeometry | null,
  sectionCount: number = 1,
  serviceConfig: ExportServiceConfig = getExportConfigForQuality('high'),
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  try {
    const startTime = performance.now();
    console.log(`[Export] Starting export with quality: ${serviceConfig.quality}`);
    
    // Collect all geometries for CSG union (baseplate + supports)
    let baseplateAndSupportsForCSG: THREE.BufferGeometry[] = [];
    
    // Add baseplate
    if (geometryCollection.baseplateGeometry) {
      baseplateAndSupportsForCSG.push(geometryCollection.baseplateGeometry);
    }
    
    // Add regular supports
    baseplateAndSupportsForCSG.push(...geometryCollection.supportGeometries);
    
    // Add clamp supports
    baseplateAndSupportsForCSG.push(...geometryCollection.clampSupportGeometries);
    
    // Log initial triangle count
    const initialTriangles = getTotalTriangleCount(baseplateAndSupportsForCSG);
    console.log(`[Export] Initial triangle count: ${initialTriangles}`);
    
    // Optimize geometries if decimation is enabled
    if (serviceConfig.targetTriangleCount > 0 && initialTriangles > serviceConfig.targetTriangleCount) {
      onProgress?.({ 
        stage: 'decimating', 
        progress: 2, 
        message: `Optimizing geometry (${initialTriangles} → ${serviceConfig.targetTriangleCount} triangles)...` 
      });
      
      baseplateAndSupportsForCSG = await optimizeGeometriesForExport(
        baseplateAndSupportsForCSG,
        serviceConfig,
        onProgress
      );
    }
    
    // Final geometries to merge (after CSG union of baseplate+supports)
    const geometriesToMerge: THREE.BufferGeometry[] = [];
    
    // Perform CSG union on baseplate + supports (if enabled)
    if (serviceConfig.performCSGUnion && baseplateAndSupportsForCSG.length > 1) {
      const unionResult = await performBaseplateSupportsUnion(
        baseplateAndSupportsForCSG,
        serviceConfig,
        onProgress
      );
      
      if (unionResult) {
        geometriesToMerge.push(unionResult);
      } else {
        console.warn('[Export] CSG union returned null, adding geometries individually');
        geometriesToMerge.push(...baseplateAndSupportsForCSG);
      }
    } else if (baseplateAndSupportsForCSG.length === 1) {
      geometriesToMerge.push(baseplateAndSupportsForCSG[0]);
    } else if (baseplateAndSupportsForCSG.length > 1) {
      // CSG union disabled (fast mode) - just add geometries directly
      console.log('[Export] Skipping CSG union (fast mode)');
      geometriesToMerge.push(...baseplateAndSupportsForCSG);
    }
    
    // Add label geometries (these don't overlap, so just merge)
    geometriesToMerge.push(...geometryCollection.labelGeometries);
    
    console.log(`[Export] Total geometries to merge: ${geometriesToMerge.length}`);
    
    // If we have no geometries, use fallback
    if (geometriesToMerge.length === 0) {
      if (fallbackGeometry) {
        console.warn('[Export] No component geometries found, using fallback geometry');
        geometriesToMerge.push(fallbackGeometry);
      } else {
        return { success: false, error: 'No geometries available for export' };
      }
    }
    
    // Perform final merge
    let exportGeometry = await performFastMerge(
      geometriesToMerge,
      serviceConfig,
      onProgress
    );
    
    // Fallback to full CSG union if fast merge failed (only if CSG is enabled)
    if (!exportGeometry && serviceConfig.performCSGUnion) {
      exportGeometry = await performFullCSGUnion(geometriesToMerge, serviceConfig, onProgress);
    }
    
    // Last resort: use fallback geometry
    if (!exportGeometry) {
      if (fallbackGeometry) {
        console.warn('[Export] All methods failed, using fallback geometry...');
        onProgress?.({ stage: 'manifold', progress: 90, message: 'Using cached geometry...' });
        exportGeometry = fallbackGeometry;
      } else {
        return { success: false, error: 'Failed to create export geometry' };
      }
    }
    
    // Generate STL file(s)
    const result = generateSTLFiles(
      exportGeometry,
      config,
      geometryCollection.isMultiSection,
      sectionCount,
      onProgress
    );
    
    // Cleanup created geometry (don't dispose fallback)
    if (exportGeometry !== fallbackGeometry) {
      exportGeometry.dispose();
    }
    
    const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[Export] Completed in ${totalTime}s (quality: ${serviceConfig.quality})`);
    
    onProgress?.({ stage: 'complete', progress: 100, message: `Export complete! (${totalTime}s)` });
    
    return result;
    
  } catch (error) {
    console.error('[Export] Failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Export failed' 
    };
  }
}
