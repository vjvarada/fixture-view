/**
 * SupportsRenderer - Renders support meshes and their transform controls
 * Extracted from 3DScene.tsx for modularity
 */
import React from 'react';
import * as THREE from 'three';
import SupportMesh from '@/features/supports/components/SupportMeshes';
import SupportTransformControls from '@/features/supports/components/SupportTransformControls';
import type { AnySupport } from '@/features/supports/types';
import type { BasePlateConfig } from '@/features/baseplate/types';

export interface SupportsRendererProps {
  /** Array of supports to render */
  supports: AnySupport[];
  /** ID of the currently selected support */
  selectedSupportId: string | null;
  /** Whether merged fixture mesh is shown (hides supports) */
  mergedFixtureMesh: THREE.Mesh | null;
  /** Preview meshes for supports trim operation */
  supportsTrimPreview: THREE.Mesh[];
  /** Map of support IDs to modified geometries (from CSG cavity cuts) */
  modifiedSupportGeometries: Map<string, THREE.BufferGeometry>;
  /** Y position of the baseplate top surface */
  baseTopY: number;
  /** Whether support placing mode is active */
  placingActive: boolean;
  /** Baseplate config for CSG trigger check */
  basePlate: BasePlateConfig | null;
  /** Number of mounting holes for CSG trigger check */
  mountingHolesCount: number;
  /** Callback when a support is selected */
  onSupportSelect: ((id: string | null) => void) | undefined;
  /** Callback to update supports array */
  setSupports: React.Dispatch<React.SetStateAction<AnySupport[]>>;
  /** Callback when support drag starts */
  onDragStart: () => void;
  /** Callback when support drag ends */
  onDragEnd: () => void;
  /** Callback to trigger hole CSG recalculation */
  triggerHoleCSG: () => void;
  /** Whether cavity has been applied - prevents transform control activation */
  isCavityApplied?: boolean;
}

/**
 * Renders all support meshes and transform controls for the selected support
 */
export const SupportsRenderer: React.FC<SupportsRendererProps> = ({
  supports,
  selectedSupportId,
  mergedFixtureMesh,
  supportsTrimPreview,
  modifiedSupportGeometries,
  baseTopY,
  placingActive,
  basePlate,
  mountingHolesCount,
  onSupportSelect,
  setSupports,
  onDragStart,
  onDragEnd,
  triggerHoleCSG,
  isCavityApplied = false,
}) => {
  const selectedSupport = selectedSupportId ? supports.find(s => s.id === selectedSupportId) : null;

  // When cavity is applied, don't allow support selection/transform
  const handleSupportDoubleClick = (supportId: string) => {
    if (isCavityApplied) {
      // Cavity applied - show message instead of selecting
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          title: 'Cavity Applied',
          description: 'Reset the cavity first to modify supports.',
          variant: 'warning'
        }
      }));
      return;
    }
    // Notify part gizmos to close
    window.dispatchEvent(new CustomEvent('pivot-control-activated', { detail: { supportId } }));
    onSupportSelect?.(supportId);
  };

  return (
    <>
      {/* Supports rendering - hide when merged fixture is shown */}
      {!mergedFixtureMesh && supportsTrimPreview.length === 0
        ? (() => {
            // Render individual supports (with modified geometry if CSG-cut)
            return supports.map((s) => {
              // Check if this support has a modified geometry (from individual cavity subtraction)
              const modifiedGeometry = modifiedSupportGeometries.get(s.id);
            
              if (modifiedGeometry) {
                // Render the modified geometry - it's already in world space from the CSG operation
                // Use amber/orange color to indicate the support has been cut
                const isSelected = selectedSupportId === s.id && !isCavityApplied;
                const cutSupportColor = 0xf59e0b; // Amber-500 - indicates support has been cut
                const cutSupportSelectedColor = 0xfbbf24; // Amber-400 - lighter when selected
              
                return (
                  <mesh
                    key={s.id}
                    geometry={modifiedGeometry}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleSupportDoubleClick(s.id);
                    }}
                  >
                    <meshStandardMaterial 
                      color={isSelected ? cutSupportSelectedColor : cutSupportColor}
                      metalness={0.0}
                      roughness={0.6}
                      emissive={isSelected ? cutSupportSelectedColor : cutSupportColor}
                      emissiveIntensity={isSelected ? 0.25 : 0.1}
                    />
                  </mesh>
                );
              }
            
              // Render standard support mesh
              return (
                <SupportMesh 
                  key={s.id} 
                  support={s} 
                  baseTopY={baseTopY}
                  selected={selectedSupportId === s.id && !isCavityApplied}
                  onDoubleClick={handleSupportDoubleClick}
                />
              );
            });
          })()
        : supportsTrimPreview.map((mesh, idx) => <primitive key={`${mesh.uuid}-${idx}`} object={mesh} />)}
      
      {/* Support transform controls - XY plane only, disabled when cavity is applied */}
      {selectedSupport && !placingActive && !isCavityApplied && (
        <SupportTransformControls
          support={selectedSupport}
          baseTopY={baseTopY}
          onDragStart={onDragStart}
          onDragEnd={() => {
            onDragEnd();
            // Trigger CSG after support drag ends if we have holes
            if (basePlate?.type === 'multi-section' && mountingHolesCount > 0) {
              console.log('[SupportTransformControls] Drag ended, triggering CSG');
              triggerHoleCSG();
            }
          }}
          onTransformChange={(newCenter, rotationY, height) => {
            // Live update support position, rotation, and height
            setSupports(prev => {
              return prev.map(s => {
                if (s.id === selectedSupportId) {
                  const updates: Partial<AnySupport> = { center: newCenter };
                  if (rotationY !== undefined) {
                    (updates as any).rotationY = rotationY;
                  }
                  if (height !== undefined) {
                    (updates as any).height = height;
                  }
                  return { ...s, ...updates } as AnySupport;
                }
                return s;
              });
            });
          }}
          onTransformEnd={(newCenter, rotationY, height) => {
            // Dispatch event for AppShell to update its state
            const updatedSupport = supports.find(s => s.id === selectedSupportId);
            if (updatedSupport) {
              const finalSupport: any = { ...updatedSupport, center: newCenter };
              if (rotationY !== undefined) {
                finalSupport.rotationY = rotationY;
              }
              if (height !== undefined) {
                finalSupport.height = height;
              }
              window.dispatchEvent(new CustomEvent('support-updated', { detail: finalSupport }));
            }
          }}
          onDeselect={() => {
            onSupportSelect?.(null);
          }}
        />
      )}
    </>
  );
};

export default SupportsRenderer;
