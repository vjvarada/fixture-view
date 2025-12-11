// ============================================
// Mesh Optimization and Cleanup Module
// ============================================

import * as THREE from 'three';

// ============================================
// Configuration
// ============================================

/** Threshold for considering triangles coplanar (dot product of normals) */
const COPLANAR_DOT_THRESHOLD = 0.9999;

/** Threshold for considering heights equal */
const HEIGHT_EPSILON = 0.0001;

// ============================================
// Greedy Coplanar Triangle Merging
// ============================================

/**
 * Merges coplanar adjacent triangles using a greedy growing algorithm.
 * 
 * Algorithm:
 * 1. Build adjacency map (edge -> triangles)
 * 2. Group triangles by normal direction (horizontal vs vertical faces)
 * 3. For horizontal faces, group by height
 * 4. Use flood-fill to find connected coplanar regions
 * 5. Extract boundary polygon for each region
 * 6. Re-triangulate with ear-clipping (produces n-2 triangles for n vertices)
 * 
 * @param geometry - Input BufferGeometry (indexed)
 * @returns Optimized geometry with merged coplanar triangles
 */
export function mergeCoplanarTriangles(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const startTime = performance.now();
    
    if (!geometry.index) {
        console.warn('[mergeCoplanarTriangles] Geometry is not indexed, skipping');
        return geometry;
    }
    
    const positions = geometry.attributes.position.array as Float32Array;
    const indices = Array.from(geometry.index.array);
    const originalTriCount = indices.length / 3;
    
    // Skip if mesh is small
    if (originalTriCount < 100) {
        console.log('[mergeCoplanarTriangles] Mesh too small to optimize');
        return geometry;
    }
    
    // Build triangle data
    const triangles = buildTriangleData(positions, indices);
    
    // Build edge adjacency
    const edgeToTriangles = buildEdgeAdjacency(triangles);
    
    // Separate triangles by orientation
    const { horizontal, vertical } = separateByOrientation(triangles);
    
    console.log(`[mergeCoplanarTriangles] ${horizontal.length} horizontal, ${vertical.length} vertical triangles`);
    
    // Group horizontal triangles by height
    const horizontalByHeight = groupByHeight(triangles, horizontal);
    
    // Process each height level and collect merged regions
    const mergedRegions: MergedRegion[] = [];
    const processedTriangles = new Set<number>();
    
    for (const [height, trisAtHeight] of horizontalByHeight) {
        if (trisAtHeight.length < 4) continue;
        
        // Find connected coplanar regions using flood-fill
        const regions = findCoplanarRegions(triangles, trisAtHeight, edgeToTriangles);
        
        for (const region of regions) {
            if (region.triangleIndices.length < 2) continue;
            
            // Extract boundary polygon
            const boundary = extractBoundaryPolygon(triangles, region.triangleIndices, edgeToTriangles, positions);
            
            if (boundary && boundary.length >= 3) {
                mergedRegions.push({
                    triangleIndices: region.triangleIndices,
                    boundary,
                    normal: region.normal,
                    height
                });
                
                for (const ti of region.triangleIndices) {
                    processedTriangles.add(ti);
                }
            }
        }
    }
    
    // Build new index array
    const newIndices: number[] = [];
    
    // Add non-processed triangles as-is
    for (let ti = 0; ti < triangles.length; ti++) {
        if (!processedTriangles.has(ti)) {
            newIndices.push(...triangles[ti].indices);
        }
    }
    
    // Add re-triangulated merged regions
    let savedTriangles = 0;
    
    for (const region of mergedRegions) {
        const originalTris = region.triangleIndices.length;
        const newTris = triangulatePolygon(region.boundary, region.normal, positions, newIndices);
        savedTriangles += originalTris - newTris;
    }
    
    // Create new geometry
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    newGeometry.setIndex(newIndices);
    newGeometry.computeVertexNormals();
    
    const endTime = performance.now();
    const newTriCount = newIndices.length / 3;
    const reduction = ((originalTriCount - newTriCount) / originalTriCount * 100).toFixed(1);
    
    console.log(`[mergeCoplanarTriangles] ${originalTriCount} → ${newTriCount} triangles (${reduction}% reduction) [${(endTime - startTime).toFixed(0)}ms]`);
    
    return newGeometry;
}

// ============================================
// Helper Types
// ============================================

interface TriangleData {
    indices: [number, number, number];
    normal: THREE.Vector3;
    centroid: THREE.Vector3;
}

interface CoplanarRegion {
    triangleIndices: number[];
    normal: THREE.Vector3;
}

interface MergedRegion {
    triangleIndices: number[];
    boundary: number[];
    normal: THREE.Vector3;
    height: number;
}

// ============================================
// Helper Functions
// ============================================

function buildTriangleData(positions: Float32Array, indices: number[]): TriangleData[] {
    const triangles: TriangleData[] = [];
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i];
        const i1 = indices[i + 1];
        const i2 = indices[i + 2];
        
        v0.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
        v1.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
        v2.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
        
        edge1.subVectors(v1, v0);
        edge2.subVectors(v2, v0);
        
        const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
        const centroid = new THREE.Vector3(
            (v0.x + v1.x + v2.x) / 3,
            (v0.y + v1.y + v2.y) / 3,
            (v0.z + v1.z + v2.z) / 3
        );
        
        triangles.push({ indices: [i0, i1, i2], normal, centroid });
    }
    
    return triangles;
}

function buildEdgeAdjacency(triangles: TriangleData[]): Map<string, number[]> {
    const edgeToTriangles = new Map<string, number[]>();
    
    const getEdgeKey = (a: number, b: number): string => {
        return a < b ? `${a}_${b}` : `${b}_${a}`;
    };
    
    for (let ti = 0; ti < triangles.length; ti++) {
        const tri = triangles[ti];
        const edges = [
            [tri.indices[0], tri.indices[1]],
            [tri.indices[1], tri.indices[2]],
            [tri.indices[2], tri.indices[0]]
        ];
        
        for (const [a, b] of edges) {
            const key = getEdgeKey(a, b);
            if (!edgeToTriangles.has(key)) {
                edgeToTriangles.set(key, []);
            }
            edgeToTriangles.get(key)!.push(ti);
        }
    }
    
    return edgeToTriangles;
}

function separateByOrientation(triangles: TriangleData[]): { horizontal: number[], vertical: number[] } {
    const horizontal: number[] = [];
    const vertical: number[] = [];
    
    for (let ti = 0; ti < triangles.length; ti++) {
        // Horizontal if normal points mostly up or down (Y direction)
        if (Math.abs(triangles[ti].normal.y) > 0.99) {
            horizontal.push(ti);
        } else {
            vertical.push(ti);
        }
    }
    
    return { horizontal, vertical };
}

function groupByHeight(triangles: TriangleData[], triIndices: number[]): Map<number, number[]> {
    const byHeight = new Map<number, number[]>();
    
    for (const ti of triIndices) {
        // Round to avoid floating point issues
        const height = Math.round(triangles[ti].centroid.y * 10000) / 10000;
        
        if (!byHeight.has(height)) {
            byHeight.set(height, []);
        }
        byHeight.get(height)!.push(ti);
    }
    
    return byHeight;
}

function findCoplanarRegions(
    triangles: TriangleData[],
    triIndices: number[],
    edgeToTriangles: Map<string, number[]>
): CoplanarRegion[] {
    const regions: CoplanarRegion[] = [];
    const visited = new Set<number>();
    const triSet = new Set(triIndices);
    
    const getEdgeKey = (a: number, b: number): string => {
        return a < b ? `${a}_${b}` : `${b}_${a}`;
    };
    
    for (const startTi of triIndices) {
        if (visited.has(startTi)) continue;
        
        // Flood-fill to find connected region
        const region: number[] = [];
        const queue = [startTi];
        const baseNormal = triangles[startTi].normal;
        
        while (queue.length > 0) {
            const ti = queue.pop()!;
            if (visited.has(ti)) continue;
            
            // Check if coplanar with region
            const dot = triangles[ti].normal.dot(baseNormal);
            if (Math.abs(dot) < COPLANAR_DOT_THRESHOLD) continue;
            
            visited.add(ti);
            region.push(ti);
            
            // Add unvisited neighbors
            const tri = triangles[ti];
            const edges = [
                getEdgeKey(tri.indices[0], tri.indices[1]),
                getEdgeKey(tri.indices[1], tri.indices[2]),
                getEdgeKey(tri.indices[2], tri.indices[0])
            ];
            
            for (const edgeKey of edges) {
                const neighbors = edgeToTriangles.get(edgeKey);
                if (neighbors) {
                    for (const ni of neighbors) {
                        if (!visited.has(ni) && triSet.has(ni)) {
                            queue.push(ni);
                        }
                    }
                }
            }
        }
        
        if (region.length >= 2) {
            regions.push({ triangleIndices: region, normal: baseNormal.clone() });
        }
    }
    
    return regions;
}

function extractBoundaryPolygon(
    triangles: TriangleData[],
    triIndices: number[],
    edgeToTriangles: Map<string, number[]>,
    positions: Float32Array
): number[] | null {
    const triSet = new Set(triIndices);
    
    const getEdgeKey = (a: number, b: number): string => {
        return a < b ? `${a}_${b}` : `${b}_${a}`;
    };
    
    // Find boundary edges (edges shared by only one triangle in the region)
    const boundaryEdges: [number, number][] = [];
    const edgeCount = new Map<string, { count: number, edge: [number, number] }>();
    
    for (const ti of triIndices) {
        const tri = triangles[ti];
        const edges: [number, number][] = [
            [tri.indices[0], tri.indices[1]],
            [tri.indices[1], tri.indices[2]],
            [tri.indices[2], tri.indices[0]]
        ];
        
        for (const [a, b] of edges) {
            const key = getEdgeKey(a, b);
            const neighbors = edgeToTriangles.get(key) || [];
            
            // Count how many triangles in our region share this edge
            let regionCount = 0;
            for (const ni of neighbors) {
                if (triSet.has(ni)) regionCount++;
            }
            
            if (regionCount === 1) {
                // This is a boundary edge - store with correct winding
                boundaryEdges.push([a, b]);
            }
        }
    }
    
    if (boundaryEdges.length < 3) return null;
    
    // Chain boundary edges into a polygon
    const edgeMap = new Map<number, number>();
    for (const [a, b] of boundaryEdges) {
        edgeMap.set(a, b);
    }
    
    // Start from first edge and follow the chain
    const polygon: number[] = [];
    let current = boundaryEdges[0][0];
    const startVertex = current;
    const maxIterations = boundaryEdges.length + 1;
    let iterations = 0;
    
    while (iterations < maxIterations) {
        polygon.push(current);
        const next = edgeMap.get(current);
        
        if (next === undefined) {
            // Broken chain - boundary is not closed
            return null;
        }
        
        if (next === startVertex) {
            break; // Completed loop
        }
        
        current = next;
        iterations++;
    }
    
    if (polygon.length < 3) return null;
    
    return polygon;
}

function triangulatePolygon(
    polygon: number[],
    normal: THREE.Vector3,
    positions: Float32Array,
    outputIndices: number[]
): number {
    if (polygon.length < 3) return 0;
    if (polygon.length === 3) {
        outputIndices.push(polygon[0], polygon[1], polygon[2]);
        return 1;
    }
    
    // Use ear-clipping for simple polygon triangulation
    // Project to 2D based on the dominant axis of the normal
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);
    
    // Choose projection plane
    let getU: (i: number) => number;
    let getV: (i: number) => number;
    
    if (absY >= absX && absY >= absZ) {
        // Project to XZ plane (Y is up)
        getU = (i) => positions[i * 3];     // X
        getV = (i) => positions[i * 3 + 2]; // Z
    } else if (absX >= absZ) {
        // Project to YZ plane (X is dominant)
        getU = (i) => positions[i * 3 + 1]; // Y
        getV = (i) => positions[i * 3 + 2]; // Z
    } else {
        // Project to XY plane (Z is dominant)
        getU = (i) => positions[i * 3];     // X
        getV = (i) => positions[i * 3 + 1]; // Y
    }
    
    // Convert to 2D coordinates
    const verts: { idx: number, u: number, v: number }[] = polygon.map(idx => ({
        idx,
        u: getU(idx),
        v: getV(idx)
    }));
    
    // Ensure correct winding (CCW for normal pointing up)
    const area = computeSignedArea(verts);
    const shouldBePositive = normal.y > 0 || (absY < 0.5 && normal.dot(new THREE.Vector3(0, 1, 0)) >= 0);
    
    if ((area < 0) === shouldBePositive) {
        verts.reverse();
    }
    
    // Ear clipping
    const remaining = [...verts];
    let triangleCount = 0;
    let safety = remaining.length * remaining.length;
    
    while (remaining.length > 3 && safety-- > 0) {
        let earFound = false;
        
        for (let i = 0; i < remaining.length; i++) {
            const prev = remaining[(i - 1 + remaining.length) % remaining.length];
            const curr = remaining[i];
            const next = remaining[(i + 1) % remaining.length];
            
            // Check if this is a convex vertex (ear candidate)
            if (!isConvex(prev, curr, next)) continue;
            
            // Check if any other vertex is inside this triangle
            let isEar = true;
            for (let j = 0; j < remaining.length; j++) {
                if (j === (i - 1 + remaining.length) % remaining.length ||
                    j === i ||
                    j === (i + 1) % remaining.length) continue;
                
                if (pointInTriangle(remaining[j], prev, curr, next)) {
                    isEar = false;
                    break;
                }
            }
            
            if (isEar) {
                outputIndices.push(prev.idx, curr.idx, next.idx);
                triangleCount++;
                remaining.splice(i, 1);
                earFound = true;
                break;
            }
        }
        
        if (!earFound) {
            // Fallback: just clip any vertex
            if (remaining.length >= 3) {
                outputIndices.push(remaining[0].idx, remaining[1].idx, remaining[2].idx);
                triangleCount++;
                remaining.splice(1, 1);
            }
        }
    }
    
    // Handle last triangle
    if (remaining.length === 3) {
        outputIndices.push(remaining[0].idx, remaining[1].idx, remaining[2].idx);
        triangleCount++;
    }
    
    return triangleCount;
}

function computeSignedArea(verts: { u: number, v: number }[]): number {
    let area = 0;
    for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        area += verts[i].u * verts[j].v;
        area -= verts[j].u * verts[i].v;
    }
    return area * 0.5;
}

function isConvex(
    prev: { u: number, v: number },
    curr: { u: number, v: number },
    next: { u: number, v: number }
): boolean {
    const cross = (curr.u - prev.u) * (next.v - prev.v) - (curr.v - prev.v) * (next.u - prev.u);
    return cross > 0;
}

function pointInTriangle(
    p: { u: number, v: number },
    a: { u: number, v: number },
    b: { u: number, v: number },
    c: { u: number, v: number }
): boolean {
    const sign = (p1: { u: number, v: number }, p2: { u: number, v: number }, p3: { u: number, v: number }) => {
        return (p1.u - p3.u) * (p2.v - p3.v) - (p2.u - p3.u) * (p1.v - p3.v);
    };
    
    const d1 = sign(p, a, b);
    const d2 = sign(p, b, c);
    const d3 = sign(p, c, a);
    
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    
    return !(hasNeg && hasPos);
}

// ============================================
// Mesh Cleanup Functions
// ============================================

export function removeDegenerateTriangles(geometry) {
    const positions = geometry.attributes.position.array;
    const indices = geometry.index.array;
    const newIndices = [];
    
    let removedTriangles = 0;
    const epsilon = 1e-10;
    
    // Process all triangles in one pass - no artificial delays
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;
        
        const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
        const v1x = positions[i1], v1y = positions[i1 + 1], v1z = positions[i1 + 2];
        const v2x = positions[i2], v2y = positions[i2 + 1], v2z = positions[i2 + 2];
        
        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
        
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        const areaSq = cx * cx + cy * cy + cz * cz;
        
        if (areaSq > epsilon) {
            newIndices.push(indices[i], indices[i + 1], indices[i + 2]);
        } else {
            removedTriangles++;
        }
    }
    
    if (removedTriangles > 0) {
        console.log(`Removed ${removedTriangles} degenerate triangles`);
        
        const cleanedGeometry = new THREE.BufferGeometry();
        cleanedGeometry.setAttribute('position', geometry.attributes.position.clone());
        cleanedGeometry.setIndex(newIndices);
        cleanedGeometry.computeVertexNormals();
        
        return cleanedGeometry;
    }
    
    return geometry;
}

// ============================================
// Manifold Verification
// ============================================

export function verifyWatertightness(geometry) {
    const edges = new Map();
    const indices = geometry.index.array;
    const positions = geometry.attributes.position.array;
    
    const edgeTriangles = new Map();
    
    for (let i = 0; i < indices.length; i += 3) {
        const triIdx = i / 3;
        const v0 = indices[i];
        const v1 = indices[i + 1];
        const v2 = indices[i + 2];
        
        const edges_in_tri = [
            [v0, v1],
            [v1, v2],
            [v2, v0]
        ];
        
        for (const [va, vb] of edges_in_tri) {
            const key = va < vb ? `${va}_${vb}` : `${vb}_${va}`;
            edges.set(key, (edges.get(key) || 0) + 1);
            
            if (!edgeTriangles.has(key)) {
                edgeTriangles.set(key, []);
            }
            edgeTriangles.get(key).push(triIdx);
        }
    }
    
    let nonManifoldEdges = 0;
    const edgesByCount = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    
    for (const [edge, count] of edges) {
        if (count === 2) {
            edgesByCount['2']++;
        } else {
            nonManifoldEdges++;
            if (count === 1) edgesByCount['1']++;
            else if (count === 0) edgesByCount['0']++;
            else edgesByCount['3+']++;
        }
    }
    
    console.log(`Manifold check: ${edges.size} total edges`);
    console.log(`  - Manifold (count=2): ${edgesByCount['2']}`);
    console.log(`  - Boundary (count=1): ${edgesByCount['1']}`);
    console.log(`  - Over-shared (count=3+): ${edgesByCount['3+']}`);
    console.log(`  - Non-manifold total: ${nonManifoldEdges}`);
    
    return {
        isWatertight: nonManifoldEdges === 0,
        totalEdges: edges.size,
        manifoldEdges: edgesByCount['2'],
        boundaryEdges: edgesByCount['1'],
        overSharedEdges: edgesByCount['3+'],
        nonManifoldEdges,
        edgeTriangles // return for repair function
    };
}

// ============================================
// Mesh Repair Functions
// ============================================

/**
 * Repair non-manifold mesh by removing triangles that share over-shared edges
 * Strategy: Iteratively keep the 2 best quality triangles for each over-shared edge
 */
export function repairNonManifoldMesh(geometry, maxIterations = 5) {
    console.log('Attempting to repair non-manifold geometry...');
    
    let currentGeometry = geometry;
    let iteration = 0;
    
    while (iteration < maxIterations) {
        const indices = Array.from(currentGeometry.index.array);
        const positions = currentGeometry.attributes.position.array;
        
        // Build edge-to-triangle map
        const edgeTriangles = new Map();
        
        for (let i = 0; i < indices.length; i += 3) {
            const triIdx = i / 3;
            const v0 = indices[i];
            const v1 = indices[i + 1];
            const v2 = indices[i + 2];
            
            const edges_in_tri = [
                [v0, v1],
                [v1, v2],
                [v2, v0]
            ];
            
            for (const [va, vb] of edges_in_tri) {
                const key = va < vb ? `${va}_${vb}` : `${vb}_${va}`;
                
                if (!edgeTriangles.has(key)) {
                    edgeTriangles.set(key, []);
                }
                edgeTriangles.get(key).push(triIdx);
            }
        }
        
        // Find all non-manifold edges (not exactly 2 triangles)
        const overSharedEdges = [];
        const boundaryEdges = [];
        
        for (const [edge, tris] of edgeTriangles) {
            if (tris.length > 2) {
                overSharedEdges.push({ edge, triangles: tris });
            } else if (tris.length === 1) {
                boundaryEdges.push({ edge, triangles: tris });
            }
        }
        
        if (overSharedEdges.length === 0 && boundaryEdges.length === 0) {
            console.log(`✓ Repair complete after ${iteration} iteration(s)`);
            return currentGeometry;
        }
        
        console.log(`Iteration ${iteration + 1}: Found ${overSharedEdges.length} over-shared edges, ${boundaryEdges.length} boundary edges`);
        
        // If only boundary edges remain and we've done at least one iteration, stop
        // (removing triangles to fix boundaries often creates more problems)
        if (overSharedEdges.length === 0 && iteration > 0) {
            console.log(`✓ Repair stopped - only boundary edges remain (${boundaryEdges.length})`);
            return currentGeometry;
        }
        
        // Helper: Calculate triangle area
        const getTriangleArea = (triIdx) => {
            const i = triIdx * 3;
            const i0 = Number(indices[i]) * 3;
            const i1 = Number(indices[i + 1]) * 3;
            const i2 = Number(indices[i + 2]) * 3;
            
            const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
            const v1x = positions[i1], v1y = positions[i1 + 1], v1z = positions[i1 + 2];
            const v2x = positions[i2], v2y = positions[i2 + 1], v2z = positions[i2 + 2];
            
            const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
            const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
            
            const cx = e1y * e2z - e1z * e2y;
            const cy = e1z * e2x - e1x * e2z;
            const cz = e1x * e2y - e1y * e2x;
            
            return Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
        };
        
        // Mark triangles to remove (only process over-shared edges, not boundaries)
        const trianglesToRemove = new Set();
        
        for (const { edge, triangles } of overSharedEdges) {
            // Sort triangles by area (descending) - keep larger triangles
            const sortedTris = triangles.slice().sort((a, b) => {
                return getTriangleArea(b) - getTriangleArea(a);
            });
            
            // Keep best 2 triangles, remove the rest
            for (let i = 2; i < sortedTris.length; i++) {
                trianglesToRemove.add(sortedTris[i]);
            }
        }
        
        if (trianglesToRemove.size === 0) {
            console.log(`✓ No triangles to remove`);
            return currentGeometry;
        }
        
        console.log(`  Removing ${trianglesToRemove.size} triangles to fix over-shared edges`);
        
        // Build new index array without removed triangles
        const newIndices = [];
        for (let i = 0; i < indices.length; i += 3) {
            const triIdx = i / 3;
            if (!trianglesToRemove.has(triIdx)) {
                newIndices.push(indices[i], indices[i + 1], indices[i + 2]);
            }
        }
        
        // Create repaired geometry for next iteration
        const repairedGeometry = new THREE.BufferGeometry();
        repairedGeometry.setAttribute('position', currentGeometry.attributes.position.clone());
        repairedGeometry.setIndex(newIndices);
        repairedGeometry.computeVertexNormals();
        
        console.log(`  ${indices.length / 3} → ${newIndices.length / 3} triangles`);
        
        currentGeometry = repairedGeometry;
        iteration++;
    }
    
    console.log(`⚠ Repair incomplete after ${maxIterations} iterations`);
    return currentGeometry;
}

// ============================================
// Hole Filling
// ============================================

/**
 * Fill small holes in mesh by detecting boundary loops and triangulating them
 * @param geometry - Input geometry with holes
 * @param maxHoleEdges - Maximum number of edges in a hole to fill (default: 100)
 * @returns Geometry with filled holes
 */
export function fillSmallHoles(geometry: any, maxHoleEdges: number = 100): any {
    const positions = Array.from(geometry.attributes.position.array) as number[];
    const indices = Array.from(geometry.index.array) as number[];
    
    // Build edge map to find boundary edges
    const edgeMap = new Map<string, number>();
    
    for (let i = 0; i < indices.length; i += 3) {
        const v0 = indices[i];
        const v1 = indices[i + 1];
        const v2 = indices[i + 2];
        
        // Check each edge of the triangle
        [[v0, v1], [v1, v2], [v2, v0]].forEach(([a, b]) => {
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        });
    }
    
    // Find boundary edges (edges that appear only once)
    const boundaryEdges = new Map<number, number[]>();
    
    for (const [key, count] of edgeMap.entries()) {
        if (count === 1) {
            const [v0, v1] = key.split('_').map(Number);
            
            if (!boundaryEdges.has(v0)) boundaryEdges.set(v0, []);
            if (!boundaryEdges.has(v1)) boundaryEdges.set(v1, []);
            
            boundaryEdges.get(v0)!.push(v1);
            boundaryEdges.get(v1)!.push(v0);
        }
    }
    
    if (boundaryEdges.size === 0) {
        console.log('✓ No holes detected - mesh is watertight');
        return geometry;
    }
    
    // Find boundary loops
    const boundaryLoops: number[][] = [];
    const visited = new Set<number>();
    
    for (const startVertex of boundaryEdges.keys()) {
        if (visited.has(startVertex)) continue;
        
        const loop: number[] = [];
        let current = startVertex;
        
        while (true) {
            visited.add(current);
            loop.push(current);
            
            const neighbors = boundaryEdges.get(current) || [];
            const next = neighbors.find(n => !visited.has(n));
            
            if (!next) {
                // Check if we can close the loop
                const firstNeighbors = boundaryEdges.get(startVertex) || [];
                if (firstNeighbors.includes(current) && loop.length > 2) {
                    boundaryLoops.push(loop);
                }
                break;
            }
            
            current = next;
            
            // Prevent infinite loops
            if (loop.length > maxHoleEdges * 2) break;
        }
    }
    
    console.log(`Found ${boundaryLoops.length} boundary loops`);
    
    let filledHoles = 0;
    const newIndices = [...indices];
    
    // Fill each hole
    for (const loop of boundaryLoops) {
        if (loop.length < 3 || loop.length > maxHoleEdges) {
            console.log(`  Skipping hole with ${loop.length} edges (max: ${maxHoleEdges})`);
            continue;
        }
        
        // Simple fan triangulation from first vertex
        const center = loop[0];
        
        for (let i = 1; i < loop.length - 1; i++) {
            const v1 = loop[i];
            const v2 = loop[i + 1];
            
            // Calculate triangle normal to ensure correct orientation
            const p0x = positions[center * 3], p0y = positions[center * 3 + 1], p0z = positions[center * 3 + 2];
            const p1x = positions[v1 * 3], p1y = positions[v1 * 3 + 1], p1z = positions[v1 * 3 + 2];
            const p2x = positions[v2 * 3], p2y = positions[v2 * 3 + 1], p2z = positions[v2 * 3 + 2];
            
            const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
            const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
            
            // Cross product for normal
            const nx = e1y * e2z - e1z * e2y;
            const ny = e1z * e2x - e1x * e2z;
            const nz = e1x * e2y - e1y * e2x;
            
            // Calculate average normal of adjacent triangles for comparison
            let avgNormalZ = 0;
            let normalCount = 0;
            
            for (let j = 0; j < indices.length; j += 3) {
                if (indices[j] === center || indices[j + 1] === center || indices[j + 2] === center) {
                    const i0 = indices[j] * 3, i1 = indices[j + 1] * 3, i2 = indices[j + 2] * 3;
                    const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
                    const v1x = positions[i1], v1y = positions[i1 + 1], v1z = positions[i1 + 2];
                    const v2x = positions[i2], v2y = positions[i2 + 1], v2z = positions[i2 + 2];
                    
                    const edge1x = v1x - v0x, edge1y = v1y - v0y, edge1z = v1z - v0z;
                    const edge2x = v2x - v0x, edge2y = v2y - v0y, edge2z = v2z - v0z;
                    
                    avgNormalZ += edge1x * edge2y - edge1y * edge2x;
                    normalCount++;
                }
            }
            
            if (normalCount > 0) avgNormalZ /= normalCount;
            
            // Add triangle with correct winding order
            if ((nz > 0 && avgNormalZ > 0) || (nz < 0 && avgNormalZ < 0)) {
                newIndices.push(center, v1, v2);
            } else {
                newIndices.push(center, v2, v1);
            }
        }
        
        filledHoles++;
        console.log(`  ✓ Filled hole with ${loop.length} edges`);
    }
    
    if (filledHoles === 0) {
        console.log('No holes were small enough to fill');
        return geometry;
    }
    
    // Create new geometry with filled holes
    const filledGeometry = new THREE.BufferGeometry();
    filledGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    filledGeometry.setIndex(newIndices);
    filledGeometry.computeVertexNormals();
    
    console.log(`✓ Filled ${filledHoles} holes, added ${(newIndices.length - indices.length) / 3} triangles`);
    
    return filledGeometry;
}
