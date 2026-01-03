/**
 * HoleMesh Component
 *
 * Renders a preview of a mounting hole on the baseplate.
 * Shows a visual indicator of where the hole will be drilled.
 * The actual CSG operation happens on the baseplate geometry.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import type { PlacedHole } from '../types';
import { createHoleGeometry } from '../utils/holeGeometry';

// =============================================================================
// Types
// =============================================================================

interface HoleMeshProps {
  /** The placed hole configuration */
  hole: PlacedHole;
  /** Y position of the baseplate top */
  baseTopY: number;
  /** Whether this hole is selected */
  isSelected?: boolean;
  /** Whether this hole is being previewed (during placement) */
  isPreview?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Double-click handler for edit mode */
  onDoubleClick?: () => void;
}

interface HoleRingIndicatorProps {
  diameter: number;
  position: THREE.Vector2;
  baseTopY: number;
  isSelected: boolean;
  isPreview: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Default hole diameter when invalid value provided */
const DEFAULT_DIAMETER = 6;

/** Ring indicator thickness in mm */
const RING_THICKNESS = 0.15;

/** Center marker radius in mm */
const CENTER_MARKER_RADIUS = 0.5;

// =============================================================================
// Materials (shared instances to reduce memory)
// =============================================================================

const PREVIEW_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x00aaff,
  transparent: true,
  opacity: 0.25,
  side: THREE.DoubleSide,
});

const NORMAL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x444444,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  metalness: 0.3,
  roughness: 0.7,
});

const SELECTED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x00ff88,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
  emissive: 0x004422,
  emissiveIntensity: 0.3,
});

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Safely parses a number with a fallback default.
 */
function safeNum(value: number | undefined | null, defaultValue: number): number {
  const num = Number(value);
  return Number.isNaN(num) ? defaultValue : num;
}

/**
 * Returns the display diameter based on hole type.
 * Countersink/counterbore holes show their larger surface diameter.
 */
function getDisplayDiameter(hole: PlacedHole, safeDiameters: {
  diameter: number;
  countersinkDiameter: number;
  counterboreDiameter: number;
}): number {
  switch (hole.type) {
    case 'counterbore':
      return safeDiameters.counterboreDiameter;
    case 'countersink':
      return safeDiameters.countersinkDiameter;
    default:
      return safeDiameters.diameter;
  }
}

/**
 * Returns the appropriate color for the ring indicator.
 */
function getRingColor(isPreview: boolean, isSelected: boolean): number {
  if (isPreview) return 0x00aaff;
  if (isSelected) return 0x00ff88;
  return 0x00aaff; // Theme blue for normal (was orange 0xff6600)
}

// =============================================================================
// Sub-Components
// =============================================================================

/**
 * Ring indicator showing hole position on baseplate surface.
 * Animates slightly when in preview mode.
 */
const HoleRingIndicator: React.FC<HoleRingIndicatorProps> = React.memo(({
  diameter,
  position,
  baseTopY,
  isSelected,
  isPreview,
}) => {
  const ringRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.RingGeometry | null>(null);

  const safePosition = useMemo(() => ({
    x: safeNum(position?.x, 0),
    y: safeNum(position?.y, 0),
  }), [position]);

  const safeDiameter = safeNum(diameter, DEFAULT_DIAMETER);

  // Animate preview ring with subtle pulsing effect
  useFrame(({ clock }) => {
    if (ringRef.current && isPreview) {
      const scale = 1 + Math.sin(clock.getElapsedTime() * 3) * 0.05;
      ringRef.current.scale.setScalar(scale);
    }
  });

  const ringGeometry = useMemo(() => {
    // Dispose previous geometry
    if (geometryRef.current) {
      geometryRef.current.dispose();
    }
    const innerRadius = Math.max(0.5, safeDiameter / 2);
    const outerRadius = innerRadius + RING_THICKNESS;
    const geo = new THREE.RingGeometry(innerRadius, outerRadius, 32);
    geometryRef.current = geo;
    return geo;
  }, [safeDiameter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }
    };
  }, []);

  const color = getRingColor(isPreview, isSelected);

  return (
    <mesh
      ref={ringRef}
      position={[safePosition.x, baseTopY + 0.1, safePosition.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={ringGeometry}
    >
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  );
});

HoleRingIndicator.displayName = 'HoleRingIndicator';

// =============================================================================
// Main Component
// =============================================================================

/**
 * HoleMesh - Renders a mounting hole visualization.
 *
 * The mesh itself is invisible (used for click detection).
 * Visual feedback is provided via ring indicator and optional center marker.
 */
const HoleMesh: React.FC<HoleMeshProps> = ({
  hole,
  baseTopY,
  isSelected = false,
  isPreview = false,
  onClick,
  onDoubleClick,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  // Sanitize hole data to prevent NaN geometries
  const safeHole = useMemo(() => ({
    ...hole,
    diameter: safeNum(hole.diameter, DEFAULT_DIAMETER),
    depth: safeNum(hole.depth, 20),
    position: {
      x: safeNum(hole.position?.x, 0),
      y: safeNum(hole.position?.y, 0),
    },
    countersinkAngle: safeNum(hole.countersinkAngle, 90),
    countersinkDiameter: safeNum(hole.countersinkDiameter, (safeNum(hole.diameter, DEFAULT_DIAMETER)) * 2),
    counterboreDiameter: safeNum(hole.counterboreDiameter, (safeNum(hole.diameter, DEFAULT_DIAMETER)) * 1.8),
    counterboreDepth: safeNum(hole.counterboreDepth, 5),
  }), [hole]);

  // Create hole geometry with safe values and proper cleanup
  const geometry = useMemo(() => {
    // Dispose previous geometry
    if (geometryRef.current) {
      geometryRef.current.dispose();
    }
    const geo = createHoleGeometry(safeHole as PlacedHole);
    geometryRef.current = geo;
    return geo;
  }, [safeHole]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }
    };
  }, []);

  // Select appropriate material based on state (uses shared instances - no cleanup needed)
  const material = useMemo(() => {
    if (isPreview) return PREVIEW_MATERIAL;
    if (isSelected) return SELECTED_MATERIAL;
    return NORMAL_MATERIAL;
  }, [isPreview, isSelected]);

  // Event handlers
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick?.();
  };

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onDoubleClick?.();
    
    // Dispatch navigation event to open step and accordion
    window.dispatchEvent(new CustomEvent('highlight-component', {
      detail: { category: 'hole', id: hole.id }
    }));
  };

  // Display diameter for ring indicator
  const displayDiameter = getDisplayDiameter(hole, {
    diameter: safeHole.diameter,
    countersinkDiameter: safeHole.countersinkDiameter,
    counterboreDiameter: safeHole.counterboreDiameter,
  });

  const showCenterMarker = isSelected || isPreview;
  const centerMarkerColor = isPreview ? 0x00aaff : 0x00ff88;

  return (
    <group>
      {/* Invisible mesh for click detection */}
      <mesh
        ref={meshRef}
        position={[safeHole.position.x, baseTopY, safeHole.position.y]}
        geometry={geometry}
        material={material}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        visible={false}
      />

      {/* Ring indicator on surface */}
      <HoleRingIndicator
        diameter={displayDiameter}
        position={new THREE.Vector2(safeHole.position.x, safeHole.position.y)}
        baseTopY={baseTopY}
        isSelected={isSelected}
        isPreview={isPreview}
      />

      {/* Center marker (shown when selected or previewing) */}
      {showCenterMarker && (
        <mesh
          position={[safeHole.position.x, baseTopY + 0.2, safeHole.position.y]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[CENTER_MARKER_RADIUS, 16]} />
          <meshBasicMaterial color={centerMarkerColor} />
        </mesh>
      )}
    </group>
  );
};

// Memoize HoleMesh to prevent unnecessary re-renders
const MemoizedHoleMesh = React.memo(HoleMesh, (prevProps, nextProps) => {
  return (
    prevProps.hole === nextProps.hole &&
    prevProps.baseTopY === nextProps.baseTopY &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isPreview === nextProps.isPreview &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onDoubleClick === nextProps.onDoubleClick
  );
});

export default MemoizedHoleMesh;
