/**
 * Export Debug Utilities
 * 
 * Centralized debug logging utilities for export operations.
 * Provides consistent formatting and can be easily disabled in production.
 */

import * as THREE from 'three';

/** Whether debug logging is enabled */
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';

/** Log prefix for export module */
const LOG_PREFIX = '[Export]';

/**
 * Logs a debug message if debugging is enabled
 */
export function logDebug(message: string, data?: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  
  if (data) {
    console.log(`${LOG_PREFIX} ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * Logs a warning message
 */
export function logWarn(message: string, data?: unknown): void {
  if (data) {
    console.warn(`${LOG_PREFIX} ${message}`, data);
  } else {
    console.warn(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * Logs an error message
 */
export function logError(message: string, error?: unknown): void {
  if (error) {
    console.error(`${LOG_PREFIX} ${message}`, error);
  } else {
    console.error(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * Gets geometry bounds info for logging
 */
export function getGeometryBoundsInfo(geometry: THREE.BufferGeometry): {
  center: { x: string; y: string; z: string };
  min: { x: string; y: string; z: string };
  max: { x: string; y: string; z: string };
} {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  
  return {
    center: { 
      x: center.x.toFixed(2), 
      y: center.y.toFixed(2), 
      z: center.z.toFixed(2) 
    },
    min: { 
      x: box.min.x.toFixed(2), 
      y: box.min.y.toFixed(2), 
      z: box.min.z.toFixed(2) 
    },
    max: { 
      x: box.max.x.toFixed(2), 
      y: box.max.y.toFixed(2), 
      z: box.max.z.toFixed(2) 
    },
  };
}

/**
 * Logs geometry bounds before and after a transformation
 */
export function logGeometryTransform(
  label: string,
  geometry: THREE.BufferGeometry,
  phase: 'before' | 'after'
): void {
  if (!DEBUG_ENABLED) return;
  
  const bounds = getGeometryBoundsInfo(geometry);
  console.log(`${LOG_PREFIX} ${label} geometry ${phase.toUpperCase()} transform:`, bounds);
}

/**
 * Logs position info from Vector3 or position object
 */
export function formatPosition(pos: THREE.Vector3 | { x: number; y: number; z: number }): {
  x: string;
  y: string;
  z: string;
} {
  const x = pos instanceof THREE.Vector3 ? pos.x : pos.x;
  const y = pos instanceof THREE.Vector3 ? pos.y : pos.y;
  const z = pos instanceof THREE.Vector3 ? pos.z : pos.z;
  
  return { 
    x: x.toFixed(2), 
    y: y.toFixed(2), 
    z: z.toFixed(2) 
  };
}

/**
 * Creates a log group for a multi-step operation
 */
export function createLogGroup(name: string): {
  start: () => void;
  log: (message: string, data?: Record<string, unknown>) => void;
  end: () => void;
} {
  return {
    start: () => {
      if (DEBUG_ENABLED) console.group(`${LOG_PREFIX} ${name}`);
    },
    log: (message: string, data?: Record<string, unknown>) => {
      logDebug(message, data);
    },
    end: () => {
      if (DEBUG_ENABLED) console.groupEnd();
    },
  };
}
