/**
 * Scene3DContainer - Container component that manages state via extracted hooks
 * 
 * This component demonstrates the pattern for decomposing 3DScene.tsx:
 * - State management via custom hooks (useSupportState, useClampState, etc.)
 * - Clean separation of concerns
 * - Easier testing and maintenance
 * 
 * Currently this serves as a reference implementation. The full migration
 * will progressively move state from 3DScene.tsx to these hooks.
 */
import React from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

// Import extracted hooks
import {
  useSupportState,
  useClampState,
  useLabelState,
  useHoleState,
  useBaseplateState,
  useSceneState,
} from './hooks';

// Import extracted types
import type { ThreeDSceneProps } from './types';

// Re-export types for consumers
export type { ThreeDSceneProps };

/**
 * Hook that combines all feature state hooks into a single object
 * This makes it easy to pass all state to child components
 */
export function useScene3DState() {
  const supportState = useSupportState();
  const clampState = useClampState();
  const labelState = useLabelState();
  const holeState = useHoleState();
  const baseplateState = useBaseplateState();
  const sceneState = useSceneState();

  return {
    // Feature state
    support: supportState,
    clamp: clampState,
    label: labelState,
    hole: holeState,
    baseplate: baseplateState,
    scene: sceneState,
    
    // Combined convenience getters
    get isDraggingAny() {
      return (
        supportState.isDraggingSupportRef.current ||
        clampState.isDraggingClampRef.current ||
        labelState.isDraggingLabelRef.current ||
        holeState.isDraggingHoleRef.current ||
        baseplateState.isDraggingBasePlateSectionRef.current ||
        sceneState.isDraggingAnyItem
      );
    },
    
    get isPlacingAny() {
      return (
        supportState.placing.active ||
        clampState.clampPlacementMode.active ||
        holeState.holePlacementMode.active
      );
    },
    
    get hasAnySelection() {
      return (
        labelState.selectedLabelId !== null ||
        clampState.selectedClampId !== null ||
        holeState.selectedHoleId !== null ||
        baseplateState.selectedBasePlateSectionId !== null
      );
    },
    
    // Clear all selections
    clearAllSelections: () => {
      labelState.setSelectedLabelId(null);
      clampState.setSelectedClampId(null);
      holeState.setSelectedHoleId(null);
      baseplateState.setSelectedBasePlateSectionId(null);
    },
    
    // Cancel all placement modes
    cancelAllPlacements: () => {
      supportState.setPlacing({ active: false, type: null });
      clampState.setClampPlacementMode({ active: false, clampModelId: null, clampCategory: null });
      holeState.setHolePlacementMode({ active: false, config: null, depth: 20 });
    },
  };
}

/**
 * Type for the combined scene state
 */
export type Scene3DState = ReturnType<typeof useScene3DState>;

/**
 * Context for sharing scene state with deeply nested components
 */
export const Scene3DContext = React.createContext<Scene3DState | null>(null);

/**
 * Hook to access scene state from context
 */
export function useScene3DContext() {
  const context = React.useContext(Scene3DContext);
  if (!context) {
    throw new Error('useScene3DContext must be used within a Scene3DProvider');
  }
  return context;
}

/**
 * Provider component that wraps the 3D scene with state management
 */
export function Scene3DProvider({ children }: { children: React.ReactNode }) {
  const state = useScene3DState();
  
  return (
    <Scene3DContext.Provider value={state}>
      {children}
    </Scene3DContext.Provider>
  );
}

/**
 * Example usage pattern for progressive migration:
 * 
 * ```tsx
 * // In AppShell.tsx or parent component:
 * import { Scene3DProvider, useScene3DContext } from '@/components/3DScene';
 * 
 * function App() {
 *   return (
 *     <Scene3DProvider>
 *       <ThreeDScene {...props} />
 *       <ParameterPanel />
 *     </Scene3DProvider>
 *   );
 * }
 * 
 * // In child components that need state:
 * function SomePanel() {
 *   const { support, clamp, clearAllSelections } = useScene3DContext();
 *   // Use support.supports, clamp.placedClamps, etc.
 * }
 * ```
 */
