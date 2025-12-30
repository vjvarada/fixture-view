/**
 * LabelMesh
 *
 * Renders a 3D text label using Text3D from @react-three/drei.
 * Supports embossed (raised) labels with multiple font options.
 */

import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Text3D } from '@react-three/drei';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { LabelConfig, getFontFile, toVector3, toEuler } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DOUBLE_CLICK_THRESHOLD_MS = 300;
const SELECTION_COLOR = 0x93c5fd;
const DEFAULT_COLOR = 0x666666;
const PREVIEW_COLOR = 0x3b82f6;
const PREVIEW_OPACITY = 0.7;
const MIN_VALID_DIMENSION = 0.01;
const OFFSET_CHANGE_THRESHOLD = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LabelMeshProps {
  label: LabelConfig;
  preview?: boolean;
  selected?: boolean;
  onSelect?: (labelId: string) => void;
  onDoubleClick?: (labelId: string) => void;
  onBoundsComputed?: (labelId: string, width: number, height: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Creates the material for the label based on state */
const createLabelMaterial = (preview: boolean, selected: boolean): THREE.MeshStandardMaterial => {
  const color = preview ? PREVIEW_COLOR : selected ? SELECTION_COLOR : DEFAULT_COLOR;

  return new THREE.MeshStandardMaterial({
    color,
    transparent: preview,
    opacity: preview ? PREVIEW_OPACITY : 1,
    metalness: 0.1,
    roughness: 0.6,
    side: THREE.DoubleSide,
    emissive: selected ? SELECTION_COLOR : 0x000000,
    emissiveIntensity: selected ? 0.15 : 0,
  });
};

/** Validates if the computed bounds are reasonable for the given text */
const isValidBounds = (
  width: number,
  height: number,
  textLength: number,
  fontSize: number
): boolean => {
  if (width < MIN_VALID_DIMENSION || height < MIN_VALID_DIMENSION) {
    return false;
  }

  const expectedMinWidth = textLength * fontSize * 0.3;
  const expectedMaxWidth = textLength * fontSize * 1.0;

  return width >= expectedMinWidth * 0.5 && width <= expectedMaxWidth * 2;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const LabelMesh: React.FC<LabelMeshProps> = ({
  label,
  preview = false,
  selected = false,
  onSelect,
  onDoubleClick,
  onBoundsComputed,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const textRef = useRef<THREE.Mesh>(null);
  const lastClickTimeRef = useRef<number>(0);
  const boundsComputedRef = useRef(false);

  const [textOffset, setTextOffset] = useState(() => new THREE.Vector3(0, 0, 0));

  // Validate and sanitize label parameters to prevent memory allocation errors
  const safeFontSize = useMemo(() => {
    const size = label.fontSize;
    if (!Number.isFinite(size) || size <= 0 || size > 1000) {
      console.warn('[LabelMesh] Invalid fontSize:', size, '- using fallback');
      return 8; // Default font size
    }
    return size;
  }, [label.fontSize]);

  const safeDepth = useMemo(() => {
    const depth = label.depth;
    if (!Number.isFinite(depth) || depth <= 0 || depth > 100) {
      console.warn('[LabelMesh] Invalid depth:', depth, '- using fallback');
      return 1; // Default depth
    }
    return depth;
  }, [label.depth]);

  const safeText = useMemo(() => {
    if (!label.text || typeof label.text !== 'string' || label.text.length === 0) {
      return 'Label';
    }
    // Limit text length to prevent extremely large geometries
    return label.text.substring(0, 100);
  }, [label.text]);

  // Memoized values with proper cleanup for material
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  
  const material = useMemo(() => {
    // Dispose previous material
    if (materialRef.current) {
      materialRef.current.dispose();
    }
    const mat = createLabelMaterial(preview, selected);
    materialRef.current = mat;
    return mat;
  }, [preview, selected]);

  const position = useMemo(() => toVector3(label.position), [label.position]);
  const rotation = useMemo(() => toEuler(label.rotation), [label.rotation]);
  const fontFile = useMemo(() => getFontFile(label.font ?? 'helvetiker'), [label.font]);

  // Cleanup material on unmount
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);

  // Reset bounds tracking when label properties change
  useEffect(() => {
    boundsComputedRef.current = false;
    setTextOffset(new THREE.Vector3(0, 0, 0));
  }, [label.text, label.fontSize, label.font]);

  // Handle click with double-click detection
  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();

      const now = Date.now();
      const timeSinceLastClick = now - lastClickTimeRef.current;

      if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD_MS) {
        onDoubleClick?.(label.id);
        lastClickTimeRef.current = 0;
      } else {
        onSelect?.(label.id);
        lastClickTimeRef.current = now;
      }
    },
    [label.id, onSelect, onDoubleClick]
  );

  // Compute bounds and center text on each frame
  useFrame(() => {
    const mesh = textRef.current;
    if (!mesh?.geometry) return;

    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) return;

    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;

    if (!isValidBounds(width, height, safeText.length, safeFontSize)) {
      return;
    }

    // Compute centering offset
    const centerX = (box.min.x + box.max.x) / 2;
    const centerY = (box.min.y + box.max.y) / 2;
    const newOffset = new THREE.Vector3(-centerX, -centerY, 0);

    // Update offset if changed significantly
    const offsetChanged =
      Math.abs(textOffset.x - newOffset.x) > OFFSET_CHANGE_THRESHOLD ||
      Math.abs(textOffset.y - newOffset.y) > OFFSET_CHANGE_THRESHOLD;

    if (offsetChanged) {
      setTextOffset(newOffset);
    }

    // Report bounds once
    if (!boundsComputedRef.current && onBoundsComputed) {
      boundsComputedRef.current = true;
      onBoundsComputed(label.id, width, height);
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} onClick={handleClick}>
      <group position={textOffset}>
        <Text3D
          ref={textRef}
          font={fontFile}
          size={safeFontSize}
          height={safeDepth}
          curveSegments={4}
          bevelEnabled={false}
        >
          {safeText}
          <primitive object={material} attach="material" />
        </Text3D>
      </group>
    </group>
  );
};

export default LabelMesh;
