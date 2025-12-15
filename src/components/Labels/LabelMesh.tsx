/**
 * LabelMesh
 * 
 * Renders a 3D text label using TextGeometry from three.js.
 * Supports embossed (raised) labels only.
 * Supports multiple fonts: Helvetica, Roboto, Arial.
 */

import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Text3D } from '@react-three/drei';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { LabelConfig, getFontFile } from './types';

interface LabelMeshProps {
  label: LabelConfig;
  preview?: boolean;
  selected?: boolean;
  onSelect?: (labelId: string) => void;
  onDoubleClick?: (labelId: string) => void;
  onBoundsComputed?: (labelId: string, width: number, height: number) => void;
}

// Double-click detection threshold in milliseconds
const DOUBLE_CLICK_THRESHOLD_MS = 300;

// Selection color (matches support selection)
const SELECTION_COLOR = 0x93c5fd;

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
  const lastReportedBoundsRef = useRef<{ width: number; height: number; text: string } | null>(null);
  const boundsComputedRef = useRef(false);
  
  // Track computed offset for manual centering
  const [textOffset, setTextOffset] = useState<THREE.Vector3>(new THREE.Vector3(0, 0, 0));

  // Material based on state
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: preview ? 0x3b82f6 : selected ? SELECTION_COLOR : 0x666666,
      transparent: preview,
      opacity: preview ? 0.7 : 1,
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
      emissive: selected ? SELECTION_COLOR : 0x000000,
      emissiveIntensity: selected ? 0.15 : 0,
    });
  }, [preview, selected]);

  // Handle click/double-click
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    
    if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD_MS) {
      // Double-click detected
      onDoubleClick?.(label.id);
      lastClickTimeRef.current = 0;
    } else {
      // Single click - select
      onSelect?.(label.id);
      lastClickTimeRef.current = now;
    }
  }, [label.id, onSelect, onDoubleClick]);

  // Ensure position is a THREE.Vector3
  const position = useMemo(() => {
    const pos = label.position;
    if (pos instanceof THREE.Vector3) {
      return pos;
    }
    return new THREE.Vector3((pos as any).x, (pos as any).y, (pos as any).z);
  }, [label.position]);

  // Ensure rotation is a THREE.Euler
  const rotation = useMemo(() => {
    const rot = label.rotation;
    if (rot instanceof THREE.Euler) {
      return rot;
    }
    return new THREE.Euler((rot as any).x, (rot as any).y, (rot as any).z);
  }, [label.rotation]);

  // Emboss height - positive extrusion outward from surface
  const extrudeDepth = label.depth;

  // Track the current text to detect geometry updates
  const currentTextRef = useRef(label.text);

  // Reset bounds tracking when text, fontSize, or font changes
  useEffect(() => {
    boundsComputedRef.current = false;
    lastReportedBoundsRef.current = null;
    currentTextRef.current = label.text;
    // Reset offset to trigger re-centering
    setTextOffset(new THREE.Vector3(0, 0, 0));
  }, [label.text, label.fontSize, label.font]);

  // Compute bounds and manually center the text
  useFrame(() => {
    if (!textRef.current) return;
    
    const mesh = textRef.current;
    if (!mesh.geometry) return;
    
    // Compute bounding box of the text geometry
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) return;
    
    // Get the actual width (X) and height (Y) of the text in local space
    // Text3D: X is width (character direction), Y is height (font size direction), Z is depth
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    
    // Skip if geometry appears to be empty/default (not yet updated)
    if (width < 0.01 || height < 0.01) return;
    
    // Check if width is reasonable for the current text
    const expectedMinWidth = label.text.length * label.fontSize * 0.3;
    const expectedMaxWidth = label.text.length * label.fontSize * 1.0;
    if (width < expectedMinWidth * 0.5 || width > expectedMaxWidth * 2) {
      return;
    }
    
    // Compute center offset - Text3D starts at origin, we need to shift to center it
    // Center X (width direction) and Y (height direction), not Z (depth)
    const centerX = (box.min.x + box.max.x) / 2;
    const centerY = (box.min.y + box.max.y) / 2;
    const newOffset = new THREE.Vector3(-centerX, -centerY, 0);
    
    // Update text offset if changed significantly
    if (Math.abs(textOffset.x - newOffset.x) > 0.01 || Math.abs(textOffset.y - newOffset.y) > 0.01) {
      setTextOffset(newOffset);
    }
    
    // Report bounds if not already done for this text
    if (!boundsComputedRef.current && onBoundsComputed) {
      lastReportedBoundsRef.current = { width, height, text: label.text };
      boundsComputedRef.current = true;
      onBoundsComputed(label.id, width, height);
    }
  });

  // Get font file path based on label font config
  const fontFile = useMemo(() => getFontFile(label.font || 'helvetiker'), [label.font]);

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      onClick={handleClick}
    >
      {/* Manual centering using computed offset - ensures visual matches hull calculation */}
      <group position={textOffset}>
        <Text3D
          ref={textRef}
          font={fontFile}
          size={label.fontSize}
          height={extrudeDepth}
          curveSegments={4}
          bevelEnabled={false}
        >
          {label.text}
          <primitive object={material} attach="material" />
        </Text3D>
      </group>
    </group>
  );
};

export default LabelMesh;
