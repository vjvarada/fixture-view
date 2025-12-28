/**
 * useSceneState - Hook for managing general scene state (models, camera, transforms)
 * Extracted from 3DScene.tsx for modularity
 */
import { useState, useRef } from 'react';
import * as THREE from 'three';
import type { BoundsSummary } from '../types';

export type ViewOrientation = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom';

export interface ModelTransformState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface LiveTransformState {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  bounds: THREE.Box3;
}

export interface UseSceneStateReturn {
  // State
  placedComponents: Array<{ component: unknown; position: THREE.Vector3; id: string }>;
  selectedComponent: unknown;
  modelDimensions: { x?: number; y?: number; z?: number } | undefined;
  orbitControlsEnabled: boolean;
  modelColors: Map<string, string>;
  modelBounds: BoundsSummary | null;
  partBounds: Map<string, BoundsSummary>;
  currentOrientation: ViewOrientation;
  modelTransform: ModelTransformState;
  liveTransform: LiveTransformState | null;
  itemBoundsUpdateTrigger: number;
  isDraggingAnyItem: boolean;
  
  // CSG state
  cavityPreview: THREE.Mesh | null;
  offsetMeshPreviews: Map<string, THREE.Mesh>;
  offsetMeshProcessing: boolean;
  showOffsetPreview: boolean;
  mergedFixtureMesh: THREE.Mesh | null;
  
  // Setters
  setPlacedComponents: React.Dispatch<React.SetStateAction<Array<{ component: unknown; position: THREE.Vector3; id: string }>>>;
  setSelectedComponent: React.Dispatch<React.SetStateAction<unknown>>;
  setModelDimensions: React.Dispatch<React.SetStateAction<{ x?: number; y?: number; z?: number } | undefined>>;
  setOrbitControlsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setModelColors: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setModelBounds: React.Dispatch<React.SetStateAction<BoundsSummary | null>>;
  setPartBounds: React.Dispatch<React.SetStateAction<Map<string, BoundsSummary>>>;
  setCurrentOrientation: React.Dispatch<React.SetStateAction<ViewOrientation>>;
  setModelTransform: React.Dispatch<React.SetStateAction<ModelTransformState>>;
  setLiveTransform: React.Dispatch<React.SetStateAction<LiveTransformState | null>>;
  setItemBoundsUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
  setIsDraggingAnyItem: React.Dispatch<React.SetStateAction<boolean>>;
  setCavityPreview: React.Dispatch<React.SetStateAction<THREE.Mesh | null>>;
  setOffsetMeshPreviews: React.Dispatch<React.SetStateAction<Map<string, THREE.Mesh>>>;
  setOffsetMeshProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOffsetPreview: React.Dispatch<React.SetStateAction<boolean>>;
  setMergedFixtureMesh: React.Dispatch<React.SetStateAction<THREE.Mesh | null>>;
  
  // Refs
  pivotClosingRef: React.MutableRefObject<boolean>;
  
  // Actions
  triggerItemBoundsUpdate: () => void;
}

/**
 * Hook to manage general scene state in 3DScene
 */
export function useSceneState(): UseSceneStateReturn {
  // Component placement state
  const [placedComponents, setPlacedComponents] = useState<Array<{ component: unknown; position: THREE.Vector3; id: string }>>([]);
  const [selectedComponent, setSelectedComponent] = useState<unknown>(null);
  
  // Model state
  const [modelDimensions, setModelDimensions] = useState<{ x?: number; y?: number; z?: number } | undefined>();
  const [orbitControlsEnabled, setOrbitControlsEnabled] = useState(true);
  const [modelColors, setModelColors] = useState<Map<string, string>>(new Map());
  const [modelBounds, setModelBounds] = useState<BoundsSummary | null>(null);
  const [partBounds, setPartBounds] = useState<Map<string, BoundsSummary>>(new Map());
  
  // Camera/view state
  const [currentOrientation, setCurrentOrientation] = useState<ViewOrientation>('iso');
  
  // Transform state
  const [modelTransform, setModelTransform] = useState<ModelTransformState>({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });
  const [liveTransform, setLiveTransform] = useState<LiveTransformState | null>(null);
  
  // Bounds update trigger
  const [itemBoundsUpdateTrigger, setItemBoundsUpdateTrigger] = useState(0);
  
  // Drag state
  const [isDraggingAnyItem, setIsDraggingAnyItem] = useState(false);
  
  // CSG preview state
  const [cavityPreview, setCavityPreview] = useState<THREE.Mesh | null>(null);
  const [offsetMeshPreviews, setOffsetMeshPreviews] = useState<Map<string, THREE.Mesh>>(new Map());
  const [offsetMeshProcessing, setOffsetMeshProcessing] = useState(false);
  const [showOffsetPreview, setShowOffsetPreview] = useState(true);
  const [mergedFixtureMesh, setMergedFixtureMesh] = useState<THREE.Mesh | null>(null);
  
  // Refs
  const pivotClosingRef = useRef(false);
  
  // Actions
  const triggerItemBoundsUpdate = () => {
    setItemBoundsUpdateTrigger(prev => prev + 1);
  };

  return {
    // State
    placedComponents,
    selectedComponent,
    modelDimensions,
    orbitControlsEnabled,
    modelColors,
    modelBounds,
    partBounds,
    currentOrientation,
    modelTransform,
    liveTransform,
    itemBoundsUpdateTrigger,
    isDraggingAnyItem,
    cavityPreview,
    offsetMeshPreviews,
    offsetMeshProcessing,
    showOffsetPreview,
    mergedFixtureMesh,
    
    // Setters
    setPlacedComponents,
    setSelectedComponent,
    setModelDimensions,
    setOrbitControlsEnabled,
    setModelColors,
    setModelBounds,
    setPartBounds,
    setCurrentOrientation,
    setModelTransform,
    setLiveTransform,
    setItemBoundsUpdateTrigger,
    setIsDraggingAnyItem,
    setCavityPreview,
    setOffsetMeshPreviews,
    setOffsetMeshProcessing,
    setShowOffsetPreview,
    setMergedFixtureMesh,
    
    // Refs
    pivotClosingRef,
    
    // Actions
    triggerItemBoundsUpdate,
  };
}
