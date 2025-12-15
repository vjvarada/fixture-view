/**
 * LabelsAccordion
 * 
 * Accordion component for the Properties panel showing label details
 * and allowing editing of the selected label.
 * Styled consistently with SupportsAccordion.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, Type, Crosshair, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { LabelConfig, LabelFont, LABEL_FONTS, MIN_FONT_SIZE, MAX_FONT_SIZE, MIN_DEPTH, MAX_DEPTH } from './types';

interface LabelsAccordionProps {
  labels: LabelConfig[];
  selectedLabelId: string | null;
  onLabelSelect: (id: string | null) => void;
  onLabelUpdate: (id: string, updates: Partial<LabelConfig>) => void;
  onLabelDelete: (id: string) => void;
}

const LabelsAccordion: React.FC<LabelsAccordionProps> = ({
  labels,
  selectedLabelId,
  onLabelSelect,
  onLabelUpdate,
  onLabelDelete,
}) => {
  const [expandedItem, setExpandedItem] = useState<string>("");
  const labelRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Auto-expand newly selected label and scroll into view
  useEffect(() => {
    if (selectedLabelId) {
      setExpandedItem(selectedLabelId);
      setTimeout(() => {
        const element = labelRefs.current.get(selectedLabelId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    }
  }, [selectedLabelId]);

  // Helper to get position value safely
  const getPositionValue = useCallback((pos: LabelConfig['position'], axis: 'x' | 'y' | 'z'): number => {
    if (pos instanceof THREE.Vector3) {
      return pos[axis];
    }
    return (pos as any)[axis] || 0;
  }, []);

  // Helper to get rotation value safely (in degrees)
  const getRotationDegrees = useCallback((rot: LabelConfig['rotation']): number => {
    const z = rot instanceof THREE.Euler ? rot.z : (rot as any).z || 0;
    return (z * 180) / Math.PI;
  }, []);

  // Handle position change
  const handlePositionChange = useCallback((label: LabelConfig, axis: 'x' | 'y' | 'z', value: number) => {
    const newPos = new THREE.Vector3(
      axis === 'x' ? value : getPositionValue(label.position, 'x'),
      axis === 'y' ? value : getPositionValue(label.position, 'y'),
      axis === 'z' ? value : getPositionValue(label.position, 'z')
    );
    onLabelUpdate(label.id, { position: newPos });
  }, [onLabelUpdate, getPositionValue]);

  // Handle rotation change (degrees to radians)
  const handleRotationChange = useCallback((label: LabelConfig, degrees: number) => {
    const rot = label.rotation;
    const currentX = rot instanceof THREE.Euler ? rot.x : (rot as any).x || 0;
    const currentY = rot instanceof THREE.Euler ? rot.y : (rot as any).y || 0;
    const newRot = new THREE.Euler(currentX, currentY, (degrees * Math.PI) / 180);
    onLabelUpdate(label.id, { rotation: newRot });
  }, [onLabelUpdate]);

  // Render label properties
  const renderLabelProperties = (label: LabelConfig) => {
    const rotationDegrees = getRotationDegrees(label.rotation);

    return (
      <div className="space-y-3">
        {/* Label Text */}
        <div className="space-y-2">
          <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
            <Type className="w-2.5 h-2.5" />
            Text
          </Label>
          <Input
            value={label.text}
            onChange={(e) => onLabelUpdate(label.id, { text: e.target.value })}
            className="h-6 !text-[10px] font-mono"
          />
        </div>

        {/* Font Selection */}
        <div className="space-y-2">
          <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
            <Type className="w-2.5 h-2.5" />
            Font
          </Label>
          <Select
            value={label.font || 'helvetiker'}
            onValueChange={(value: LabelFont) => onLabelUpdate(label.id, { font: value })}
          >
            <SelectTrigger className="h-6 !text-[10px]">
              <SelectValue placeholder="Select font" />
            </SelectTrigger>
            <SelectContent>
              {LABEL_FONTS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
                value={getPositionValue(label.position, 'x').toFixed(1)}
                onChange={(e) => handlePositionChange(label, 'x', parseFloat(e.target.value) || 0)}
                className="h-6 !text-[10px] font-mono"
                step="1"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[8px] text-blue-500 font-mono">Z</Label>
              <Input
                type="number"
                value={getPositionValue(label.position, 'z').toFixed(1)}
                onChange={(e) => handlePositionChange(label, 'z', parseFloat(e.target.value) || 0)}
                className="h-6 !text-[10px] font-mono"
                step="1"
              />
            </div>
          </div>
        </div>

        {/* Rotation */}
        <div className="space-y-2">
          <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
            <RotateCcw className="w-2.5 h-2.5" />
            Rotation (°)
          </Label>
          <Input
            type="number"
            value={rotationDegrees.toFixed(1)}
            onChange={(e) => handleRotationChange(label, parseFloat(e.target.value) || 0)}
            className="h-6 !text-[10px] font-mono"
            step="5"
          />
        </div>

        {/* Dimensions Section */}
        <div className="space-y-3 pt-2 border-t border-border/30">
          <Label className="text-[8px] font-tech text-muted-foreground uppercase tracking-wider">
            Dimensions
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[8px] font-mono">Font Size</Label>
              <Input
                type="number"
                value={label.fontSize}
                onChange={(e) => onLabelUpdate(label.id, { fontSize: Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, parseFloat(e.target.value) || MIN_FONT_SIZE)) })}
                className="h-6 !text-[10px] font-mono"
                step="1"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[8px] font-mono">Emboss</Label>
              <Input
                type="number"
                value={label.depth.toFixed(1)}
                onChange={(e) => onLabelUpdate(label.id, { depth: Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, parseFloat(e.target.value) || MIN_DEPTH)) })}
                className="h-6 !text-[10px] font-mono"
                step="0.1"
                min={MIN_DEPTH}
                max={MAX_DEPTH}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (labels.length === 0) {
    return (
      <AccordionItem value="labels" className="border-border/50">
        <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
          <div className="flex items-center gap-2 flex-1">
            <Type className="w-3.5 h-3.5 text-primary" />
            Labels
            <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
              0
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2">
          <Card className="tech-glass p-4 text-center">
            <Type className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground font-tech">
              No labels added yet
            </p>
            <p className="text-[10px] text-muted-foreground font-tech mt-1">
              Use the Labels step in the Context Panel to add labels
            </p>
          </Card>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <AccordionItem value="labels" className="border-border/50">
      <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2 flex-1">
          <Type className="w-3.5 h-3.5 text-primary" />
          Labels
          <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
            {labels.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2">
        <Accordion 
          type="single" 
          collapsible
          value={expandedItem}
          onValueChange={(val) => {
            setExpandedItem(val ?? "");
            if (!val) {
              onLabelSelect(null);
            }
          }}
          className="space-y-1"
        >
          {labels.map((label, index) => (
            <AccordionItem 
              key={label.id} 
              value={label.id}
              ref={(el) => labelRefs.current.set(label.id, el)}
              className={`
                border rounded-md transition-all
                ${selectedLabelId === label.id 
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30' 
                  : expandedItem === label.id 
                    ? 'border-primary bg-primary/5' 
                    : 'border-border/30'
                }
              `}
            >
              <AccordionTrigger 
                className="py-1.5 px-2 text-xs font-tech hover:no-underline"
                onClick={() => {
                  onLabelSelect(label.id);
                  // Dispatch event to focus on this label in 3D view
                  window.dispatchEvent(new CustomEvent('label-focus', { detail: label }));
                }}
              >
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-5 h-5 rounded bg-muted/50 flex items-center justify-center text-[10px] font-tech">
                    {index + 1}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Type className="w-3 h-3" />
                    <span className="text-[10px] truncate max-w-[80px]">{label.text}</span>
                  </div>
                  <span className="text-[8px] text-muted-foreground ml-auto mr-2">
                    {label.fontSize}mm
                  </span>
                  <div
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onLabelDelete(label.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                        onLabelDelete(label.id);
                      }
                    }}
                    className="w-6 h-6 p-0 flex items-center justify-center rounded text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                    title="Delete label"
                  >
                    <Trash2 className="w-3 h-3" />
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-2">
                <div className="space-y-3">
                  {renderLabelProperties(label)}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
};

export default LabelsAccordion;
