import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Square, Hexagon, Check, AlertCircle, Settings2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface BaseplateType {
  id: 'rectangular' | 'convex-hull';
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const BASEPLATE_TYPES: BaseplateType[] = [
  { 
    id: 'rectangular', 
    name: 'Rectangular', 
    description: 'Axis-aligned bounding box with padding',
    icon: Square
  },
  { 
    id: 'convex-hull', 
    name: 'Convex Hull', 
    description: 'Tight-fitting outline around workpiece',
    icon: Hexagon
  },
];

interface BaseplatesStepContentProps {
  hasWorkpiece?: boolean;
  currentBaseplate?: { id: string; type: string; padding?: number; height?: number } | null;
  onSelectBaseplate: (type: string, options: { padding: number; height: number }) => void;
  onRemoveBaseplate?: () => void;}

const BaseplatesStepContent: React.FC<BaseplatesStepContentProps> = ({
  hasWorkpiece = false,
  currentBaseplate,
  onSelectBaseplate,
  onRemoveBaseplate
}) => {
  const [selectedType, setSelectedType] = useState<'rectangular' | 'convex-hull'>(
    (currentBaseplate?.type as 'rectangular' | 'convex-hull') || 'rectangular'
  );
  const [padding, setPadding] = useState(currentBaseplate?.padding || 10);
  const [height, setHeight] = useState(currentBaseplate?.height || 4);

  if (!hasWorkpiece) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Import a workpiece first to configure the baseplate.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleCreateBaseplate = () => {
    onSelectBaseplate(selectedType, { padding, height });
  };

  return (
    <div className="p-4 space-y-4">
      {/* Current Baseplate Status - Small indicator */}
      {currentBaseplate && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-tech text-green-600">
            Baseplate active
          </span>
          <span className="text-xs text-muted-foreground font-tech ml-auto">
            View in Properties Panel →
          </span>
        </div>
      )}

      {/* Baseplate Type Selection */}
      <div className="space-y-2">
        <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Baseplate Type
        </Label>
        
        <div className="grid gap-2">
          {BASEPLATE_TYPES.map((type) => {
            const IconComponent = type.icon;
            const isSelected = selectedType === type.id;
            
            return (
              <Card
                key={type.id}
                className={`
                  tech-glass p-3 cursor-pointer transition-all
                  hover:border-primary/50 hover:bg-primary/5
                  ${isSelected ? 'border-primary bg-primary/10' : ''}
                `}
                onClick={() => setSelectedType(type.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`
                    w-10 h-10 rounded-md flex items-center justify-center
                    ${isSelected ? 'bg-primary/20' : 'bg-muted/50'}
                  `}>
                    <IconComponent className={`w-5 h-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-tech font-medium">{type.name}</p>
                    <p className="text-xs text-muted-foreground font-tech">
                      {type.description}
                    </p>
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="text-xs">
                      Selected
                    </Badge>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Parameters Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
            Parameters
          </Label>
        </div>

        {/* Padding */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-tech">Padding</Label>
            <span className="text-xs font-tech text-muted-foreground">{padding} mm</span>
          </div>
          <Slider
            value={[padding]}
            onValueChange={([v]) => setPadding(v)}
            min={0}
            max={50}
            step={1}
            className="w-full"
          />
          <p className="text-[8px] text-muted-foreground font-tech">
            Extra space around the workpiece boundary
          </p>
        </div>

        {/* Height */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-tech">Height</Label>
            <span className="text-xs font-tech text-muted-foreground">{height} mm</span>
          </div>
          <Slider
            value={[height]}
            onValueChange={([v]) => setHeight(v)}
            min={5}
            max={50}
            step={1}
            className="w-full"
          />
          <p className="text-[8px] text-muted-foreground font-tech">
            Thickness of the baseplate
          </p>
        </div>
      </div>

      {/* Create/Update Button */}
      <Button
        variant="default"
        size="sm"
        className="w-full font-tech"
        onClick={handleCreateBaseplate}
      >
        {currentBaseplate ? 'Update Baseplate' : 'Create Baseplate'}
      </Button>

      {/* Info Card */}
      <Card className="tech-glass">
        <div className="p-3 text-xs text-muted-foreground font-tech space-y-2">
          <p className="font-semibold text-foreground">
            {selectedType === 'rectangular' ? 'Rectangular Baseplate' : 'Convex Hull Baseplate'}
          </p>
          <p>
            {selectedType === 'rectangular' 
              ? 'Creates a rectangular baseplate aligned to the X/Y axes, sized to fit the workpiece bounding box plus the specified padding.'
              : 'Creates a baseplate that follows the convex hull outline of the workpiece footprint, providing a tighter fit with less material.'}
          </p>
        </div>
      </Card>
    </div>
  );
};

export default BaseplatesStepContent;
