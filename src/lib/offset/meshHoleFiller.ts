// ============================================
// Mesh Hole Filler Module
// Detects and fills holes in triangle soup meshes
// Creates cap geometry to close through-holes before heightmap generation
// ============================================

import * as THREE from 'three';

// ============================================
// Types
// ============================================

interface Edge {
    v1: number;  // Vertex index 1 (in original position array, divided by 3)
    v2: number;  // Vertex index 2
    p1: THREE.Vector3;
    p2: THREE.Vector3;
}

interface BoundaryLoop {
    vertices: THREE.Vector3[];
    indices: number[];
    normal: THREE.Vector3;
    center: THREE.Vector3;
    area: number;
}

// ============================================
// Main API
// ============================================

/**
 * Analyze triangle soup and create cap geometry to close holes
 * This is critical for preventing holes in heightmap generation
 * 
 * @param vertices - Float32Array of triangle soup vertices (x,y,z per vertex)
 * @param maxHoleArea - Maximum area of hole to fill (in square units)
 * @param minHoleVertices - Minimum vertices in a hole to consider filling
 * @returns New vertices array with cap triangles appended
 */
export function fillMeshHoles(
    vertices: Float32Array,
    maxHoleArea: number = Infinity,
    minHoleVertices: number = 3
): Float32Array {
    const startTime = performance.now();
    
    console.log(`[fillMeshHoles] Input: ${vertices.length / 9} triangles, ${vertices.length / 3} vertices`);
    
    // Step 1: Build vertex map with spatial hashing for welding
    console.log('[fillMeshHoles] Building vertex map...');
    const { uniqueVertices, vertexToUnique } = buildVertexMap(vertices);
    
    // Step 2: Build edge map and find boundary edges
    console.log('[fillMeshHoles] Finding boundary edges...');
    const boundaryEdges = findBoundaryEdges(vertices, vertexToUnique);
    
    if (boundaryEdges.length === 0) {
        console.log('[fillMeshHoles] ✓ No holes detected - mesh appears closed');
        return vertices;
    }
    
    console.log(`[fillMeshHoles] Found ${boundaryEdges.length} boundary edges`);
    
    // Step 3: Chain boundary edges into loops
    console.log('[fillMeshHoles] Building boundary loops...');
    const loops = buildBoundaryLoops(boundaryEdges, uniqueVertices);
    
    if (loops.length === 0) {
        console.log('[fillMeshHoles] ⚠ Could not form closed boundary loops from edges');
        console.log('[fillMeshHoles] This may indicate a non-manifold mesh or complex hole geometry');
        return vertices;
    }
    
    console.log(`[fillMeshHoles] Found ${loops.length} boundary loops (potential holes)`);
    
    // Step 4: Filter and triangulate loops to create cap geometry
    const capTriangles: number[] = [];
    let filledHoles = 0;
    let skippedSmall = 0;
    let skippedLarge = 0;
    let failedTriangulation = 0;
    
    for (let loopIdx = 0; loopIdx < loops.length; loopIdx++) {
        const loop = loops[loopIdx];
        
        // Skip if outside size limits
        if (loop.vertices.length < minHoleVertices) {
            skippedSmall++;
            continue;
        }
        
        if (loop.area > maxHoleArea) {
            skippedLarge++;
            continue;
        }
        
        console.log(`[fillMeshHoles] Processing loop ${loopIdx + 1}/${loops.length}: ${loop.vertices.length} vertices, area=${loop.area.toFixed(2)}`);
        
        // Triangulate the loop
        const triangles = triangulateLoop(loop);
        
        if (triangles.length > 0) {
            capTriangles.push(...triangles);
            filledHoles++;
            console.log(`[fillMeshHoles]   ✓ Created ${triangles.length / 9} cap triangles`);
        } else {
            failedTriangulation++;
            console.log(`[fillMeshHoles]   ✗ Triangulation failed`);
        }
    }
    
    if (skippedSmall > 0) console.log(`[fillMeshHoles] Skipped ${skippedSmall} small loops`);
    if (skippedLarge > 0) console.log(`[fillMeshHoles] Skipped ${skippedLarge} large loops`);
    if (failedTriangulation > 0) console.log(`[fillMeshHoles] Failed to triangulate ${failedTriangulation} loops`);
    
    if (capTriangles.length === 0) {
        console.log('[fillMeshHoles] No cap triangles generated');
        return vertices;
    }
    
    // Step 5: Combine original vertices with cap triangles
    const combinedVertices = new Float32Array(vertices.length + capTriangles.length);
    combinedVertices.set(vertices, 0);
    combinedVertices.set(new Float32Array(capTriangles), vertices.length);
    
    const endTime = performance.now();
    console.log(`[fillMeshHoles] ✓ Complete: ${filledHoles} holes filled, ${capTriangles.length / 9} cap triangles added [${(endTime - startTime).toFixed(0)}ms]`);
    
    return combinedVertices;
}

// ============================================
// Vertex Welding with Spatial Hashing
// ============================================

function buildVertexMap(vertices: Float32Array): { 
    uniqueVertices: THREE.Vector3[], 
    vertexToUnique: Map<number, number> 
} {
    // Use larger epsilon for better vertex welding - 1e-4 is about 0.1mm for mm-scale models
    const EPSILON = 1e-4;
    const uniqueVertices: THREE.Vector3[] = [];
    const vertexToUnique = new Map<number, number>();
    
    // Spatial hash for fast lookups
    const spatialHash = new Map<string, number[]>();
    const cellSize = EPSILON * 10;
    
    const getHashKey = (x: number, y: number, z: number): string => {
        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        const cz = Math.floor(z / cellSize);
        return `${cx},${cy},${cz}`;
    };
    
    const numVertices = vertices.length / 3;
    
    for (let i = 0; i < numVertices; i++) {
        const x = vertices[i * 3];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];
        
        // Check nearby cells for matching vertex
        let foundIndex = -1;
        
        outer:
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = getHashKey(x + dx * cellSize, y + dy * cellSize, z + dz * cellSize);
                    const candidates = spatialHash.get(key);
                    
                    if (candidates) {
                        for (const idx of candidates) {
                            const v = uniqueVertices[idx];
                            if (Math.abs(v.x - x) < EPSILON && 
                                Math.abs(v.y - y) < EPSILON && 
                                Math.abs(v.z - z) < EPSILON) {
                                foundIndex = idx;
                                break outer;
                            }
                        }
                    }
                }
            }
        }
        
        if (foundIndex >= 0) {
            vertexToUnique.set(i, foundIndex);
        } else {
            const newIndex = uniqueVertices.length;
            uniqueVertices.push(new THREE.Vector3(x, y, z));
            vertexToUnique.set(i, newIndex);
            
            const key = getHashKey(x, y, z);
            if (!spatialHash.has(key)) {
                spatialHash.set(key, []);
            }
            spatialHash.get(key)!.push(newIndex);
        }
    }
    
    console.log(`  Welded ${numVertices} vertices to ${uniqueVertices.length} unique vertices`);
    
    return { uniqueVertices, vertexToUnique };
}

// ============================================
// Boundary Edge Detection
// ============================================

function findBoundaryEdges(
    vertices: Float32Array, 
    vertexToUnique: Map<number, number>
): Edge[] {
    const edgeCount = new Map<string, { count: number, edge: Edge }>();
    const numTriangles = vertices.length / 9;
    
    for (let t = 0; t < numTriangles; t++) {
        const baseIdx = t * 3;
        
        // Get unique vertex indices for this triangle
        const v0 = vertexToUnique.get(baseIdx)!;
        const v1 = vertexToUnique.get(baseIdx + 1)!;
        const v2 = vertexToUnique.get(baseIdx + 2)!;
        
        // Get positions
        const p0 = new THREE.Vector3(
            vertices[baseIdx * 3], vertices[baseIdx * 3 + 1], vertices[baseIdx * 3 + 2]
        );
        const p1 = new THREE.Vector3(
            vertices[(baseIdx + 1) * 3], vertices[(baseIdx + 1) * 3 + 1], vertices[(baseIdx + 1) * 3 + 2]
        );
        const p2 = new THREE.Vector3(
            vertices[(baseIdx + 2) * 3], vertices[(baseIdx + 2) * 3 + 1], vertices[(baseIdx + 2) * 3 + 2]
        );
        
        // Process each edge
        const edges: [number, number, THREE.Vector3, THREE.Vector3][] = [
            [v0, v1, p0, p1],
            [v1, v2, p1, p2],
            [v2, v0, p2, p0]
        ];
        
        for (const [va, vb, pa, pb] of edges) {
            // Canonical edge key (smaller index first)
            const key = va < vb ? `${va}_${vb}` : `${vb}_${va}`;
            
            if (!edgeCount.has(key)) {
                edgeCount.set(key, { 
                    count: 0, 
                    edge: { v1: va, v2: vb, p1: pa.clone(), p2: pb.clone() } 
                });
            }
            edgeCount.get(key)!.count++;
        }
    }
    
    // Boundary edges appear exactly once
    const boundaryEdges: Edge[] = [];
    
    for (const [key, { count, edge }] of edgeCount) {
        if (count === 1) {
            boundaryEdges.push(edge);
        }
    }
    
    return boundaryEdges;
}

// ============================================
// Boundary Loop Construction
// ============================================

function buildBoundaryLoops(edges: Edge[], uniqueVertices: THREE.Vector3[]): BoundaryLoop[] {
    const loops: BoundaryLoop[] = [];
    
    if (edges.length === 0) return loops;
    
    // Build adjacency map: vertex -> list of connected vertices with edge info
    const adjacency = new Map<number, Map<number, THREE.Vector3>>();
    
    for (const edge of edges) {
        if (!adjacency.has(edge.v1)) adjacency.set(edge.v1, new Map());
        if (!adjacency.has(edge.v2)) adjacency.set(edge.v2, new Map());
        
        adjacency.get(edge.v1)!.set(edge.v2, edge.p2);
        adjacency.get(edge.v2)!.set(edge.v1, edge.p1);
    }
    
    // Debug: Check vertex degrees (should be 2 for simple holes)
    let degree1Count = 0;
    let degree2Count = 0;
    let degree3PlusCount = 0;
    for (const [vertex, neighbors] of adjacency) {
        const degree = neighbors.size;
        if (degree === 1) degree1Count++;
        else if (degree === 2) degree2Count++;
        else degree3PlusCount++;
    }
    console.log(`  Boundary vertex degrees: 1=${degree1Count}, 2=${degree2Count}, 3+=${degree3PlusCount}`);
    
    if (degree1Count > 0) {
        console.log(`  ⚠ Found ${degree1Count} degree-1 vertices (open boundary, cannot form closed loops)`);
    }
    
    // Track which edges have been used
    const usedEdges = new Set<string>();
    const getEdgeKey = (v1: number, v2: number) => v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
    
    // Find all loops by following unused edges
    for (const startVertex of adjacency.keys()) {
        const startNeighbors = adjacency.get(startVertex)!;
        
        // Try to start a loop from each unused edge from this vertex
        for (const [firstNeighbor, _] of startNeighbors) {
            const firstEdgeKey = getEdgeKey(startVertex, firstNeighbor);
            if (usedEdges.has(firstEdgeKey)) continue;
            
            // Try to form a loop
            const loopVertices: THREE.Vector3[] = [];
            const loopIndices: number[] = [];
            const loopEdges: string[] = [];
            
            let current = startVertex;
            let next = firstNeighbor;
            
            loopIndices.push(current);
            loopVertices.push(uniqueVertices[current].clone());
            
            let iterations = 0;
            const maxIterations = edges.length + 1;
            
            while (iterations < maxIterations) {
                iterations++;
                
                const edgeKey = getEdgeKey(current, next);
                if (usedEdges.has(edgeKey)) {
                    // Hit an already-used edge, can't continue
                    break;
                }
                
                loopEdges.push(edgeKey);
                loopIndices.push(next);
                loopVertices.push(uniqueVertices[next].clone());
                
                // Check if we've closed the loop
                if (next === startVertex) {
                    // Successfully closed the loop!
                    // Remove the duplicate start vertex we just added
                    loopIndices.pop();
                    loopVertices.pop();
                    
                    if (loopIndices.length >= 3) {
                        // Mark all edges as used
                        for (const ek of loopEdges) {
                            usedEdges.add(ek);
                        }
                        
                        const loop = createBoundaryLoop(loopVertices, loopIndices);
                        if (loop) {
                            loops.push(loop);
                        }
                    }
                    break;
                }
                
                // Find next vertex: look for an unused edge from 'next' that isn't going back to 'current'
                const neighbors = adjacency.get(next);
                if (!neighbors) break;
                
                let found = false;
                const prev = current;
                current = next;
                
                for (const [neighbor, _] of neighbors) {
                    if (neighbor === prev) continue; // Don't go back
                    
                    const nextEdgeKey = getEdgeKey(current, neighbor);
                    if (!usedEdges.has(nextEdgeKey)) {
                        next = neighbor;
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    // Dead end - this path doesn't form a closed loop
                    console.log(`    Dead end at vertex ${current}, could not find next unused edge`);
                    break;
                }
            }
        }
    }
    
    // Count unused edges for diagnostics
    let unusedEdgeCount = 0;
    for (const edge of edges) {
        const key = getEdgeKey(edge.v1, edge.v2);
        if (!usedEdges.has(key)) unusedEdgeCount++;
    }
    
    console.log(`  Built ${loops.length} closed boundary loops from ${edges.length} edges (${unusedEdgeCount} unused)`);
    
    if (unusedEdgeCount > 0 && loops.length === 0) {
        console.log(`  ⚠ All ${unusedEdgeCount} edges unused - boundary may be open or non-manifold`);
    }
    
    return loops;
}

function createBoundaryLoop(vertices: THREE.Vector3[], indices: number[]): BoundaryLoop | null {
    if (vertices.length < 3) return null;
    
    // Calculate center
    const center = new THREE.Vector3();
    for (const v of vertices) {
        center.add(v);
    }
    center.divideScalar(vertices.length);
    
    // Calculate normal using Newell's method (robust for non-planar polygons)
    const normal = new THREE.Vector3();
    for (let i = 0; i < vertices.length; i++) {
        const curr = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        
        normal.x += (curr.y - next.y) * (curr.z + next.z);
        normal.y += (curr.z - next.z) * (curr.x + next.x);
        normal.z += (curr.x - next.x) * (curr.y + next.y);
    }
    
    if (normal.lengthSq() < 1e-10) {
        return null; // Degenerate loop
    }
    
    normal.normalize();
    
    // Calculate approximate area using shoelace formula projected onto best-fit plane
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const curr = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        
        // Cross product contribution
        const cross = new THREE.Vector3().crossVectors(
            curr.clone().sub(center),
            next.clone().sub(center)
        );
        area += cross.length();
    }
    area *= 0.5;
    
    return {
        vertices,
        indices,
        normal,
        center,
        area
    };
}

// ============================================
// Loop Triangulation
// ============================================

/**
 * Triangulate a boundary loop using ear clipping algorithm
 * Projects to 2D, triangulates, then maps back to 3D
 */
function triangulateLoop(loop: BoundaryLoop): number[] {
    const vertices = loop.vertices;
    const n = vertices.length;
    
    if (n < 3) return [];
    if (n === 3) {
        // Simple triangle - use normal to determine winding
        // Cap should face "inward" (opposite to boundary normal for holes)
        return [
            vertices[0].x, vertices[0].y, vertices[0].z,
            vertices[2].x, vertices[2].y, vertices[2].z,
            vertices[1].x, vertices[1].y, vertices[1].z
        ];
    }
    
    // Project to 2D for triangulation
    const { points2D, basis } = projectTo2D(vertices, loop.normal, loop.center);
    
    // Check if projection is valid (points have some spread)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points2D) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    
    const spread = Math.max(maxX - minX, maxY - minY);
    if (spread < 1e-6) {
        console.warn('  Degenerate projection - loop is nearly a line');
        return fanTriangulate(vertices, loop.center);
    }
    
    // Ear clipping triangulation
    const triangleIndices = earClipTriangulate(points2D);
    
    if (triangleIndices.length === 0) {
        console.warn('  Ear clipping failed, using fan triangulation');
        return fanTriangulate(vertices, loop.center);
    }
    
    // Convert back to 3D triangles
    const triangles: number[] = [];
    
    for (let i = 0; i < triangleIndices.length; i += 3) {
        const i0 = triangleIndices[i];
        const i1 = triangleIndices[i + 1];
        const i2 = triangleIndices[i + 2];
        
        triangles.push(
            vertices[i0].x, vertices[i0].y, vertices[i0].z,
            vertices[i1].x, vertices[i1].y, vertices[i1].z,
            vertices[i2].x, vertices[i2].y, vertices[i2].z
        );
    }
    
    return triangles;
}

function projectTo2D(
    vertices: THREE.Vector3[], 
    normal: THREE.Vector3, 
    center: THREE.Vector3
): { points2D: { x: number, y: number }[], basis: { u: THREE.Vector3, v: THREE.Vector3 } } {
    // Create orthonormal basis on the plane
    // Find a vector not parallel to normal to create basis
    let tempVec = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tempVec)) > 0.9) {
        tempVec = new THREE.Vector3(0, 1, 0);
    }
    
    // u = tempVec × normal (perpendicular to normal)
    const u = new THREE.Vector3().crossVectors(tempVec, normal).normalize();
    // v = normal × u (perpendicular to both)
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    
    // Project vertices to 2D
    const points2D: { x: number, y: number }[] = [];
    
    for (const vertex of vertices) {
        const local = vertex.clone().sub(center);
        points2D.push({
            x: local.dot(u),
            y: local.dot(v)
        });
    }
    
    return { points2D, basis: { u, v } };
}

function earClipTriangulate(points: { x: number, y: number }[]): number[] {
    const n = points.length;
    if (n < 3) return [];
    
    // Create linked list of vertex indices
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
        indices.push(i);
    }
    
    const result: number[] = [];
    
    // Determine winding order
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        signedArea += points[i].x * points[j].y;
        signedArea -= points[j].x * points[i].y;
    }
    const ccw = signedArea > 0;
    
    // Helper: check if point is inside triangle
    const isPointInTriangle = (
        px: number, py: number,
        ax: number, ay: number,
        bx: number, by: number,
        cx: number, cy: number
    ): boolean => {
        const sign = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) => {
            return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
        };
        
        const d1 = sign(px, py, ax, ay, bx, by);
        const d2 = sign(px, py, bx, by, cx, cy);
        const d3 = sign(px, py, cx, cy, ax, ay);
        
        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        
        return !(hasNeg && hasPos);
    };
    
    // Helper: check if vertex is convex
    const isConvex = (prevIdx: number, currIdx: number, nextIdx: number): boolean => {
        const prev = points[indices[prevIdx]];
        const curr = points[indices[currIdx]];
        const next = points[indices[nextIdx]];
        
        const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
        return ccw ? cross > 0 : cross < 0;
    };
    
    // Helper: check if ear is valid (no points inside)
    const isEar = (prevIdx: number, currIdx: number, nextIdx: number): boolean => {
        if (!isConvex(prevIdx, currIdx, nextIdx)) return false;
        
        const prev = points[indices[prevIdx]];
        const curr = points[indices[currIdx]];
        const next = points[indices[nextIdx]];
        
        for (let i = 0; i < indices.length; i++) {
            if (i === prevIdx || i === currIdx || i === nextIdx) continue;
            
            const p = points[indices[i]];
            if (isPointInTriangle(p.x, p.y, prev.x, prev.y, curr.x, curr.y, next.x, next.y)) {
                return false;
            }
        }
        
        return true;
    };
    
    // Main ear clipping loop
    let safetyCounter = n * n;
    
    while (indices.length > 3 && safetyCounter > 0) {
        safetyCounter--;
        let earFound = false;
        
        for (let i = 0; i < indices.length; i++) {
            const prevIdx = (i - 1 + indices.length) % indices.length;
            const nextIdx = (i + 1) % indices.length;
            
            if (isEar(prevIdx, i, nextIdx)) {
                // Add triangle (with correct winding for caps - reversed)
                result.push(indices[nextIdx], indices[i], indices[prevIdx]);
                
                // Remove ear vertex
                indices.splice(i, 1);
                earFound = true;
                break;
            }
        }
        
        if (!earFound) {
            // No valid ear found - polygon may be degenerate
            break;
        }
    }
    
    // Add final triangle
    if (indices.length === 3) {
        result.push(indices[2], indices[1], indices[0]);
    }
    
    return result;
}

function fanTriangulate(vertices: THREE.Vector3[], center: THREE.Vector3): number[] {
    const triangles: number[] = [];
    const n = vertices.length;
    
    for (let i = 0; i < n; i++) {
        const v0 = vertices[i];
        const v1 = vertices[(i + 1) % n];
        
        // Create triangle from center to edge (reversed winding for caps)
        triangles.push(
            center.x, center.y, center.z,
            v1.x, v1.y, v1.z,
            v0.x, v0.y, v0.z
        );
    }
    
    return triangles;
}

// ============================================
// Utility: Analyze mesh for holes
// ============================================

export function analyzeMeshHoles(vertices: Float32Array): {
    totalEdges: number;
    boundaryEdges: number;
    estimatedHoles: number;
    hasHoles: boolean;
} {
    const { uniqueVertices, vertexToUnique } = buildVertexMap(vertices);
    const boundaryEdges = findBoundaryEdges(vertices, vertexToUnique);
    
    // Rough estimate: each hole has on average ~10 boundary edges
    const estimatedHoles = Math.ceil(boundaryEdges.length / 10);
    
    return {
        totalEdges: vertices.length / 3, // Approximate
        boundaryEdges: boundaryEdges.length,
        estimatedHoles,
        hasHoles: boundaryEdges.length > 0
    };
}
