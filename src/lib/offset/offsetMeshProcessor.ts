// ============================================
// Offset Mesh Processor - Main API
// High-level API for creating offset meshes from STL geometry
// ============================================

import * as THREE from 'three';
import { createOffsetHeightMap, loadHeightMapFromTiles, cleanupOffscreenResources } from './offsetHeightmap.js';
import { createWatertightMeshFromHeightmap, calculateOptimalMeshSettings } from './meshGenerator.js';
import { fillMeshHoles, analyzeMeshHoles } from './meshHoleFiller.js';
import { mergeCoplanarTriangles } from './meshOptimizer.js';
import type { OffsetMeshOptions, OffsetMeshResult, HeightmapResult } from './types';

// ============================================
// Main Processing Pipeline
// ============================================

/**
 * Process STL geometry and create offset mesh
 * @param {Float32Array} vertices - Triangle soup vertices (xyz per vertex)
 * @param {Object} options - Processing options
 * @param {number} options.offsetDistance - Offset distance in world units
 * @param {number} options.pixelsPerUnit - Resolution (pixels per unit)
 * @param {number} [options.tileSize=2048] - Tile size for large heightmaps
 * @param {number} [options.rotationXZ=0] - Rotation around Y axis in degrees (XZ plane)
 * @param {number} [options.rotationYZ=0] - Rotation around X axis in degrees (YZ plane, inverted: 180-input)
 * @param {boolean} [options.fillHoles=true] - Fill holes in input mesh before heightmap generation
 * @param {Function} [options.progressCallback] - Progress callback (current, total, stage)
 * @returns {Promise<Object>} Result with geometry and metadata
 */
export async function createOffsetMesh(vertices: Float32Array, options: any): Promise<OffsetMeshResult> {
    const {
        offsetDistance,
        pixelsPerUnit,
        tileSize = 2048,
        rotationXZ = 0,
        rotationYZ = 0,
        fillHoles = true,
        progressCallback = null
    } = options;
    
    // Validate inputs
    if (!vertices || vertices.length === 0) {
        throw new Error('No vertices provided');
    }
    if (offsetDistance <= 0) {
        throw new Error('Offset distance must be positive');
    }
    if (pixelsPerUnit <= 0) {
        throw new Error('Pixels per unit must be positive');
    }
    
    const result: OffsetMeshResult = {
        heightmapResult: null,
        geometry: null,
        metadata: {
            offsetDistance,
            pixelsPerUnit,
            resolution: 0,
            vertexCount: 0,
            triangleCount: 0,
            processingTime: 0,
            originalTriangleCount: 0,
            geometryCreationTime: 0,
            holesFilled: 0,
            holesCapTriangles: 0
        }
    };
    
    const startTime = performance.now();
    
    // Pre-calculate rotation parameters
    // Baseline: 180° around X-axis is needed for correct coordinate system alignment
    // User rotationXZ/rotationYZ are deltas from this baseline (-90 to +90)
    const baselineYZ = 180;
    const actualYZ = baselineYZ + rotationYZ;
    // Only apply rotation if there's any rotation to apply (baseline or user-specified)
    const needsRotation = rotationXZ !== 0 || actualYZ !== 0;
    
    try {
        // Step 0: Apply rotation if needed
        let workingVertices = vertices;
        
        if (needsRotation) {
            if (progressCallback) progressCallback(0, 100, 'Applying rotation');
            
            // Create rotation matrix
            const rotationMatrix = createRotationMatrix(rotationXZ, actualYZ);
            
            // Rotate vertices
            workingVertices = applyMatrixToVertices(vertices, rotationMatrix);
            
            console.log(`Applied rotation: XZ=${rotationXZ}°, YZ=${rotationYZ}° (actual YZ=${actualYZ}°)`);
        }
        
        // Step 0.5: Fill holes in input mesh to prevent gaps in heightmap
        if (fillHoles) {
            if (progressCallback) progressCallback(2, 100, 'Analyzing mesh for holes');
            
            const holeAnalysis = analyzeMeshHoles(workingVertices);
            
            if (holeAnalysis.hasHoles) {
                console.log(`Mesh has ${holeAnalysis.boundaryEdges} boundary edges (~${holeAnalysis.estimatedHoles} holes)`);
                
                if (progressCallback) progressCallback(3, 100, 'Filling mesh holes');
                
                const originalVertexCount = workingVertices.length;
                workingVertices = fillMeshHoles(workingVertices);
                
                const addedVertices = workingVertices.length - originalVertexCount;
                const addedTriangles = addedVertices / 9;
                
                result.metadata.holesFilled = holeAnalysis.estimatedHoles;
                result.metadata.holesCapTriangles = addedTriangles;
                
                console.log(`Added ${addedTriangles} cap triangles to close holes`);
            } else {
                console.log('No holes detected in input mesh');
            }
        }
        
        // Step 1: Calculate resolution
        if (progressCallback) progressCallback(5, 100, 'Calculating resolution');
        
        // Yield to browser to keep UI responsive
        await new Promise(resolve => setTimeout(resolve, 0));
        
        const box = new THREE.Box3();
        box.setFromArray(workingVertices);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        
        const effectiveDim = maxDim + (offsetDistance * 10);
        const resolution = Math.ceil(effectiveDim * pixelsPerUnit);
        const clampedResolution = Math.max(64, Math.min(16384, resolution));
        
        result.metadata.resolution = clampedResolution;
        
        console.log(`Resolution: ${maxDim.toFixed(1)} units × ${pixelsPerUnit} px/unit = ${clampedResolution}×${clampedResolution}`);
        
        // Step 2: Generate heightmap
        if (progressCallback) progressCallback(10, 100, 'Generating heightmap');
        
        // Yield to browser before GPU work
        await new Promise(resolve => setTimeout(resolve, 0));
        
        const heightmapProgressCallback = clampedResolution > tileSize ? (current, total) => {
            const percent = 10 + (current / total) * 40;
            if (progressCallback) progressCallback(percent, 100, `Rendering tile ${current}/${total}`);
        } : null;
        
        const heightmapResult = await createOffsetHeightMap(
            workingVertices, 
            offsetDistance, 
            clampedResolution, 
            tileSize, 
            heightmapProgressCallback
        );
        
        result.heightmapResult = heightmapResult as HeightmapResult;
        
        // Step 3: Load heightmap data
        if (progressCallback) progressCallback(50, 100, 'Loading heightmap data');
        
        // Yield to browser after GPU work
        await new Promise(resolve => setTimeout(resolve, 0));
        
        let heightMap;
        if ('usesIndexedDB' in heightmapResult && heightmapResult.usesIndexedDB) {
            const loadProgressCallback = (current, total) => {
                const percent = 50 + (current / total) * 20;
                if (progressCallback) progressCallback(percent, 100, `Loading tile ${current}/${total}`);
            };
            heightMap = await loadHeightMapFromTiles(heightmapResult, loadProgressCallback);
        } else {
            heightMap = heightmapResult.heightMap;
        }
        
        // Step 4: Calculate mesh settings
        if (progressCallback) progressCallback(70, 100, 'Calculating mesh settings');
        
        const meshSettings = {
            downsampleFactor: 1,
            effectiveResolution: clampedResolution
        };
        
        console.log(`Mesh resolution: ${meshSettings.effectiveResolution}×${meshSettings.effectiveResolution}`);
        
        // Step 5: Create watertight mesh
        if (progressCallback) progressCallback(75, 100, 'Creating watertight mesh');
        
        // Yield to browser before mesh generation
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // For Y-up coordinate system, clip values are based on Y (height) bounds
        const originalBox = box;
        const clipYMin = originalBox.min.y - offsetDistance;  // Bottom of mesh (ground level)
        const clipYMax = originalBox.max.y + offsetDistance;  // Top of mesh
        
        let geometry = createWatertightMeshFromHeightmap(
            heightMap,
            clampedResolution,
            heightmapResult.scale,
            heightmapResult.center,
            clipYMin,  // Was clipZMin - now represents Y min
            clipYMax,  // Was clipZMax - now represents Y max
            meshSettings
        );
        
        // Yield to browser after mesh generation
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Optimize by merging coplanar triangles (reduces triangle count for flat surfaces)
        if (progressCallback) progressCallback(88, 100, 'Optimizing mesh');
        geometry = mergeCoplanarTriangles(geometry);
        
        // Yield to browser after optimization
        await new Promise(resolve => setTimeout(resolve, 0));
        
        result.geometry = geometry;
        result.metadata.originalTriangleCount = geometry.index.count / 3;
        
        // Apply inverse rotation to restore original orientation
        if (needsRotation) {
            if (progressCallback) progressCallback(92, 100, 'Restoring orientation');
            
            const inverseMatrix = createInverseRotationMatrix(rotationXZ, actualYZ);
            result.geometry.applyMatrix4(inverseMatrix);
            result.geometry.computeVertexNormals();
            
            console.log('Restored original orientation');
        }
        
        result.metadata.vertexCount = result.geometry.getAttribute('position').count;
        result.metadata.triangleCount = result.geometry.index.count / 3;
        
        const endTime = performance.now();
        result.metadata.processingTime = endTime - startTime;
        result.metadata.geometryCreationTime = result.metadata.processingTime;
        
        if (progressCallback) progressCallback(100, 100, 'Complete');
        
        console.log(`Processing complete: ${result.metadata.triangleCount.toLocaleString()} triangles in ${result.metadata.processingTime.toFixed(0)}ms`);
        
        return result;
        
    } catch (error) {
        console.error('Error in createOffsetMesh:', error);
        throw error;
    }
}

/**
 * Cleanup resources (call when done)
 */
export function cleanup() {
    cleanupOffscreenResources();
}

// ============================================
// Utility Functions
// ============================================

/**
 * Extract vertices from Three.js BufferGeometry
 * @param {THREE.BufferGeometry} geometry
 * @returns {Float32Array} Triangle soup vertices
 */
export function extractVertices(geometry) {
    return geometry.attributes.position.array;
}

/**
 * Calculate adaptive resolution based on model size
 * @param {THREE.Box3} boundingBox - Model bounding box
 * @param {number} pixelsPerUnit - Pixels per unit
 * @param {number} offsetDistance - Offset distance
 * @returns {number} Calculated resolution (clamped 64-16384)
 */
export function calculateResolution(boundingBox, pixelsPerUnit, offsetDistance) {
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const effectiveDim = maxDim + (offsetDistance * 10);
    const resolution = Math.ceil(effectiveDim * pixelsPerUnit);
    return Math.max(64, Math.min(16384, resolution));
}

// ============================================
// Rotation Helper Functions
// ============================================

/**
 * Create a rotation matrix for tilt adjustments
 * @param {number} xzAngleDeg - Rotation around Z axis (degrees) - tilts left/right
 * @param {number} actualYZ - Actual rotation around X axis (degrees) - tilts front/back
 * @returns {THREE.Matrix4} Rotation matrix
 */
function createRotationMatrix(xzAngleDeg, actualYZ) {
    const matrix = new THREE.Matrix4();
    
    // Early return if no rotation needed
    if (xzAngleDeg === 0 && actualYZ === 0) {
        return matrix; // Identity matrix
    }
    
    // Rotation order: Z axis first (left/right tilt), then X axis (front/back tilt)
    if (xzAngleDeg !== 0) {
        const rotZ = new THREE.Matrix4();
        rotZ.makeRotationZ(xzAngleDeg * Math.PI / 180);
        matrix.multiply(rotZ);
    }
    
    if (actualYZ !== 0) {
        const rotX = new THREE.Matrix4();
        rotX.makeRotationX(actualYZ * Math.PI / 180);
        matrix.multiply(rotX);
    }
    
    return matrix;
}

/**
 * Create an inverse rotation matrix
 * @param {number} xzAngleDeg - Rotation around Z axis (degrees) - tilts left/right
 * @param {number} actualYZ - Actual rotation around X axis (degrees) - tilts front/back
 * @returns {THREE.Matrix4} Inverse rotation matrix
 */
function createInverseRotationMatrix(xzAngleDeg, actualYZ) {
    const matrix = new THREE.Matrix4();
    
    // Early return if no rotation needed
    if (xzAngleDeg === 0 && actualYZ === 0) {
        return matrix; // Identity matrix
    }
    
    // Inverse rotation: apply in reverse order with negative angles
    if (actualYZ !== 0) {
        const rotX = new THREE.Matrix4();
        rotX.makeRotationX(-actualYZ * Math.PI / 180);
        matrix.multiply(rotX);
    }
    
    if (xzAngleDeg !== 0) {
        const rotZ = new THREE.Matrix4();
        rotZ.makeRotationZ(-xzAngleDeg * Math.PI / 180);
        matrix.multiply(rotZ);
    }
    
    return matrix;
}

/**
 * Apply a transformation matrix to vertices
 * @param {Float32Array} vertices - Input vertices
 * @param {THREE.Matrix4} matrix - Transformation matrix
 * @returns {Float32Array} Transformed vertices
 */
function applyMatrixToVertices(vertices, matrix) {
    const result = new Float32Array(vertices.length);
    const vec = new THREE.Vector3();
    const elements = matrix.elements;
    
    // Extract matrix elements for faster access
    const m11 = elements[0], m12 = elements[4], m13 = elements[8], m14 = elements[12];
    const m21 = elements[1], m22 = elements[5], m23 = elements[9], m24 = elements[13];
    const m31 = elements[2], m32 = elements[6], m33 = elements[10], m34 = elements[14];
    const m41 = elements[3], m42 = elements[7], m43 = elements[11], m44 = elements[15];
    
    for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i];
        const y = vertices[i + 1];
        const z = vertices[i + 2];
        
        // Manual matrix multiplication for better performance
        const w = m41 * x + m42 * y + m43 * z + m44 || 1;
        
        result[i] = (m11 * x + m12 * y + m13 * z + m14) / w;
        result[i + 1] = (m21 * x + m22 * y + m23 * z + m24) / w;
        result[i + 2] = (m31 * x + m32 * y + m33 * z + m34) / w;
    }
    
    return result;
}
