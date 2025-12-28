/**
 * Deselection Hooks
 * 
 * Shared hooks for handling transform control deselection.
 * Used by: Supports, Clamps, Labels, Parts, Holes, Baseplate sections
 */

import { useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { EVENTS, addAppEventListener } from '@/core/events';

// ============================================================================
// Escape Key Hook
// ============================================================================

/**
 * Calls onDeselect when Escape key is pressed.
 * Used by all transform controls to allow keyboard deselection.
 */
export function useEscapeDeselect(onDeselect: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDeselect();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeselect]);
}

// ============================================================================
// Click Outside Hooks
// ============================================================================

/** UI selectors that should trigger deselection */
const UI_CLICK_SELECTORS =
  'button, input, select, [role="button"], [role="slider"], [data-radix-collection-item], [class*="accordion"]';

/**
 * Deselects when clicking on specific UI elements outside canvas.
 * Used by: Supports, Clamps, Labels, Parts
 */
export function useUIClickDeselect(onDeselect: () => void): void {
  const { gl } = useThree();
  
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;

      // Ignore clicks on canvas (for camera controls)
      if (gl.domElement.contains(target) || gl.domElement === target) return;

      // Deselect only on specific UI element clicks
      if (target.closest(UI_CLICK_SELECTORS)) {
        onDeselect();
      }
    };

    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [gl.domElement, onDeselect]);
}

/**
 * Deselects when clicking anywhere outside canvas.
 * Used by: Holes, Baseplate sections (stricter deselection)
 */
export function useAnyClickOutsideDeselect(onDeselect: () => void): void {
  const { gl } = useThree();
  
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;

      // Allow clicks on canvas (for camera controls) - don't deselect
      if (gl.domElement.contains(target) || gl.domElement === target) return;

      // Any click outside canvas should deselect
      onDeselect();
    };

    document.addEventListener('mousedown', handleDocumentClick, true);
    return () => document.removeEventListener('mousedown', handleDocumentClick, true);
  }, [gl.domElement, onDeselect]);
}

// ============================================================================
// Pivot Conflict Hook
// ============================================================================

interface PivotConflictOptions {
  /** Current entity ID (for comparison) */
  entityId?: string;
  /** Entity type for filtering */
  entityType: 'part' | 'support' | 'clamp' | 'hole' | 'label' | 'section';
}

/**
 * Deselects when another pivot control is activated.
 * Prevents multiple pivot controls from being active at once.
 */
export function usePivotConflictDeselect(
  onDeselect: () => void,
  options: PivotConflictOptions
): void {
  const { entityId, entityType } = options;
  
  useEffect(() => {
    return addAppEventListener<{
      partId?: string;
      supportId?: string;
      clampId?: string;
      holeId?: string;
      labelId?: string;
      sectionId?: string;
    }>(EVENTS.PIVOT_CONTROL_ACTIVATED, (detail) => {
      // Extract the ID based on entity type
      const idMap: Record<string, string | undefined> = {
        part: detail.partId,
        support: detail.supportId,
        clamp: detail.clampId,
        hole: detail.holeId,
        label: detail.labelId,
        section: detail.sectionId,
      };
      
      const activatedId = idMap[entityType];
      
      // If another entity of same type was activated, deselect this one
      if (activatedId !== undefined && activatedId !== entityId) {
        onDeselect();
      }
      
      // If any other entity type was activated, also deselect
      const anyOtherActivated = Object.entries(idMap)
        .filter(([type]) => type !== entityType)
        .some(([, id]) => id !== undefined);
      
      if (anyOtherActivated) {
        onDeselect();
      }
    });
  }, [entityId, entityType, onDeselect]);
}
