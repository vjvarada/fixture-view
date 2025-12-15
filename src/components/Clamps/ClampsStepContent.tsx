import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Pin, 
  AlertCircle, 
  Plus, 
  GripVertical, 
  ChevronRight,
  ChevronDown,
  ArrowDown,
  ArrowRight,
  ExternalLink,
  Trash2,
  Image as ImageIcon
} from 'lucide-react';
import { 
  ClampModel, 
  ClampCategory, 
  ClampCategoryGroup, 
  PlacedClamp 
} from './types';
import { 
  getClampCategories, 
  CATEGORY_INFO 
} from './clampData';

interface ClampsStepContentProps {
  hasWorkpiece?: boolean;
  placedClamps?: PlacedClamp[];
  onSelectClamp?: (clamp: ClampModel) => void;
  onPlaceClamp?: (clamp: ClampModel) => void;
  onRemoveClamp?: (clampId: string) => void;
  selectedClamp?: ClampModel | null;
}

const ClampsStepContent: React.FC<ClampsStepContentProps> = ({
  hasWorkpiece = false,
  placedClamps = [],
  onSelectClamp,
  onPlaceClamp,
  onRemoveClamp,
  selectedClamp
}) => {
  const [categories, setCategories] = useState<ClampCategoryGroup[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<ClampCategory>>(new Set());
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load clamp categories
    const clampCategories = getClampCategories();
    setCategories(clampCategories);
    
    // Expand categories that have clamps by default
    const categoriesWithClamps = new Set<ClampCategory>();
    clampCategories.forEach(cat => {
      if (cat.clamps.length > 0) {
        categoriesWithClamps.add(cat.category);
      }
    });
    setExpandedCategories(categoriesWithClamps);
  }, []);

  const toggleCategory = (category: ClampCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleImageError = (clampId: string) => {
    setImageErrors(prev => new Set(prev).add(clampId));
  };

  const getCategoryIcon = (category: ClampCategory) => {
    if (category === 'Toggle Clamps Vertical') {
      return <ArrowDown className="w-4 h-4" />;
    }
    return <ArrowRight className="w-4 h-4" />;
  };

  if (!hasWorkpiece) {
    return (
      <div className="p-4">
        <Alert className="font-tech">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Import a workpiece first to add clamps.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Clamp Categories */}
      <div className="space-y-2">
        <p className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Select Clamp Type
        </p>
        
        <ScrollArea className="h-[300px]">
          <div className="space-y-2 pr-2">
            {categories.map((categoryGroup) => (
              <div key={categoryGroup.category} className="space-y-1">
                {/* Category Header */}
                <Card
                  className={`
                    tech-glass p-3 cursor-pointer transition-all
                    hover:border-primary/50 hover:bg-primary/5
                  `}
                  onClick={() => toggleCategory(categoryGroup.category)}
                >
                  <div className="flex items-center gap-3">
                    {getCategoryIcon(categoryGroup.category)}
                    <div className="flex-1">
                      <p className="text-sm font-tech font-medium">
                        {categoryGroup.category}
                      </p>
                      <p className="text-xs text-muted-foreground font-tech">
                        {CATEGORY_INFO[categoryGroup.category]?.description}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {categoryGroup.clamps.length}
                    </Badge>
                    {expandedCategories.has(categoryGroup.category) ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </Card>

                {/* Clamps in Category */}
                {expandedCategories.has(categoryGroup.category) && (
                  <div className="ml-4 space-y-1">
                    {categoryGroup.clamps.length === 0 ? (
                      <Card className="tech-glass p-3">
                        <p className="text-xs text-muted-foreground font-tech italic">
                          No clamps available in this category
                        </p>
                      </Card>
                    ) : (
                      categoryGroup.clamps.map((clamp) => (
                        <Card
                          key={clamp.id}
                          className={`
                            tech-glass p-3 cursor-pointer transition-all
                            hover:border-primary/50 hover:bg-primary/5
                            ${selectedClamp?.id === clamp.id ? 'border-primary bg-primary/10' : ''}
                          `}
                          onClick={() => onSelectClamp?.(clamp)}
                        >
                          <div className="flex items-start gap-3">
                            {/* Clamp Image or Placeholder */}
                            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                              {clamp.imagePath && !imageErrors.has(clamp.id) ? (
                                <img 
                                  src={clamp.imagePath} 
                                  alt={clamp.name}
                                  className="w-full h-full object-cover"
                                  onError={() => handleImageError(clamp.id)}
                                />
                              ) : (
                                <Pin className="w-6 h-6 text-muted-foreground" />
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-tech font-medium truncate">
                                  {clamp.name}
                                </p>
                                {selectedClamp?.id === clamp.id && (
                                  <Badge variant="default" className="text-xs flex-shrink-0">
                                    Selected
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex items-center justify-between gap-2">
                                {clamp.info.force && (
                                  <p className="text-xs text-muted-foreground font-tech">
                                    Force: {clamp.info.force}
                                  </p>
                                )}
                                
                                {clamp.info.url && (
                                  <a 
                                    href={clamp.info.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline font-tech inline-flex items-center gap-1 flex-shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Details
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Place Clamp Button */}
      {selectedClamp && (
        <Button
          variant="default"
          size="sm"
          className="w-full font-tech"
          onClick={() => onPlaceClamp?.(selectedClamp)}
        >
          <Plus className="w-4 h-4 mr-2" />
          Place {selectedClamp.name}
        </Button>
      )}

      {/* Placed Clamps List */}
      {placedClamps.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
            Placed Clamps ({placedClamps.length})
          </p>
          <ScrollArea className="max-h-[150px]">
            <div className="space-y-1 pr-2">
              {placedClamps.map((clamp, index) => (
                <Card key={clamp.id} className="tech-glass p-2">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-3 h-3 text-muted-foreground cursor-grab" />
                    <Pin className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs font-tech flex-1 truncate">
                      Clamp {index + 1} - {clamp.clampModelId}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemoveClamp?.(clamp.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Info Card */}
      <Card className="tech-glass">
        <div className="p-3 text-xs text-muted-foreground font-tech space-y-2">
          <p>
            <strong>Toggle Clamps Vertical:</strong> Apply downward clamping force, ideal for holding workpieces flat against the baseplate.
          </p>
          <p>
            <strong>Toggle Clamps Side Push:</strong> Apply horizontal clamping force, useful for pushing workpieces against stops or edges.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default ClampsStepContent;
