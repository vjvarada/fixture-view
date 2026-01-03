/**
 * LabelsRenderer - Renders label meshes and their transform controls
 * Extracted from 3DScene.tsx for modularity
 */
import React, { Suspense } from 'react';
import * as THREE from 'three';
import LabelMesh from '@/features/labels/components/LabelMesh';
import LabelTransformControls from '@/features/labels/components/LabelTransformControls';
import type { LabelConfig } from '@/features/labels/types';
import type { BasePlateConfig } from '@/features/baseplate/types';

export interface LabelsRendererProps {
  /** Array of labels to render */
  labels: LabelConfig[];
  /** ID of the currently selected label */
  selectedLabelId: string | null;
  /** Whether merged fixture mesh is shown (hides labels) */
  mergedFixtureMesh: THREE.Mesh | null;
  /** Baseplate config for CSG trigger check */
  basePlate: BasePlateConfig | null;
  /** Number of mounting holes for CSG trigger check */
  mountingHolesCount: number;
  /** Callback to update selected label ID */
  setSelectedLabelId: (id: string | null) => void;
  /** Callback to update labels array */
  setLabels: React.Dispatch<React.SetStateAction<LabelConfig[]>>;
  /** Callback when label drag starts */
  onDragStart: () => void;
  /** Callback when label drag ends */
  onDragEnd: () => void;
  /** Callback to trigger hole CSG recalculation */
  triggerHoleCSG: () => void;
}

/**
 * Renders all label meshes and transform controls for the selected label
 */
export const LabelsRenderer: React.FC<LabelsRendererProps> = ({
  labels,
  selectedLabelId,
  mergedFixtureMesh,
  basePlate,
  mountingHolesCount,
  setSelectedLabelId,
  setLabels,
  onDragStart,
  onDragEnd,
  triggerHoleCSG,
}) => {
  // Don't render if merged fixture is shown
  if (mergedFixtureMesh) return null;

  const selectedLabel = selectedLabelId ? labels.find(l => l.id === selectedLabelId) : null;

  return (
    <>
      {/* Labels rendering */}
      <Suspense fallback={null}>
        {labels.map((label) => (
          <LabelMesh
            key={label.id}
            label={label}
            selected={selectedLabelId === label.id}
            onSelect={(id) => {
              setSelectedLabelId(id);
              window.dispatchEvent(new CustomEvent('label-selected', { detail: id }));
            }}
            onDoubleClick={(id) => {
              // Activate pivot controls for this label
              window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { labelId: id } }));
              setSelectedLabelId(id);
              window.dispatchEvent(new CustomEvent('label-selected', { detail: id }));
            }}
            onBoundsComputed={(id, width, height) => {
              // Update label with computed bounds from actual geometry
              setLabels(prev => prev.map(l => 
                l.id === id ? { ...l, computedWidth: width, computedHeight: height } : l
              ));
            }}
          />
        ))}
      </Suspense>

      {/* Label transform controls - activated on double-click */}
      {selectedLabel && (
        <LabelTransformControls
          label={selectedLabel}
          onDragStart={onDragStart}
          onDragEnd={() => {
            onDragEnd();
            // Trigger CSG after label drag ends if we have holes
            if (basePlate?.type === 'multi-section' && mountingHolesCount > 0) {
              triggerHoleCSG();
            }
          }}
          onTransformChange={(position, rotation, depth) => {
            // Live update label position, rotation, and depth
            setLabels(prev => prev.map(l => {
              if (l.id === selectedLabelId) {
                return {
                  ...l,
                  position,
                  rotation,
                  depth: depth ?? l.depth,
                };
              }
              return l;
            }));
            // Also dispatch event for AppShell to update Properties panel live
            const updates = { position, rotation, depth: depth ?? selectedLabel.depth };
            window.dispatchEvent(new CustomEvent('label-update', { 
              detail: { labelId: selectedLabelId, updates } 
            }));
          }}
          onTransformEnd={(position, rotation, depth) => {
            // Dispatch event for AppShell to update its state
            const finalLabel = labels.find(l => l.id === selectedLabelId);
            if (finalLabel) {
              const updates = { position, rotation, depth: depth ?? finalLabel.depth };
              window.dispatchEvent(new CustomEvent('label-update', { 
                detail: { labelId: selectedLabelId, updates } 
              }));
            }
          }}
          onDeselect={() => {
            setSelectedLabelId(null);
            window.dispatchEvent(new CustomEvent('label-selected', { detail: null }));
          }}
        />
      )}
    </>
  );
};

export default LabelsRenderer;
