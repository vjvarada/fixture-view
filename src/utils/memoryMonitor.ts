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
  };
  
  console.log('[MemoryMonitor] Debug commands available at window.__memoryMonitor');
}
