import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircleDashed, Circle, Trash2, Move, Crosshair, Maximize2 } from 'lucide-react';
import type { PlacedHole } from '../types';
import * as THREE from 'three';

interface MountingHolesAccordionProps {
  holes: PlacedHole[];
  hasBaseplate?: boolean;
  baseplateDepth?: number; // Baseplate thickness in Y direction (mm)
  onRemoveHole?: (holeId: string) => void;
  onSelectHole?: (holeId: string) => void;
  onUpdateHole?: (hole: PlacedHole) => void;
  selectedHoleId?: string | null;
}

const HOLE_TYPE_LABELS: Record<string, string> = {
  through: 'Through',
  countersink: 'C-Sink',
  counterbore: 'C-Bore',
};

/**
 * MountingHolesAccordion - Properties panel view for mounting holes
 * 
 * This accordion shows the list of placed mounting holes with their configurations.
 * Main controls for hole creation are in DrillStepContent (ContextOptionsPanel).
 */
const MountingHolesAccordion: React.FC<MountingHolesAccordionProps> = ({
  holes,
  hasBaseplate = false,
  baseplateDepth = 20,
  onRemoveHole,
  onSelectHole,
  onUpdateHole,
  selectedHoleId,
}) => {
  const [expandedItem, setExpandedItem] = useState<string>("");
  const holeRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Max counterbore depth is 75% of baseplate depth (industry standard)
  const maxCounterboreDepth = Math.round(baseplateDepth * 0.75 * 10) / 10;

  // Auto-expand newly selected hole and scroll into view
  useEffect(() => {
    if (selectedHoleId) {
      setExpandedItem(selectedHoleId);
      // Scroll the hole item into view with a slight delay for accordion animation
      setTimeout(() => {
        const element = holeRefs.current.get(selectedHoleId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    }
  }, [selectedHoleId]);

  // Handle hole property changes
  const handleHolePropertyChange = useCallback((hole: PlacedHole, property: string, value: number) => {
    if (!onUpdateHole) return;
    
    let updatedHole: PlacedHole;
    
    if (property === 'positionX' || property === 'positionY') {
      const newPosition = new THREE.Vector2(
        property === 'positionX' ? value : Number(hole.position?.x) || 0,
        property === 'positionY' ? value : Number(hole.position?.y) || 0
      );
      updatedHole = { ...hole, position: newPosition };
    } else {
      updatedHole = { ...hole, [property]: value };
    }
    
    onUpdateHole(updatedHole);
    
    // Dispatch event to update 3D scene and trigger CSG recalculation
    window.dispatchEvent(new CustomEvent('hole-updated', { detail: updatedHole }));
  }, [onUpdateHole]);

  // Handle move button click - enters edit mode with gizmo
  const handleMoveHole = useCallback((holeId: string) => {
    onSelectHole?.(holeId);
    window.dispatchEvent(new CustomEvent('hole-edit-request', { detail: holeId }));
  }, [onSelectHole]);

  if (!hasBaseplate) {
    return null;
  }

  return (
    <AccordionItem value="holes" className="border-border/50">
      <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2 flex-1">
          <CircleDashed className="w-3.5 h-3.5 text-primary" />
          Mounting Holes
          <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
            {holes.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 px-1">
        {holes.length === 0 ? (
          <div className="text-[9px] text-muted-foreground italic text-center py-3">
            No mounting holes placed yet.
            <br />
            Use the Mounting Holes step to add holes.
          </div>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={expandedItem}
            onValueChange={(value) => {
              setExpandedItem(value);
              // Select the hole when expanding
              if (value) {
                onSelectHole?.(value);
                // Dispatch event to select this hole in 3D view
                window.dispatchEvent(new CustomEvent('hole-select-request', { detail: value }));
              }
            }}
            className="space-y-1"
          >
            {holes.map((hole, index) => (
              <AccordionItem 
                key={hole.id} 
                value={hole.id}
                ref={(el: HTMLDivElement | null) => holeRefs.current.set(hole.id, el)}
                className={`
                  border rounded-md transition-all
                  ${selectedHoleId === hole.id 
                    ? 'border-primary bg-primary/10 ring-1 ring-primary/30' 
                    : expandedItem === hole.id 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border/30'
                  }
                `}
              >
                <AccordionTrigger 
                  className="py-1.5 px-2 text-xs font-tech hover:no-underline"
                  onClick={() => {
                    onSelectHole?.(hole.id);
                    window.dispatchEvent(new CustomEvent('hole-select-request', { detail: hole.id }));
                  }}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-5 h-5 rounded bg-muted/50 flex items-center justify-center text-[10px] font-tech">
                      {index + 1}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Circle className="w-3 h-3" />
                      <span className="text-[10px]">{HOLE_TYPE_LABELS[hole.type] || hole.type}</span>
                    </div>
                    <span className="text-[8px] text-muted-foreground ml-auto mr-2">
                      Ø{(Number(hole.diameter) || 6).toFixed(0)}mm
                    </span>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleMoveHole(hole.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          e.preventDefault();
                          handleMoveHole(hole.id);
                        }
                      }}
                      className="w-6 h-6 p-0 flex items-center justify-center rounded hover:bg-primary/10 cursor-pointer"
                      title="Move hole (or double-click in 3D view)"
                    >
                      <Move className="w-3 h-3 text-muted-foreground hover:text-primary" />
                    </div>
                    {onRemoveHole && (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onRemoveHole(hole.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onRemoveHole(hole.id);
                          }
                        }}
                        className="w-6 h-6 p-0 flex items-center justify-center rounded hover:bg-destructive/10 cursor-pointer"
                        title="Delete hole"
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-2 pb-2">
                  <div className="space-y-3">
                    {/* Position */}
                    <div className="space-y-2">
                      <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
                        <Crosshair className="w-2.5 h-2.5" />
                        Position (mm)
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[8px] text-red-500 font-mono">X</Label>
                          <Input
                            type="number"
                            value={(Number(hole.position?.x) || 0).toFixed(1)}
                            onChange={(e) => handleHolePropertyChange(hole, 'positionX', parseFloat(e.target.value) || 0)}
                            className="h-6 !text-[10px] font-mono"
                            step="0.5"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[8px] text-green-500 font-mono">Y</Label>
                          <Input
                            type="number"
                            value={(Number(hole.position?.y) || 0).toFixed(1)}
                            onChange={(e) => handleHolePropertyChange(hole, 'positionY', parseFloat(e.target.value) || 0)}
                            className="h-6 !text-[10px] font-mono"
                            step="0.5"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Diameter */}
                    <div className="space-y-2">
                      <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
                        <Circle className="w-2.5 h-2.5" />
                        Diameter (mm)
                      </Label>
                      <Input
                        type="number"
                        value={(Number(hole.diameter) || 6).toFixed(1)}
                        onChange={(e) => handleHolePropertyChange(hole, 'diameter', parseFloat(e.target.value) || 6)}
                        className="h-6 !text-[10px] font-mono"
                        step="0.5"
                        min="0.5"
                      />
                    </div>

                    {/* Depth */}
                    <div className="space-y-2">
                      <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
                        <Maximize2 className="w-2.5 h-2.5" />
                        Depth (mm)
                      </Label>
                      <Input
                        type="number"
                        value={(Number(hole.depth) || 20).toFixed(1)}
                        onChange={(e) => handleHolePropertyChange(hole, 'depth', parseFloat(e.target.value) || 20)}
                        className="h-6 !text-[10px] font-mono"
                        step="0.5"
                        min="1"
                      />
                    </div>

                    {/* Countersink specific */}
                    {hole.type === 'countersink' && (
                      <>
                        <div className="space-y-2">
                          <Label className="text-[8px] font-tech text-muted-foreground">
                            Countersink Diameter (mm)
                          </Label>
                          <Input
                            type="number"
                            value={(Number(hole.countersinkDiameter) || (Number(hole.diameter) || 6) * 2).toFixed(1)}
                            onChange={(e) => handleHolePropertyChange(hole, 'countersinkDiameter', parseFloat(e.target.value))}
                            className="h-6 !text-[10px] font-mono"
                            step="0.5"
                            min={Number(hole.diameter) || 6}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[8px] font-tech text-muted-foreground">
                            Countersink Angle (°)
                          </Label>
                          <Input
                            type="number"
                            value={Number(hole.countersinkAngle) || 90}
                            onChange={(e) => handleHolePropertyChange(hole, 'countersinkAngle', parseFloat(e.target.value))}
                            className="h-6 !text-[10px] font-mono"
                            step="1"
                            min="60"
                            max="120"
                          />
                        </div>
                      </>
                    )}

                    {/* Counterbore specific */}
                    {hole.type === 'counterbore' && (
                      <>
                        <div className="space-y-2">
                          <Label className="text-[8px] font-tech text-muted-foreground">
                            Counterbore Diameter (mm)
                          </Label>
                          <Input
                            type="number"
                            value={(Number(hole.counterboreDiameter) || (Number(hole.diameter) || 6) * 1.8).toFixed(1)}
                            onChange={(e) => handleHolePropertyChange(hole, 'counterboreDiameter', parseFloat(e.target.value))}
                            className="h-6 !text-[10px] font-mono"
                            step="0.5"
                            min={Number(hole.diameter) || 6}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[8px] font-tech text-muted-foreground">
                            Counterbore Depth (mm) <span className="text-muted-foreground/70">max {maxCounterboreDepth}</span>
                          </Label>
                          <Input
                            type="number"
                            value={Math.min(Number(hole.counterboreDepth) || 5, maxCounterboreDepth).toFixed(1)}
                            onChange={(e) => {
                              const value = Math.min(parseFloat(e.target.value) || 1, maxCounterboreDepth);
                              handleHolePropertyChange(hole, 'counterboreDepth', value);
                            }}
                            className="h-6 !text-[10px] font-mono"
                            step="0.5"
                            min="1"
                            max={maxCounterboreDepth}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        {/* Summary */}
        {holes.length > 0 && (
          <div className="text-[9px] text-muted-foreground bg-muted/30 rounded p-2 mt-2">
            <div className="grid grid-cols-3 gap-1 text-center">
              <div>
                <span className="block font-mono text-foreground">
                  {holes.filter(h => h.type === 'through').length}
                </span>
                <span>Through</span>
              </div>
              <div>
                <span className="block font-mono text-foreground">
                  {holes.filter(h => h.type === 'countersink').length}
                </span>
                <span>C-Sink</span>
              </div>
              <div>
                <span className="block font-mono text-foreground">
                  {holes.filter(h => h.type === 'counterbore').length}
                </span>
                <span>C-Bore</span>
              </div>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};

export default MountingHolesAccordion;
