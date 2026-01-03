import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Square, Hexagon, Check, AlertCircle, Settings2, LayoutGrid, Trash2, PenTool, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { BasePlateSection } from '@/features/baseplate';

interface BaseplateType {
  id: 'rectangular' | 'convex-hull' | 'multi-section';
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
  { 
    id: 'multi-section', 
    name: 'Multi-Section', 
    description: 'Draw multiple rectangular regions around the part',
    icon: LayoutGrid
  },
];

interface BaseplatesStepContentProps {
  hasWorkpiece?: boolean;
  currentBaseplate?: { id: string; type: string; padding?: number; height?: number; sections?: BasePlateSection[] } | null;
  onSelectBaseplate: (type: string, options: { padding: number; height: number; sections?: BasePlateSection[] }) => void;
  onRemoveBaseplate?: () => void;
  /** Whether drawing mode is active for multi-section baseplate */
  isDrawingMode?: boolean;
  /** Callback to toggle drawing mode */
  onToggleDrawingMode?: (active: boolean) => void;
  /** Sections drawn for multi-section baseplate */
  drawnSections?: BasePlateSection[];
  /** Callback when a section is removed */
  onRemoveSection?: (sectionId: string) => void;
}

const BaseplatesStepContent: React.FC<BaseplatesStepContentProps> = ({
  hasWorkpiece = false,
  currentBaseplate,
  onSelectBaseplate,
  onRemoveBaseplate,
  isDrawingMode = false,
  onToggleDrawingMode,
  drawnSections = [],
  onRemoveSection,
}) => {
  const [selectedType, setSelectedType] = useState<'rectangular' | 'convex-hull' | 'multi-section'>(
    (currentBaseplate?.type as 'rectangular' | 'convex-hull' | 'multi-section') || 'rectangular'
  );
  const [padding, setPadding] = useState(currentBaseplate?.padding || 4);
  const [height, setHeight] = useState(currentBaseplate?.height || 4);

  // For multi-section, combine existing sections with newly drawn ones
  const allSections = React.useMemo(() => {
    if (selectedType !== 'multi-section') return drawnSections;
    
    const existing = currentBaseplate?.type === 'multi-section' ? (currentBaseplate.sections || []) : [];
    return [...existing, ...drawnSections];
  }, [selectedType, currentBaseplate, drawnSections]);

  // Handle type change - exit drawing mode if switching away from multi-section
  const handleTypeChange = useCallback((type: 'rectangular' | 'convex-hull' | 'multi-section') => {
    setSelectedType(type);
    if (type !== 'multi-section' && isDrawingMode) {
      onToggleDrawingMode?.(false);
    }
  }, [isDrawingMode, onToggleDrawingMode]);

  // Listen for section drawn events from 3D scene
  useEffect(() => {
    const handleSectionDrawn = (e: CustomEvent<BasePlateSection>) => {
      // Section is handled by parent component (AppShell)
      console.log('Section drawn:', e.detail);
    };
    
    window.addEventListener('baseplate-section-drawn', handleSectionDrawn as EventListener);
    return () => window.removeEventListener('baseplate-section-drawn', handleSectionDrawn as EventListener);
  }, []);

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
    if (selectedType === 'multi-section') {
      // For multi-section, we need drawn sections
      if (drawnSections.length === 0) {
        // Toggle drawing mode to start drawing
        onToggleDrawingMode?.(!isDrawingMode);
        return;
      }
      // Pass only the newly drawn sections - merging happens in 3DScene and AppShell
      onSelectBaseplate(selectedType, { padding, height, sections: drawnSections });
    } else {
      onSelectBaseplate(selectedType, { padding, height });
    }
  };

  const handleToggleDrawingMode = () => {
    onToggleDrawingMode?.(!isDrawingMode);
  };

  const isMultiSection = selectedType === 'multi-section';
  const hasDrawnSections = allSections.length > 0;

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
                onClick={() => handleTypeChange(type.id)}
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
            {isMultiSection 
              ? 'Reserved space for features (supports, clamps, holes) added later'
              : 'Extra space around the workpiece boundary'
            }
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
            min={3}
            max={50}
            step={1}
            className="w-full"
          />
          <p className="text-[8px] text-muted-foreground font-tech">
            Thickness of the baseplate
          </p>
        </div>
      </div>

      {/* Multi-Section Drawing Controls */}
      {isMultiSection && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <PenTool className="w-4 h-4 text-muted-foreground" />
            <Label className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
              Draw Sections
            </Label>
          </div>

          {/* Drawing Mode Toggle Button */}
          <Button
            variant={isDrawingMode ? 'destructive' : 'outline'}
            size="sm"
            className="w-full font-tech"
            onClick={handleToggleDrawingMode}
          >
            {isDrawingMode ? (
              <>
                <XCircle className="w-4 h-4 mr-2" />
                Cancel Drawing
              </>
            ) : (
              <>
                <PenTool className="w-4 h-4 mr-2" />
                Draw Section
              </>
            )}
          </Button>

          {isDrawingMode && (
            <Alert className="font-tech">
              <PenTool className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Click to set the center point, then drag outward to set the final size. 
                The drawn rectangle is the complete baseplate section. Press Esc to cancel.
              </AlertDescription>
            </Alert>
          )}

          {/* Create Baseplate Button - shown right after Cancel Drawing for multi-section */}
          {hasDrawnSections && (
            <Button
              variant="default"
              size="sm"
              className="w-full font-tech"
              onClick={handleCreateBaseplate}
            >
              {currentBaseplate ? 'Update Baseplate' : 'Create Baseplate'}
            </Button>
          )}

          {/* Drawn Sections List */}
          {hasDrawnSections && (
            <div className="space-y-2">
              <Label className="text-[10px] font-tech text-muted-foreground uppercase">
                {currentBaseplate?.type === 'multi-section' && drawnSections.length < allSections.length
                  ? `All Sections (${allSections.length})`
                  : `Drawn Sections (${allSections.length})`
                }
              </Label>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {allSections.map((section, index) => {
                  // Check if this is an existing section or newly drawn
                  const isExisting = currentBaseplate?.type === 'multi-section' && 
                                     currentBaseplate.sections?.some(s => s.id === section.id);
                  
                  return (
                    <div
                      key={section.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/30"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded flex items-center justify-center ${
                          isExisting ? 'bg-green-500/20' : 'bg-primary/20'
                        }`}>
                          <span className={`text-[10px] font-tech ${
                            isExisting ? 'text-green-600' : 'text-primary'
                          }`}>{index + 1}</span>
                        </div>
                        <div className="text-[10px] font-tech text-muted-foreground">
                          {Math.abs(section.maxX - section.minX).toFixed(1)} × {Math.abs(section.maxZ - section.minZ).toFixed(1)} mm
                        </div>
                      </div>
                      <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => onRemoveSection?.(section.id)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create/Update Button - only for non-multi-section types */}
      {!isMultiSection && (
        <Button
          variant="default"
          size="sm"
          className="w-full font-tech"
          onClick={handleCreateBaseplate}
        >
          {currentBaseplate ? 'Update Baseplate' : 'Create Baseplate'}
        </Button>
      )}

      {/* Info Card */}
      <Card className="tech-glass">
        <div className="p-3 text-xs text-muted-foreground font-tech space-y-2">
          <p className="font-semibold text-foreground">
            {selectedType === 'rectangular' 
              ? 'Rectangular Baseplate' 
              : selectedType === 'convex-hull'
                ? 'Convex Hull Baseplate'
                : 'Multi-Section Baseplate'
            }
          </p>
          <p>
            {selectedType === 'rectangular' 
              ? 'Creates a rectangular baseplate aligned to the X/Y axes, sized to fit the workpiece bounding box plus the specified padding.'
              : selectedType === 'convex-hull'
                ? 'Creates a baseplate that follows the convex hull outline of the workpiece footprint, providing a tighter fit with less material.'
                : 'Draw multiple rectangular sections around your part. Unlike other baseplates, multi-section baseplates do not update when the part is moved or transformed.'
            }
          </p>
        </div>
      </Card>
    </div>
  );
};

export default BaseplatesStepContent;
