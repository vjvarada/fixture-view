import { useRef, useCallback, useState } from 'react';
import * as THREE from 'three';

interface DragDropState {
  isDragging: boolean;
  draggedComponent: any | null;
  dragOffset: THREE.Vector3;
  snapPoint: THREE.Vector3 | null;
  isSnapping: boolean;
}

interface UseDragDropReturn {
  dragDropState: DragDropState;
  startDrag: (component: any, startPosition: THREE.Vector3) => void;
  updateDrag: (mousePosition: THREE.Vector2, camera: THREE.Camera, scene: THREE.Scene) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  getSnapPoint: (mousePosition: THREE.Vector2, camera: THREE.Camera, scene: THREE.Scene) => THREE.Vector3 | null;
}

export function useDragDrop(): UseDragDropReturn {
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    isDragging: false,
    draggedComponent: null,
    dragOffset: new THREE.Vector3(),
    snapPoint: null,
    isSnapping: false
  });

  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const startDrag = useCallback((component: any, startPosition: THREE.Vector3) => {
    setDragDropState(prev => ({
      ...prev,
      isDragging: true,
      draggedComponent: component,
      dragOffset: startPosition.clone(),
      snapPoint: null,
      isSnapping: false
    }));
  }, []);

  const updateDrag = useCallback((mousePosition: THREE.Vector2, camera: THREE.Camera, scene: THREE.Scene) => {
    if (!dragDropState.isDragging) return;

    mouseRef.current.copy(mousePosition);
    raycasterRef.current.setFromCamera(mousePosition, camera);

    // Find intersection with baseplate or other surfaces
    const snapPoint = getSnapPoint(mousePosition, camera, scene);

    setDragDropState(prev => ({
      ...prev,
      snapPoint,
      isSnapping: snapPoint !== null
    }));
  }, []);

  const endDrag = useCallback((): THREE.Vector3 | undefined => {
    if (!dragDropState.isDragging) return undefined;

    // Place component at snap point or current position
    const finalPosition = dragDropState.snapPoint || dragDropState.dragOffset;

    setDragDropState(prev => ({
      ...prev,
      isDragging: false,
      draggedComponent: null,
      snapPoint: null,
      isSnapping: false
    }));

    return finalPosition;
  }, []);

  const cancelDrag = useCallback(() => {
    setDragDropState(prev => ({
      ...prev,
      isDragging: false,
      draggedComponent: null,
      snapPoint: null,
      isSnapping: false
    }));
  }, []);

  const getSnapPoint = useCallback((mousePosition: THREE.Vector2, camera: THREE.Camera, scene: THREE.Scene): THREE.Vector3 | null => {
    raycasterRef.current.setFromCamera(mousePosition, camera);

    // Define planes and surfaces to snap to
    const snapPlanes: THREE.Plane[] = [];

    // Add baseplate plane (Y = 0)
    const basePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    snapPlanes.push(basePlane);

    // Add vertical planes for side snapping
    const verticalPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),  // YZ plane
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),  // XY plane
    ];
    snapPlanes.push(...verticalPlanes);

    // Check intersections with all snap planes
    for (const plane of snapPlanes) {
      const intersectionPoint = new THREE.Vector3();
      if (raycasterRef.current.ray.intersectPlane(plane, intersectionPoint)) {
        return intersectionPoint;
      }
    }

    return null;
  }, []);

  return {
    dragDropState,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    getSnapPoint
  };
}

// Helper function to create visual feedback during drag
export function createDragPreview(component: any): THREE.Group {
  const group = new THREE.Group();

  // Create a semi-transparent version of the component for preview
  if (component.geometry && component.material) {
    const previewGeometry = component.geometry.clone();
    const previewMaterial = component.material.clone();

    // Make material semi-transparent
    if (previewMaterial instanceof THREE.MeshStandardMaterial) {
      previewMaterial.transparent = true;
      previewMaterial.opacity = 0.5;
      previewMaterial.color.setHex(0x3b82f6); // Blue color for preview
    }

    const previewMesh = new THREE.Mesh(previewGeometry, previewMaterial);
    group.add(previewMesh);
  }

  // Add wireframe outline
  if (component.geometry) {
    const wireframeGeometry = component.geometry.clone();
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x1e40af,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    const wireframeMesh = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
    wireframeMesh.scale.multiplyScalar(1.02); // Slightly larger for outline effect
    group.add(wireframeMesh);
  }

  return group;
}

// Helper function to dispose drag preview resources
export function disposeDragPreview(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
  group.clear();
}

// Helper function to check if a point is valid for placement
export function isValidPlacement(point: THREE.Vector3, existingComponents: any[]): boolean {
  // Check if point is within reasonable bounds
  const maxDistance = 100;
  if (point.length() > maxDistance) {
    return false;
  }

  // Check for collisions with existing components
  for (const component of existingComponents) {
    if (component.mesh) {
      const distance = point.distanceTo(component.mesh.position);
      const minDistance = 5; // Minimum distance between components

      if (distance < minDistance) {
        return false;
      }
    }
  }

  return true;
}

// Helper function to snap to grid
export function snapToGrid(point: THREE.Vector3, gridSize: number = 5): THREE.Vector3 {
  return new THREE.Vector3(
    Math.round(point.x / gridSize) * gridSize,
    point.y,
    Math.round(point.z / gridSize) * gridSize
  );
}
