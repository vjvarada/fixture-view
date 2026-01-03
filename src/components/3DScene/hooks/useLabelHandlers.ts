/**
 * useLabelHandlers Hook
 * 
 * Manages label event listeners for the 3D scene.
 * Handles label add, update, delete, and select events.
 * 
 * Extracted from 3DScene.tsx to reduce component complexity.
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import type { BasePlateConfig, BasePlateSection } from '@/features/baseplate/types';
import type { LabelConfig } from '@/features/labels/types';
import type { AnySupport } from '@/features/supports/types';
import type { PlacedClamp, ClampSupportInfo } from '@/features/clamps/types';
import type { BoundsSummary } from '../types';
import { getSupportFootprintPoints } from '@/features/supports';

interface UseLabelHandlersParams {
  // Baseplate state
  basePlate: BasePlateConfig | null;
  selectedBasePlateSectionId: string | null;
  setSelectedBasePlateSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Labels state
  labels: LabelConfig[];
  setLabels: React.Dispatch<React.SetStateAction<LabelConfig[]>>;
  selectedLabelId: string | null;
  setSelectedLabelId: React.Dispatch<React.SetStateAction<string | null>>;
  setWaitingForLabelSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingLabelConfig: React.Dispatch<React.SetStateAction<LabelConfig | null>>;
  
  // Related items for bounds calculation
  supports: AnySupport[];
  placedClamps: PlacedClamp[];
  clampSupportInfos: Map<string, ClampSupportInfo>;
  modelBounds: BoundsSummary | null;
  baseTopY: number;
  
  // Bounds update trigger
  setItemBoundsUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Hook that manages all label-related event listeners.
 * 
 * Events handled:
 * - label-add: Add a new label to the scene
 * - label-update: Update an existing label's properties
 * - label-delete: Remove a label from the scene
 * - label-select: Select/deselect a label
 * - labels-clear-all: Remove all labels
 */
export function useLabelHandlers({
  basePlate,
  selectedBasePlateSectionId,
  setSelectedBasePlateSectionId,
  labels,
  setLabels,
  selectedLabelId,
  setSelectedLabelId,
  setWaitingForLabelSectionSelection,
  setPendingLabelConfig,
  supports,
  placedClamps,
  clampSupportInfos,
  modelBounds,
  baseTopY,
  setItemBoundsUpdateTrigger,
}: UseLabelHandlersParams): void {
  
  useEffect(() => {
    const onLabelAdd = (e: CustomEvent) => {
      const newLabel = e.detail as LabelConfig;
      
      // For multi-section baseplates, require section selection if not already provided
      if (basePlate?.type === 'multi-section') {
        if (!newLabel.sectionId && !selectedBasePlateSectionId) {
          // Wait for section selection
          setWaitingForLabelSectionSelection(true);
          setPendingLabelConfig(newLabel);
          return;
        }
        
        // Use provided sectionId or selected section
        const sectionId = newLabel.sectionId || selectedBasePlateSectionId;
        if (sectionId && basePlate.sections) {
          const section = basePlate.sections.find(s => s.id === sectionId);
          if (section) {
            // Add sectionId to label
            newLabel.sectionId = sectionId;
            
            // Position label at the center-front of the section
            const sectionCenterX = (section.minX + section.maxX) / 2;
            const sectionFrontZ = section.maxZ;
            
            const labelY = baseTopY;
            const labelX = sectionCenterX;
            const labelZ = sectionFrontZ + newLabel.fontSize / 2;
            
            newLabel.position = new THREE.Vector3(labelX, labelY, labelZ);
            newLabel.rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
            
            setLabels(prev => [...prev, newLabel]);
            setSelectedLabelId(newLabel.id);
            
            // Force bounds recalculation after label is added to state
            setTimeout(() => setItemBoundsUpdateTrigger(t => t + 1), 0);
            
            // Clear selected section after label placement
            setSelectedBasePlateSectionId(null);
            
            // Dispatch events
            window.dispatchEvent(new CustomEvent('label-added', { detail: newLabel }));
            window.dispatchEvent(new CustomEvent('label-placed', { 
              detail: { 
                labelId: newLabel.id, 
                sectionId: newLabel.sectionId,
                position: newLabel.position,
                fontSize: newLabel.fontSize,
                text: newLabel.text
              } 
            }));
            
            return;
          }
        }
      }
      
      // Original logic for rectangular/convex-hull baseplates
      // Calculate rectangular bounding box of supports + part
      // Label should be placed at the lower-left boundary (outside)
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      // Include support footprint points in bounds
      for (const support of supports) {
        const footprintPoints = getSupportFootprintPoints(support);
        for (const pt of footprintPoints) {
          minX = Math.min(minX, pt.x);
          maxX = Math.max(maxX, pt.x);
          minZ = Math.min(minZ, pt.z);
          maxZ = Math.max(maxZ, pt.z);
        }
      }
      
      // Include clamp support footprint points in bounds
      for (const placedClamp of placedClamps) {
        const supportInfo = clampSupportInfos.get(placedClamp.id);
        if (!supportInfo) continue;
        
        // Transform polygon from clamp local space to world space
        const rotationY = THREE.MathUtils.degToRad(placedClamp.rotation.y);
        const cosR = Math.cos(rotationY);
        const sinR = Math.sin(rotationY);
        
        for (const [localX, localZ] of supportInfo.polygon) {
          // Apply Y-axis rotation and add clamp position
          const worldX = localX * cosR + localZ * sinR + placedClamp.position.x;
          const worldZ = -localX * sinR + localZ * cosR + placedClamp.position.z;
          minX = Math.min(minX, worldX);
          maxX = Math.max(maxX, worldX);
          minZ = Math.min(minZ, worldZ);
          maxZ = Math.max(maxZ, worldZ);
        }
      }
      
      // Include part bounds if available
      if (modelBounds) {
        const center = modelBounds.center;
        const halfX = modelBounds.size.x / 2;
        const halfZ = modelBounds.size.z / 2;
        minX = Math.min(minX, center.x - halfX);
        maxX = Math.max(maxX, center.x + halfX);
        minZ = Math.min(minZ, center.z - halfZ);
        maxZ = Math.max(maxZ, center.z + halfZ);
      }
      
      // Fallback if no supports or parts
      if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minZ) || !isFinite(maxZ)) {
        minX = -50; maxX = 50;
        minZ = -50; maxZ = 50;
      }
      
      // Use the actual baseplate top Y from the mesh bounding box
      // baseTopY is computed from the actual geometry, accounting for chamfers
      const labelY = baseTopY;
      
      // Estimate label width based on text length and font size
      const estimatedLabelWidth = newLabel.fontSize * newLabel.text.length * 0.6;
      
      // Position label at front-center (centered X, maxZ is front in world coords)
      // No padding - label edge touches the boundary
      const labelX = (minX + maxX) / 2; // Center X
      const labelZ = maxZ + newLabel.fontSize / 2; // Front edge (positive Z)
      
      newLabel.position = new THREE.Vector3(labelX, labelY, labelZ);
      // Rotate to face up (readable from above)
      newLabel.rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
      
      setLabels(prev => [...prev, newLabel]);
      setSelectedLabelId(newLabel.id);
      
      // Notify LabelsStepContent about the label position update
      window.dispatchEvent(new CustomEvent('label-added', { detail: newLabel }));
    };

    const onLabelUpdate = (e: CustomEvent) => {
      const { labelId, updates } = e.detail as { labelId: string; updates: Partial<LabelConfig> };
      setLabels(prev => prev.map(l => l.id === labelId ? { ...l, ...updates } : l));
    };

    const onLabelDelete = (e: CustomEvent) => {
      const labelId = e.detail as string;
      setLabels(prev => prev.filter(l => l.id !== labelId));
      if (selectedLabelId === labelId) {
        setSelectedLabelId(null);
      }
    };

    const onLabelSelect = (e: CustomEvent) => {
      const labelId = e.detail as string | null;
      setSelectedLabelId(labelId);
    };

    const onLabelsClearAll = () => {
      setLabels([]);
      setSelectedLabelId(null);
    };

    window.addEventListener('label-add', onLabelAdd as EventListener);
    window.addEventListener('label-update', onLabelUpdate as EventListener);
    window.addEventListener('label-delete', onLabelDelete as EventListener);
    window.addEventListener('label-select', onLabelSelect as EventListener);
    window.addEventListener('labels-clear-all', onLabelsClearAll);

    return () => {
      window.removeEventListener('label-add', onLabelAdd as EventListener);
      window.removeEventListener('label-update', onLabelUpdate as EventListener);
      window.removeEventListener('label-delete', onLabelDelete as EventListener);
      window.removeEventListener('label-select', onLabelSelect as EventListener);
      window.removeEventListener('labels-clear-all', onLabelsClearAll);
    };
  }, [
    basePlate,
    selectedBasePlateSectionId,
    setSelectedBasePlateSectionId,
    selectedLabelId,
    setLabels,
    setSelectedLabelId,
    setWaitingForLabelSectionSelection,
    setPendingLabelConfig,
    supports,
    placedClamps,
    clampSupportInfos,
    modelBounds,
    baseTopY,
    setItemBoundsUpdateTrigger,
  ]);
}

export default useLabelHandlers;
