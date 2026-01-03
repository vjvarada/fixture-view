/**
 * Mounting Holes Geometry Utilities
 *
 * Functions for creating hole geometries (cylinders, countersinks, counterbores)
 * for CSG operations and preview rendering.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION } from 'three-bvh-csg';
import type { PlacedHole } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** Number of segments for circular geometry (smoother = more segments) */
const CIRCLE_SEGMENTS = 32;

/** Default diameter when invalid value provided */
const DEFAULT_DIAMETER = 6;

/** Default depth when invalid value provided */
const DEFAULT_DEPTH = 20;

/** Extra depth added to holes to ensure complete through-hole penetration */
const PENETRATION_BUFFER = 4;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validates and sanitizes a numeric value with a fallback.
 *
 * @param value - The value to validate
 * @param defaultValue - Fallback if invalid
 * @param minValue - Minimum allowed value (defaults to 0.1)
 * @returns A valid number
 */
function safeNumber(
  value: number | undefined | null,
  defaultValue: number,
  minValue = 0.1
): number {
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < minValue) {
    return defaultValue;
  }
  return num;
}

// =============================================================================
// Geometry Creation - Through Holes
// =============================================================================

/**
 * Creates a cylindrical geometry for a through hole.
 * Adds extra depth buffer to ensure complete penetration through the baseplate.
 *
 * @param diameter - Hole diameter in mm
 * @param depth - Hole depth in mm
 * @returns Cylinder geometry positioned with top at Y=0
 */
export function createThroughHoleGeometry(
  diameter: number,
  depth: number
): THREE.BufferGeometry {
  const safeDiameter = safeNumber(diameter, DEFAULT_DIAMETER);
  const safeDepth = safeNumber(depth, DEFAULT_DEPTH) + PENETRATION_BUFFER;
  const radius = safeDiameter / 2;

  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    safeDepth,
    CIRCLE_SEGMENTS
  );

  // Position so top extends above Y=0 and bottom extends below -depth
  // This ensures complete penetration on both sides of the baseplate
  const yOffset = -safeDepth / 2 + PENETRATION_BUFFER / 2;
  geometry.translate(0, yOffset, 0);

  return geometry;
}

// =============================================================================
// Geometry Creation - Countersink Holes
// =============================================================================

/**
 * Performs a CSG union of main hole and countersink/counterbore geometries.
 * Falls back to simple merge if CSG operation fails.
 *
 * @param mainGeo - Main cylindrical hole geometry
 * @param secondaryGeo - Countersink cone or counterbore cylinder
 * @param fallbackLabel - Label for logging on fallback
 * @returns Combined geometry without internal faces
 */
function performCSGUnion(
  mainGeo: THREE.BufferGeometry,
  secondaryGeo: THREE.BufferGeometry,
  fallbackLabel: string
): THREE.BufferGeometry {
  try {
    const evaluator = new Evaluator();
    const mainBrush = new Brush(mainGeo);
    const secondaryBrush = new Brush(secondaryGeo);

    mainBrush.updateMatrixWorld();
    secondaryBrush.updateMatrixWorld();

    const result = evaluator.evaluate(mainBrush, secondaryBrush, ADDITION);
    const resultGeo = result.geometry.clone();
    resultGeo.computeVertexNormals();

    // Cleanup CSG resources
    mainGeo.dispose();
    secondaryGeo.dispose();
    mainBrush.geometry.dispose();
    secondaryBrush.geometry.dispose();
    result.geometry.dispose();

    return resultGeo;
  } catch (error) {
    console.warn(`[holeGeometry] CSG union failed for ${fallbackLabel}, using fallback merge:`, error);
    const merged = mergeBufferGeometries([mainGeo, secondaryGeo]);
    return merged ?? mainGeo;
  }
}

/**
 * Creates a countersink hole geometry.
 * Uses CSG union to properly combine cylinder and cone without internal faces.
 *
 * @param diameter - Main hole diameter in mm
 * @param depth - Total hole depth in mm
 * @param countersinkDiameter - Diameter at countersink surface
 * @param countersinkAngle - Countersink angle in degrees (typically 90°)
 * @returns Combined countersink geometry
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

  const mainRadius = safeDiameter / 2;
  const csRadius = safeCsDiameter / 2;

  // Calculate countersink depth from angle (geometry formula)
  const angleRad = (safeCsAngle / 2) * (Math.PI / 180);
  const csDepth = Math.max(0.5, (csRadius - mainRadius) / Math.tan(angleRad));

  // Main cylindrical hole with penetration buffer
  const mainHoleDepth = depth + PENETRATION_BUFFER;
  const mainHoleGeo = new THREE.CylinderGeometry(
    mainRadius,
    mainRadius,
    mainHoleDepth,
    CIRCLE_SEGMENTS
  );
  mainHoleGeo.translate(0, -mainHoleDepth / 2 + PENETRATION_BUFFER / 2, 0);

  // Countersink cone (frustum from main hole radius to countersink radius)
  const countersinkGeo = new THREE.CylinderGeometry(
    csRadius,    // Top (at surface)
    mainRadius,  // Bottom (at main hole)
    csDepth,
    CIRCLE_SEGMENTS
  );
  countersinkGeo.translate(0, -csDepth / 2, 0);

  return performCSGUnion(mainHoleGeo, countersinkGeo, 'countersink');
}

// =============================================================================
// Geometry Creation - Counterbore Holes
// =============================================================================

/**
 * Creates a counterbore hole geometry.
 * Uses CSG union to properly combine cylinders without internal faces.
 *
 * @param diameter - Main hole diameter in mm
 * @param depth - Total hole depth in mm
 * @param counterboreDiameter - Larger counterbore diameter
 * @param counterboreDepth - Depth of counterbore recess
 * @returns Combined counterbore geometry
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

  const mainRadius = safeDiameter / 2;
  const cbRadius = safeCbDiameter / 2;

  // Main cylindrical hole (below counterbore, with penetration buffer)
  const mainHoleDepth = Math.max(1, safeDepth - safeCbDepth) + PENETRATION_BUFFER;
  const mainHoleGeo = new THREE.CylinderGeometry(
    mainRadius,
    mainRadius,
    mainHoleDepth,
    CIRCLE_SEGMENTS
  );
  mainHoleGeo.translate(0, -safeCbDepth - mainHoleDepth / 2 + PENETRATION_BUFFER / 2, 0);

  // Counterbore (larger cylinder at top surface)
  const counterboreGeo = new THREE.CylinderGeometry(
    cbRadius,
    cbRadius,
    safeCbDepth,
    CIRCLE_SEGMENTS
  );
  counterboreGeo.translate(0, -safeCbDepth / 2, 0);

  return performCSGUnion(mainHoleGeo, counterboreGeo, 'counterbore');
}

// =============================================================================
// Geometry Creation - Factory Function
// =============================================================================

/**
 * Creates hole geometry based on hole type and configuration.
 * Factory function that dispatches to the appropriate geometry creator.
 *
 * @param hole - The placed hole configuration
 * @returns Geometry for the specified hole type
 */
export function createHoleGeometry(hole: PlacedHole): THREE.BufferGeometry {
  const { type, diameter, depth, countersinkDiameter, countersinkAngle, counterboreDiameter, counterboreDepth } = hole;

  switch (type) {
    case 'countersink':
      return createCountersinkGeometry(
        diameter,
        depth,
        countersinkDiameter ?? diameter * 2,
        countersinkAngle ?? 90
      );

    case 'counterbore':
      return createCounterboreGeometry(
        diameter,
        depth,
        counterboreDiameter ?? diameter * 1.8,
        counterboreDepth ?? diameter
      );

    case 'through':
    default:
      return createThroughHoleGeometry(diameter, depth);
  }
}

// =============================================================================
// Positioning & Merging
// =============================================================================

/**
 * Positions hole geometry at the correct location on baseplate.
 *
 * @param geometry - The hole geometry (assumed to have top at Y=0)
 * @param position - XZ position on baseplate
 * @param baseTopY - Y coordinate of baseplate top surface
 * @returns Positioned geometry (cloned)
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
 * Converts hole position from world space to local baseplate geometry space.
 *
 * This accounts for two offsets:
 * 1. baseplateOffset - The mesh position in world space (basePlate.position)
 * 2. geometryOffset - Internal offset baked into geometry when baseplate expands asymmetrically
 *
 * @param holePosition - Hole position in world space (x = worldX, y = worldZ)
 * @param baseplateOffset - XZ position of baseplate mesh in world space
 * @param geometryOffset - XZ offset baked into geometry for asymmetric expansion
 * @returns Local position as Vector2 in geometry coordinate space
 */
function worldToLocalPosition(
  holePosition: THREE.Vector2,
  baseplateOffset?: { x: number; z: number },
  geometryOffset?: { x: number; z: number }
): THREE.Vector2 {
  const meshOffsetX = baseplateOffset?.x ?? 0;
  const meshOffsetZ = baseplateOffset?.z ?? 0;
  const geoOffsetX = geometryOffset?.x ?? 0;
  const geoOffsetZ = geometryOffset?.z ?? 0;
  
  // Convert world position to geometry-local position
  // First subtract mesh position, then subtract geometry's internal offset
  return new THREE.Vector2(
    holePosition.x - meshOffsetX - geoOffsetX,
    holePosition.y - meshOffsetZ - geoOffsetZ
  );
}

/**
 * Creates merged geometry for all holes (for batch CSG operation).
 *
 * @param holes - Array of placed holes with world-space positions
 * @param baseTopY - Y coordinate of baseplate top surface in local space
 * @param baseplateOffset - XZ position of baseplate mesh in world space
 * @param geometryOffset - XZ offset baked into geometry for asymmetric expansion
 * @returns Merged geometry or null if no holes
 */
export function createMergedHolesGeometry(
  holes: PlacedHole[],
  baseTopY: number,
  baseplateOffset?: { x: number; z: number },
  geometryOffset?: { x: number; z: number }
): THREE.BufferGeometry | null {
  if (holes.length === 0) {
    return null;
  }

  const geometries = holes.map((hole) => {
    const geo = createHoleGeometry(hole);
    const localPosition = worldToLocalPosition(hole.position, baseplateOffset, geometryOffset);
    return positionHoleGeometry(geo, localPosition, baseTopY);
  });

  const merged = mergeBufferGeometries(geometries);

  if (merged) {
    merged.computeVertexNormals();
  }

  // Dispose individual geometries to prevent memory leaks
  geometries.forEach((g) => g.dispose());

  return merged;
}

// =============================================================================
// Buffer Geometry Merging Utilities
// =============================================================================

/**
 * Normalizes a geometry for consistent merging.
 * Ensures non-indexed format and presence of normals.
 *
 * @param geo - The geometry to normalize
 * @returns Normalized geometry (cloned)
 */
function normalizeGeometryForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let normalized = geo.clone();

  // Convert indexed to non-indexed for consistent merging
  if (normalized.index) {
    const nonIndexed = normalized.toNonIndexed();
    normalized.dispose();
    normalized = nonIndexed;
  }

  // Ensure normals exist
  if (!normalized.getAttribute('normal')) {
    normalized.computeVertexNormals();
  }

  return normalized;
}

/**
 * Merges multiple buffer geometries using Three.js utilities.
 * Falls back to manual merge if the standard approach fails.
 *
 * @param geometries - Array of geometries to merge
 * @returns Merged geometry or null if empty
 */
function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geometries.length === 0) {
    return null;
  }
  if (geometries.length === 1) {
    return geometries[0].clone();
  }

  const normalizedGeometries = geometries.map(normalizeGeometryForMerge);

  try {
    const merged = mergeGeometries(normalizedGeometries, false);
    normalizedGeometries.forEach((g) => g.dispose());
    return merged;
  } catch (error) {
    console.error('[holeGeometry] Failed to merge geometries:', error);
    normalizedGeometries.forEach((g) => g.dispose());
    return manualMergeGeometries(geometries);
  }
}

/**
 * Calculates total vertex and index counts for manual merge.
 *
 * @param geometries - Array of geometries
 * @returns Object with totalVertices and totalIndices
 */
function calculateMergeCounts(geometries: THREE.BufferGeometry[]): {
  totalVertices: number;
  totalIndices: number;
} {
  let totalVertices = 0;
  let totalIndices = 0;

  for (const geo of geometries) {
    const posAttr = geo.getAttribute('position');
    totalVertices += posAttr.count;
    totalIndices += geo.index ? geo.index.count : posAttr.count;
  }

  return { totalVertices, totalIndices };
}

/**
 * Manual geometry merge fallback when standard merge fails.
 * Combines all vertices and indices into a single geometry.
 *
 * @param geometries - Array of geometries to merge
 * @returns Merged geometry or null if empty
 */
function manualMergeGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (geometries.length === 0) {
    return null;
  }
  if (geometries.length === 1) {
    return geometries[0].clone();
  }

  const { totalVertices, totalIndices } = calculateMergeCounts(geometries);
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

    // Copy or create indices
    if (geo.index) {
      const indexArray = geo.index.array;
      for (let i = 0; i < indexArray.length; i += 1) {
        indices[indexOffset + i] = indexArray[i] + vertexCount;
      }
      indexOffset += indexArray.length;
    } else {
      for (let i = 0; i < posAttr.count; i += 1) {
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

// =============================================================================
// Serialization (for Web Worker Transfer)
// =============================================================================

/** Serialized geometry structure for transferable objects */
export interface SerializedGeometry {
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
}

/**
 * Serializes geometry for web worker transfer.
 *
 * @param geometry - The geometry to serialize
 * @returns Serialized geometry with typed arrays
 */
export function serializeGeometry(geometry: THREE.BufferGeometry): SerializedGeometry {
  const positions = geometry.getAttribute('position').array as Float32Array;
  const normals = geometry.getAttribute('normal');

  const result: SerializedGeometry = {
    positions: new Float32Array(positions),
  };

  if (geometry.index) {
    result.indices = new Uint32Array(geometry.index.array);
  }

  if (normals) {
    result.normals = new Float32Array(normals.array as Float32Array);
  }

  return result;
}

/**
 * Deserializes geometry from web worker result.
 * Ensures CSG compatibility by adding UV attribute if missing.
 *
 * @param data - The serialized geometry data
 * @returns Reconstructed BufferGeometry
 */
export function deserializeGeometry(data: SerializedGeometry): THREE.BufferGeometry {
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

  // Add UV attribute for CSG compatibility if missing
  const posAttr = geometry.getAttribute('position');
  if (posAttr && !geometry.getAttribute('uv')) {
    const uvArray = new Float32Array(posAttr.count * 2);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }

  return geometry;
}
