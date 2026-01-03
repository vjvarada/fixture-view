/**
 * LabelsAccordion
 *
 * Accordion component for the Properties panel displaying label details
 * with inline editing capabilities.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import {
  LabelConfig,
  LabelFont,
  LABEL_FONTS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_DEPTH,
  MAX_DEPTH,
  getPositionAxis,
  getRotationZ,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LabelsAccordionProps {
  labels: LabelConfig[];
  selectedLabelId: string | null;
  onLabelSelect: (id: string | null) => void;
  onLabelUpdate: (id: string, updates: Partial<LabelConfig>) => void;
  onLabelDelete: (id: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Converts radians to degrees */
const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Converts degrees to radians */
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** Clamps a value between min and max */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface LabelPropertiesProps {
  label: LabelConfig;
  onUpdate: (updates: Partial<LabelConfig>) => void;
}

/** Input field for position axis */
const PositionInput: React.FC<{
  label: LabelConfig;
  axis: 'x' | 'z';
  color: string;
  onUpdate: (updates: Partial<LabelConfig>) => void;
}> = ({ label, axis, color, onUpdate }) => {
  const value = getPositionAxis(label.position, axis);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value) || 0;
      const newPos = new THREE.Vector3(
        axis === 'x' ? newValue : getPositionAxis(label.position, 'x'),
        getPositionAxis(label.position, 'y'),
        axis === 'z' ? newValue : getPositionAxis(label.position, 'z')
      );
      onUpdate({ position: newPos });
    },
    [axis, label.position, onUpdate]
  );

  return (
    <div className="space-y-1">
      <Label className={`text-[8px] font-mono ${color}`}>{axis === 'z' ? 'Y' : axis.toUpperCase()}</Label>
      <Input
        type="number"
        value={value.toFixed(1)}
        onChange={handleChange}
        className="h-6 !text-[10px] font-mono"
        step="1"
      />
    </div>
  );
};

/** Renders editable properties for a single label */
const LabelProperties: React.FC<LabelPropertiesProps> = ({ label, onUpdate }) => {
  const rotationDegrees = radToDeg(getRotationZ(label.rotation));

  const handleRotationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const degrees = parseFloat(e.target.value) || 0;
      const rot = label.rotation;
      const currentX = rot instanceof THREE.Euler ? rot.x : (rot as { x: number }).x || 0;
      const currentY = rot instanceof THREE.Euler ? rot.y : (rot as { y: number }).y || 0;
      onUpdate({ rotation: new THREE.Euler(currentX, currentY, degToRad(degrees)) });
    },
    [label.rotation, onUpdate]
  );

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = clamp(parseFloat(e.target.value) || MIN_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE);
      onUpdate({ fontSize: value });
    },
    [onUpdate]
  );

  const handleDepthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = clamp(parseFloat(e.target.value) || MIN_DEPTH, MIN_DEPTH, MAX_DEPTH);
      onUpdate({ depth: value });
    },
    [onUpdate]
  );

  return (
    <div className="space-y-3">
      {/* Text */}
      <div className="space-y-2">
        <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
          <Type className="w-2.5 h-2.5" />
          Text
        </Label>
        <Input
          value={label.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          className="h-6 !text-[10px] font-mono"
        />
      </div>

      {/* Font */}
      <div className="space-y-2">
        <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
          <Type className="w-2.5 h-2.5" />
          Font
        </Label>
        <Select
          value={label.font || 'helvetiker'}
          onValueChange={(value: LabelFont) => onUpdate({ font: value })}
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
          <PositionInput label={label} axis="x" color="text-red-500" onUpdate={onUpdate} />
          <PositionInput label={label} axis="z" color="text-blue-500" onUpdate={onUpdate} />
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
          onChange={handleRotationChange}
          className="h-6 !text-[10px] font-mono"
          step="5"
        />
      </div>

      {/* Dimensions */}
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
              onChange={handleFontSizeChange}
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
              onChange={handleDepthChange}
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

/** Delete button for a label */
const DeleteButton: React.FC<{ onDelete: () => void }> = ({ onDelete }) => {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onDelete();
    },
    [onDelete]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        e.preventDefault();
        onDelete();
      }
    },
    [onDelete]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Delete label"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="w-6 h-6 p-0 flex items-center justify-center rounded text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
      title="Delete label"
    >
      <Trash2 className="w-3 h-3" />
    </div>
  );
};

/** Empty state when no labels exist */
const EmptyState: React.FC = () => (
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
        <p className="text-xs text-muted-foreground font-tech">No labels added yet</p>
        <p className="text-[10px] text-muted-foreground font-tech mt-1">
          Use the Labels step in the Context Panel to add labels
        </p>
      </Card>
    </AccordionContent>
  </AccordionItem>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const LabelsAccordion: React.FC<LabelsAccordionProps> = ({
  labels,
  selectedLabelId,
  onLabelSelect,
  onLabelUpdate,
  onLabelDelete,
}) => {
  const [expandedItem, setExpandedItem] = useState<string>('');
  const labelRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Auto-expand and scroll to selected label
  useEffect(() => {
    if (!selectedLabelId) return;

    setExpandedItem(selectedLabelId);

    const timeoutId = setTimeout(() => {
      const element = labelRefs.current.get(selectedLabelId);
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedLabelId]);

  const handleAccordionChange = useCallback(
    (value: string) => {
      setExpandedItem(value ?? '');
      if (!value) {
        onLabelSelect(null);
      }
    },
    [onLabelSelect]
  );

  const handleLabelClick = useCallback(
    (label: LabelConfig) => {
      onLabelSelect(label.id);
      window.dispatchEvent(new CustomEvent('label-focus', { detail: label }));
    },
    [onLabelSelect]
  );

  const getItemClassName = useCallback(
    (labelId: string): string => {
      const isSelected = selectedLabelId === labelId;
      const isExpanded = expandedItem === labelId;

      if (isSelected) {
        return 'border-primary bg-primary/10 ring-1 ring-primary/30';
      }
      if (isExpanded) {
        return 'border-primary bg-primary/5';
      }
      return 'border-border/30';
    },
    [selectedLabelId, expandedItem]
  );

  if (labels.length === 0) {
    return <EmptyState />;
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
          onValueChange={handleAccordionChange}
          className="space-y-1"
        >
          {labels.map((label, index) => (
            <AccordionItem
              key={label.id}
              value={label.id}
              ref={(el) => labelRefs.current.set(label.id, el)}
              className={`border rounded-md transition-all ${getItemClassName(label.id)}`}
            >
              <AccordionTrigger
                className="py-1.5 px-2 text-xs font-tech hover:no-underline"
                onClick={() => handleLabelClick(label)}
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
                  <DeleteButton onDelete={() => onLabelDelete(label.id)} />
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-2">
                <LabelProperties
                  label={label}
                  onUpdate={(updates) => onLabelUpdate(label.id, updates)}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
};

export default LabelsAccordion;
