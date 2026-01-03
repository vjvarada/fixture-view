/**
 * Baseplate Coverage Utilities
 * 
 * Utilities for calculating how much of a support's base area
 * is covered by baseplate sections. Used for filtering auto-placed
 * supports on multi-section baseplates.
 */

import type { AnySupport, CustomSupport, RectSupport, CylSupport } from '../types';
import type { BasePlateSection } from '@/features/baseplate/types';

/**
 * Minimum coverage ratio required for a support to be placed on a multi-section baseplate.
 * A support must have at least this fraction of its base area on a baseplate section.
 */
export const MIN_BASEPLATE_COVERAGE_RATIO = 0.6; // 60%

/**
 * Represents a 2D axis-aligned bounding box
 */
interface BoundingBox2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Calculate the 2D bounding box of a support's base footprint.
 * 
 * @param support - The support to calculate bounds for
 * @returns The 2D bounding box on the XZ plane
 */
export function getSupportBoundingBox(support: AnySupport): BoundingBox2D {
  const centerX = support.center.x;
  const centerZ = support.center.y; // THREE.Vector2's y is Z in world space
  
  switch (support.type) {
    case 'rectangular': {
      const rect = support as RectSupport;
      const halfWidth = rect.width / 2;
      const halfDepth = rect.depth / 2;
      
      // If there's rotation, we need to compute the rotated bounding box
      if (rect.rotationY && rect.rotationY !== 0) {
        // For rotated rectangle, compute corners and find AABB
        const cos = Math.cos(rect.rotationY);
        const sin = Math.sin(rect.rotationY);
        const corners = [
          { x: -halfWidth, z: -halfDepth },
          { x: halfWidth, z: -halfDepth },
          { x: halfWidth, z: halfDepth },
          { x: -halfWidth, z: halfDepth },
        ];
        
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const corner of corners) {
          // Rotate corner
          const rotX = corner.x * cos - corner.z * sin;
          const rotZ = corner.x * sin + corner.z * cos;
          // Translate to world position
          const worldX = centerX + rotX;
          const worldZ = centerZ + rotZ;
          
          minX = Math.min(minX, worldX);
          maxX = Math.max(maxX, worldX);
          minZ = Math.min(minZ, worldZ);
          maxZ = Math.max(maxZ, worldZ);
        }
        
        return { minX, maxX, minZ, maxZ };
      }
      
      // No rotation - simple bounding box
      return {
        minX: centerX - halfWidth,
        maxX: centerX + halfWidth,
        minZ: centerZ - halfDepth,
        maxZ: centerZ + halfDepth,
      };
    }
    
    case 'cylindrical': {
      const cyl = support as CylSupport;
      return {
        minX: centerX - cyl.radius,
        maxX: centerX + cyl.radius,
        minZ: centerZ - cyl.radius,
        maxZ: centerZ + cyl.radius,
      };
    }
    
    case 'conical': {
      // Use base radius for footprint
      const baseRadius = (support as any).baseRadius || 5;
      return {
        minX: centerX - baseRadius,
        maxX: centerX + baseRadius,
        minZ: centerZ - baseRadius,
        maxZ: centerZ + baseRadius,
      };
    }
    
    case 'custom': {
      const custom = support as CustomSupport;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      // Polygon points are relative to center
      const cos = custom.rotationY ? Math.cos(custom.rotationY) : 1;
      const sin = custom.rotationY ? Math.sin(custom.rotationY) : 0;
      
      for (const [px, pz] of custom.polygon) {
        // Apply rotation if present
        const rotX = cos !== 1 ? px * cos - pz * sin : px;
        const rotZ = cos !== 1 ? px * sin + pz * cos : pz;
        
        const worldX = centerX + rotX;
        const worldZ = centerZ + rotZ;
        
        minX = Math.min(minX, worldX);
        maxX = Math.max(maxX, worldX);
        minZ = Math.min(minZ, worldZ);
        maxZ = Math.max(maxZ, worldZ);
      }
      
      return { minX, maxX, minZ, maxZ };
    }
    
    default:
      // Fallback: small bounding box around center
      return {
        minX: centerX - 5,
        maxX: centerX + 5,
        minZ: centerZ - 5,
        maxZ: centerZ + 5,
      };
  }
}

/**
 * Calculate the approximate base area of a support.
 * 
 * @param support - The support to calculate area for
 * @returns The approximate base area in mm²
 */
export function getSupportBaseArea(support: AnySupport): number {
  switch (support.type) {
    case 'rectangular': {
      const rect = support as RectSupport;
      return rect.width * rect.depth;
    }
    
    case 'cylindrical': {
      const cyl = support as CylSupport;
      return Math.PI * cyl.radius * cyl.radius;
    }
    
    case 'conical': {
      const baseRadius = (support as any).baseRadius || 5;
      return Math.PI * baseRadius * baseRadius;
    }
    
    case 'custom': {
      const custom = support as CustomSupport;
      // Calculate polygon area using Shoelace formula
      let area = 0;
      const n = custom.polygon.length;
      for (let i = 0; i < n; i++) {
        const [x1, z1] = custom.polygon[i];
        const [x2, z2] = custom.polygon[(i + 1) % n];
        area += x1 * z2 - x2 * z1;
      }
      return Math.abs(area) / 2;
    }
    
    default:
      return 100; // Fallback: 10x10mm
  }
}

/**
 * Calculate the overlap area between a support's bounding box and a section.
 * This is an approximation using bounding boxes for efficiency.
 * 
 * @param supportBox - The support's 2D bounding box
 * @param section - The baseplate section
 * @returns The overlap area in mm²
 */
function calculateBoxOverlapArea(supportBox: BoundingBox2D, section: BasePlateSection): number {
  // Calculate intersection rectangle
  const overlapMinX = Math.max(supportBox.minX, section.minX);
  const overlapMaxX = Math.min(supportBox.maxX, section.maxX);
  const overlapMinZ = Math.max(supportBox.minZ, section.minZ);
  const overlapMaxZ = Math.min(supportBox.maxZ, section.maxZ);
  
  // Check if there's actually an overlap
  if (overlapMinX >= overlapMaxX || overlapMinZ >= overlapMaxZ) {
    return 0;
  }
  
  return (overlapMaxX - overlapMinX) * (overlapMaxZ - overlapMinZ);
}

/**
 * Find the baseplate section that best covers a support.
 * Returns the section with the highest overlap area, or null if no section
 * provides sufficient coverage.
 * 
 * @param support - The support to check
 * @param sections - The baseplate sections to check against
 * @param minCoverageRatio - Minimum required coverage ratio (0-1)
 * @returns The best matching section ID, or null if coverage is insufficient
 */
export function findBestCoveringSectionForSupport(
  support: AnySupport,
  sections: BasePlateSection[],
  minCoverageRatio: number = MIN_BASEPLATE_COVERAGE_RATIO
): string | null {
  if (!sections || sections.length === 0) {
    return null;
  }
  
  const supportBox = getSupportBoundingBox(support);
  const supportBoxArea = (supportBox.maxX - supportBox.minX) * (supportBox.maxZ - supportBox.minZ);
  
  // For more accurate coverage calculation on non-rectangular supports,
  // use the actual support area instead of bounding box area
  const supportActualArea = getSupportBaseArea(support);
  
  // Use the smaller of bounding box area and actual area for coverage calculation
  // This prevents over-estimation for circular/custom shapes
  const referenceArea = Math.min(supportBoxArea, supportActualArea * 1.2); // 1.2 factor for safety margin
  
  if (referenceArea <= 0) {
    return null;
  }
  
  let bestSection: BasePlateSection | null = null;
  let bestOverlapArea = 0;
  
  for (const section of sections) {
    const overlapArea = calculateBoxOverlapArea(supportBox, section);
    if (overlapArea > bestOverlapArea) {
      bestOverlapArea = overlapArea;
      bestSection = section;
    }
  }
  
  if (!bestSection) {
    return null;
  }
  
  // Calculate coverage ratio
  const coverageRatio = bestOverlapArea / referenceArea;
  
  if (coverageRatio >= minCoverageRatio) {
    return bestSection.id;
  }
  
  return null;
}

/**
 * Result of filtering supports by baseplate coverage
 */
export interface FilteredSupportsResult {
  /** Supports that meet the coverage criteria */
  accepted: AnySupport[];
  /** Supports that were rejected due to insufficient coverage */
  rejected: AnySupport[];
  /** Summary message */
  message: string;
}

/**
 * Filter auto-placed supports to only include those with sufficient
 * coverage on multi-section baseplate sections.
 * 
 * Each accepted support will have its `sectionId` set to the ID of
 * the section that best covers it.
 * 
 * @param supports - Array of supports to filter
 * @param sections - The baseplate sections to check against
 * @param minCoverageRatio - Minimum required coverage ratio (0-1), defaults to 60%
 * @returns Filtered result with accepted and rejected supports
 */
export function filterSupportsByBaseplateCoverage(
  supports: AnySupport[],
  sections: BasePlateSection[],
  minCoverageRatio: number = MIN_BASEPLATE_COVERAGE_RATIO
): FilteredSupportsResult {
  if (!sections || sections.length === 0) {
    // No sections defined - accept all supports without section assignment
    return {
      accepted: supports,
      rejected: [],
      message: `No baseplate sections defined - ${supports.length} supports accepted`,
    };
  }
  
  const accepted: AnySupport[] = [];
  const rejected: AnySupport[] = [];
  
  for (const support of supports) {
    const bestSectionId = findBestCoveringSectionForSupport(support, sections, minCoverageRatio);
    
    if (bestSectionId) {
      // Assign the section ID to the support
      accepted.push({
        ...support,
        sectionId: bestSectionId,
      });
    } else {
      rejected.push(support);
    }
  }
  
  const coveragePercent = Math.round(minCoverageRatio * 100);
  const message = rejected.length > 0
    ? `${accepted.length} supports placed (${rejected.length} rejected - less than ${coveragePercent}% on baseplate)`
    : `${accepted.length} supports placed with ≥${coveragePercent}% baseplate coverage`;
  
  return {
    accepted,
    rejected,
    message,
  };
}
