/**
 * Clamp Loader Utility
 * 
 * Loads OBJ clamp models and their associated fixture components.
 * Handles async loading of all clamp parts with proper error handling.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ClampModel } from '../types';

export interface LoadedClampData {
  /** Main clamp as a THREE.Group with all meshes and materials */
  clampGroup: THREE.Group;
  /** Merged geometry for CSG operations (without materials) */
  clampGeometry: THREE.BufferGeometry;
  /** Fixture point geometry (disk that touches workpiece) */
  fixturePointGeometry: THREE.BufferGeometry | null;
  /** Fixture mount surface geometry (support height reference) */
  fixtureMountSurfaceGeometry: THREE.BufferGeometry | null;
  /** Fixture cutouts geometry (for CSG operations) */
  fixtureCutoutsGeometry: THREE.BufferGeometry | null;
  /** Top center of fixture point disk (for transform controls) */
  fixturePointTopCenter: THREE.Vector3;
  /** Bounding box of main clamp */
  boundingBox: THREE.Box3;
  /** Minimum placement height offset (from fixture point to lowest cutout point) */
  minPlacementOffset: number;
}

// Keep old interface for backwards compatibility
export interface LoadedClampGeometries extends LoadedClampData {}

export interface ClampLoadResult {
  success: boolean;
  data?: LoadedClampData;
  error?: string;
}

// Singleton loader instances
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

/**
 * Load an OBJ file and extract its geometry (for helper meshes)
 */
async function loadOBJGeometry(path: string): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    objLoader.load(
      path,
      (object) => {
        // Update world matrices before extracting geometries
        object.updateMatrixWorld(true);
        
        // Extract geometries from the loaded object
        const geometries: THREE.BufferGeometry[] = [];
        
        object.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            // Clone and apply world transform to properly position each body
            const geo = child.geometry.clone();
            geo.applyMatrix4(child.matrixWorld);
            geometries.push(geo);
          }
        });
        
        if (geometries.length > 0) {
          // Merge all geometries if there are multiple
          let geometry: THREE.BufferGeometry;
          if (geometries.length === 1) {
            geometry = geometries[0];
          } else {
            const merged = mergeGeometries(geometries);
            if (!merged) {
              reject(new Error(`Failed to merge geometries in OBJ file: ${path}`));
              return;
            }
            geometry = merged;
          }
          
          // Ensure normals are computed
          if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
          }
          resolve(geometry);
        } else {
          reject(new Error(`No geometry found in OBJ file: ${path}`));
        }
      },
      undefined,
      (error) => {
        reject(new Error(`Failed to load OBJ: ${path} - ${error}`));
      }
    );
  });
}

/**
 * Check if a color is gray (similar R, G, B values)
 */
function isGrayColor(color: THREE.Color): boolean {
  const threshold = 0.1; // How close R, G, B need to be
  return (
    Math.abs(color.r - color.g) < threshold &&
    Math.abs(color.g - color.b) < threshold &&
    Math.abs(color.r - color.b) < threshold
  );
}

/**
 * Convert a material to metallic if it appears gray
 */
function makeMetallicIfGray(material: THREE.Material): void {
  if (material instanceof THREE.MeshStandardMaterial || 
      material instanceof THREE.MeshPhysicalMaterial) {
    if (isGrayColor(material.color)) {
      material.metalness = 0.85;
      material.roughness = 0.25;
      // Slightly brighten the color for better metallic appearance
      material.color.multiplyScalar(1.2);
      material.envMapIntensity = 1.0;
    }
  } else if (material instanceof THREE.MeshPhongMaterial ||
             material instanceof THREE.MeshLambertMaterial ||
             material instanceof THREE.MeshBasicMaterial) {
    // Convert Phong/Lambert/Basic materials to Standard with metallic properties
    if (isGrayColor(material.color)) {
      const newMaterial = new THREE.MeshStandardMaterial({
        color: material.color.clone().multiplyScalar(1.2),
        metalness: 0.85,
        roughness: 0.25,
        side: material.side,
        transparent: material.transparent,
        opacity: material.opacity,
      });
      // Copy the new material properties back (we'll replace the material reference later)
      Object.assign(material, { _needsMetallicUpgrade: true, _metallicMaterial: newMaterial });
    }
  }
}

/**
 * Load OBJ with MTL materials - returns the full Group with materials intact
 */
async function loadOBJWithMTLAsGroup(objPath: string, mtlPath: string): Promise<{ group: THREE.Group; geometry: THREE.BufferGeometry }> {
  return new Promise((resolve, reject) => {
    // Extract directory from mtlPath for texture loading
    const mtlDir = mtlPath.substring(0, mtlPath.lastIndexOf('/') + 1);
    mtlLoader.setPath(mtlDir);
    
    const mtlFilename = mtlPath.substring(mtlPath.lastIndexOf('/') + 1);
    
    mtlLoader.load(
      mtlFilename,
      (materials) => {
        materials.preload();
        
        // Create a new OBJLoader instance with materials
        const loaderWithMaterials = new OBJLoader();
        loaderWithMaterials.setMaterials(materials);
        
        loaderWithMaterials.load(
          objPath,
          (object) => {
            // Update world matrices
            object.updateMatrixWorld(true);
            
            // Collect geometries for CSG operations
            const geometries: THREE.BufferGeometry[] = [];
            
            // Process meshes to ensure proper rendering
            object.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                // Enable shadows
                child.castShadow = true;
                child.receiveShadow = true;
                
                // Process materials - make gray parts metallic
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => {
                      mat.side = THREE.DoubleSide;
                      makeMetallicIfGray(mat);
                      // Check if material needs to be replaced with Standard
                      if ((mat as any)._needsMetallicUpgrade && (mat as any)._metallicMaterial) {
                        return (mat as any)._metallicMaterial;
                      }
                      return mat;
                    });
                  } else {
                    child.material.side = THREE.DoubleSide;
                    makeMetallicIfGray(child.material);
                    // Check if material needs to be replaced with Standard
                    if ((child.material as any)._needsMetallicUpgrade && (child.material as any)._metallicMaterial) {
                      child.material = (child.material as any)._metallicMaterial;
                    }
                  }
                }
                
                // Clone geometry for CSG (with world transform applied)
                if (child.geometry) {
                  const geo = child.geometry.clone();
                  geo.applyMatrix4(child.matrixWorld);
                  geometries.push(geo);
                }
              }
            });
            
            // Merge geometries for CSG operations
            let mergedGeometry: THREE.BufferGeometry;
            if (geometries.length === 1) {
              mergedGeometry = geometries[0];
            } else if (geometries.length > 1) {
              const merged = mergeGeometries(geometries);
              if (!merged) {
                reject(new Error(`Failed to merge geometries for CSG in: ${objPath}`));
                return;
              }
              mergedGeometry = merged;
            } else {
              reject(new Error(`No geometry found in OBJ file: ${objPath}`));
              return;
            }
            
            if (!mergedGeometry.attributes.normal) {
              mergedGeometry.computeVertexNormals();
            }
            
            resolve({ group: object, geometry: mergedGeometry });
          },
          undefined,
          (error) => {
            reject(new Error(`Failed to load OBJ: ${objPath} - ${error}`));
          }
        );
      },
      undefined,
      () => {
        // MTL load failed, fall back to OBJ only with default material
        const defaultLoader = new OBJLoader();
        defaultLoader.load(
          objPath,
          (object) => {
            object.updateMatrixWorld(true);
            
            const geometries: THREE.BufferGeometry[] = [];
            
            // Apply default metallic material (gray metallic look)
            const defaultMaterial = new THREE.MeshStandardMaterial({
              color: 0x9a9a9a,
              roughness: 0.25,
              metalness: 0.85,
              side: THREE.DoubleSide,
              envMapIntensity: 1.0,
            });
            
            object.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.material = defaultMaterial;
                child.castShadow = true;
                child.receiveShadow = true;
                
                if (child.geometry) {
                  const geo = child.geometry.clone();
                  geo.applyMatrix4(child.matrixWorld);
                  geometries.push(geo);
                }
              }
            });
            
            let mergedGeometry: THREE.BufferGeometry;
            if (geometries.length === 1) {
              mergedGeometry = geometries[0];
            } else if (geometries.length > 1) {
              const merged = mergeGeometries(geometries);
              if (!merged) {
                reject(new Error(`Failed to merge geometries: ${objPath}`));
                return;
              }
              mergedGeometry = merged;
            } else {
              reject(new Error(`No geometry found: ${objPath}`));
              return;
            }
            
            resolve({ group: object, geometry: mergedGeometry });
          },
          undefined,
          (err) => reject(new Error(`Failed to load OBJ: ${objPath} - ${err}`))
        );
      }
    );
  });
}

/**
 * Calculate the center of a disk geometry
 * The disk represents the contact surface - we need the geometric center for gizmo placement
 * Note: After Y-up to Z-up conversion, the disk lies flat
 */
function calculateDiskCenter(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  
  // Return the true geometric center of the disk bounding box
  return new THREE.Vector3(
    (bbox.min.x + bbox.max.x) / 2,
    (bbox.min.y + bbox.max.y) / 2,
    (bbox.min.z + bbox.max.z) / 2
  );
}

/**
 * Rotation matrix to convert from Y-up to Z-up coordinate system
 * Rotates -90 degrees around the X-axis
 */
const Y_UP_TO_Z_UP_MATRIX = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/**
 * Apply Y-up to Z-up conversion to a geometry
 */
function convertGeometryToZUp(geometry: THREE.BufferGeometry): void {
  geometry.applyMatrix4(Y_UP_TO_Z_UP_MATRIX);
  geometry.computeBoundingBox();
  if (geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
}

/**
 * Apply Y-up to Z-up conversion to a group (rotates the group itself)
 */
function convertGroupToZUp(group: THREE.Group): void {
  group.rotation.x = -Math.PI / 2;
  group.updateMatrixWorld(true);
}

/**
 * Load all components of a clamp model
 */
export async function loadClampModel(clamp: ClampModel): Promise<ClampLoadResult> {
  try {
    // Load main clamp with materials (required)
    let clampGroup: THREE.Group;
    let clampGeometry: THREE.BufferGeometry;
    
    if (clamp.mtlPath) {
      const result = await loadOBJWithMTLAsGroup(clamp.modelPath, clamp.mtlPath);
      clampGroup = result.group;
      clampGeometry = result.geometry;
    } else {
      // Load without materials
      clampGeometry = await loadOBJGeometry(clamp.modelPath);
      // Create a simple group with metallic material
      clampGroup = new THREE.Group();
      const mesh = new THREE.Mesh(
        clampGeometry,
        new THREE.MeshStandardMaterial({
          color: 0x9a9a9a,
          roughness: 0.25,
          metalness: 0.85,
          side: THREE.DoubleSide,
          envMapIntensity: 1.0,
        })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      clampGroup.add(mesh);
    }
    
    // Convert from Y-up to Z-up coordinate system
    convertGroupToZUp(clampGroup);
    convertGeometryToZUp(clampGeometry);
    
    // Calculate bounding box after rotation
    clampGeometry.computeBoundingBox();
    const boundingBox = clampGeometry.boundingBox!.clone();
    
    // Load optional fixture components in parallel
    const [fixturePointGeometry, fixtureMountSurfaceGeometry, fixtureCutoutsGeometry] = 
      await Promise.all([
        clamp.fixturePointPath 
          ? loadOBJGeometry(clamp.fixturePointPath).catch(() => null)
          : Promise.resolve(null),
        clamp.fixtureMountSurfacePath
          ? loadOBJGeometry(clamp.fixtureMountSurfacePath).catch(() => null)
          : Promise.resolve(null),
        clamp.fixtureCutoutsPath
          ? loadOBJGeometry(clamp.fixtureCutoutsPath).catch(() => null)
          : Promise.resolve(null),
      ]);
    
    // Convert helper geometries to Z-up as well
    if (fixturePointGeometry) convertGeometryToZUp(fixturePointGeometry);
    if (fixtureMountSurfaceGeometry) convertGeometryToZUp(fixtureMountSurfaceGeometry);
    if (fixtureCutoutsGeometry) convertGeometryToZUp(fixtureCutoutsGeometry);
    
    // Calculate fixture point center (for transform gizmo placement)
    let fixturePointTopCenter = new THREE.Vector3(0, 0, 0);
    if (fixturePointGeometry) {
      fixturePointTopCenter = calculateDiskCenter(fixturePointGeometry);
    } else {
      // Fall back to center of clamp bounding box bottom (Z is up now)
      fixturePointTopCenter.set(
        (boundingBox.min.x + boundingBox.max.x) / 2,
        (boundingBox.min.y + boundingBox.max.y) / 2,
        boundingBox.min.z
      );
    }
    
    // Calculate minimum placement offset based on fixture cutouts
    // This is the distance from the fixture point to the lowest point of the cutouts
    // When placed at height H, the cutouts extend down to H + minPlacementOffset
    // For the cutouts to not go below the baseplate, H >= baseTopY - minPlacementOffset
    let minPlacementOffset = 0;
    if (fixtureCutoutsGeometry) {
      fixtureCutoutsGeometry.computeBoundingBox();
      const cutoutsBbox = fixtureCutoutsGeometry.boundingBox!;
      // The lowest point of the cutouts in local Z-up space (Y is up after conversion)
      const cutoutsMinY = cutoutsBbox.min.y;
      // The fixture point Y position
      const fixturePointY = fixturePointTopCenter.y;
      // Offset = how far below the fixture point the cutouts extend
      minPlacementOffset = fixturePointY - cutoutsMinY;
    }
    
    return {
      success: true,
      data: {
        clampGroup,
        clampGeometry,
        fixturePointGeometry,
        fixtureMountSurfaceGeometry,
        fixtureCutoutsGeometry,
        fixturePointTopCenter,
        boundingBox,
        minPlacementOffset,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error loading clamp',
    };
  }
}

/**
 * Create materials for clamp visualization
 */
export function createClampMaterials() {
  return {
    // Main clamp material - metallic steel appearance
    clamp: new THREE.MeshStandardMaterial({
      color: 0x9a9a9a,
      roughness: 0.25,
      metalness: 0.85,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    }),
    // Debug material for fixture point - transparent blue
    fixturePoint: new THREE.MeshStandardMaterial({
      color: 0x0088ff,
      transparent: true,
      opacity: 0.5,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
    // Debug material for mount surface - transparent cyan
    fixtureMountSurface: new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.4,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
    // Debug material for cutouts - transparent magenta
    fixtureCutouts: new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      transparent: true,
      opacity: 0.4,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
  };
}
