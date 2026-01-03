/**
 * UI Hooks for Fixture App
 * 
 * Provides fixture-specific UI state hooks.
 * Maps generic panel states to fixture-specific naming.
 */

import { useCallback } from 'react';
import { useUIStore } from '@rapidtool/cad-ui';

/**
 * Hook for context panel collapse state (left panel)
 * Replaces: const [isContextPanelCollapsed, setIsContextPanelCollapsed] = useState(false)
 */
export function useContextPanelCollapsed() {
  const isOpen = useUIStore((state) => state.panels.leftSidebar);
  const setPanel = useUIStore((state) => state.setPanel);
  
  // Inverted: collapsed = !open
  const isCollapsed = !isOpen;
  
  const setCollapsed = useCallback((collapsed: boolean) => {
    setPanel('leftSidebar', !collapsed);
  }, [setPanel]);
  
  return [isCollapsed, setCollapsed] as const;
}

/**
 * Hook for properties panel collapse state (right panel)
 * Replaces: const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false)
 */
export function usePropertiesPanelCollapsed() {
  const isOpen = useUIStore((state) => state.panels.rightSidebar);
  const setPanel = useUIStore((state) => state.setPanel);
  
  // Inverted: collapsed = !open
  const isCollapsed = !isOpen;
  
  const setCollapsed = useCallback((collapsed: boolean) => {
    setPanel('rightSidebar', !collapsed);
  }, [setPanel]);
  
  return [isCollapsed, setCollapsed] as const;
}

/**
 * Hook for viewport options
 */
export function useViewportOptions() {
  const viewport = useUIStore((state) => state.viewport);
  const toggleOption = useUIStore((state) => state.toggleViewportOption);
  const setOption = useUIStore((state) => state.setViewportOption);
  
  return { viewport, toggleOption, setOption };
}

/**
 * Hook for the full UI store
 */
export function useUI() {
  return useUIStore();
}
