/**
 * Mounting Holes Geometry Utilities
 * 
 * Functions for creating hole geometries (cylinders, countersinks, counterbores)
 * for CSG operations and preview rendering.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION } from 'three-bvh-csg';
import { PlacedHole, HoleType } from './types';

// Number of segments for circular geometry
const CIRCLE_SEGMENTS = 32;

// Default values for safety
const DEFAULT_DIAMETER = 6;
const DEFAULT_DEPTH = 20;

/**
 * Validate and sanitize numeric value
 */
function safeNumber(value: number | undefined | null, defaultValue: number, minValue = 0.1): number {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num) || num < minValue) {
    return defaultValue;
  }
  return num;
}

/**
 * Create a cylindrical hole geometry for a through hole
 * Adds extra depth to ensure complete penetration through baseplate
 */
export function createThroughHoleGeometry(
  diameter: number,
  depth: number
): THREE.BufferGeometry {
  const safeDiameter = safeNumber(diameter, DEFAULT_DIAMETER);
  // Add extra depth (2mm buffer on each end) to ensure complete through-hole
  const extraDepth = 4;
  const safeDepth = safeNumber(depth, DEFAULT_DEPTH) + extraDepth;
  
  const radius = safeDiameter / 2;
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    safeDepth,
    CIRCLE_SEGMENTS
  );
  // Position so top extends 2mm above Y=0 and bottom extends 2mm below -depth
  // This ensures the hole fully penetrates the baseplate on both sides
  geometry.translate(0, -safeDepth / 2 + extraDepth / 2, 0);
  return geometry;
}

/**
 * Create a countersink hole geometry
 * Uses CSG union to properly combine cylinder and cone without internal faces
 * Adds extra depth for complete through-hole penetration
 */
export function createCountersinkGeometry(
  diameter: number,
  depth: number,
  countersinkDiameter: number,
  countersinkAngle: number
): THREE.BufferGeometry {
  const safeDiameter = safeNumber(diameter, DEFAULT_DIAMETER);
  const safeDepth = safeNumber(depth, DEFAULT_DEPTH);
  const safeCsDiameter = safeNumber(countersinkDiameter, safeDiameter * 2);
  const safeCsAngle = safeNumber(countersinkAngle, 90, 10);
  
  // Extra depth for through-hole penetration
  const extraDepth = 4;
  
  const mainRadius = safeDiameter / 2;
  const csRadius = safeCsDiameter / 2;
  
  // Calculate countersink depth from angle
  const angleRad = (safeCsAngle / 2) * (Math.PI / 180);
  const csDepth = Math.max(0.5, (csRadius - mainRadius) / Math.tan(angleRad));
  
  // Main cylindrical hole (with extra depth for penetration)
  const mainHoleGeo = new THREE.CylinderGeometry(
    mainRadius,
    mainRadius,
    depth + extraDepth,
    CIRCLE_SEGMENTS
  );
  mainHoleGeo.translate(0, -(depth + extraDepth) / 2 + extraDepth / 2, 0);
  
  // Countersink cone (frustum from main hole radius to countersink radius)
  const countersinkGeo = new THREE.CylinderGeometry(
    csRadius,    // top (at surface)
    mainRadius,  // bottom (at main hole)
    csDepth,
    CIRCLE_SEGMENTS
  );
  countersinkGeo.translate(0, -csDepth / 2, 0);
  
  // Use CSG union to properly combine without internal faces
  try {
    const evaluator = new Evaluator();
    const mainBrush = new Brush(mainHoleGeo);
    const csBrush = new Brush(countersinkGeo);
    mainBrush.updateMatrixWorld();
    csBrush.updateMatrixWorld();
    
    const result = evaluator.evaluate(mainBrush, csBrush, ADDITION);
    const resultGeo = result.geometry.clone();
    resultGeo.computeVertexNormals();
    
    // Cleanup
    mainHoleGeo.dispose();
    countersinkGeo.dispose();
    mainBrush.geometry.dispose();
    csBrush.geometry.dispose();
    result.geometry.dispose();
    
    return resultGeo;
  } catch (error) {
    console.warn('[holeGeometry] CSG union failed for countersink, using fallback merge:', error);
    // Fallback to simple merge (may have artifacts)
    const merged = mergeBufferGeometries([mainHoleGeo, countersinkGeo]);
    return merged || mainHoleGeo;
  }
}

/**
 * Create a counterbore hole geometry
 * Uses CSG union to properly combine cylinders without internal faces
 * Adds extra depth for complete through-hole penetration
 */
export function createCounterboreGeometry(
  diameter: number,
  depth: number,
  counterboreDiameter: number,
  counterboreDepth: number
): THREE.BufferGeometry {
  const safeDiameter = safeNumber(diameter, DEFAULT_DIAMETER);
  const safeDepth = safeNumber(depth, DEFAULT_DEPTH);
  const safeCbDiameter = safeNumber(counterboreDiameter, safeDiameter * 1.8);
  const safeCbDepth = safeNumber(counterboreDepth, safeDiameter);
  
  // Extra depth for through-hole penetration
  const extraDepth = 4;
  
  const mainRadius = safeDiameter / 2;
  const cbRadius = safeCbDiameter / 2;
  
  // Main cylindrical hole (below counterbore, with extra depth for penetration)
  const mainHoleDepth = Math.max(1, safeDepth - safeCbDepth) + extraDepth;
  const mainHoleGeo = new THREE.CylinderGeometry(
    mainRadius,
    mainRadius,
    mainHoleDepth,
    CIRCLE_SEGMENTS
  );
  mainHoleGeo.translate(0, -safeCbDepth - mainHoleDepth / 2 + extraDepth / 2, 0);
  
  // Counterbore (larger cylinder at top)
  const counterboreGeo = new THREE.CylinderGeometry(
    cbRadius,
    cbRadius,
    safeCbDepth,
    CIRCLE_SEGMENTS
  );
  counterboreGeo.translate(0, -safeCbDepth / 2, 0);
  
  // Use CSG union to properly combine without internal faces
  try {
    const evaluator = new Evaluator();
    const mainBrush = new Brush(mainHoleGeo);
    const cbBrush = new Brush(counterboreGeo);
    mainBrush.updateMatrixWorld();
    cbBrush.updateMatrixWorld();
    
    const result = evaluator.evaluate(mainBrush, cbBrush, ADDITION);
    const resultGeo = result.geometry.clone();
    resultGeo.computeVertexNormals();
    
    // Cleanup
    mainHoleGeo.dispose();
    counterboreGeo.dispose();
    mainBrush.geometry.dispose();
    cbBrush.geometry.dispose();
    result.geometry.dispose();
    
    return resultGeo;
  } catch (error) {
    console.warn('[holeGeometry] CSG union failed for counterbore, using fallback merge:', error);
    // Fallback to simple merge (may have artifacts)
    const merged = mergeBufferGeometries([mainHoleGeo, counterboreGeo]);
    return merged || mainHoleGeo;
  }
}

/**
 * Create hole geometry based on hole type and configuration
 */
export function createHoleGeometry(hole: PlacedHole): THREE.BufferGeometry {
  switch (hole.type) {
    case 'through':
      return createThroughHoleGeometry(hole.diameter, hole.depth);
    
    case 'countersink':
      return createCountersinkGeometry(
        hole.diameter,
        hole.depth,
        hole.countersinkDiameter ?? hole.diameter * 2,
        hole.countersinkAngle ?? 90
      );
    
    case 'counterbore':
      return createCounterboreGeometry(
        hole.diameter,
        hole.depth,
        hole.counterboreDiameter ?? hole.diameter * 1.8,
        hole.counterboreDepth ?? hole.diameter
      );
    
    default:
      return createThroughHoleGeometry(hole.diameter, hole.depth);
  }
}

/**
 * Position hole geometry at the correct location on baseplate
 * @param geometry The hole geometry (assumed to have top at Y=0)
 * @param position XZ position on baseplate
 * @param baseTopY Y coordinate of baseplate top surface
 * @returns Positioned geometry
 */
export function positionHoleGeometry(
  geometry: THREE.BufferGeometry,
  position: THREE.Vector2,
  baseTopY: number
): THREE.BufferGeometry {
  const positioned = geometry.clone();
  positioned.translate(position.x, baseTopY, position.y);
  return positioned;
}

/**
 * Create merged geometry for all holes (for batch CSG operation)
 * @param holes Array of placed holes with world-space positions
 * @param baseTopY Y coordinate of baseplate top surface in local space
 * @param baseplateOffset Optional XZ offset of baseplate in world space (for transforming world→local coords)
 */
export function createMergedHolesGeometry(
  holes: PlacedHole[],
  baseTopY: number,
  baseplateOffset?: { x: number; z: number }
): THREE.BufferGeometry | null {
  if (holes.length === 0) return null;
  
  // Default offset is zero (no transform needed)
  const offsetX = baseplateOffset?.x ?? 0;
  const offsetZ = baseplateOffset?.z ?? 0;
  
  const geometries = holes.map(hole => {
    const geo = createHoleGeometry(hole);
    // Transform hole position from world space to local baseplate space
    // hole.position.x = worldX, hole.position.y = worldZ
    const localPosition = new THREE.Vector2(
      hole.position.x - offsetX,
      hole.position.y - offsetZ
    );
    return positionHoleGeometry(geo, localPosition, baseTopY);
  });
  
  const merged = mergeBufferGeometries(geometries);
  if (merged) {
    merged.computeVertexNormals();
  }
  
  // Dispose individual geometries
  geometries.forEach(g => g.dispose());
  
  return merged;
}

/**
 * Simple geometry merge utility using Three.js BufferGeometryUtils
 * Normalizes all geometries to have compatible attributes before merging
 */
function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0].clone();
  
  // Normalize all geometries to have consistent attributes
  const normalizedGeometries = geometries.map(geo => {
    const normalized = geo.clone();
    
    // Ensure all geometries are non-indexed for consistent merging
    if (normalized.index) {
      const nonIndexed = normalized.toNonIndexed();
      normalized.dispose();
      return nonIndexed;
    }
    
    return normalized;
  });
  
  // Ensure all have normals
  normalizedGeometries.forEach(geo => {
    if (!geo.getAttribute('normal')) {
      geo.computeVertexNormals();
    }
  });
  
  // Use Three.js built-in mergeGeometries
  try {
    const merged = mergeGeometries(normalizedGeometries, false);
    
    // Cleanup normalized geometries
    normalizedGeometries.forEach(g => g.dispose());
    
    return merged;
  } catch (error) {
    console.error('[holeGeometry] Failed to merge geometries:', error);
    // Cleanup normalized geometries
    normalizedGeometries.forEach(g => g.dispose());
    // Fallback: manually merge by combining all vertices
    return manualMergeGeometries(geometries);
  }
}

/**
 * Manual geometry merge fallback
 */
function manualMergeGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0].clone();
  
  // Calculate total vertex count
  let totalVertices = 0;
  let totalIndices = 0;
  
  for (const geo of geometries) {
    const posAttr = geo.getAttribute('position');
    totalVertices += posAttr.count;
    if (geo.index) {
      totalIndices += geo.index.count;
    } else {
      totalIndices += posAttr.count;
    }
  }
  
  // Create merged arrays
  const positions = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);
  
  let vertexOffset = 0;
  let indexOffset = 0;
  let vertexCount = 0;
  
  for (const geo of geometries) {
    const posAttr = geo.getAttribute('position');
    const posArray = posAttr.array as Float32Array;
    
    // Copy positions
    positions.set(posArray, vertexOffset * 3);
    
    // Copy/create indices
    if (geo.index) {
      const indexArray = geo.index.array;
      for (let i = 0; i < indexArray.length; i++) {
        indices[indexOffset + i] = indexArray[i] + vertexCount;
      }
      indexOffset += indexArray.length;
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices[indexOffset + i] = vertexCount + i;
      }
      indexOffset += posAttr.count;
    }
    
    vertexCount += posAttr.count;
    vertexOffset += posAttr.count;
  }
  
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();
  
  return merged;
}

/**
 * Serialize geometry for web worker transfer
 */
export function serializeGeometry(geometry: THREE.BufferGeometry): {
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
} {
  const positions = geometry.getAttribute('position').array as Float32Array;
  const result: {
    positions: Float32Array;
    indices?: Uint32Array;
    normals?: Float32Array;
  } = {
    positions: new Float32Array(positions),
  };
  
  if (geometry.index) {
    result.indices = new Uint32Array(geometry.index.array);
  }
  
  const normals = geometry.getAttribute('normal');
  if (normals) {
    result.normals = new Float32Array(normals.array as Float32Array);
  }
  
  return result;
}

/**
 * Deserialize geometry from web worker result
 */
export function deserializeGeometry(data: {
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  
  if (data.indices) {
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  }
  
  if (data.normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  
  // Add UV attribute for CSG compatibility
  if (!geometry.getAttribute('uv')) {
    const posAttr = geometry.getAttribute('position');
    if (posAttr) {
      const uvArray = new Float32Array(posAttr.count * 2);
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
    }
  }
  
  return geometry;
}
