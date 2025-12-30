/**
 * Geometry Optimizer Utilities
 * 
 * Functions for optimizing geometries for export on less powerful devices.
 * Includes decimation, chunked processing, and memory-efficient operations.
 */

import * as THREE from 'three';
import { simplifyGeometry, decimateMesh } from '@rapidtool/cad-core';
import type { ExportServiceConfig, ExportProgressCallback } from '../types';

/**
 * Yields control back to the browser event loop
 * Uses requestIdleCallback when available for better scheduling
 */
export function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Process an array in chunks, yielding to the main thread between chunks
 */
export async function processInChunks<T, R>(
  items: T[],
  processor: (item: T, index: number) => R | Promise<R>,
  chunkSize: number,
  onProgress?: (current: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, Math.min(i + chunkSize, items.length));
    
    for (let j = 0; j < chunk.length; j++) {
      const result = await processor(chunk[j], i + j);
      results.push(result);
    }
    
    onProgress?.(Math.min(i + chunkSize, items.length), items.length);
    
    // Yield to main thread after each chunk
    await yieldToMain();
  }
  
  return results;
}

/**
 * Get triangle count from a geometry
 */
export function getTriangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.index;
  const position = geometry.getAttribute('position');
  
  if (index) {
    return index.count / 3;
  }
  return position.count / 3;
}

/**
 * Get total triangle count from multiple geometries
 */
export function getTotalTriangleCount(geometries: THREE.BufferGeometry[]): number {
  return geometries.reduce((sum, g) => sum + getTriangleCount(g), 0);
}

/**
 * Decimates a geometry using fast quadric simplification
 * Returns the original if decimation fails or isn't needed
 */
export async function decimateGeometry(
  geometry: THREE.BufferGeometry,
  targetTriangles: number,
  onProgress?: (message: string) => void
): Promise<THREE.BufferGeometry> {
  const currentTriangles = getTriangleCount(geometry);
  
  // Skip if already under target
  if (currentTriangles <= targetTriangles) {
    return geometry;
  }
  
  const ratio = targetTriangles / currentTriangles;
  onProgress?.(`Decimating from ${currentTriangles} to ~${targetTriangles} triangles...`);
  
  try {
    // Try WASM-based simplification first (faster, better quality)
    const result = await simplifyGeometry(geometry, {
      ratio,
      onProgress: (stage, percent, message) => {
        onProgress?.(`${message} (${percent}%)`);
      }
    });
    
    if (result.success && result.geometry) {
      console.log(`[Export] Decimated: ${currentTriangles} → ${result.finalTriangles} triangles (${result.reductionPercent.toFixed(1)}% reduction)`);
      return result.geometry;
    }
  } catch (err) {
    console.warn('[Export] WASM simplification failed, trying fallback:', err);
  }
  
  // Fallback to Three.js-based decimation
  try {
    const result = decimateMesh(geometry, { ratio });
    if (result.success && result.geometry) {
      console.log(`[Export] Decimated (fallback): ${currentTriangles} → ${result.finalTriangles} triangles`);
      return result.geometry;
    }
  } catch (err) {
    console.warn('[Export] Fallback decimation failed:', err);
  }
  
  // Return original if all methods fail
  return geometry;
}

/**
 * Optimizes geometries for export based on config
 */
export async function optimizeGeometriesForExport(
  geometries: THREE.BufferGeometry[],
  config: ExportServiceConfig,
  onProgress?: ExportProgressCallback
): Promise<THREE.BufferGeometry[]> {
  if (geometries.length === 0) {
    return [];
  }
  
  const totalTriangles = getTotalTriangleCount(geometries);
  console.log(`[Export] Total triangles before optimization: ${totalTriangles}`);
  
  // Skip optimization if no decimation needed
  if (config.targetTriangleCount <= 0 || totalTriangles <= config.targetTriangleCount) {
    return geometries;
  }
  
  onProgress?.({
    stage: 'decimating',
    progress: 0,
    message: `Optimizing ${geometries.length} geometries...`
  });
  
  // Calculate per-geometry target based on proportion
  const perGeometryRatio = config.targetTriangleCount / totalTriangles;
  
  const optimizedGeometries: THREE.BufferGeometry[] = [];
  
  for (let i = 0; i < geometries.length; i++) {
    const geometry = geometries[i];
    const currentTriangles = getTriangleCount(geometry);
    const targetTriangles = Math.ceil(currentTriangles * perGeometryRatio);
    
    onProgress?.({
      stage: 'decimating',
      progress: (i / geometries.length) * 100,
      message: `Optimizing geometry ${i + 1}/${geometries.length}...`
    });
    
    const optimized = await decimateGeometry(
      geometry,
      targetTriangles,
      (msg) => onProgress?.({ stage: 'decimating', progress: (i / geometries.length) * 100, message: msg })
    );
    
    optimizedGeometries.push(optimized);
    
    // Yield to main thread if using chunked processing
    if (config.useChunkedProcessing) {
      await yieldToMain();
    }
  }
  
  const finalTriangles = getTotalTriangleCount(optimizedGeometries);
  console.log(`[Export] Total triangles after optimization: ${finalTriangles} (${((1 - finalTriangles/totalTriangles) * 100).toFixed(1)}% reduction)`);
  
  return optimizedGeometries;
}

/**
 * Estimates export time based on geometry complexity and config
 */
export function estimateExportTime(
  totalTriangles: number,
  config: ExportServiceConfig
): { estimatedSeconds: number; complexity: 'low' | 'medium' | 'high' } {
  // Base time per 10k triangles (roughly estimated)
  let baseTimePerUnit = config.performCSGUnion ? 2.0 : 0.5;
  
  // Adjust for quality settings
  if (config.quality === 'fast') {
    baseTimePerUnit *= 0.3;
  } else if (config.quality === 'balanced') {
    baseTimePerUnit *= 0.6;
  }
  
  const effectiveTriangles = config.targetTriangleCount > 0 
    ? Math.min(totalTriangles, config.targetTriangleCount)
    : totalTriangles;
  
  const estimatedSeconds = (effectiveTriangles / 10000) * baseTimePerUnit;
  
  const complexity: 'low' | 'medium' | 'high' = 
    effectiveTriangles < 20000 ? 'low' :
    effectiveTriangles < 100000 ? 'medium' : 'high';
  
  return { estimatedSeconds, complexity };
}

/**
 * Memory-efficient geometry disposal
 */
export function disposeGeometries(geometries: THREE.BufferGeometry[]): void {
  for (const geometry of geometries) {
    if (geometry) {
      geometry.dispose();
    }
  }
}
