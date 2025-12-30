/**
 * useDisposableGeometry Hook
 * 
 * React hook that creates THREE.js geometries and automatically disposes them
 * when the component unmounts or when dependencies change.
 * 
 * This prevents memory leaks from accumulated geometries that are not properly
 * cleaned up during the React lifecycle.
 */

import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Creates a geometry using a factory function and automatically disposes it
 * when the component unmounts or when dependencies change.
 * 
 * @param factory Function that creates the geometry
 * @param deps Dependency array (like useMemo)
 * @returns The created geometry
 * 
 * @example
 * const geometry = useDisposableGeometry(
 *   () => new THREE.CylinderGeometry(radius, radius, height, 64),
 *   [radius, height]
 * );
 */
export function useDisposableGeometry<T extends THREE.BufferGeometry>(
  factory: () => T,
  deps: React.DependencyList
): T {
  const geometryRef = useRef<T | null>(null);
  
  const geometry = useMemo(() => {
    // Dispose previous geometry if it exists
    if (geometryRef.current) {
      geometryRef.current.dispose();
    }
    
    // Create new geometry
    const newGeometry = factory();
    geometryRef.current = newGeometry;
    return newGeometry;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }
    };
  }, []);
  
  return geometry;
}

/**
 * Creates multiple geometries and automatically disposes all of them
 * when the component unmounts or when dependencies change.
 * 
 * @param factory Function that creates an array of geometries
 * @param deps Dependency array
 * @returns Array of created geometries
 */
export function useDisposableGeometries<T extends THREE.BufferGeometry>(
  factory: () => T[],
  deps: React.DependencyList
): T[] {
  const geometriesRef = useRef<T[]>([]);
  
  const geometries = useMemo(() => {
    // Dispose previous geometries
    geometriesRef.current.forEach(geo => geo.dispose());
    
    // Create new geometries
    const newGeometries = factory();
    geometriesRef.current = newGeometries;
    return newGeometries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometriesRef.current.forEach(geo => geo.dispose());
      geometriesRef.current = [];
    };
  }, []);
  
  return geometries;
}

/**
 * Creates a material and automatically disposes it when the component
 * unmounts or when dependencies change.
 * 
 * @param factory Function that creates the material
 * @param deps Dependency array
 * @returns The created material
 */
export function useDisposableMaterial<T extends THREE.Material>(
  factory: () => T,
  deps: React.DependencyList
): T {
  const materialRef = useRef<T | null>(null);
  
  const material = useMemo(() => {
    // Dispose previous material if it exists
    if (materialRef.current) {
      materialRef.current.dispose();
    }
    
    // Create new material
    const newMaterial = factory();
    materialRef.current = newMaterial;
    return newMaterial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);
  
  return material;
}

/**
 * Disposes a THREE.Object3D and all its children, including geometries and materials.
 * Useful for cleaning up loaded models.
 * 
 * @param object The object to dispose
 */
export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
}

/**
 * Hook that manages a THREE.Object3D and disposes it properly on cleanup.
 * Useful for loaded models (OBJ, GLTF, etc.)
 * 
 * @param object The object to manage (can be null during loading)
 */
export function useDisposableObject3D(object: THREE.Object3D | null): void {
  const objectRef = useRef<THREE.Object3D | null>(null);
  
  useEffect(() => {
    // Store reference to current object
    objectRef.current = object;
    
    return () => {
      // Dispose on unmount or when object changes
      if (objectRef.current) {
        disposeObject3D(objectRef.current);
        objectRef.current = null;
      }
    };
  }, [object]);
}

export default useDisposableGeometry;
