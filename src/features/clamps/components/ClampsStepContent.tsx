import { useState, useEffect, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  Pin, 
  AlertCircle, 
  Plus, 
  ChevronRight,
  ChevronDown,
  ArrowDown,
  ArrowRight,
  ExternalLink,
  MousePointer,
  X,
  Loader2,
  Check
} from 'lucide-react';
import { 
  ClampModel, 
  ClampCategory, 
  ClampCategoryGroup
} from '../types';
import { 
  getClampCategories, 
  CATEGORY_INFO 
} from '../utils/clampData';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ClampProgress {
  stage: 'idle' | 'loading' | 'computing' | 'positioning' | 'csg';
  progress: number;
  message: string;
}

interface ClampsStepContentProps {
  hasWorkpiece?: boolean;
  clampsCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Hook: Track clamp processing progress
// ─────────────────────────────────────────────────────────────────────────────

function useClampProgress(): ClampProgress {
  const [progress, setProgress] = useState<ClampProgress>({
    stage: 'idle',
    progress: 0,
    message: '',
  });

  useEffect(() => {
    const handleClampProgress = (e: CustomEvent<{ stage: string; progress: number; message?: string }>) => {
      const { stage, progress: prog, message } = e.detail;
      setProgress({
        stage: stage as ClampProgress['stage'],
        progress: prog,
        message: message || getStageMessage(stage, prog),
      });
    };

    const handleClampPlaced = () => {
      setProgress({ stage: 'idle', progress: 100, message: '' });
    };

    const handlePlacementCancelled = () => {
      setProgress({ stage: 'idle', progress: 0, message: '' });
    };

    window.addEventListener('clamp-progress', handleClampProgress as EventListener);
    window.addEventListener('clamp-placed', handleClampPlaced);
    window.addEventListener('clamp-placement-cancelled', handlePlacementCancelled);

    return () => {
      window.removeEventListener('clamp-progress', handleClampProgress as EventListener);
      window.removeEventListener('clamp-placed', handleClampPlaced);
      window.removeEventListener('clamp-placement-cancelled', handlePlacementCancelled);
    };
  }, []);

  return progress;
}

function getStageMessage(stage: string, progress: number): string {
  switch (stage) {
    case 'loading':
      return 'Loading clamp model...';
    case 'computing':
      return 'Computing placement position...';
    case 'positioning':
      return 'Optimizing clamp position...';
    case 'csg':
      return `Processing support geometry (${progress}%)...`;
    default:
      return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────────────────

/** Processing indicator card with progress */
const ProcessingCard = memo<{ progress: ClampProgress }>(({ progress }) => {
  const hasProgress = progress.progress > 0 && progress.progress < 100;

  return (
    <Card className="tech-glass p-4 bg-primary/5 border-primary/30">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-tech font-medium text-primary">
              Placing Clamp
            </p>
            <p className="text-[10px] text-muted-foreground">
              {progress.message || 'Processing...'}
            </p>
          </div>
        </div>

        {hasProgress ? (
          <div className="space-y-1">
            <Progress value={progress.progress} className="h-1.5" />
            <p className="text-[8px] text-muted-foreground text-right font-mono">
              {progress.progress.toFixed(0)}%
            </p>
          </div>
        ) : (
          <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary/60 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        )}
      </div>
    </Card>
  );
});
ProcessingCard.displayName = 'ProcessingCard';

const ClampsStepContent: React.FC<ClampsStepContentProps> = ({
  hasWorkpiece = false,
  clampsCount = 0,
}) => {
  const [categories, setCategories] = useState<ClampCategoryGroup[]>([]);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [selectedClamp, setSelectedClamp] = useState<ClampModel | null>(null);
  const [expandedClamp, setExpandedClamp] = useState<string | null>(null);
  const [isPlacementMode, setIsPlacementMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Track clamp processing progress
  const clampProgress = useClampProgress();
  
  // Track expanded accordion categories
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  useEffect(() => {
    // Load clamp categories
    const clampCategories = getClampCategories();
    setCategories(clampCategories);
    
    // Expand categories that have clamps by default
    const categoriesWithClamps: string[] = [];
    clampCategories.forEach(cat => {
      if (cat.clamps.length > 0) {
        categoriesWithClamps.push(cat.category);
      }
    });
    setExpandedCategories(categoriesWithClamps);
  }, []);

  // Listen for clamp placed event to exit placement mode
  useEffect(() => {
    const handleClampPlaced = () => {
      setIsPlacementMode(false);
      setIsProcessing(false);
    };
    
    const handlePlacementCancelled = () => {
      setIsPlacementMode(false);
      setIsProcessing(false);
    };
    
    const handleClampProcessingStart = () => {
      setIsProcessing(true);
    };
    
    window.addEventListener('clamp-placed', handleClampPlaced);
    window.addEventListener('clamp-placement-cancelled', handlePlacementCancelled);
    window.addEventListener('clamp-processing-start', handleClampProcessingStart);
    
    return () => {
      window.removeEventListener('clamp-placed', handleClampPlaced);
      window.removeEventListener('clamp-placement-cancelled', handlePlacementCancelled);
      window.removeEventListener('clamp-processing-start', handleClampProcessingStart);
    };
  }, []);

  const handleImageError = (clampId: string) => {
    setImageErrors(prev => new Set(prev).add(clampId));
  };

  const getCategoryIcon = (category: ClampCategory) => {
    if (category === 'Toggle Clamps Vertical') {
      return <ArrowDown className="w-4 h-4" />;
    }
    return <ArrowRight className="w-4 h-4" />;
  };

  const handleStartPlacement = () => {
    if (!selectedClamp) return;
    
    setIsPlacementMode(true);
    
    // Dispatch event to 3DScene to enter placement mode
    window.dispatchEvent(new CustomEvent('clamp-start-placement', { 
      detail: { 
        clampModelId: selectedClamp.id,
        clampCategory: selectedClamp.category
      } 
    }));
  };

  const handleCancelPlacement = () => {
    setIsPlacementMode(false);
    window.dispatchEvent(new CustomEvent('clamp-cancel-placement'));
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
      {/* Clamps Status - Small indicator */}
      {clampsCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Check className="w-5 h-5 text-green-500" />
          <span className="text-sm font-tech text-green-600">
            {clampsCount} clamp{clampsCount !== 1 ? 's' : ''} placed
          </span>
          <span className="text-xs text-muted-foreground font-tech ml-auto">
            View in Properties Panel →
          </span>
        </div>
      )}

      {/* Clamp Categories */}
      <div className="space-y-2">
        <p className="text-xs font-tech text-muted-foreground uppercase tracking-wider">
          Select Clamp Type
        </p>
        
        <ScrollArea className="h-[300px]">
          <Accordion 
            type="multiple" 
            value={expandedCategories}
            onValueChange={setExpandedCategories}
            className="space-y-1"
          >
            {categories.map((categoryGroup) => (
              <AccordionItem 
                key={categoryGroup.category} 
                value={categoryGroup.category}
                className="border rounded-lg tech-glass overflow-hidden"
              >
                <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-primary/5 [&[data-state=open]]:bg-primary/5">
                  <div className="flex items-center gap-2 flex-1">
                    {getCategoryIcon(categoryGroup.category)}
                    <div className="flex-1 text-left">
                      <p className="text-xs font-tech font-medium">
                        {categoryGroup.category}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-tech">
                        {CATEGORY_INFO[categoryGroup.category]?.description}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] mr-2">
                      {categoryGroup.clamps.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                
                <AccordionContent className="pb-0">
                  <div className="px-1 pb-2 space-y-0.5">
                    {categoryGroup.clamps.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground font-tech italic py-2 px-1">
                        No clamps available in this category
                      </p>
                    ) : (
                      categoryGroup.clamps.map((clamp) => {
                        const isSelected = selectedClamp?.id === clamp.id;
                        const isExpanded = expandedClamp === clamp.id;
                        
                        return (
                          <Collapsible
                            key={clamp.id}
                            open={isExpanded}
                            onOpenChange={(open) => setExpandedClamp(open ? clamp.id : null)}
                          >
                            <div
                              className={`
                                border rounded-md transition-all overflow-hidden
                                ${isSelected ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'}
                              `}
                            >
                              {/* Compact Row - Always Visible */}
                              <div
                                className="flex items-center gap-1.5 py-1 px-1.5 cursor-pointer"
                                onClick={() => setSelectedClamp(clamp)}
                              >
                                {/* Thumbnail */}
                                <div className="w-6 h-6 rounded bg-muted/50 flex items-center justify-center overflow-hidden flex-shrink-0">
                                  {clamp.imagePath && !imageErrors.has(clamp.id) ? (
                                    <img 
                                      src={clamp.imagePath} 
                                      alt={clamp.name}
                                      className="w-full h-full object-cover"
                                      onError={() => handleImageError(clamp.id)}
                                    />
                                  ) : (
                                    <Pin className="w-3 h-3 text-muted-foreground" />
                                  )}
                                </div>
                                
                                {/* Name and Info */}
                                <div className="flex-1 min-w-0 text-left">
                                  <p className="text-[10px] font-tech font-medium truncate">
                                    {clamp.name}
                                  </p>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {clamp.info.force && (
                                      <p className="text-[8px] text-muted-foreground font-tech">
                                        Force: {clamp.info.force}
                                      </p>
                                    )}
                                    {clamp.info.feature && (
                                      <Badge variant="outline" className="text-[7px] h-3 px-1 font-tech">
                                        {clamp.info.feature}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Expand Toggle */}
                                <CollapsibleTrigger asChild>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted/80 flex-shrink-0 cursor-pointer"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="w-3 h-3" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3" />
                                    )}
                                  </div>
                                </CollapsibleTrigger>
                              </div>
                              
                              {/* Expanded Content */}
                              <CollapsibleContent>
                                <div className="px-1.5 pb-1.5 pt-0 border-t border-border/50">
                                  <div className="pt-1.5 space-y-1.5">
                                    {/* Full Image */}
                                    {clamp.imagePath && !imageErrors.has(clamp.id) && (
                                      <div className="w-full h-20 rounded bg-muted overflow-hidden">
                                        <img 
                                          src={clamp.imagePath} 
                                          alt={clamp.name}
                                          className="w-full h-full object-contain"
                                          onError={() => handleImageError(clamp.id)}
                                        />
                                      </div>
                                    )}
                                    
                                    {/* Details */}
                                    <div className="text-[10px] text-muted-foreground font-tech space-y-0.5">
                                      {clamp.info.force && (
                                        <p>
                                          <span className="text-foreground">Clamping Force:</span> {clamp.info.force}
                                        </p>
                                      )}
                                      {clamp.info.feature && (
                                        <p>
                                          <span className="text-foreground">Feature:</span> {clamp.info.feature}
                                        </p>
                                      )}
                                      <p>
                                        <span className="text-foreground">Category:</span> {clamp.category}
                                      </p>
                                    </div>
                                    
                                    {/* External Link */}
                                    {clamp.info.url && (
                                      <a 
                                        href={clamp.info.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-primary hover:underline font-tech inline-flex items-center gap-1"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        View Details
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        );
                      })
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollArea>
      </div>

      {/* Placement Mode Prompt */}
      {isPlacementMode && selectedClamp && !isProcessing && (
        <Alert className="bg-primary/10 border-primary/30">
          <MousePointer className="h-4 w-4 text-primary" />
          <AlertDescription className="text-xs font-tech">
            <span className="font-semibold text-primary">Click on part surface</span> to place the clamp.
            {selectedClamp.category === 'Toggle Clamps Vertical' && (
              <span className="block mt-1 text-muted-foreground">
                The fixture point will rest on the selected surface.
              </span>
            )}
          </AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-2 top-2 h-6 w-6 p-0"
            onClick={handleCancelPlacement}
          >
            <X className="h-3 w-3" />
          </Button>
        </Alert>
      )}

      {/* Processing Progress Card */}
      {isProcessing && clampProgress.stage !== 'idle' && (
        <ProcessingCard progress={clampProgress} />
      )}

      {/* Place Clamp Button */}
      {selectedClamp && !isPlacementMode && !isProcessing && (
        <Button
          variant="default"
          size="sm"
          className="w-full font-tech"
          onClick={handleStartPlacement}
        >
          <Plus className="w-4 h-4 mr-2" />
          Place {selectedClamp.name}
        </Button>
      )}

      {/* Cancel Placement Button (shown during placement mode) */}
      {isPlacementMode && !isProcessing && (
        <Button
          variant="outline"
          size="sm"
          className="w-full font-tech"
          onClick={handleCancelPlacement}
        >
          <X className="w-4 h-4 mr-2" />
          Cancel Placement
        </Button>
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
          <p className="text-[10px] italic">
            Placed clamps are shown in the Properties Panel.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default ClampsStepContent;
