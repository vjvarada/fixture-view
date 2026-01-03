/**
 * useLabelState - Hook for managing label placement and state
 * Extracted from 3DScene.tsx for modularity
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import type { LabelConfig } from '@/features/labels';

export interface UseLabelStateReturn {
  // State
  labels: LabelConfig[];
  selectedLabelId: string | null;
  waitingForLabelSectionSelection: boolean;
  pendingLabelConfig: LabelConfig | null;
  
  // Setters
  setLabels: React.Dispatch<React.SetStateAction<LabelConfig[]>>;
  setSelectedLabelId: React.Dispatch<React.SetStateAction<string | null>>;
  setWaitingForLabelSectionSelection: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingLabelConfig: React.Dispatch<React.SetStateAction<LabelConfig | null>>;
  
  // Refs
  labelsRef: React.MutableRefObject<LabelConfig[]>;
  isDraggingLabelRef: React.MutableRefObject<boolean>;
  
  // Computed
  labelHullPoints: Array<{ x: number; z: number }>;
}

// Constants for label footprint margin
const LABEL_MARGIN = 2.0;

/**
 * Hook to manage all label-related state in 3DScene
 */
export function useLabelState(): UseLabelStateReturn {
  // Labels state
  const [labels, setLabels] = useState<LabelConfig[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  
  // Section selection waiting state
  const [waitingForLabelSectionSelection, setWaitingForLabelSectionSelection] = useState(false);
  const [pendingLabelConfig, setPendingLabelConfig] = useState<LabelConfig | null>(null);
  
  // Refs
  const labelsRef = useRef<LabelConfig[]>([]);
  const isDraggingLabelRef = useRef(false);
  
  // Keep labelsRef in sync with labels state
  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);
  
  // Calculate label footprint points for baseplate expansion
  const prevLabelHullPointsRef = useRef<Array<{ x: number; z: number }>>([]);
  const labelHullPoints = useMemo(() => {
    const points: Array<{ x: number; z: number }> = [];
    
    for (const label of labels) {
      // Use actual computed bounds from rendered geometry if available
      let textWidth: number;
      let textHeight: number;
      
      if (label.computedWidth !== undefined && label.computedHeight !== undefined) {
        textWidth = label.computedWidth;
        textHeight = label.computedHeight;
      } else {
        // Fallback: estimate from font size and text length
        const fontSize = label.fontSize || 8;
        const charWidth = fontSize * 0.6;
        textWidth = label.text.length * charWidth;
        textHeight = fontSize;
      }
      
      // Calculate 4 corners of the label bounding box on XZ plane
      const halfWidth = (textWidth / 2) + LABEL_MARGIN;
      const halfDepth = (textHeight / 2) + LABEL_MARGIN;
      
      // Get rotation angle - label.rotation can be a number or an object
      const rot = label.rotation;
      const rotationAngle = typeof rot === 'object' ? ((rot as any).z || 0) : (typeof rot === 'number' ? rot : 0);
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);
      
      // Four corners before rotation
      const corners = [
        { x: -halfWidth, z: -halfDepth },
        { x: halfWidth, z: -halfDepth },
        { x: halfWidth, z: halfDepth },
        { x: -halfWidth, z: halfDepth },
      ];
      
      // Rotate and translate corners
      for (const corner of corners) {
        const rotX = corner.x * cos - corner.z * sin;
        const rotZ = corner.x * sin + corner.z * cos;
        points.push({
          x: label.position.x + rotX,
          z: label.position.z + rotZ,
        });
      }
    }
    
    // Check if points are the same as before
    const prev = prevLabelHullPointsRef.current;
    if (prev.length === points.length) {
      let same = true;
      for (let i = 0; i < points.length && same; i++) {
        if (Math.abs(prev[i].x - points[i].x) > 0.001 || Math.abs(prev[i].z - points[i].z) > 0.001) {
          same = false;
        }
      }
      if (same) return prev;
    }
    
    prevLabelHullPointsRef.current = points;
    return points;
  }, [labels]);

  return {
    // State
    labels,
    selectedLabelId,
    waitingForLabelSectionSelection,
    pendingLabelConfig,
    
    // Setters
    setLabels,
    setSelectedLabelId,
    setWaitingForLabelSectionSelection,
    setPendingLabelConfig,
    
    // Refs
    labelsRef,
    isDraggingLabelRef,
    
    // Computed
    labelHullPoints,
  };
}
