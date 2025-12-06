import React, { useState, useEffect, useCallback } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Boxes, Trash2, Move, Maximize2, RotateCcw, Circle, Square, Triangle, Spline } from 'lucide-react';
import { AnySupport, SupportType, RectSupport, CylSupport, ConicalSupport, CustomSupport } from './types';

interface SupportsAccordionProps {
  supports: AnySupport[];
  selectedSupportId: string | null;
  onSupportSelect: (id: string | null) => void;
  onSupportUpdate: (support: AnySupport) => void;
  onSupportDelete: (id: string) => void;
}

const SUPPORT_TYPE_ICONS: Record<SupportType, React.ReactNode> = {
  rectangular: <Square className="w-3 h-3" />,
  cylindrical: <Circle className="w-3 h-3" />,
  conical: <Triangle className="w-3 h-3" />,
  custom: <Spline className="w-3 h-3" />,
};

const SUPPORT_TYPE_LABELS: Record<SupportType, string> = {
  rectangular: 'Rectangular',
  cylindrical: 'Cylindrical',
  conical: 'Conical',
  custom: 'Custom',
};

const SupportsAccordion: React.FC<SupportsAccordionProps> = ({
  supports,
  selectedSupportId,
  onSupportSelect,
  onSupportUpdate,
  onSupportDelete,
}) => {
  const [expandedItem, setExpandedItem] = useState<string | undefined>(undefined);

  // Auto-expand newly selected support
  useEffect(() => {
    if (selectedSupportId) {
      setExpandedItem(selectedSupportId);
    }
  }, [selectedSupportId]);

  // Handle support property changes
  const handlePropertyChange = useCallback((support: AnySupport, property: string, value: number) => {
    const updatedSupport = { ...support, [property]: value };
    onSupportUpdate(updatedSupport as AnySupport);
    
    // Dispatch update event for 3D scene
    window.dispatchEvent(new CustomEvent('support-updated', { detail: updatedSupport }));
  }, [onSupportUpdate]);

  // Handle position changes (center.x, center.y which maps to z in world)
  const handlePositionChange = useCallback((support: AnySupport, axis: 'x' | 'z', value: number) => {
    const newCenter = support.center.clone();
    if (axis === 'x') {
      newCenter.x = value;
    } else {
      newCenter.y = value; // THREE.Vector2 y = world z
    }
    const updatedSupport = { ...support, center: newCenter };
    onSupportUpdate(updatedSupport as AnySupport);
    
    // Dispatch update event for 3D scene
    window.dispatchEvent(new CustomEvent('support-updated', { detail: updatedSupport }));
  }, [onSupportUpdate]);

  // Render properties based on support type
  const renderSupportProperties = (support: AnySupport) => {
    const baseProperties = (
      <div className="space-y-3">
        {/* Position */}
        <div className="space-y-2">
          <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
            <Move className="w-2.5 h-2.5" />
            Position (mm)
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[8px] text-red-500 font-mono">X</Label>
              <Input
                type="number"
                value={support.center.x.toFixed(1)}
                onChange={(e) => handlePositionChange(support, 'x', parseFloat(e.target.value) || 0)}
                className="h-6 !text-[10px] font-mono"
                step="0.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[8px] text-green-500 font-mono">Z</Label>
              <Input
                type="number"
                value={support.center.y.toFixed(1)}
                onChange={(e) => handlePositionChange(support, 'z', parseFloat(e.target.value) || 0)}
                className="h-6 !text-[10px] font-mono"
                step="0.5"
              />
            </div>
          </div>
        </div>

        {/* Height */}
        <div className="space-y-2">
          <Label className="text-[8px] font-tech text-muted-foreground flex items-center gap-1">
            <Maximize2 className="w-2.5 h-2.5" />
            Height (mm)
          </Label>
          <Input
            type="number"
            value={support.height.toFixed(1)}
            onChange={(e) => handlePropertyChange(support, 'height', parseFloat(e.target.value) || 1)}
            className="h-6 !text-[10px] font-mono"
            step="0.5"
            min="1"
          />
        </div>
      </div>
    );

    // Type-specific properties
    switch (support.type) {
      case 'rectangular': {
        const rectSupport = support as RectSupport;
        return (
          <>
            {baseProperties}
            <div className="space-y-3 pt-2 border-t border-border/30">
              <Label className="text-[8px] font-tech text-muted-foreground uppercase tracking-wider">
                Dimensions
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[8px] font-mono">Width</Label>
                  <Input
                    type="number"
                    value={rectSupport.width.toFixed(1)}
                    onChange={(e) => handlePropertyChange(support, 'width', parseFloat(e.target.value) || 1)}
                    className="h-6 !text-[10px] font-mono"
                    step="0.5"
                    min="1"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[8px] font-mono">Depth</Label>
                  <Input
                    type="number"
                    value={rectSupport.depth.toFixed(1)}
                    onChange={(e) => handlePropertyChange(support, 'depth', parseFloat(e.target.value) || 1)}
                    className="h-6 !text-[10px] font-mono"
                    step="0.5"
                    min="1"
                  />
                </div>
              </div>
              {rectSupport.cornerRadius !== undefined && (
                <div className="space-y-1">
                  <Label className="text-[8px] font-mono">Corner Radius</Label>
                  <Input
                    type="number"
                    value={rectSupport.cornerRadius.toFixed(1)}
                    onChange={(e) => handlePropertyChange(support, 'cornerRadius', parseFloat(e.target.value) || 0)}
                    className="h-6 !text-[10px] font-mono"
                    step="0.5"
                    min="0"
                  />
                </div>
              )}
            </div>
          </>
        );
      }

      case 'cylindrical': {
        const cylSupport = support as CylSupport;
        return (
          <>
            {baseProperties}
            <div className="space-y-3 pt-2 border-t border-border/30">
              <Label className="text-[8px] font-tech text-muted-foreground uppercase tracking-wider">
                Dimensions
              </Label>
              <div className="space-y-1">
                <Label className="text-[8px] font-mono">Radius</Label>
                <Input
                  type="number"
                  value={cylSupport.radius.toFixed(1)}
                  onChange={(e) => handlePropertyChange(support, 'radius', parseFloat(e.target.value) || 1)}
                  className="h-6 !text-[10px] font-mono"
                  step="0.5"
                  min="1"
                />
              </div>
            </div>
          </>
        );
      }

      case 'conical': {
        const conicalSupport = support as ConicalSupport;
        return (
          <>
            {baseProperties}
            <div className="space-y-3 pt-2 border-t border-border/30">
              <Label className="text-[8px] font-tech text-muted-foreground uppercase tracking-wider">
                Dimensions
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[8px] font-mono">Base Radius</Label>
                  <Input
                    type="number"
                    value={conicalSupport.baseRadius.toFixed(1)}
                    onChange={(e) => handlePropertyChange(support, 'baseRadius', parseFloat(e.target.value) || 1)}
                    className="h-6 !text-[10px] font-mono"
                    step="0.5"
                    min="1"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[8px] font-mono">Top Radius</Label>
                  <Input
                    type="number"
                    value={conicalSupport.topRadius.toFixed(1)}
                    onChange={(e) => handlePropertyChange(support, 'topRadius', parseFloat(e.target.value) || 0)}
                    className="h-6 !text-[10px] font-mono"
                    step="0.5"
                    min="0"
                  />
                </div>
              </div>
            </div>
          </>
        );
      }

      case 'custom': {
        const customSupport = support as CustomSupport;
        return (
          <>
            {baseProperties}
            <div className="space-y-2 pt-2 border-t border-border/30">
              <Label className="text-[8px] font-tech text-muted-foreground uppercase tracking-wider">
                Custom Shape
              </Label>
              <p className="text-[8px] text-muted-foreground">
                {customSupport.polygon.length} vertices
              </p>
              <div className="space-y-1">
                <Label className="text-[8px] font-mono">Corner Radius</Label>
                <Input
                  type="number"
                  value={(customSupport.cornerRadius ?? 0).toFixed(1)}
                  onChange={(e) => handlePropertyChange(support, 'cornerRadius', parseFloat(e.target.value) || 0)}
                  className="h-6 !text-[10px] font-mono"
                  step="0.5"
                  min="0"
                />
              </div>
              {customSupport.offset !== undefined && (
                <div className="space-y-1">
                  <Label className="text-[8px] font-mono">Offset</Label>
                  <Input
                    type="number"
                    value={customSupport.offset.toFixed(1)}
                    onChange={(e) => handlePropertyChange(support, 'offset', parseFloat(e.target.value) || 0)}
                    className="h-6 !text-[10px] font-mono"
                    step="0.1"
                  />
                </div>
              )}
            </div>
          </>
        );
      }

      default:
        return baseProperties;
    }
  };

  if (supports.length === 0) {
    return (
      <AccordionItem value="supports" className="border-border/50">
        <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
          <div className="flex items-center gap-2">
            <Boxes className="w-3.5 h-3.5 text-primary" />
            Supports
            <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
              0
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2">
          <Card className="tech-glass p-4 text-center">
            <Boxes className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground font-tech">
              No supports placed yet
            </p>
            <p className="text-[10px] text-muted-foreground font-tech mt-1">
              Use the Supports step in the Context Panel to add supports
            </p>
          </Card>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <AccordionItem value="supports" className="border-border/50">
      <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2">
          <Boxes className="w-3.5 h-3.5 text-primary" />
          Supports
          <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4">
            {supports.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2">
        <Accordion 
          type="single" 
          collapsible
          value={expandedItem}
          onValueChange={setExpandedItem}
          className="space-y-1"
        >
          {supports.map((support, index) => (
            <AccordionItem 
              key={support.id} 
              value={support.id}
              className={`
                border rounded-md transition-all
                ${selectedSupportId === support.id ? 'border-primary bg-primary/5' : 'border-border/30'}
              `}
            >
              <AccordionTrigger 
                className="py-1.5 px-2 text-xs font-tech hover:no-underline"
                onClick={() => {
                  onSupportSelect(support.id);
                  // Dispatch event to focus on this support in 3D view
                  window.dispatchEvent(new CustomEvent('support-focus', { detail: support }));
                }}
              >
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-5 h-5 rounded bg-muted/50 flex items-center justify-center text-[10px] font-tech">
                    {index + 1}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {SUPPORT_TYPE_ICONS[support.type]}
                    <span className="text-[10px]">{SUPPORT_TYPE_LABELS[support.type]}</span>
                  </div>
                  <span className="text-[8px] text-muted-foreground ml-auto mr-2">
                    H: {support.height.toFixed(0)}mm
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-2">
                <div className="space-y-3">
                  {renderSupportProperties(support)}
                  
                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-border/30">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 h-6 text-[10px] font-tech"
                      onClick={() => {
                        // Edit support - dispatch event for 3D scene
                        window.dispatchEvent(new CustomEvent('support-edit', { detail: support }));
                      }}
                    >
                      <Move className="w-3 h-3 mr-1" />
                      Edit in 3D
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      onClick={() => onSupportDelete(support.id)}
                      title="Delete support"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
};

export default SupportsAccordion;
