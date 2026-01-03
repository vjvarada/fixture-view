/**
 * LabelTransformControls
 *
 * Transform controls for labels using PivotControls from @react-three/drei.
 * Allows XZ plane translation, Y-axis rotation for orientation,
 * and Y-axis height adjustment for emboss depth.
 *
 * Gizmo stays upright (like supports) even though the label lies flat:
 * - X/Z axes: move label on baseplate surface
 * - Y axis: adjust emboss depth
 * - Y rotation: rotate label text orientation
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { PivotControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { LabelConfig, MIN_DEPTH, MAX_DEPTH, toVector3, toEuler } from '../types';
import {
  TransformController,
  LABEL_TRANSFORM_CONFIG,
  setOrbitControlsEnabled,
  resetPivotMatrix,
  calculateGizmoScale as calculateGizmoScaleBase,
} from '@/core/transform';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Vertical offset from label top to gizmo position */
const GIZMO_OFFSET_Y = 5;

/** UI click selectors for deselect detection */
const UI_CLICK_SELECTORS =
  'button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]';

// Transform controller for applying constraints (shared instance for performance)
const transformController = new TransformController(LABEL_TRANSFORM_CONFIG);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LabelTransformControlsProps {
  label: LabelConfig;
  onTransformChange: (position: THREE.Vector3, rotation: THREE.Euler, depth?: number) => void;
  onTransformEnd: (position: THREE.Vector3, rotation: THREE.Euler, depth?: number) => void;
  onDeselect: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

interface DragState {
  groupPosition: THREE.Vector3 | null;
  groupRotationY: number;
  depth: number;
  anchorY: number;
}

interface TransformResult {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  depth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Reusable THREE.js objects to avoid allocations */
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

/** Clamps depth value to valid range */
const clampDepth = (value: number): number =>
  Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, value));

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Hook to handle document click outside canvas */
function useDocumentClickDeselect(
  canvasElement: HTMLCanvasElement,
  onDeselect: () => void
): void {
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;

      // Ignore clicks on canvas (for camera controls)
      if (canvasElement.contains(target) || canvasElement === target) return;

      // Deselect on UI element clicks
      if (target.closest(UI_CLICK_SELECTORS)) {
        onDeselect();
      }
    };

    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [canvasElement, onDeselect]);
}

/** Hook to handle escape key */
function useEscapeDeselect(onDeselect: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDeselect();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeselect]);
}

/** Hook to handle other pivot control activation */
function usePivotConflictDeselect(labelId: string, onDeselect: () => void): void {
  useEffect(() => {
    const handleOtherActivated = (e: Event): void => {
      const detail = (e as CustomEvent).detail;
      const isDifferentLabel = detail?.labelId && detail.labelId !== labelId;
      const isSupport = Boolean(detail?.supportId);

      if (isDifferentLabel || isSupport) {
        onDeselect();
      }
    };

    window.addEventListener('pivot-control-activated', handleOtherActivated);
    return () => window.removeEventListener('pivot-control-activated', handleOtherActivated);
  }, [labelId, onDeselect]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Close button rendered at gizmo center */
const CloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  return (
    <Html center style={{ pointerEvents: 'auto', userSelect: 'none' }}>
      <button
        type="button"
        onClick={handleClick}
        className="w-6 h-6 flex items-center justify-center bg-slate-800/90 hover:bg-red-600 text-white rounded-full shadow-lg border border-slate-600 transition-colors text-xs"
        title="Close (Esc)"
      >
        ✕
      </button>
    </Html>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const LabelTransformControls: React.FC<LabelTransformControlsProps> = ({
  label,
  onTransformChange,
  onTransformEnd,
  onDeselect,
  onDragStart,
  onDragEnd,
}) => {
  const { gl } = useThree();

  // Refs
  const pivotRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Mesh>(null);
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState>({
    groupPosition: null,
    groupRotationY: 0,
    depth: label.depth,
    anchorY: 0,
  });

  // Memoized transforms
  const labelPosition = useMemo(() => toVector3(label.position), [label.position]);
  const labelRotation = useMemo(() => toEuler(label.rotation), [label.rotation]);

  // Computed values
  const gizmoY = labelPosition.y + label.depth + GIZMO_OFFSET_Y;
  const currentRotationY = labelRotation.z; // Z rotation becomes Y in world space (label is flat)
  const gizmoScale = useMemo(
    () => calculateGizmoScaleBase('label', { fontSize: label.fontSize }),
    [label.fontSize]
  );

  // Display position (locked during drag to prevent feedback loop)
  // IMPORTANT: Don't use useMemo - refs don't trigger memo recalculation
  const displayPos = isDraggingRef.current && dragStateRef.current.groupPosition
    ? dragStateRef.current.groupPosition
    : new THREE.Vector3(labelPosition.x, gizmoY, labelPosition.z);

  const displayRotY = isDraggingRef.current
    ? dragStateRef.current.groupRotationY
    : currentRotationY;

  // Read transform from anchor mesh
  const getTransformFromAnchor = useCallback((): TransformResult | null => {
    if (!anchorRef.current) return null;

    anchorRef.current.updateMatrixWorld(true);
    anchorRef.current.getWorldPosition(tempPosition);
    anchorRef.current.getWorldQuaternion(tempQuaternion);
    tempEuler.setFromQuaternion(tempQuaternion, 'YXZ');

    const yDelta = tempPosition.y - dragStateRef.current.anchorY;
    const newDepth = clampDepth(dragStateRef.current.depth + yDelta);

    return {
      position: new THREE.Vector3(tempPosition.x, labelPosition.y, tempPosition.z),
      rotation: new THREE.Euler(labelRotation.x, labelRotation.y, tempEuler.y),
      depth: newDepth,
    };
  }, [labelPosition.y, labelRotation.x, labelRotation.y]);

  // Drag handlers
  const handleDrag = useCallback((): void => {
    if (!isDraggingRef.current) return;

    const transform = getTransformFromAnchor();
    if (transform) {
      onTransformChange(transform.position, transform.rotation, transform.depth);
    }
  }, [getTransformFromAnchor, onTransformChange]);

  const handleDragStart = useCallback((): void => {
    isDraggingRef.current = true;

    // Store initial state to prevent feedback loop
    dragStateRef.current = {
      groupPosition: new THREE.Vector3(labelPosition.x, gizmoY, labelPosition.z),
      groupRotationY: currentRotationY,
      depth: label.depth,
      anchorY: gizmoY,
    };

    // Get actual anchor Y if available
    if (anchorRef.current) {
      anchorRef.current.updateMatrixWorld(true);
      anchorRef.current.getWorldPosition(tempPosition);
      dragStateRef.current.anchorY = tempPosition.y;
    }

    setOrbitControlsEnabled(false);
    gl.domElement.style.cursor = 'grabbing';
    onDragStart?.();
  }, [gl, labelPosition.x, labelPosition.z, gizmoY, currentRotationY, label.depth, onDragStart]);

  const handleDragEnd = useCallback((): void => {
    isDraggingRef.current = false;
    dragStateRef.current.groupPosition = null;

    setOrbitControlsEnabled(true);
    gl.domElement.style.cursor = 'auto';

    const transform = getTransformFromAnchor();
    if (transform) {
      onTransformEnd(transform.position, transform.rotation, transform.depth);
    }

    onDragEnd?.();
    resetPivotMatrix(pivotRef.current);
  }, [gl, getTransformFromAnchor, onTransformEnd, onDragEnd]);

  // Event hooks
  useDocumentClickDeselect(gl.domElement, onDeselect);
  useEscapeDeselect(onDeselect);
  usePivotConflictDeselect(label.id, onDeselect);

  return (
    <group position={[displayPos.x, displayPos.y, displayPos.z]} rotation={[0, displayRotY, 0]}>
      <PivotControls
        ref={pivotRef}
        scale={gizmoScale}
        lineWidth={4}
        depthTest={false}
        fixed={false}
        visible
        activeAxes={[true, true, true]}
        axisColors={['#ff4060', '#40ff60', '#4080ff']}
        hoveredColor="#ffff40"
        annotations
        annotationsClass="pivot-annotation"
        autoTransform
        disableScaling
        disableSliders
        onDrag={handleDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Anchor mesh for reading world transform */}
        <mesh ref={anchorRef} visible={false}>
          <sphereGeometry args={[0.1]} />
        </mesh>

        <CloseButton onClose={onDeselect} />
      </PivotControls>
    </group>
  );
};

export default LabelTransformControls;

