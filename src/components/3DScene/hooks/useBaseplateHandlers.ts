/**
 * useBaseplateHandlers - Hook for baseplate-related calculations and handlers
 * Extracted from 3DScene.tsx for modularity
 * 
 * Phase 5.7.1 extraction
 */
import { useCallback } from 'react';
import * as THREE from 'three';
import type { BasePlateSection } from '@/features/baseplate';
import type { PlacedClamp, ClampSupportInfo } from '@/features/clamps';
import type { AnySupport, FootprintBounds, getSupportFootprintBounds } from '@/features/supports';
import type { LabelConfig } from '@/features/labels';
import type { PlacedHole } from '@/features/holes';

export interface UseBaseplateHandlersProps {
  clampSupportInfos: Map<string, ClampSupportInfo>;
  getSupportFootprintBounds: typeof getSupportFootprintBounds;
}

export interface UseBaseplateHandlersReturn {
  /**
   * Gets the footprint bounds of a clamp in world space.
   * Applies rotation and translation to transform local polygon to world space.
   */
  getClampFootprintBounds: (clamp: PlacedClamp) => FootprintBounds | null;
  
  /**
   * Calculates the optimal bounds for a section based on its original size and nearby supports/clamps.
   * Maintains minimum original size but allows the section to be positioned anywhere.
   */
  calculateOptimalSectionBounds: (
    section: BasePlateSection,
    nearbySupports: AnySupport[],
    nearbyClamps: PlacedClamp[],
    padding: number,
    nearbyLabels?: LabelConfig[],
    nearbyHoles?: PlacedHole[]
  ) => BasePlateSection;
  
  /**
   * Expands a baseplate section to include a support's footprint with padding.
   */
  expandSectionForSupport: (
    section: BasePlateSection,
    footprint: FootprintBounds,
    padding: number
  ) => BasePlateSection;
}

/**
 * Hook providing baseplate calculation utilities for section bounds and footprint handling
 */
export function useBaseplateHandlers({
  clampSupportInfos,
  getSupportFootprintBounds,
}: UseBaseplateHandlersProps): UseBaseplateHandlersReturn {
  
  /**
   * Gets the footprint bounds of a clamp in world space.
   * Applies rotation and translation to transform local polygon to world space.
   */
  const getClampFootprintBounds = useCallback((clamp: PlacedClamp): FootprintBounds | null => {
    const supportInfo = clampSupportInfos.get(clamp.id);
    if (!supportInfo || !supportInfo.polygon || supportInfo.polygon.length === 0) {
      return null;
    }

    // Apply clamp rotation to polygon points before translating
    const rotationY = THREE.MathUtils.degToRad(clamp.rotation.y);
    const cosR = Math.cos(rotationY);
    const sinR = Math.sin(rotationY);

    // Transform polygon points to world space
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    
    supportInfo.polygon.forEach(([localX, localZ]) => {
      // Apply Y-axis rotation (rotation in the XZ horizontal plane)
      const rotatedX = localX * cosR + localZ * sinR;
      const rotatedZ = -localX * sinR + localZ * cosR;
      
      // Add clamp world position
      const worldX = rotatedX + clamp.position.x;
      const worldZ = rotatedZ + clamp.position.z;
      
      minX = Math.min(minX, worldX);
      maxX = Math.max(maxX, worldX);
      minZ = Math.min(minZ, worldZ);
      maxZ = Math.max(maxZ, worldZ);
    });

    return { minX, maxX, minZ, maxZ };
  }, [clampSupportInfos]);

  /**
   * Calculates the optimal bounds for a section based on its original size and nearby supports/clamps.
   * Maintains minimum original size but allows the section to be positioned anywhere.
   */
  const calculateOptimalSectionBounds = useCallback((
    section: BasePlateSection,
    nearbySupports: AnySupport[],
    nearbyClamps: PlacedClamp[],
    padding: number,
    nearbyLabels: LabelConfig[] = [],
    nearbyHoles: PlacedHole[] = []
  ): BasePlateSection => {
    // Validate section has required bounds
    if (!isFinite(section.minX) || !isFinite(section.maxX) || 
        !isFinite(section.minZ) || !isFinite(section.maxZ)) {
      console.error('[calculateOptimalSectionBounds] Invalid section bounds:', section);
      // Return section unchanged if it's invalid
      return section;
    }
    
    const originalWidth = section.originalWidth ?? (section.maxX - section.minX);
    const originalDepth = section.originalDepth ?? (section.maxZ - section.minZ);
    
    // Use original center if available, otherwise calculate from current bounds
    // This prevents the section from drifting when items are added/removed
    const centerX = section.originalCenterX ?? (section.minX + section.maxX) / 2;
    const centerZ = section.originalCenterZ ?? (section.minZ + section.maxZ) / 2;
    
    // Start with original size centered at original position
    let minX = centerX - originalWidth / 2;
    let maxX = centerX + originalWidth / 2;
    let minZ = centerZ - originalDepth / 2;
    let maxZ = centerZ + originalDepth / 2;

    // Expand to include each nearby support (but don't shrink below original)
    nearbySupports.forEach(support => {
      const footprint = getSupportFootprintBounds(support);
      minX = Math.min(minX, footprint.minX - padding);
      maxX = Math.max(maxX, footprint.maxX + padding);
      minZ = Math.min(minZ, footprint.minZ - padding);
      maxZ = Math.max(maxZ, footprint.maxZ + padding);
    });

    // Expand to include each nearby clamp
    nearbyClamps.forEach(clamp => {
      const footprint = getClampFootprintBounds(clamp);
      if (footprint) {
        minX = Math.min(minX, footprint.minX - padding);
        maxX = Math.max(maxX, footprint.maxX + padding);
        minZ = Math.min(minZ, footprint.minZ - padding);
        maxZ = Math.max(maxZ, footprint.maxZ + padding);
      }
    });

    // Expand to include each nearby label
    nearbyLabels.forEach(label => {
      if (label.position) {
        // Use actual computed bounds if available, otherwise estimate
        const fontSize = label.fontSize ?? 10;
        let labelHalfWidth: number;
        let labelHalfHeight: number;
        
        if (label.computedWidth !== undefined && label.computedHeight !== undefined) {
          // Use actual computed dimensions from rendered text geometry
          labelHalfWidth = label.computedWidth / 2;
          labelHalfHeight = label.computedHeight / 2;
        } else {
          // Fallback: estimate based on text length (used before geometry is computed)
          // Use a more conservative factor of 0.5 instead of 0.6
          const textLength = (label.text?.length ?? 0) * fontSize * 0.5;
          labelHalfWidth = textLength / 2;
          labelHalfHeight = fontSize / 2;
        }
        
        minX = Math.min(minX, label.position.x - labelHalfWidth - padding);
        maxX = Math.max(maxX, label.position.x + labelHalfWidth + padding);
        minZ = Math.min(minZ, label.position.z - labelHalfHeight - padding);
        maxZ = Math.max(maxZ, label.position.z + labelHalfHeight + padding);
      }
    });

    // Expand to include each nearby hole
    nearbyHoles.forEach(hole => {
      // Note: hole.position is Vector2 where .x = world X, .y = world Z
      if (hole.position && isFinite(hole.position.x) && isFinite(hole.position.y)) {
        const holeRadius = (hole.diameter ?? 5) / 2;
        minX = Math.min(minX, hole.position.x - holeRadius - padding);
        maxX = Math.max(maxX, hole.position.x + holeRadius + padding);
        minZ = Math.min(minZ, hole.position.y - holeRadius - padding);
        maxZ = Math.max(maxZ, hole.position.y + holeRadius + padding);
      }
    });

    return {
      ...section,
      minX,
      maxX,
      minZ,
      maxZ,
    };
  }, [getClampFootprintBounds, getSupportFootprintBounds]);

  /**
   * Expands a baseplate section to include a support's footprint with padding.
   */
  const expandSectionForSupport = useCallback((
    section: BasePlateSection,
    footprint: FootprintBounds,
    padding: number
  ): BasePlateSection => {
    return {
      ...section,
      minX: Math.min(section.minX, footprint.minX - padding),
      maxX: Math.max(section.maxX, footprint.maxX + padding),
      minZ: Math.min(section.minZ, footprint.minZ - padding),
      maxZ: Math.max(section.maxZ, footprint.maxZ + padding),
    };
  }, []);

  return {
    getClampFootprintBounds,
    calculateOptimalSectionBounds,
    expandSectionForSupport,
  };
}
