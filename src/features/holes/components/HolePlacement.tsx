/**
 * HolePlacement Component
 *
 * Handles the interactive placement of mounting holes on the baseplate.
 * Uses raycasting to determine placement position on XZ plane.
 * Supports snapping to horizontal/vertical alignment with existing holes.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { PlacedHole, HoleConfig } from '../types';
import HoleMesh from './HoleMesh';

// =============================================================================
// Types
// =============================================================================

interface HolePlacementProps {
  /** Whether placement mode is active */
  active: boolean;
  /** The hole configuration to place */
  holeConfig: HoleConfig | null;
  /** Depth of the hole (baseplate height for through holes) */
  depth: number;
  /** Y position of baseplate top */
  baseTopY: number;
  /** Callback when hole is placed */
  onPlace: (hole: PlacedHole) => void;
  /** Callback to cancel placement */
  onCancel: () => void;
  /** Optional raycast target (baseplate mesh) */
  baseTarget?: THREE.Object3D | null;
  /** Existing holes for snap alignment */
  existingHoles?: PlacedHole[];
  /** Snap threshold distance in mm */
  snapThreshold?: number;
}

/** Alignment information for snapping */
interface SnapAlignment {
  /** Horizontal alignment (same Z) - the hole we're aligning to */
  horizontal: PlacedHole | null;
  /** Vertical alignment (same X) - the hole we're aligning to */
  vertical: PlacedHole | null;
  /** The snapped position */
  snappedPosition: THREE.Vector2;
}

// =============================================================================
// Constants
// =============================================================================

/** Default snap threshold in mm */
const DEFAULT_SNAP_THRESHOLD = 3;

/** Alignment guide line extension beyond the holes */
const GUIDE_LINE_EXTENSION = 50;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generates a unique hole ID using timestamp and random string.
 */
function generateHoleId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `hole-${timestamp}-${random}`;
}

/**
 * Converts mouse event to normalized device coordinates (NDC).
 */
function getNormalizedMouseCoords(
  event: PointerEvent,
  canvas: HTMLCanvasElement
): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
}

/**
 * Checks if an event target is a UI element that should block placement.
 */
function isUIElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('.ui-panel') !== null;
}

/**
 * Finds the closest hole for horizontal alignment (same Z coordinate).
 * Returns the hole with the smallest Z difference within threshold.
 */
function findHorizontalAlignment(
  position: THREE.Vector2,
  existingHoles: PlacedHole[],
  threshold: number
): PlacedHole | null {
  let closestHole: PlacedHole | null = null;
  let minDistance = threshold;

  for (const hole of existingHoles) {
    const zDiff = Math.abs(position.y - hole.position.y); // position.y is Z in world coords
    if (zDiff < minDistance) {
      minDistance = zDiff;
      closestHole = hole;
    }
  }

  return closestHole;
}

/**
 * Finds the closest hole for vertical alignment (same X coordinate).
 * Returns the hole with the smallest X difference within threshold.
 */
function findVerticalAlignment(
  position: THREE.Vector2,
  existingHoles: PlacedHole[],
  threshold: number
): PlacedHole | null {
  let closestHole: PlacedHole | null = null;
  let minDistance = threshold;

  for (const hole of existingHoles) {
    const xDiff = Math.abs(position.x - hole.position.x);
    if (xDiff < minDistance) {
      minDistance = xDiff;
      closestHole = hole;
    }
  }

  return closestHole;
}

/**
 * Computes snap alignment for a given position.
 * Prevents snapping to the exact center of existing holes.
 */
function computeSnapAlignment(
  rawPosition: THREE.Vector2,
  existingHoles: PlacedHole[],
  threshold: number
): SnapAlignment {
  const horizontalHole = findHorizontalAlignment(rawPosition, existingHoles, threshold);
  const verticalHole = findVerticalAlignment(rawPosition, existingHoles, threshold);

  const snappedPosition = rawPosition.clone();

  // Check if both alignments would snap to the same hole's center
  // If so, only apply the alignment that's closer to the raw position
  if (horizontalHole && verticalHole && horizontalHole.id === verticalHole.id) {
    // Both snaps point to the same hole - would result in snapping to center
    // Choose only the closer alignment to prevent center snapping
    const xDiff = Math.abs(rawPosition.x - horizontalHole.position.x);
    const zDiff = Math.abs(rawPosition.y - horizontalHole.position.y);
    
    if (xDiff < zDiff) {
      // Vertical alignment is closer, apply only that
      snappedPosition.x = verticalHole.position.x;
      return {
        horizontal: null,
        vertical: verticalHole,
        snappedPosition,
      };
    } else {
      // Horizontal alignment is closer, apply only that
      snappedPosition.y = horizontalHole.position.y;
      return {
        horizontal: horizontalHole,
        vertical: null,
        snappedPosition,
      };
    }
  }

  // Check if the snapped position would land on the center of any existing hole
  let finalHorizontal = horizontalHole;
  let finalVertical = verticalHole;

  // Apply horizontal snap (align Z coordinate)
  if (horizontalHole) {
    snappedPosition.y = horizontalHole.position.y;
  }

  // Apply vertical snap (align X coordinate)
  if (verticalHole) {
    snappedPosition.x = verticalHole.position.x;
  }

  // Check if the resulting snapped position is at the center of any hole
  for (const hole of existingHoles) {
    const atCenter = 
      Math.abs(snappedPosition.x - hole.position.x) < 0.01 &&
      Math.abs(snappedPosition.y - hole.position.y) < 0.01;
    
    if (atCenter) {
      // Would snap to center - remove the alignment that's further from raw position
      const xDiff = Math.abs(rawPosition.x - hole.position.x);
      const zDiff = Math.abs(rawPosition.y - hole.position.y);
      
      if (xDiff < zDiff) {
        // Keep vertical, remove horizontal
        finalHorizontal = null;
        snappedPosition.y = rawPosition.y;
      } else {
        // Keep horizontal, remove vertical
        finalVertical = null;
        snappedPosition.x = rawPosition.x;
      }
      break;
    }
  }

  return {
    horizontal: finalHorizontal,
    vertical: finalVertical,
    snappedPosition,
  };
}

// =============================================================================
// Custom Hook - Raycasting with Snap Support
// =============================================================================

/**
 * Hook that handles raycasting for hole placement with snap alignment.
 * Returns the current preview position and alignment info based on mouse location.
 */
function useHoleRaycasting(
  active: boolean,
  baseTopY: number,
  baseTarget: THREE.Object3D | null | undefined,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  existingHoles: PlacedHole[],
  snapThreshold: number
): [THREE.Vector2 | null, SnapAlignment | null, (event: PointerEvent) => void] {
  const [previewPosition, setPreviewPosition] = useState<THREE.Vector2 | null>(null);
  const [snapAlignment, setSnapAlignment] = useState<SnapAlignment | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -baseTopY));
  const hitPointRef = useRef(new THREE.Vector3());

  // Update plane when baseTopY changes
  useEffect(() => {
    planeRef.current.constant = -baseTopY;
  }, [baseTopY]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!active) return;

    const mouse = getNormalizedMouseCoords(event, canvas);
    raycasterRef.current.setFromCamera(mouse, camera);

    let rawPosition: THREE.Vector2 | null = null;

    // Try to hit baseplate first for accurate placement
    if (baseTarget) {
      const intersects = raycasterRef.current.intersectObject(baseTarget, true);
      if (intersects.length > 0) {
        const { point } = intersects[0];
        rawPosition = new THREE.Vector2(point.x, point.z);
      }
    }

    // Fallback to plane intersection when not hitting baseplate
    if (!rawPosition && raycasterRef.current.ray.intersectPlane(planeRef.current, hitPointRef.current)) {
      rawPosition = new THREE.Vector2(hitPointRef.current.x, hitPointRef.current.z);
    }

    if (rawPosition) {
      // Compute snap alignment
      const alignment = computeSnapAlignment(rawPosition, existingHoles, snapThreshold);
      setSnapAlignment(alignment);
      setPreviewPosition(alignment.snappedPosition);
    }
  }, [active, camera, canvas, baseTarget, existingHoles, snapThreshold]);

  // Clear preview when deactivated
  useEffect(() => {
    if (!active) {
      setPreviewPosition(null);
      setSnapAlignment(null);
    }
  }, [active]);

  return [previewPosition, snapAlignment, handlePointerMove];
}

// =============================================================================
// Alignment Guide Component
// =============================================================================

interface AlignmentGuideProps {
  /** Current hole position being placed */
  currentPosition: THREE.Vector2;
  /** The hole we're aligning to */
  alignedHole: PlacedHole;
  /** Whether this is horizontal (Z) or vertical (X) alignment */
  direction: 'horizontal' | 'vertical';
  /** Y position for the guide line */
  baseTopY: number;
}

/**
 * Renders a dotted alignment guide line between the hole being placed
 * and the hole it's snapping to.
 */
const AlignmentGuide: React.FC<AlignmentGuideProps> = ({
  currentPosition,
  alignedHole,
  direction,
  baseTopY,
}) => {
  const lineY = baseTopY + 0.15; // Slightly above the surface

  const positions = useMemo(() => {
    const currentX = currentPosition.x;
    const currentZ = currentPosition.y; // Vector2.y = Z in world coords
    const alignedX = alignedHole.position.x;
    const alignedZ = alignedHole.position.y;

    if (direction === 'horizontal') {
      // Horizontal alignment: same Z, draw line along X axis
      const minX = Math.min(currentX, alignedX) - GUIDE_LINE_EXTENSION;
      const maxX = Math.max(currentX, alignedX) + GUIDE_LINE_EXTENSION;
      return new Float32Array([
        minX, lineY, currentZ,
        maxX, lineY, currentZ,
      ]);
    } else {
      // Vertical alignment: same X, draw line along Z axis
      const minZ = Math.min(currentZ, alignedZ) - GUIDE_LINE_EXTENSION;
      const maxZ = Math.max(currentZ, alignedZ) + GUIDE_LINE_EXTENSION;
      return new Float32Array([
        currentX, lineY, minZ,
        currentX, lineY, maxZ,
      ]);
    }
  }, [currentPosition, alignedHole, direction, lineY]);

  // Create dashed segments manually for proper dotted line effect
  const dashedPositions = useMemo(() => {
    const dashSize = 2;
    const gapSize = 1.5;
    const segments: number[] = [];
    
    const startX = positions[0];
    const startY = positions[1];
    const startZ = positions[2];
    const endX = positions[3];
    const endY = positions[4];
    const endZ = positions[5];
    
    const dx = endX - startX;
    const dy = endY - startY;
    const dz = endZ - startZ;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dirX = dx / length;
    const dirY = dy / length;
    const dirZ = dz / length;
    
    let dist = 0;
    let drawing = true;
    
    while (dist < length) {
      const segLen = drawing ? dashSize : gapSize;
      const endDist = Math.min(dist + segLen, length);
      
      if (drawing) {
        segments.push(
          startX + dirX * dist,
          startY + dirY * dist,
          startZ + dirZ * dist,
          startX + dirX * endDist,
          startY + dirY * endDist,
          startZ + dirZ * endDist
        );
      }
      
      dist = endDist;
      drawing = !drawing;
    }
    
    return new Float32Array(segments);
  }, [positions]);

  const color = 0x00aaff; // Blue for both horizontal and vertical alignment

  return (
    <lineSegments renderOrder={1000}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={dashedPositions.length / 3}
          array={dashedPositions}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
};

// =============================================================================
// XY Guide Lines Component
// =============================================================================

interface XYGuidesProps {
  /** Current position for the guide lines */
  point: THREE.Vector2;
  /** Y position for the guide lines */
  baseTopY: number;
  /** Hide horizontal grey line when blue snap alignment replaces it */
  hideHorizontal?: boolean;
  /** Hide vertical grey line when blue snap alignment replaces it */
  hideVertical?: boolean;
}

/**
 * Renders grey guide lines through the current position (horizontal and vertical axes).
 * Lines are hidden when snap alignment guides replace them.
 */
const XYGuides: React.FC<XYGuidesProps> = ({ 
  point, 
  baseTopY, 
  hideHorizontal = false, 
  hideVertical = false 
}) => {
  const y = baseTopY + 0.03;
  const len = 2000; // extend across scene
  const px = point.x;
  const pz = point.y;
  
  // Build positions array based on which lines to show
  const linePositions: number[] = [];
  if (!hideHorizontal) {
    // Horizontal X line through Z = pz
    linePositions.push(-len, y, pz, len, y, pz);
  }
  if (!hideVertical) {
    // Vertical Z line through X = px
    linePositions.push(px, y, -len, px, y, len);
  }
  const positions = new Float32Array(linePositions);

  if (positions.length === 0) {
    return null;
  }

  // Use key to force geometry recreation when position changes
  const geometryKey = `${px}-${pz}-${hideHorizontal}-${hideVertical}`;

  return (
    <lineSegments frustumCulled={false} renderOrder={999} key={geometryKey}>
      <bufferGeometry>
        <bufferAttribute 
          attach="attributes-position" 
          count={positions.length / 3} 
          array={positions} 
          itemSize={3} 
        />
      </bufferGeometry>
      <lineBasicMaterial color={0x9CA3AF} depthWrite={false} depthTest={false} />
    </lineSegments>
  );
};

// =============================================================================
// Main Component
// =============================================================================

const HolePlacement: React.FC<HolePlacementProps> = ({
  active,
  holeConfig,
  depth,
  baseTopY,
  onPlace,
  onCancel,
  baseTarget,
  existingHoles = [],
  snapThreshold = DEFAULT_SNAP_THRESHOLD,
}) => {
  const { gl, camera } = useThree();

  // Use custom raycasting hook with snap support
  const [previewPosition, snapAlignment, handlePointerMove] = useHoleRaycasting(
    active && holeConfig !== null,
    baseTopY,
    baseTarget,
    camera,
    gl.domElement,
    existingHoles,
    snapThreshold
  );

  // Handle click to place hole
  const handleClick = useCallback((event: MouseEvent) => {
    if (!active || !holeConfig || !previewPosition) return;
    if (isUIElement(event.target)) return;

    const placedHole: PlacedHole = {
      ...holeConfig,
      id: generateHoleId(),
      position: previewPosition.clone(),
      depth,
    };

    onPlace(placedHole);
  }, [active, holeConfig, previewPosition, depth, onPlace]);

  // Handle escape key to cancel placement
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && active) {
      onCancel();
    }
  }, [active, onCancel]);

  // Set up event listeners
  useEffect(() => {
    if (!active) return undefined;

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    canvas.style.cursor = 'crosshair';

    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.style.cursor = 'auto';
    };
  }, [active, gl, handlePointerMove, handleClick, handleKeyDown]);

  // Don't render if not active, no config, or no preview position
  if (!active || !holeConfig || !previewPosition) {
    return null;
  }

  // Create preview hole for rendering
  const previewHole: PlacedHole = {
    ...holeConfig,
    id: 'preview',
    position: previewPosition,
    depth,
  };

  return (
    <group>
      {/* XY Guide lines - grey lines through cursor, hidden when snap alignment replaces them */}
      <XYGuides 
        point={previewPosition} 
        baseTopY={baseTopY}
        hideHorizontal={!!snapAlignment?.horizontal}
        hideVertical={!!snapAlignment?.vertical}
      />

      {/* Preview hole mesh */}
      <HoleMesh
        hole={previewHole}
        baseTopY={baseTopY}
        isPreview
      />

      {/* Horizontal alignment guide (same Z) */}
      {snapAlignment?.horizontal && (
        <AlignmentGuide
          currentPosition={previewPosition}
          alignedHole={snapAlignment.horizontal}
          direction="horizontal"
          baseTopY={baseTopY}
        />
      )}

      {/* Vertical alignment guide (same X) */}
      {snapAlignment?.vertical && (
        <AlignmentGuide
          currentPosition={previewPosition}
          alignedHole={snapAlignment.vertical}
          direction="vertical"
          baseTopY={baseTopY}
        />
      )}
    </group>
  );
};

export default HolePlacement;
