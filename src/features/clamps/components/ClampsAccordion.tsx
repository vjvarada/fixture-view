/**
 * ClampsAccordion
 *
 * Accordion component for the Properties panel displaying placed clamps
 * with editing and deletion capabilities.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pin, Trash2, Crosshair, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { PlacedClamp } from '../types';
import { getClampById } from '../utils/clampData';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ClampsAccordionProps {
  clamps: PlacedClamp[];
  selectedClampId: string | null;
  onClampSelect: (id: string | null) => void;
  onClampUpdate: (id: string, updates: Partial<PlacedClamp>) => void;
  onClampDelete: (id: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface ClampPropertiesProps {
  clamp: PlacedClamp;
  onUpdate: (updates: Partial<PlacedClamp>) => void;
}

/** Renders editable properties for a single clamp */
const ClampProperties: React.FC<ClampPropertiesProps> = ({ clamp, onUpdate }) => {
  // Rotation is stored in degrees, no conversion needed
  const handlePositionChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: number) => {
      onUpdate({
        position: {
          ...clamp.position,
          [axis]: value,
        },
      });
    },
    [clamp.position, onUpdate]
  );

  // Only allow Y-axis rotation (rotation via green gizmo, like supports)
  const handleRotationChange = useCallback(
    (degrees: number) => {
      onUpdate({
        rotation: {
          x: 0, // Lock X rotation
          y: degrees, // Only Y rotation allowed (green gizmo)
          z: 0, // Lock Z rotation
        },
      });
    },
    [onUpdate]
  );

  return (
    <div className="space-y-3">
      {/* Position */}
      <div className="space-y-2">
        <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
          <Crosshair className="w-2.5 h-2.5" />
          Position (mm)
        </Label>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[8px] text-red-500 font-mono">X</Label>
            <Input
              type="number"
              value={clamp.position.x.toFixed(1)}
              onChange={(e) => handlePositionChange('x', parseFloat(e.target.value) || 0)}
              className="h-6 !text-[10px] font-mono"
              step="0.5"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[8px] text-blue-500 font-mono">Y</Label>
            <Input
              type="number"
              value={clamp.position.z.toFixed(1)}
              onChange={(e) => handlePositionChange('z', parseFloat(e.target.value) || 0)}
              className="h-6 !text-[10px] font-mono"
              step="0.5"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[8px] text-green-500 font-mono">Z</Label>
            <Input
              type="number"
              value={clamp.position.y.toFixed(1)}
              onChange={(e) => handlePositionChange('y', parseFloat(e.target.value) || 0)}
              className="h-6 !text-[10px] font-mono"
              step="0.5"
            />
          </div>
        </div>
      </div>

      {/* Rotation - only Y axis (green gizmo, like supports) */}
      <div className="space-y-2">
        <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
          <RotateCcw className="w-2.5 h-2.5" />
          Rotation (°)
        </Label>
        <div className="space-y-1">
          <Label className="text-[8px] text-green-500 font-mono">Y</Label>
          <Input
            type="number"
            value={clamp.rotation.y.toFixed(1)}
            onChange={(e) => handleRotationChange(parseFloat(e.target.value) || 0)}
            className="h-6 !text-[10px] font-mono"
            step="5"
          />
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const ClampsAccordion: React.FC<ClampsAccordionProps> = ({
  clamps,
  selectedClampId,
  onClampSelect,
  onClampUpdate,
  onClampDelete,
}) => {
  const [expandedItem, setExpandedItem] = useState<string>('');
  const clampRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  // Handle image load errors
  const handleImageError = useCallback((clampId: string) => {
    setImageErrors(prev => new Set(prev).add(clampId));
  }, []);

  // Auto-expand newly selected clamp and scroll into view
  useEffect(() => {
    if (selectedClampId) {
      setExpandedItem(selectedClampId);
      // Scroll the clamp item into view with a slight delay for accordion animation
      setTimeout(() => {
        const element = clampRefs.current.get(selectedClampId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    }
  }, [selectedClampId]);

  // Handle clamp update with event dispatch
  const handleClampUpdate = useCallback(
    (id: string, updates: Partial<PlacedClamp>) => {
      onClampUpdate(id, updates);
      // Dispatch update event for 3D scene
      window.dispatchEvent(
        new CustomEvent('clamp-update', {
          detail: { clampId: id, updates },
        })
      );
    },
    [onClampUpdate]
  );

  // Handle clamp delete with event dispatch
  const handleClampDelete = useCallback(
    (id: string) => {
      onClampDelete(id);
      // Dispatch delete event for 3D scene
      window.dispatchEvent(new CustomEvent('clamp-delete', { detail: id }));
    },
    [onClampDelete]
  );

  // Handle clamp selection with event dispatch
  const handleClampSelect = useCallback(
    (id: string | null) => {
      onClampSelect(id);
      // Dispatch select event for 3D scene
      window.dispatchEvent(new CustomEvent('clamp-select', { detail: id }));
    },
    [onClampSelect]
  );

  // Get display name for a clamp
  const getClampDisplayName = (clamp: PlacedClamp, index: number): string => {
    const clampModel = getClampById(clamp.clampModelId);
    return clampModel?.name || `Clamp ${index + 1}`;
  };

  // Empty state
  if (clamps.length === 0) {
    return (
      <AccordionItem value="clamps" className="border-border/50">
        <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
          <div className="flex items-center gap-2 flex-1">
            <Pin className="w-3.5 h-3.5 text-primary" />
            Clamps
            <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
              0
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 px-1">
          <div className="text-[10px] text-muted-foreground font-tech text-center py-4">
            No clamps placed yet.
            <br />
            Use the Clamps step in the workflow panel to add clamps.
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <AccordionItem value="clamps" className="border-border/50">
      <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2 flex-1">
          <Pin className="w-3.5 h-3.5 text-primary" />
          Clamps
          <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
            {clamps.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 px-1">
        <Accordion
          type="single"
          collapsible
          value={expandedItem}
          onValueChange={(val) => {
            setExpandedItem(val);
            handleClampSelect(val || null);
          }}
          className="space-y-1"
        >
          {clamps.map((clamp, index) => {
            const isSelected = selectedClampId === clamp.id;
            const displayName = getClampDisplayName(clamp, index);
            const clampModel = getClampById(clamp.clampModelId);

            return (
              <div
                key={clamp.id}
                ref={(el) => clampRefs.current.set(clamp.id, el)}
              >
                <AccordionItem
                  value={clamp.id}
                  className={`border rounded-md transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border/50 hover:border-border'
                  }`}
                >
                  <AccordionTrigger className="py-1.5 px-2 hover:no-underline">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-6 h-6 rounded bg-muted/50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {clampModel?.imagePath && !imageErrors.has(clamp.id) ? (
                          <img 
                            src={clampModel.imagePath} 
                            alt={displayName}
                            className="w-full h-full object-cover"
                            onError={() => handleImageError(clamp.id)}
                          />
                        ) : (
                          <Pin className="w-3 h-3 text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[10px] font-tech font-medium truncate">
                          {displayName}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {clampModel?.info.force && (
                            <p className="text-[8px] text-muted-foreground font-tech">
                              Force: {clampModel.info.force}
                            </p>
                          )}
                          {clampModel?.info.feature && (
                            <Badge variant="outline" className="text-[7px] h-3 px-1 font-tech">
                              {clampModel.info.feature}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Visibility toggle */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const currentlyVisible = clamp.visible !== false; // default to visible
                          handleClampUpdate(clamp.id, { visible: !currentlyVisible });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            const currentlyVisible = clamp.visible !== false;
                            handleClampUpdate(clamp.id, { visible: !currentlyVisible });
                          }
                        }}
                        className={`w-6 h-6 p-0 flex items-center justify-center rounded cursor-pointer transition-colors ${
                          clamp.visible === false
                            ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            : 'text-foreground hover:bg-muted'
                        }`}
                        title={clamp.visible === false ? "Show clamp" : "Hide clamp"}
                      >
                        {clamp.visible === false ? (
                          <EyeOff className="w-3 h-3" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                      </div>
                      {/* Delete button */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleClampDelete(clamp.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            handleClampDelete(clamp.id);
                          }
                        }}
                        className="w-6 h-6 p-0 flex items-center justify-center rounded hover:bg-destructive/10 cursor-pointer"
                        title="Delete clamp"
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-2 pb-2">
                    <ClampProperties
                      clamp={clamp}
                      onUpdate={(updates) => handleClampUpdate(clamp.id, updates)}
                    />
                  </AccordionContent>
                </AccordionItem>
              </div>
            );
          })}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
};

export default ClampsAccordion;
