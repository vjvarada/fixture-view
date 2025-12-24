import React, { useState } from 'react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircleDashed, Circle, Trash2, ChevronDown, ChevronRight, Move } from 'lucide-react';
import { PlacedHole } from '@/components/MountingHoles/types';
import * as THREE from 'three';

interface MountingHolesAccordionProps {
  holes: PlacedHole[];
  hasBaseplate?: boolean;
  onRemoveHole?: (holeId: string) => void;
  onSelectHole?: (holeId: string) => void;
  onUpdateHole?: (hole: PlacedHole) => void;
  selectedHoleId?: string | null;
}

/**
 * MountingHolesAccordion - Properties panel view for mounting holes
 * 
 * This accordion shows the list of placed mounting holes with their configurations.
 * Main controls for hole creation are in DrillStepContent (ContextOptionsPanel).
 */
const MountingHolesAccordion: React.FC<MountingHolesAccordionProps> = ({
  holes,
  hasBaseplate = false,
  onRemoveHole,
  onSelectHole,
  onUpdateHole,
  selectedHoleId,
}) => {
  const [expandedHoleId, setExpandedHoleId] = useState<string | null>(null);

  if (!hasBaseplate) {
    return null;
  }

  const getHoleTypeLabel = (type: PlacedHole['type']) => {
    switch (type) {
      case 'through': return 'Through';
      case 'countersink': return 'C-Sink';
      case 'counterbore': return 'C-Bore';
      default: return type;
    }
  };

  const getHoleDetails = (hole: PlacedHole) => {
    const details: string[] = [];
    
    // Diameter - ensure it's a valid number
    const diameter = Number(hole.diameter);
    if (!isNaN(diameter) && diameter > 0) {
      details.push(`Ø${diameter.toFixed(1)}mm`);
    }
    
    // Depth for through holes
    const depth = Number(hole.depth);
    if (!isNaN(depth) && depth > 0) {
      details.push(`D${depth.toFixed(1)}mm`);
    }
    
    if (hole.type === 'countersink') {
      const csAngle = Number(hole.countersinkAngle);
      const csDiameter = Number(hole.countersinkDiameter);
      if (!isNaN(csAngle) && csAngle > 0) details.push(`${csAngle}°`);
      if (!isNaN(csDiameter) && csDiameter > 0) details.push(`CS Ø${csDiameter.toFixed(1)}mm`);
    } else if (hole.type === 'counterbore') {
      const cbDiameter = Number(hole.counterboreDiameter);
      const cbDepth = Number(hole.counterboreDepth);
      if (!isNaN(cbDiameter) && cbDiameter > 0) details.push(`CB Ø${cbDiameter.toFixed(1)}mm`);
      if (!isNaN(cbDepth) && cbDepth > 0) details.push(`CB D${cbDepth.toFixed(1)}mm`);
    }
    
    // Position
    const posX = Number(hole.position?.x);
    const posY = Number(hole.position?.y);
    if (!isNaN(posX) && !isNaN(posY)) {
      details.push(`@(${posX.toFixed(0)}, ${posY.toFixed(0)})`);
    }
    
    return details.length > 0 ? details.join(' • ') : 'No details';
  };

  const handleHolePropertyChange = (hole: PlacedHole, property: string, value: number) => {
    if (!onUpdateHole) return;
    
    let updatedHole: PlacedHole;
    
    if (property === 'positionX' || property === 'positionZ') {
      const newPosition = new THREE.Vector2(
        property === 'positionX' ? value : Number(hole.position?.x) || 0,
        property === 'positionZ' ? value : Number(hole.position?.y) || 0
      );
      updatedHole = { ...hole, position: newPosition };
    } else {
      updatedHole = { ...hole, [property]: value };
    }
    
    onUpdateHole(updatedHole);
  };

  const handleMoveHole = (holeId: string) => {
    // Select the hole and dispatch event to enter edit mode (show transform controls)
    onSelectHole?.(holeId);
    window.dispatchEvent(new CustomEvent('hole-edit-request', { detail: holeId }));
  };

  return (
    <AccordionItem value="mounting-holes" className="border-border/50">
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
        <div className="space-y-2">
          {holes.length === 0 ? (
            <div className="text-[9px] text-muted-foreground italic text-center py-3">
              No mounting holes placed yet.
              <br />
              Use the Mounting Holes step to add holes.
            </div>
          ) : (
            <div className="space-y-1 max-h-[300px] overflow-auto">
              {holes.map((hole, index) => {
                const isExpanded = expandedHoleId === hole.id;
                const isSelected = selectedHoleId === hole.id;
                
                return (
                  <Card 
                    key={hole.id} 
                    className={`tech-glass transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/10' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    {/* Header row */}
                    <div 
                      className="p-2 cursor-pointer flex items-center gap-2"
                      onClick={() => {
                        onSelectHole?.(hole.id);
                        setExpandedHoleId(isExpanded ? null : hole.id);
                      }}
                    >
                      <button
                        className="p-0 h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedHoleId(isExpanded ? null : hole.id);
                        }}
                      >
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                      <Circle className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-tech truncate">
                            Hole {index + 1}
                          </span>
                          <Badge variant="outline" className="text-[8px] flex-shrink-0">
                            {getHoleTypeLabel(hole.type)}
                          </Badge>
                        </div>
                        {!isExpanded && (
                          <p className="text-[9px] text-muted-foreground truncate">
                            {getHoleDetails(hole)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
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
                            title="Remove hole"
                          >
                            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Expanded properties editor */}
                    {isExpanded && (
                      <div className="px-2 pb-2 pt-1 border-t border-border/30 space-y-2">
                        {/* Position */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[9px] text-muted-foreground">Position X</Label>
                            <Input
                              type="number"
                              className="h-6 text-xs font-mono"
                              value={Number(hole.position?.x) || 0}
                              onChange={(e) => handleHolePropertyChange(hole, 'positionX', parseFloat(e.target.value) || 0)}
                              step={1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[9px] text-muted-foreground">Position Z</Label>
                            <Input
                              type="number"
                              className="h-6 text-xs font-mono"
                              value={Number(hole.position?.y) || 0}
                              onChange={(e) => handleHolePropertyChange(hole, 'positionZ', parseFloat(e.target.value) || 0)}
                              step={1}
                            />
                          </div>
                        </div>
                        
                        {/* Diameter and Depth */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[9px] text-muted-foreground">Diameter (mm)</Label>
                            <Input
                              type="number"
                              className="h-6 text-xs font-mono"
                              value={Number(hole.diameter) || 6}
                              onChange={(e) => handleHolePropertyChange(hole, 'diameter', parseFloat(e.target.value) || 6)}
                              min={0.5}
                              step={0.5}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[9px] text-muted-foreground">Depth (mm)</Label>
                            <Input
                              type="number"
                              className="h-6 text-xs font-mono"
                              value={Number(hole.depth) || 20}
                              onChange={(e) => handleHolePropertyChange(hole, 'depth', parseFloat(e.target.value) || 20)}
                              min={1}
                              step={1}
                            />
                          </div>
                        </div>
                        
                        {/* Type-specific properties */}
                        {hole.type === 'countersink' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px] text-muted-foreground">CS Diameter (mm)</Label>
                              <Input
                                type="number"
                                className="h-6 text-xs font-mono"
                                value={Number(hole.countersinkDiameter) || (Number(hole.diameter) || 6) * 2}
                                onChange={(e) => handleHolePropertyChange(hole, 'countersinkDiameter', parseFloat(e.target.value))}
                                min={Number(hole.diameter) || 6}
                                step={0.5}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] text-muted-foreground">CS Angle (°)</Label>
                              <Input
                                type="number"
                                className="h-6 text-xs font-mono"
                                value={Number(hole.countersinkAngle) || 90}
                                onChange={(e) => handleHolePropertyChange(hole, 'countersinkAngle', parseFloat(e.target.value))}
                                min={60}
                                max={120}
                                step={1}
                              />
                            </div>
                          </div>
                        )}
                        
                        {hole.type === 'counterbore' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px] text-muted-foreground">CB Diameter (mm)</Label>
                              <Input
                                type="number"
                                className="h-6 text-xs font-mono"
                                value={Number(hole.counterboreDiameter) || (Number(hole.diameter) || 6) * 1.8}
                                onChange={(e) => handleHolePropertyChange(hole, 'counterboreDiameter', parseFloat(e.target.value))}
                                min={Number(hole.diameter) || 6}
                                step={0.5}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] text-muted-foreground">CB Depth (mm)</Label>
                              <Input
                                type="number"
                                className="h-6 text-xs font-mono"
                                value={Number(hole.counterboreDepth) || 5}
                                onChange={(e) => handleHolePropertyChange(hole, 'counterboreDepth', parseFloat(e.target.value))}
                                min={1}
                                step={0.5}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
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
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

export default MountingHolesAccordion;
