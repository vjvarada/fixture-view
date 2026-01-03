/**
 * Polygon Utility Functions
 * 
 * Provides functions for working with 2D polygons, particularly
 * for ensuring consistent winding order which is critical for
 * generating manifold 3D geometry.
 * 
 * WINDING ORDER CONVENTIONS:
 * - In XZ plane (looking down Y axis): CW = negative signed area, CCW = positive
 * - THREE.js Shape (XY plane): expects CCW for front-facing geometry
 * - When we apply [x, -y] transformation + rotateX(-PI/2), the winding flips
 * 
 * For custom polygon supports, the geometry pipeline works as follows:
 * 1. User draws polygon in XZ plane (can be CW or CCW)
 * 2. For body: apply [x, -y] to flip winding, create Shape, extrude, rotateX(-PI/2)
 * 3. For fillet: reverse polygon to match body winding, compute normals based on winding
 * 4. For bottom cap: use same reversed polygon as fillet for consistent geometry
 * 
 * The geometry functions now handle ANY winding direction by computing isCW dynamically.
 */

/**
 * Calculate the signed area of a 2D polygon using the shoelace formula.
 * 
 * @param polygon - Array of [x, y] coordinate pairs
 * @returns Signed area (positive = CCW, negative = CW in standard math convention)
 */
export function polygonSignedArea2D(polygon: [number, number][]): number {
  if (polygon.length < 3) return 0;
  
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i][0] * polygon[j][1];
    area -= polygon[j][0] * polygon[i][1];
  }
  return area / 2;
}

/**
 * Determine if a polygon is clockwise in XZ plane.
 * Uses the shoelace formula where negative area = CW.
 * 
 * @param polygon - Array of [x, z] coordinate pairs in XZ plane
 * @returns true if polygon is clockwise, false if counter-clockwise
 */
export function isPolygonClockwiseXZ(polygon: [number, number][]): boolean {
  return polygonSignedArea2D(polygon) < 0;
}

/**
 * Compute winding direction for a polygon using the trapezoidal formula.
 * This is used by geometry functions after reversing the polygon.
 * 
 * The trapezoidal formula: sum of (x2-x1)*(z2+z1) for each edge
 * - Positive = clockwise
 * - Negative = counter-clockwise
 * 
 * @param polygon - Array of [x, z] coordinate pairs
 * @returns true if clockwise, false if counter-clockwise
 */
export function computePolygonWindingCW(polygon: [number, number][]): boolean {
  if (polygon.length < 3) return true;
  
  let signedArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i];
    const [x2, z2] = polygon[(i + 1) % polygon.length];
    signedArea += (x2 - x1) * (z2 + z1);
  }
  return signedArea > 0;
}

/**
 * Ensure polygon has clockwise winding order when viewed in XZ plane (looking down Y axis).
 * 
 * This is used at support creation time to normalize the polygon, ensuring
 * consistent geometry regardless of how the user drew the outline.
 * 
 * @param polygon - Array of [x, z] coordinate pairs in XZ plane
 * @returns Polygon with consistent clockwise winding
 */
export function ensureClockwiseWindingXZ(polygon: [number, number][]): [number, number][] {
  if (polygon.length < 3) return polygon;
  
  // Using shoelace: positive = CCW, negative = CW
  const signedArea = polygonSignedArea2D(polygon);
  
  // If CCW (positive area), reverse to make CW
  if (signedArea > 0) {
    return [...polygon].reverse();
  }
  
  return polygon;
}

/**
 * Prepare a polygon for fillet/cap geometry creation.
 * 
 * IMPORTANT: This function should NOT be used anymore. The fillet and cap geometry
 * should use the SAME polygon vertex order as the body to ensure corners match.
 * 
 * Previously this function reversed the polygon, which caused the corner geometry
 * to be calculated with opposite prev/next directions compared to the body,
 * resulting in non-matching corner curves.
 * 
 * @deprecated Use ensureClockwiseWindingXZ and computePolygonWindingCW separately
 */
export function preparePolygonForGeometry(polygon: [number, number][]): {
  workingPolygon: [number, number][];
  isCW: boolean;
} {
  if (polygon.length < 3) {
    return { workingPolygon: polygon, isCW: true };
  }
  
  // Reverse the polygon to match body's effective winding
  const workingPolygon: [number, number][] = [...polygon].reverse();
  
  // Compute winding of the reversed polygon using trapezoidal formula
  const isCW = computePolygonWindingCW(workingPolygon);
  
  return { workingPolygon, isCW };
}

/**
 * Compute outward-facing edge normal for a polygon edge.
 * The normal direction depends on the polygon's winding order.
 * 
 * @param p1 - Start point of edge [x, z]
 * @param p2 - End point of edge [x, z]
 * @param isCW - Whether the polygon is clockwise
 * @returns Outward normal [nx, nz], or [0, 0] if edge is degenerate
 */
export function computeEdgeNormal(
  p1: [number, number],
  p2: [number, number],
  isCW: boolean
): [number, number] {
  const dx = p2[0] - p1[0];
  const dz = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  
  if (len < 0.01) return [0, 0];
  
  // Perpendicular direction depends on winding
  if (isCW) {
    return [-dz / len, dx / len]; // outward for CW
  } else {
    return [dz / len, -dx / len]; // outward for CCW
  }
}

/**
 * Check if two line segments intersect (excluding endpoints).
 * Used to detect self-intersecting polygons.
 */
function segmentsIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  
  return false;
}

function direction(p1: [number, number], p2: [number, number], p3: [number, number]): number {
  return (p3[0] - p1[0]) * (p2[1] - p1[1]) - (p2[0] - p1[0]) * (p3[1] - p1[1]);
}

/**
 * Check if a polygon is simple (non-self-intersecting).
 * 
 * @param polygon - Array of [x, z] coordinate pairs
 * @returns true if polygon is simple, false if it self-intersects
 */
export function isPolygonSimple(polygon: [number, number][]): boolean {
  const n = polygon.length;
  if (n < 3) return true;
  
  // Check all pairs of non-adjacent edges for intersection
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges (they share a vertex)
      if (i === 0 && j === n - 1) continue;
      
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % n];
      const p3 = polygon[j];
      const p4 = polygon[(j + 1) % n];
      
      if (segmentsIntersect(p1, p2, p3, p4)) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Remove duplicate and near-duplicate vertices from a polygon.
 * Also removes vertices that create zero-length edges.
 * 
 * @param polygon - Array of [x, z] coordinate pairs
 * @param minEdgeLength - Minimum edge length to keep (default 0.1mm)
 * @returns Simplified polygon with unique vertices
 */
export function simplifyPolygonVertices(
  polygon: [number, number][],
  minEdgeLength: number = 0.1
): [number, number][] {
  if (polygon.length < 3) return polygon;
  
  const result: [number, number][] = [];
  
  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    
    // Check if this vertex is too close to the previous one
    if (result.length > 0) {
      const prev = result[result.length - 1];
      const dist = Math.sqrt((curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2);
      if (dist < minEdgeLength) {
        continue; // Skip this vertex
      }
    }
    
    result.push(curr);
  }
  
  // Check if the last vertex is too close to the first
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    const dist = Math.sqrt((first[0] - last[0]) ** 2 + (first[1] - last[1]) ** 2);
    if (dist < minEdgeLength) {
      result.pop();
    }
  }
  
  return result;
}

/**
 * Validate and prepare a polygon for geometry creation.
 * - Removes duplicate vertices
 * - Checks for self-intersection
 * - Normalizes to CW winding
 * 
 * @param polygon - Array of [x, z] coordinate pairs
 * @returns Validated polygon, or null if invalid
 */
export function validateAndPreparePolygon(
  polygon: [number, number][]
): [number, number][] | null {
  if (polygon.length < 3) return null;
  
  // Remove duplicate/near-duplicate vertices
  let cleaned = simplifyPolygonVertices(polygon, 0.5);
  
  if (cleaned.length < 3) {
    console.warn('[validateAndPreparePolygon] Polygon has fewer than 3 unique vertices');
    return null;
  }
  
  // Check for self-intersection
  if (!isPolygonSimple(cleaned)) {
    console.warn('[validateAndPreparePolygon] Polygon is self-intersecting');
    // Don't return null - try to use it anyway, CSG might handle it
    // But log the warning for debugging
  }
  
  // Normalize to CW winding
  cleaned = ensureClockwiseWindingXZ(cleaned);
  
  return cleaned;
}

