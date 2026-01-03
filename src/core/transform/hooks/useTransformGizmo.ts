import { useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { TransformConfig, TransformDelta, TransformOutput, TransformCallbacks } from '../types';
import { TransformController } from '../TransformController';
import { useDragState } from './useDragState';
import { useGizmoPosition } from './useGizmoPosition';
import { dispatchTransformUpdate } from '../utils';

export interface UseTransformGizmoOptions extends TransformCallbacks {
  config: TransformConfig;
  /** Data for gizmo positioning (component-specific) */
  componentData: Record<string, unknown>;
  /** Current position in world space */
  currentPosition: THREE.Vector3;
  /** Current rotation */
  currentRotation?: THREE.Euler;
  /** Unique ID for this component instance */
  instanceId?: string;
  /** Whether the gizmo is currently active/visible */
  isActive?: boolean;
}

export interface UseTransformGizmoReturn {
  // Refs
  pivotRef: React.RefObject<THREE.Group>;
  anchorRef: React.RefObject<THREE.Mesh>;
  controllerRef: React.MutableRefObject<TransformController | null>;
  
  // State
  isDragging: boolean;
  
  // Gizmo config
  gizmoPosition: THREE.Vector3;
  gizmoScale: number;
  activeAxes: [boolean, boolean, boolean];
  disableRotations: boolean;
  disableScaling: boolean;
  
  // Handlers
  handleDrag: () => void;
  handleDragStart: () => void;
  handleDragEnd: () => void;
  
  // Display
  displayPosition: THREE.Vector3;
}

/**
 * Main hook for transform gizmo functionality.
 * 
 * This hook:
 * 1. Creates and manages a TransformController
 * 2. Handles drag state with feedback loop prevention
 * 3. Calculates gizmo position/scale per component type
 * 4. Applies constraints during drag
 * 5. Dispatches transform events
 */
export function useTransformGizmo(options: UseTransformGizmoOptions): UseTransformGizmoReturn {
  const {
    config,
    componentData,
    currentPosition,
    instanceId,
    onTransformStart,
    onTransformChange,
    onTransformEnd,
    onActivate,
    onDeactivate,
  } = options;
  
  // Refs
  const pivotRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Mesh>(null);
  const controllerRef = useRef<TransformController | null>(null);
  
  // Initialize controller
  useEffect(() => {
    controllerRef.current = new TransformController(config);
    return () => {
      controllerRef.current = null;
    };
  }, [config]);
  
  // Drag state management
  const {
    isDraggingRef,
    handleDragStart: onDragStart,
    handleDragEnd: onDragEnd,
    getDisplayPosition,
  } = useDragState({
    disableOrbitOnDrag: config.disableOrbitOnDrag,
    onDragStart: onTransformStart,
    onDragEnd: () => {
      // Dispatch global transform event
      if (instanceId) {
        dispatchTransformUpdate(config.componentType, instanceId);
      }
    },
  });
  
  // Gizmo positioning
  const { gizmoPosition, gizmoScale } = useGizmoPosition({
    componentType: config.componentType,
    data: componentData,
    customScale: config.gizmoScale,
  });
  
  // Calculate active axes from config
  const activeAxes = useMemo((): [boolean, boolean, boolean] => {
    return controllerRef.current?.getActiveAxes() ?? [true, true, true];
  }, [config]);
  
  const disableRotations = useMemo(() => {
    return !(controllerRef.current?.hasRotation() ?? false);
  }, [config]);
  
  const disableScaling = useMemo(() => {
    return !(controllerRef.current?.hasScale() ?? false);
  }, [config]);
  
  // Drag handlers
  const handleDragStart = useCallback(() => {
    onDragStart(currentPosition);
    onActivate?.();
  }, [currentPosition, onDragStart, onActivate]);
  
  const handleDragEnd = useCallback(() => {
    if (!anchorRef.current || !controllerRef.current) return;
    
    // Get final transform from anchor
    const anchor = anchorRef.current;
    const finalDelta: TransformDelta = {
      position: anchor.position.clone(),
      rotation: anchor.rotation.clone(),
      scale: anchor.scale.clone(),
    };
    
    // Apply constraints
    const constrained = controllerRef.current.applyConstraints(finalDelta);
    
    // Create output
    const output: TransformOutput = {
      position: constrained.position,
      rotation: constrained.rotation,
      scale: constrained.scale,
    };
    
    // Add component-specific fields
    if (config.componentType === 'support' || config.componentType === 'clamp' || config.componentType === 'label') {
      output.rotationY = controllerRef.current.extractYRotation(constrained.rotation);
    }
    
    onTransformEnd?.(output);
    onDragEnd(pivotRef);
    onDeactivate?.();
  }, [config.componentType, onTransformEnd, onDragEnd, onDeactivate]);
  
  const handleDrag = useCallback(() => {
    if (!anchorRef.current || !controllerRef.current) return;
    
    // Get current transform from anchor
    const anchor = anchorRef.current;
    const delta: TransformDelta = {
      position: anchor.position.clone(),
      rotation: anchor.rotation.clone(),
      scale: anchor.scale.clone(),
    };
    
    // Apply constraints
    const constrained = controllerRef.current.applyConstraints(delta);
    
    // Create output
    const output: TransformOutput = {
      position: constrained.position,
      rotation: constrained.rotation,
      scale: constrained.scale,
    };
    
    onTransformChange?.(output);
  }, [onTransformChange]);
  
  // Display position (locked during drag)
  const displayPosition = useMemo(() => {
    return getDisplayPosition(currentPosition);
  }, [currentPosition, getDisplayPosition]);
  
  return {
    pivotRef,
    anchorRef,
    controllerRef,
    isDragging: isDraggingRef.current,
    gizmoPosition,
    gizmoScale,
    activeAxes,
    disableRotations,
    disableScaling,
    handleDrag,
    handleDragStart,
    handleDragEnd,
    displayPosition,
  };
}
