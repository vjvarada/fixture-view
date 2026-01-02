/**
 * PartPropertiesAccordion
 *
 * Main properties panel showing all imported parts, baseplate,
 * supports, clamps, labels, and cavity settings.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Cog } from 'lucide-react';
import { ProcessedFile } from '@/modules/FileImport/types';
import { SupportsAccordion, AnySupport } from '@/features/supports';
import { BaseplateAccordion } from '@/features/baseplate';
import { CavityAccordion } from '@/features/cavity';
import { LabelsAccordion, LabelConfig } from '@/features/labels';
import { ClampsAccordion, PlacedClamp } from '@/features/clamps';
import PartItemAccordion from './PartItemAccordion';
import { MountingHolesAccordion, PlacedHole } from '@/features/holes';
import { CavitySettings, DEFAULT_CAVITY_SETTINGS } from '@rapidtool/cad-core';
import {
  Transform3D,
  DEFAULT_TRANSFORM,
  radToDeg,
  degToRad,
  cadToThreeAxis,
  toCadPosition,
  toCadRotation,
  dispatchTransformChange,
  requestPartTransform,
  dispatchSetToBaseplate,
} from '@/lib/transformUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PartPropertiesAccordionProps {
  hasModel: boolean;
  currentFile?: ProcessedFile | null;
  importedParts?: ProcessedFile[];
  selectedPartId?: string | null;
  onPartSelect?: (partId: string | null) => void;
  onRemovePart?: (partId: string) => void;
  onClearFile?: () => void;
  baseplate?: { id: string; type: string; padding?: number; height?: number; depth?: number; sections?: Array<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }> } | null;
  onRemoveBaseplate?: () => void;
  onUpdateBaseplate?: (updates: { padding?: number; height?: number }) => void;
  onRemoveBaseplateSection?: (sectionId: string) => void;
  onUpdateBaseplateSection?: (sectionId: string, updates: { minX?: number; maxX?: number; minZ?: number; maxZ?: number }) => void;
  onSelectBaseplateSection?: (sectionId: string | null) => void;
  onAddBaseplateSection?: () => void;
  selectedBasePlateSectionId?: string | null;
  supports?: AnySupport[];
  selectedSupportId?: string | null;
  onSupportSelect?: (id: string | null) => void;
  onSupportUpdate?: (support: AnySupport) => void;
  onSupportDelete?: (id: string) => void;
  modelColor?: string;
  modelColors?: Map<string, string>;
  partVisibility?: Map<string, boolean>;
  onPartVisibilityChange?: (partId: string, visible: boolean) => void;
  baseplateVisible?: boolean;
  onBaseplateVisibilityChange?: (visible: boolean) => void;
  cavitySettings?: CavitySettings;
  isCavityProcessing?: boolean;
  hasCavityPreview?: boolean;
  labels?: LabelConfig[];
  selectedLabelId?: string | null;
  onLabelSelect?: (id: string | null) => void;
  onLabelUpdate?: (id: string, updates: Partial<LabelConfig>) => void;
  onLabelDelete?: (id: string) => void;
  clamps?: PlacedClamp[];
  selectedClampId?: string | null;
  onClampSelect?: (id: string | null) => void;
  onClampUpdate?: (id: string, updates: Partial<PlacedClamp>) => void;
  onClampDelete?: (id: string) => void;
  // Mounting holes
  holes?: PlacedHole[];
  selectedHoleId?: string | null;
  onHoleSelect?: (id: string | null) => void;
  onHoleUpdate?: (hole: PlacedHole) => void;
  onHoleDelete?: (id: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Manages transform state for all parts */
function usePartTransforms(parts: ProcessedFile[]) {
  const [transforms, setTransforms] = useState<Map<string, Transform3D>>(new Map());
  const initializedRef = useRef<Set<string>>(new Set());

  // Handle transform updates from 3D scene
  useEffect(() => {
    const handleTransformUpdate = (e: CustomEvent) => {
      const { position, rotation, partId } = e.detail;
      if (!partId || !position) return;

      const newTransform: Transform3D = {
        position: {
          x: parseFloat(position.x.toFixed(2)),
          y: parseFloat(position.y.toFixed(2)),
          z: parseFloat(position.z.toFixed(2)),
        },
        rotation: {
          x: parseFloat(radToDeg(rotation?.x || 0).toFixed(1)),
          y: parseFloat(radToDeg(rotation?.y || 0).toFixed(1)),
          z: parseFloat(radToDeg(rotation?.z || 0).toFixed(1)),
        },
      };

      setTransforms((prev) => new Map(prev).set(partId, newTransform));
    };

    window.addEventListener(
      'model-transform-updated',
      handleTransformUpdate as EventListener
    );
    return () => {
      window.removeEventListener(
        'model-transform-updated',
        handleTransformUpdate as EventListener
      );
    };
  }, []);

  // Request transforms for new parts
  useEffect(() => {
    const currentIds = new Set(parts.map((p) => p.id));

    // Initialize new parts
    parts.forEach((part) => {
      if (!initializedRef.current.has(part.id)) {
        initializedRef.current.add(part.id);
        setTimeout(() => requestPartTransform(part.id), 150);
      }
    });

    // Cleanup removed parts
    initializedRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        initializedRef.current.delete(id);
        setTransforms((prev) => {
          const newMap = new Map(prev);
          newMap.delete(id);
          return newMap;
        });
      }
    });
  }, [parts]);

  const getTransform = useCallback(
    (partId: string): Transform3D => transforms.get(partId) || DEFAULT_TRANSFORM,
    [transforms]
  );

  const updateTransform = useCallback(
    (partId: string, newTransform: Transform3D) => {
      setTransforms((prev) => new Map(prev).set(partId, newTransform));
      dispatchTransformChange(partId, newTransform);
    },
    []
  );

  return { getTransform, updateTransform };
}

/** Manages accordion section state - auto-opens based on selected components */
function useAccordionSection(
  selectedPartId: string | null,
  selectedSupportId: string | null,
  selectedClampId: string | null,
  selectedLabelId: string | null,
  selectedHoleId: string | null,
  selectedBasePlateSectionId: string | null
) {
  const [openSection, setOpenSection] = useState<string>('parts');

  // Auto-open accordion based on selection
  useEffect(() => {
    if (selectedPartId) setOpenSection('parts');
  }, [selectedPartId]);

  useEffect(() => {
    if (selectedSupportId) setOpenSection('supports');
  }, [selectedSupportId]);

  useEffect(() => {
    if (selectedClampId) setOpenSection('clamps');
  }, [selectedClampId]);

  useEffect(() => {
    if (selectedLabelId) setOpenSection('labels');
  }, [selectedLabelId]);

  useEffect(() => {
    if (selectedHoleId) setOpenSection('holes');
  }, [selectedHoleId]);

  useEffect(() => {
    if (selectedBasePlateSectionId) setOpenSection('baseplate');
  }, [selectedBasePlateSectionId]);

  // Listen for external navigation events (from WorkflowNavigationContext)
  useEffect(() => {
    const handleAccordionChange = (e: CustomEvent<{ section: string | null }>) => {
      if (e.detail.section) {
        setOpenSection(e.detail.section);
      }
    };

    // Listen for step changes from mini-map navigation
    // The accordion section names now come directly from cad-ui's STEP_TO_ACCORDION
    const handleStepChange = (e: CustomEvent<{ step: string; accordion: string }>) => {
      if (e.detail.accordion) {
        setOpenSection(e.detail.accordion);
      }
    };

    window.addEventListener('workflow-accordion-changed', handleAccordionChange as EventListener);
    window.addEventListener('workflow-step-changed', handleStepChange as EventListener);
    return () => {
      window.removeEventListener('workflow-accordion-changed', handleAccordionChange as EventListener);
      window.removeEventListener('workflow-step-changed', handleStepChange as EventListener);
    };
  }, []);

  return { openSection, setOpenSection };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const PartPropertiesAccordion: React.FC<PartPropertiesAccordionProps> = ({
  hasModel,
  currentFile,
  importedParts = [],
  selectedPartId,
  onPartSelect,
  onRemovePart,
  onClearFile,
  baseplate = null,
  onRemoveBaseplate,
  onUpdateBaseplate,
  onRemoveBaseplateSection,
  onUpdateBaseplateSection,
  onSelectBaseplateSection,
  onAddBaseplateSection,
  selectedBasePlateSectionId = null,
  supports = [],
  selectedSupportId = null,
  onSupportSelect,
  onSupportUpdate,
  onSupportDelete,
  modelColor,
  modelColors = new Map(),
  partVisibility = new Map(),
  onPartVisibilityChange,
  baseplateVisible = true,
  onBaseplateVisibilityChange,
  cavitySettings = DEFAULT_CAVITY_SETTINGS,
  isCavityProcessing = false,
  hasCavityPreview = false,
  labels = [],
  selectedLabelId = null,
  onLabelSelect,
  onLabelUpdate,
  onLabelDelete,
  clamps = [],
  selectedClampId = null,
  onClampSelect,
  onClampUpdate,
  onClampDelete,
  holes = [],
  selectedHoleId = null,
  onHoleSelect,
  onHoleUpdate,
  onHoleDelete,
}) => {
  // Get all parts to display
  const allParts = useMemo(
    () => (importedParts.length > 0 ? importedParts : currentFile ? [currentFile] : []),
    [importedParts, currentFile]
  );

  const { getTransform, updateTransform } = usePartTransforms(allParts);
  const { openSection, setOpenSection } = useAccordionSection(
    selectedPartId ?? null,
    selectedSupportId,
    selectedClampId,
    selectedLabelId,
    selectedHoleId,
    selectedBasePlateSectionId
  );

  // Transform handlers
  const handlePositionChange = useCallback(
    (partId: string, cadAxis: 'x' | 'y' | 'z', value: string) => {
      const numValue = parseFloat(value) || 0;
      const threeAxis = cadToThreeAxis(cadAxis);
      const current = getTransform(partId);
      updateTransform(partId, {
        ...current,
        position: { ...current.position, [threeAxis]: numValue },
      });
    },
    [getTransform, updateTransform]
  );

  const handleRotationChange = useCallback(
    (partId: string, cadAxis: 'x' | 'y' | 'z', value: string) => {
      const numValue = parseFloat(value) || 0;
      const threeAxis = cadToThreeAxis(cadAxis);
      const current = getTransform(partId);
      updateTransform(partId, {
        ...current,
        rotation: { ...current.rotation, [threeAxis]: numValue },
      });
    },
    [getTransform, updateTransform]
  );

  const handleResetPosition = useCallback(
    (partId: string) => {
      const current = getTransform(partId);
      updateTransform(partId, {
        ...current,
        position: { x: 0, y: 0, z: 0 },
      });
    },
    [getTransform, updateTransform]
  );

  const handleResetRotation = useCallback(
    (partId: string) => {
      const current = getTransform(partId);
      updateTransform(partId, {
        ...current,
        rotation: { x: 0, y: 0, z: 0 },
      });
    },
    [getTransform, updateTransform]
  );

  const handleRemovePart = useCallback(
    (partId: string) => {
      if (onRemovePart) {
        onRemovePart(partId);
      } else if (onClearFile) {
        onClearFile();
      }
    },
    [onRemovePart, onClearFile]
  );

  if (!hasModel) {
    return null;
  }

  return (
    <Accordion
      type="single"
      collapsible
      value={openSection}
      onValueChange={(val) => setOpenSection(val ?? '')}
      className="w-full"
    >
      {/* Parts Accordion */}
      {allParts.length > 0 && (
        <AccordionItem value="parts" className="border-border/50">
          <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
            <div className="flex items-center gap-2 flex-1">
              <Cog className="w-3.5 h-3.5 text-primary" />
              Parts
              <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
                {allParts.length}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2">
            <Accordion
              type="single"
              collapsible
              value={selectedPartId ? `part-${selectedPartId}` : ''}
              onValueChange={(val) => {
                const partId = val?.replace('part-', '') || null;
                onPartSelect?.(partId);
              }}
              className="space-y-1"
            >
              {allParts.map((part) => {
                const transform = getTransform(part.id);
                const partColor = modelColors.get(part.metadata.name) || modelColor;
                const isVisible = partVisibility.get(part.id) !== false;

                return (
                  <PartItemAccordion
                    key={part.id}
                    part={part}
                    isSelected={selectedPartId === part.id}
                    cadPosition={toCadPosition(transform.position)}
                    cadRotation={toCadRotation(transform.rotation)}
                    color={partColor}
                    isVisible={isVisible}
                    hasBaseplate={!!baseplate}
                    onPositionChange={handlePositionChange}
                    onRotationChange={handleRotationChange}
                    onResetPosition={handleResetPosition}
                    onResetRotation={handleResetRotation}
                    onSetToBaseplate={dispatchSetToBaseplate}
                    onVisibilityChange={onPartVisibilityChange}
                    onRemove={onRemovePart || onClearFile ? handleRemovePart : undefined}
                  />
                );
              })}
            </Accordion>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Baseplate Accordion */}
      <BaseplateAccordion
        baseplate={baseplate}
        onRemoveBaseplate={onRemoveBaseplate}
        onUpdateBaseplate={onUpdateBaseplate}
        visible={baseplateVisible}
        onVisibilityChange={onBaseplateVisibilityChange}
        onRemoveSection={onRemoveBaseplateSection}
        onUpdateSection={onUpdateBaseplateSection}
        onSelectSection={onSelectBaseplateSection}
        onAddSections={onAddBaseplateSection}
        selectedSectionId={selectedBasePlateSectionId}
      />

      {/* Supports Accordion */}
      <SupportsAccordion
        supports={supports}
        selectedSupportId={selectedSupportId}
        onSupportSelect={onSupportSelect || (() => {})}
        onSupportUpdate={onSupportUpdate || (() => {})}
        onSupportDelete={onSupportDelete || (() => {})}
      />

      {/* Clamps Accordion */}
      <ClampsAccordion
        clamps={clamps}
        selectedClampId={selectedClampId}
        onClampSelect={onClampSelect || (() => {})}
        onClampUpdate={onClampUpdate || (() => {})}
        onClampDelete={onClampDelete || (() => {})}
      />

      {/* Labels Accordion */}
      <LabelsAccordion
        labels={labels}
        selectedLabelId={selectedLabelId}
        onLabelSelect={onLabelSelect || (() => {})}
        onLabelUpdate={onLabelUpdate || (() => {})}
        onLabelDelete={onLabelDelete || (() => {})}
      />

      {/* Mounting Holes Accordion */}
      <MountingHolesAccordion
        holes={holes || []}
        hasBaseplate={!!baseplate}
        baseplateDepth={baseplate?.depth ?? 20}
        selectedHoleId={selectedHoleId}
        onSelectHole={onHoleSelect || (() => {})}
        onUpdateHole={onHoleUpdate || (() => {})}
        onRemoveHole={onHoleDelete || (() => {})}
      />

      {/* Cavity Accordion */}
      <CavityAccordion
        settings={cavitySettings}
        isProcessing={isCavityProcessing}
        hasPreview={hasCavityPreview}
        hasModel={hasModel}
      />
    </Accordion>
  );
};

export default PartPropertiesAccordion;