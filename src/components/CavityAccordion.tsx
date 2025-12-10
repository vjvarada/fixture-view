import React from 'react';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Box, Eye, Loader2 } from 'lucide-react';
import { CavitySettings } from '@/lib/offset/types';

interface CavityAccordionProps {
  settings: CavitySettings;
  isProcessing?: boolean;
  hasPreview?: boolean;
  hasModel?: boolean;
}

/**
 * CavityAccordion - Properties panel view for cavity status
 * 
 * This accordion shows the current cavity settings and preview status.
 * Main controls for cavity creation are in CavityStepContent (ContextOptionsPanel).
 */
const CavityAccordion: React.FC<CavityAccordionProps> = ({
  settings,
  isProcessing = false,
  hasPreview = false,
  hasModel = false,
}) => {
  if (!hasModel) {
    return null;
  }

  return (
    <AccordionItem value="cavity" className="border-border/50">
      <AccordionTrigger className="py-2 text-xs font-tech hover:no-underline">
        <div className="flex items-center gap-2 flex-1">
          <Box className="w-3.5 h-3.5 text-primary" />
          Cavity
          {isProcessing && (
            <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4 bg-amber-500/20 text-amber-600">
              <Loader2 className="w-2 h-2 mr-1 animate-spin" />
              Processing
            </Badge>
          )}
          {!isProcessing && hasPreview && (
            <Badge variant="secondary" className="ml-auto font-tech text-[8px] h-4 bg-green-500/20 text-green-600">
              <Eye className="w-2 h-2 mr-1" />
              Preview Active
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 px-1">
        <div className="space-y-3">
          {/* Current Settings Display */}
          <div className="text-[10px] font-tech text-muted-foreground space-y-2">
            <p className="text-[9px] uppercase tracking-wider mb-2">Current Settings</p>
            
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-muted/30 rounded p-2">
              <span className="text-muted-foreground">Offset Distance:</span>
              <span className="font-mono">{settings.offsetDistance.toFixed(2)} mm</span>
              
              <span className="text-muted-foreground">Resolution:</span>
              <span className="font-mono">{settings.pixelsPerUnit} px/unit</span>
            </div>
          </div>

          {/* Status Info */}
          {hasPreview && (
            <div className="text-[9px] text-muted-foreground bg-green-500/10 rounded p-2 flex items-center gap-2">
              <Eye className="w-3 h-3 text-green-600" />
              <span>
                Cavity preview is visible in the 3D view. 
                Use the Cavity step panel to execute or clear.
              </span>
            </div>
          )}

          {!hasPreview && !isProcessing && (
            <div className="text-[9px] text-muted-foreground italic text-center py-2">
              Use the Cavity step in the workflow panel to generate a preview.
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

export default CavityAccordion;
