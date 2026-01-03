/**
 * Auto-Placement Service for Supports
 * 
 * Uses overhang-based analysis similar to 3D printing support generation.
 * 
 * Algorithm:
 * 1. Analyze mesh faces to find overhanging surfaces (faces pointing downward)
 * 2. Ignore surfaces touching the buildplate (within tolerance)
 * 3. Cluster nearby overhangs into groups
 * 4. For each cluster, determine support shape based on aspect ratio:
 *    - Elongated clusters (aspect ratio > threshold): rectangular support
 *    - Compact clusters: cylindrical support
 * 5. Use raycasting to determine proper support height (same as manual placement)
 */

import * as THREE from 'three';
import { AnySupport } from '../types';
import { placeOverhangSupports } from './overhangAnalysis';
import { computeSupportMetrics } from './metrics';

// Debug flag - set to true to enable verbose logging
const DEBUG_LOGGING = false;

// Helper function to conditionally log debug messages
function debugLog(...args: unknown[]): void {
  if (DEBUG_LOGGING) {
    console.log(...args);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface AutoPlacementOptions {
  supportType?: 'cylindrical' | 'rectangular' | 'auto' | 'custom';
  cornerRadius?: number;            // Corner radius for rectangular supports (mm)
  contactOffset?: number;           // Gap from model contact (mm)
  // Overhang detection options
  overhangAngle?: number;           // Angle from vertical to consider overhang (default 45°)
  aspectRatioThreshold?: number;    // Ratio above which to use rectangular (default 1.2)
  clusterDistance?: number;         // Max distance to cluster overhang points (mm)
  minClusterArea?: number;          // Minimum cluster area to place support (mm²)
  supportPadding?: number;          // Extra padding around cluster (mm)
  minSupportSize?: number;          // Minimum support radius/width (mm)
  maxSupportSize?: number;          // Maximum support radius/width (mm)
  maxSupportSpan?: number;          // Max span per support - larger clusters get multiple supports (mm)
}

export interface AutoPlacementResult {
  supports: AnySupport[];
  message: string;
  clustersFound: number;
  totalOverhangArea: number;
  /** Debug: the computed perimeter boundary for visualization */
  debugPerimeter?: Array<{ x: number; z: number }>;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_OPTIONS: Required<AutoPlacementOptions> = {
  supportType: 'auto',
  cornerRadius: 2,
  contactOffset: 0,
  overhangAngle: 45,
  aspectRatioThreshold: 1.2,
  clusterDistance: 15,
  minClusterArea: 25,
  supportPadding: 3,
  minSupportSize: 5,
  maxSupportSize: 40,
  maxSupportSpan: 50,  // Large overhangs spanning more than 50mm get multiple supports
};

// ============================================================================
// Main Export
// ============================================================================

/**
 * Automatically place supports for the given model meshes using overhang analysis.
 * Uses raycasting to determine proper support heights (same as manual placement).
 * 
 * When multiple parts are loaded, each part is processed SEPARATELY to generate
 * supports specific to that part's silhouette. This ensures proper support coverage
 * for each individual part rather than treating all parts as one combined shape.
 * 
 * @param meshes - The model meshes to analyze for overhangs
 * @param baseTopY - The Y coordinate of the top of the baseplate
 * @param options - Configuration options for placement
 * @param modelTargets - Optional: meshes for raycasting to find proper heights
 * @param baseTarget - Optional: baseplate mesh for raycasting
 */
export function autoPlaceSupports(
  meshes: THREE.Object3D[],
  baseTopY: number,
  options: AutoPlacementOptions = {},
  modelTargets?: THREE.Object3D[] | null,
  baseTarget?: THREE.Object3D | null
): AutoPlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Process each mesh (part) SEPARATELY to get individual supports per part
  // This ensures proper support coverage when multiple parts are loaded
  const allSupports: AnySupport[] = [];
  let allClustersFound = 0;
  let allOverhangArea = 0;
  const allMessages: string[] = [];
  const combinedDebugPerimeter: Array<{ x: number; z: number }> = [];
  
  // Use raycasting to refine support heights (same technique as manual placement)
  const raycaster = new THREE.Raycaster();
  const effectiveModelTargets = modelTargets && modelTargets.length > 0 ? modelTargets : meshes;
  
  debugLog(`[AutoPlacement] Processing ${meshes.length} part(s) separately`);
  
  for (let partIndex = 0; partIndex < meshes.length; partIndex++) {
    const mesh = meshes[partIndex];
    debugLog(`[AutoPlacement] Processing part ${partIndex + 1}/${meshes.length}`);
    
    // Process this single mesh/part
    const overhangResult = placeOverhangSupports([mesh], baseTopY, {
      overhangAngle: opts.overhangAngle,
      aspectRatioThreshold: opts.aspectRatioThreshold,
      clusterDistance: opts.clusterDistance,
      minClusterArea: opts.minClusterArea,
      supportType: opts.supportType === 'cylindrical' ? 'cylindrical'
                 : opts.supportType === 'rectangular' ? 'rectangular'
                 : opts.supportType === 'custom' ? 'custom' : 'auto',
      cornerRadius: opts.cornerRadius,
      contactOffset: opts.contactOffset,
      supportPadding: opts.supportPadding,
      minSupportSize: opts.minSupportSize,
      maxSupportSize: opts.maxSupportSize,
      maxSupportSpan: opts.maxSupportSpan,
    });
    
    // Refine support heights using raycasting against ALL meshes
    // This ensures supports properly connect to any mesh they touch
    for (const support of overhangResult.supports) {
      // Make support IDs unique across parts
      support.id = `${support.id}-p${partIndex}`;
      
      const metrics = computeSupportMetrics({
        support,
        baseTopY,
        contactOffset: opts.contactOffset,
        baseTarget: baseTarget || null,
        modelTargets: effectiveModelTargets,
        maxRayHeight: 2000,
        raycaster,
      });

      if (metrics) {
        support.baseY = metrics.baseY;
        support.height = metrics.height;
      }
    }
    
    // Accumulate results
    allSupports.push(...overhangResult.supports);
    allClustersFound += overhangResult.clusters.length;
    allOverhangArea += overhangResult.totalOverhangArea;
    allMessages.push(`Part ${partIndex + 1}: ${overhangResult.message}`);
    
    // Combine debug perimeters (add all perimeter points for visualization)
    if (overhangResult.debugPerimeter && overhangResult.debugPerimeter.length > 0) {
      combinedDebugPerimeter.push(...overhangResult.debugPerimeter);
    }
    
    debugLog(`[AutoPlacement] Part ${partIndex + 1}: ${overhangResult.supports.length} supports, ${overhangResult.clusters.length} clusters`);
  }
  
  const finalMessage = meshes.length > 1 
    ? `Processed ${meshes.length} parts: ${allSupports.length} total supports`
    : allMessages[0] || 'No parts processed';
  
  debugLog(`[AutoPlacement] Total: ${allSupports.length} supports across ${meshes.length} parts`);

  return {
    supports: allSupports,
    message: finalMessage,
    clustersFound: allClustersFound,
    totalOverhangArea: allOverhangArea,
    debugPerimeter: combinedDebugPerimeter,
  };
}

/**
 * Get configurable options with descriptions for UI
 */
export function getAutoPlacementOptions(): Array<{
  key: keyof AutoPlacementOptions;
  label: string;
  description: string;
  defaultValue: number | string;
  type: 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}> {
  return [
    {
      key: 'overhangAngle',
      label: 'Overhang Angle',
      description: 'Angle from vertical to consider as overhang (degrees). 45° is standard for 3D printing.',
      defaultValue: DEFAULT_OPTIONS.overhangAngle,
      type: 'number',
      min: 20,
      max: 80,
    },
    {
      key: 'supportType',
      label: 'Support Shape',
      description: 'Shape of supports to generate',
      defaultValue: DEFAULT_OPTIONS.supportType,
      type: 'select',
      options: [
        { value: 'auto', label: 'Auto (based on overhang shape)' },
        { value: 'cylindrical', label: 'Cylindrical' },
        { value: 'rectangular', label: 'Rectangular' },
        { value: 'custom', label: 'Custom (convex hull)' },
      ],
    },
    {
      key: 'aspectRatioThreshold',
      label: 'Aspect Ratio Threshold',
      description: 'When Auto: clusters more elongated than this use rectangular supports',
      defaultValue: DEFAULT_OPTIONS.aspectRatioThreshold,
      type: 'number',
      min: 1.0,
      max: 3.0,
    },
    {
      key: 'clusterDistance',
      label: 'Cluster Distance',
      description: 'Maximum distance to group nearby overhangs (mm)',
      defaultValue: DEFAULT_OPTIONS.clusterDistance,
      type: 'number',
      min: 5,
      max: 50,
    },
    {
      key: 'minClusterArea',
      label: 'Min Cluster Area',
      description: 'Minimum overhang area to place a support (mm²)',
      defaultValue: DEFAULT_OPTIONS.minClusterArea,
      type: 'number',
      min: 1,
      max: 200,
    },
    {
      key: 'supportPadding',
      label: 'Support Padding',
      description: 'Extra padding around overhang for support size (mm)',
      defaultValue: DEFAULT_OPTIONS.supportPadding,
      type: 'number',
      min: 0,
      max: 20,
    },
  ];
}
