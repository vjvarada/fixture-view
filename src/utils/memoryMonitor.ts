/**
 * Memory Monitor Utilities
 * 
 * Tools for tracking memory usage and THREE.js resource consumption.
 * Use these during development to identify memory leaks.
 */

import * as THREE from 'three';

// ============================================================================
// Types
// ============================================================================

export interface MemorySnapshot {
  timestamp: number;
  label: string;
  jsHeap: {
    usedMB: number;
    totalMB: number;
    limitMB: number;
  } | null;
  threeResources: {
    geometries: number;
    textures: number;
    programs: number;
    calls: number;
    triangles: number;
  } | null;
}

export interface MemoryDelta {
  from: string;
  to: string;
  jsHeapDeltaMB: number;
  geometriesDelta: number;
  texturesDelta: number;
}

// ============================================================================
// Memory Tracking State
// ============================================================================

const snapshots: MemorySnapshot[] = [];
let currentRenderer: THREE.WebGLRenderer | null = null;

// ============================================================================
// Renderer Registration
// ============================================================================

/**
 * Register the WebGL renderer for resource tracking.
 * Call this once when the renderer is created.
 */
export function registerRenderer(renderer: THREE.WebGLRenderer): void {
  currentRenderer = renderer;
  console.log('[MemoryMonitor] Renderer registered for tracking');
}

/**
 * Unregister the renderer (call on cleanup)
 */
export function unregisterRenderer(): void {
  currentRenderer = null;
}

// ============================================================================
// Memory Measurement
// ============================================================================

/**
 * Get current JS heap memory usage (Chrome only)
 */
export function getJSHeapUsage(): MemorySnapshot['jsHeap'] {
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    return {
      usedMB: Math.round(memory.usedJSHeapSize / 1024 / 1024 * 100) / 100,
      totalMB: Math.round(memory.totalJSHeapSize / 1024 / 1024 * 100) / 100,
      limitMB: Math.round(memory.jsHeapSizeLimit / 1024 / 1024 * 100) / 100,
    };
  }
  return null;
}

/**
 * Get THREE.js resource counts from the renderer
 */
export function getThreeResourceCounts(): MemorySnapshot['threeResources'] {
  if (!currentRenderer) {
    return null;
  }
  
  const info = currentRenderer.info;
  return {
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
    calls: info.render.calls,
    triangles: info.render.triangles,
  };
}

// ============================================================================
// Snapshot Management
// ============================================================================

/**
 * Take a memory snapshot with a label.
 * Use at key workflow points (before/after operations).
 */
export function takeSnapshot(label: string): MemorySnapshot {
  const snapshot: MemorySnapshot = {
    timestamp: Date.now(),
    label,
    jsHeap: getJSHeapUsage(),
    threeResources: getThreeResourceCounts(),
  };
  
  snapshots.push(snapshot);
  
  // Keep only last 50 snapshots
  if (snapshots.length > 50) {
    snapshots.shift();
  }
  
  return snapshot;
}

/**
 * Log a memory snapshot to console
 */
export function logMemoryUsage(label: string): void {
  const snapshot = takeSnapshot(label);
  
  const heap = snapshot.jsHeap;
  const three = snapshot.threeResources;
  
  console.group(`[Memory] ${label}`);
  
  if (heap) {
    console.log(`JS Heap: ${heap.usedMB} MB / ${heap.totalMB} MB (limit: ${heap.limitMB} MB)`);
  }
  
  if (three) {
    console.log(`THREE.js: ${three.geometries} geometries, ${three.textures} textures, ${three.triangles} triangles`);
  }
  
  console.groupEnd();
}

/**
 * Compare two snapshots and return the delta
 */
export function compareSnapshots(fromLabel: string, toLabel: string): MemoryDelta | null {
  const from = snapshots.find(s => s.label === fromLabel);
  const to = snapshots.find(s => s.label === toLabel);
  
  if (!from || !to) {
    console.warn('[MemoryMonitor] Could not find snapshots:', fromLabel, toLabel);
    return null;
  }
  
  return {
    from: fromLabel,
    to: toLabel,
    jsHeapDeltaMB: (to.jsHeap?.usedMB ?? 0) - (from.jsHeap?.usedMB ?? 0),
    geometriesDelta: (to.threeResources?.geometries ?? 0) - (from.threeResources?.geometries ?? 0),
    texturesDelta: (to.threeResources?.textures ?? 0) - (from.threeResources?.textures ?? 0),
  };
}

/**
 * Get all snapshots (for debugging)
 */
export function getSnapshots(): MemorySnapshot[] {
  return [...snapshots];
}

/**
 * Clear all snapshots
 */
export function clearSnapshots(): void {
  snapshots.length = 0;
}

// ============================================================================
// Disposal Helpers
// ============================================================================

/**
 * Dispose a BufferGeometry safely
 */
export function disposeGeometry(geometry: THREE.BufferGeometry | null | undefined): void {
  if (geometry) {
    geometry.dispose();
  }
}

/**
 * Dispose a Material (or array of materials) safely
 */
export function disposeMaterial(
  material: THREE.Material | THREE.Material[] | null | undefined
): void {
  if (!material) return;
  
  if (Array.isArray(material)) {
    material.forEach(m => m.dispose());
  } else {
    material.dispose();
  }
}

/**
 * Recursively dispose an Object3D and all its children
 */
export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      disposeGeometry(child.geometry);
      disposeMaterial(child.material);
    } else if (child instanceof THREE.Line) {
      disposeGeometry(child.geometry as THREE.BufferGeometry);
      disposeMaterial(child.material);
    } else if (child instanceof THREE.Points) {
      disposeGeometry(child.geometry as THREE.BufferGeometry);
      disposeMaterial(child.material);
    }
  });
}

/**
 * Dispose a mesh completely (geometry + material)
 */
export function disposeMesh(mesh: THREE.Mesh | null | undefined): void {
  if (!mesh) return;
  disposeGeometry(mesh.geometry);
  disposeMaterial(mesh.material);
}

// ============================================================================
// Memory Leak Detection
// ============================================================================

/**
 * Check if geometries are growing unexpectedly.
 * Returns true if geometry count increased by more than threshold since last check.
 */
let lastGeometryCount = 0;

export function checkGeometryGrowth(threshold: number = 10): boolean {
  const current = getThreeResourceCounts();
  if (!current) return false;
  
  const growth = current.geometries - lastGeometryCount;
  lastGeometryCount = current.geometries;
  
  if (growth > threshold) {
    console.warn(`[MemoryMonitor] Geometry count grew by ${growth} (current: ${current.geometries})`);
    return true;
  }
  
  return false;
}

/**
 * Test session reset cleanup
 * Takes a snapshot, triggers reset, waits for GC, then compares.
 * Call from console: window.__memoryMonitor.testSessionReset()
 */
export async function testSessionReset(): Promise<void> {
  console.log('[MemoryMonitor] Starting session reset test...');
  
  // Take "before" snapshot
  const before = takeSnapshot('Before Session Reset');
  console.log('Before reset:');
  console.log(`  JS Heap: ${before.jsHeap?.usedMB ?? 'N/A'} MB`);
  console.log(`  Geometries: ${before.threeResources?.geometries ?? 'N/A'}`);
  console.log(`  Textures: ${before.threeResources?.textures ?? 'N/A'}`);
  
  // Trigger session reset
  window.dispatchEvent(new CustomEvent('viewer-reset'));
  window.dispatchEvent(new CustomEvent('session-reset'));
  window.dispatchEvent(new Event('supports-cancel-placement'));
  
  // Wait for React to clean up
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Try to trigger garbage collection (only works in Chrome with --js-flags="--expose-gc")
  if ((window as any).gc) {
    (window as any).gc();
    console.log('[MemoryMonitor] Forced GC');
  }
  
  // Wait for GC
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Take "after" snapshot
  const after = takeSnapshot('After Session Reset');
  console.log('After reset (2s delay):');
  console.log(`  JS Heap: ${after.jsHeap?.usedMB ?? 'N/A'} MB`);
  console.log(`  Geometries: ${after.threeResources?.geometries ?? 'N/A'}`);
  console.log(`  Textures: ${after.threeResources?.textures ?? 'N/A'}`);
  
  // Compare
  const delta = compareSnapshots('Before Session Reset', 'After Session Reset');
  if (delta) {
    console.log('Delta:');
    console.log(`  JS Heap: ${delta.jsHeapDeltaMB > 0 ? '+' : ''}${delta.jsHeapDeltaMB.toFixed(2)} MB`);
    console.log(`  Geometries: ${delta.geometriesDelta > 0 ? '+' : ''}${delta.geometriesDelta}`);
    console.log(`  Textures: ${delta.texturesDelta > 0 ? '+' : ''}${delta.texturesDelta}`);
    
    // Warn if resources weren't freed
    if (delta.geometriesDelta > 0) {
      console.warn(`[MemoryMonitor] WARNING: ${delta.geometriesDelta} geometries not freed after reset`);
    }
    if (delta.texturesDelta > 0) {
      console.warn(`[MemoryMonitor] WARNING: ${delta.texturesDelta} textures not freed after reset`);
    }
    if (delta.geometriesDelta <= 0 && delta.texturesDelta <= 0) {
      console.log('[MemoryMonitor] ✓ Resources appear to be properly cleaned up');
    }
  }
}

/**
 * Print a summary of memory usage over time
 */
export function printMemorySummary(): void {
  if (snapshots.length < 2) {
    console.log('[MemoryMonitor] Not enough snapshots to summarize');
    return;
  }
  
  console.group('[MemoryMonitor] Memory Summary');
  
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  
  console.log(`Time range: ${new Date(first.timestamp).toLocaleTimeString()} - ${new Date(last.timestamp).toLocaleTimeString()}`);
  console.log(`Snapshots: ${snapshots.length}`);
  
  // Find peak memory
  const peakHeap = snapshots.reduce((max, s) => 
    Math.max(max, s.jsHeap?.usedMB ?? 0), 0);
  const peakGeometries = snapshots.reduce((max, s) => 
    Math.max(max, s.threeResources?.geometries ?? 0), 0);
  
  console.log(`Peak JS Heap: ${peakHeap.toFixed(2)} MB`);
  console.log(`Peak Geometries: ${peakGeometries}`);
  
  // Current vs start
  if (first.jsHeap && last.jsHeap) {
    const heapGrowth = last.jsHeap.usedMB - first.jsHeap.usedMB;
    console.log(`Heap growth from start: ${heapGrowth > 0 ? '+' : ''}${heapGrowth.toFixed(2)} MB`);
  }
  
  if (first.threeResources && last.threeResources) {
    const geoGrowth = last.threeResources.geometries - first.threeResources.geometries;
    console.log(`Geometry growth from start: ${geoGrowth > 0 ? '+' : ''}${geoGrowth}`);
  }
  
  console.groupEnd();
}

/**
 * Start periodic memory monitoring (for development)
 */
let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicMonitoring(intervalMs: number = 10000): void {
  if (monitorInterval) {
    console.warn('[MemoryMonitor] Already monitoring');
    return;
  }
  
  monitorInterval = setInterval(() => {
    logMemoryUsage('Periodic Check');
    checkGeometryGrowth(5);
  }, intervalMs);
  
  console.log(`[MemoryMonitor] Started periodic monitoring every ${intervalMs}ms`);
}

export function stopPeriodicMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[MemoryMonitor] Stopped periodic monitoring');
  }
}

// ============================================================================
// Development Console Commands
// ============================================================================

// Expose to window for easy debugging in browser console
if (typeof window !== 'undefined') {
  (window as any).__memoryMonitor = {
    logMemoryUsage,
    takeSnapshot,
    getSnapshots,
    compareSnapshots,
    clearSnapshots,
    startPeriodicMonitoring,
    stopPeriodicMonitoring,
    checkGeometryGrowth,
    testSessionReset,
    printMemorySummary,
  };
  
  console.log('[MemoryMonitor] Debug commands available at window.__memoryMonitor');
  console.log('[MemoryMonitor] Run window.__memoryMonitor.testSessionReset() to test cleanup');
}
