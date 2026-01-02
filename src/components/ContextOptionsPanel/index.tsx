import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload,
  Grid3X3,
  Cuboid,
  SquaresSubtract,
  Pin,
  Type,
  CircleDashed,
  Scissors,
  DownloadCloud,
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  SkipForward,
  MinusCircle
} from 'lucide-react';
import { ProcessedFile } from '@/modules/FileImport/types';
import {
  CATEGORY_TO_STEP,
  STEP_TO_ACCORDION,
  type ComponentCategory
} from '@rapidtool/cad-ui';

// Step definitions for the workflow
export type WorkflowStep = 
  | 'import'
  | 'baseplates'
  | 'supports'
  | 'cavity'
  | 'clamps'
  | 'labels'
  | 'drill'
  | 'export';

interface StepConfig {
  id: WorkflowStep;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  helpText: string[];
  isOptional?: boolean;
}

const WORKFLOW_STEPS: StepConfig[] = [
  {
    id: 'import',
    label: 'Import',
    description: 'Upload workpieces and models',
    icon: Upload,
    helpText: [
      'Double-click the name on the title bar to rename your project',
      'Drag & drop STL, OBJ, or GLTF files',
      'Select the correct unit system'
    ]
  },
  {
    id: 'baseplates',
    label: 'Baseplates',
    description: 'Configure the fixture base',
    icon: Grid3X3,
    helpText: [
      'Choose a baseplate type that fits your needs',
      'Grid plates provide regular mounting points',
      'Custom plates can be shaped to your workpiece'
    ]
  },
  {
    id: 'supports',
    label: 'Supports',
    description: 'Create support structures',
    icon: Cuboid,
    helpText: [
      'Click on the baseplate to place supports',
      'Drag to adjust support height',
      'Double-click to edit support parameters'
    ]
  },
  {
    id: 'clamps',
    label: 'Clamps',
    description: 'Add clamping mechanisms',
    icon: Pin,
    helpText: [
      'Select from standard clamp components',
      'Position clamps around your workpiece',
      'Ensure adequate clamping force distribution'
    ],
    isOptional: true
  },
  {
    id: 'labels',
    label: 'Labels',
    description: 'Add identification labels',
    icon: Type,
    helpText: [
      'Add version numbers and identifiers',
      'Position labels on visible surfaces',
      'Embossed text for clear marking'
    ],
    isOptional: true
  },
  {
    id: 'drill',
    label: 'Mounting Holes',
    description: 'Add holes to fixture',
    icon: CircleDashed,
    helpText: [
      'Select standard hole sizes (M3-M12)',
      'Choose through hole, countersink, or counterbore',
      'Click on fixture to place mounting holes'
    ],
    isOptional: true
  },
  {
    id: 'cavity',
    label: 'Cavity',
    description: 'Subtract workpiece geometry',
    icon: SquaresSubtract,
    helpText: [
      'Select the fixture component as base',
      'Choose workpieces to subtract',
      'Adjust clearance for fit tolerance'
    ]
  },
  {
    id: 'export',
    label: 'Export',
    description: 'Export for 3D printing',
    icon: DownloadCloud,
    helpText: [
      'Choose your output format (STL, 3MF)',
      'Verify mesh integrity before export',
      'Generate print-ready files'
    ]
  }
];

interface ContextOptionsPanelProps {
  currentFile?: ProcessedFile | null;
  activeStep: WorkflowStep;
  onStepChange?: (step: WorkflowStep) => void;
  completedSteps?: WorkflowStep[];
  skippedSteps?: WorkflowStep[];
  onSkipStep?: (step: WorkflowStep) => void;
  isProcessing?: boolean;
  children?: React.ReactNode;
}

const ContextOptionsPanel: React.FC<ContextOptionsPanelProps> = ({
  currentFile,
  activeStep,
  onStepChange,
  completedSteps = [],
  skippedSteps = [],
  onSkipStep,
  isProcessing = false,
  children
}) => {
  const currentStepConfig = WORKFLOW_STEPS.find(s => s.id === activeStep);
  const currentStepIndex = WORKFLOW_STEPS.findIndex(s => s.id === activeStep);
  
  // Calculate progress percentage (completed + skipped count toward progress)
  const processedSteps = [...new Set([...completedSteps, ...skippedSteps])];
  const progressPercent = ((processedSteps.length) / WORKFLOW_STEPS.length) * 100;

  // Listen for navigation events from double-click on components
  useEffect(() => {
    const handleNavigateToStep = (event: CustomEvent<{ step: WorkflowStep }>) => {
      if (onStepChange && event.detail?.step) {
        onStepChange(event.detail.step);
      }
    };

    const handleHighlightComponent = (event: CustomEvent<{ category: string; id: string }>) => {
      if (!event.detail?.category) return;
      
      // Use centralized mapping from cad-ui
      const targetStep = CATEGORY_TO_STEP[event.detail.category as ComponentCategory];
      if (!targetStep) return;
      
      // Always navigate to the step and dispatch the event
      if (onStepChange && targetStep !== activeStep) {
        onStepChange(targetStep as WorkflowStep);
      }
      
      // Always dispatch event to ensure accordion opens
      const accordionSection = STEP_TO_ACCORDION[targetStep];
      if (accordionSection) {
        window.dispatchEvent(new CustomEvent('workflow-step-changed', {
          detail: { step: targetStep, accordion: accordionSection }
        }));
      }
    };

    window.addEventListener('navigate-to-step', handleNavigateToStep as EventListener);
    window.addEventListener('highlight-component', handleHighlightComponent as EventListener);

    return () => {
      window.removeEventListener('navigate-to-step', handleNavigateToStep as EventListener);
      window.removeEventListener('highlight-component', handleHighlightComponent as EventListener);
    };
  }, [onStepChange, activeStep]);

  // Dispatch event when step changes so accordions can sync
  useEffect(() => {
    // Use centralized mapping from cad-ui
    const accordionSection = STEP_TO_ACCORDION[activeStep];
    if (accordionSection) {
      window.dispatchEvent(new CustomEvent('workflow-step-changed', {
        detail: { step: activeStep, accordion: accordionSection }
      }));
    }
  }, [activeStep]);

  const getStepStatus = (stepId: WorkflowStep): 'completed' | 'skipped' | 'current' | 'upcoming' => {
    if (skippedSteps.includes(stepId)) return 'skipped';
    if (completedSteps.includes(stepId)) return 'completed';
    if (stepId === activeStep) return 'current';
    return 'upcoming';
  };

  // Get the next step in the workflow
  const getNextStep = (): WorkflowStep | null => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < WORKFLOW_STEPS.length) {
      return WORKFLOW_STEPS[nextIndex].id;
    }
    return null;
  };

  // Handle skip action
  const handleSkip = () => {
    if (currentStepConfig?.isOptional && onSkipStep) {
      onSkipStep(activeStep);
      const nextStep = getNextStep();
      if (nextStep && onStepChange) {
        onStepChange(nextStep);
      }
    }
  };

  const StepIcon = currentStepConfig?.icon || Upload;

  return (
    <div className="h-full flex flex-col">
      {/* Step Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <StepIcon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-tech font-semibold text-lg leading-tight">
              {currentStepConfig?.label}
            </h2>
            <p className="text-xs text-muted-foreground font-tech">
              {currentStepConfig?.description}
            </p>
          </div>
          {isProcessing && (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          )}
        </div>
        
        {/* Progress indicator */}
        <div className="flex items-center gap-2 mt-3">
          <Progress value={progressPercent} className="flex-1 h-1.5" />
          <span className="text-xs font-tech text-muted-foreground">
            Step {currentStepIndex + 1}/{WORKFLOW_STEPS.length}
          </span>
        </div>

        {/* Skip button for optional steps */}
        {currentStepConfig?.isOptional && onSkipStep && (
          <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="w-full text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/20 gap-2 font-medium"
            >
              <SkipForward className="w-4 h-4" />
              Skip this step
              <Badge className="ml-auto text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40 pointer-events-none">
                Optional
              </Badge>
            </Button>
          </div>
        )}
      </div>

      {/* Step Content - This is where step-specific UI goes */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>

      {/* Step Navigation Mini-Map */}
      <div className="p-3 border-t border-border/50">
        <div className="flex items-center justify-between gap-1">
          {WORKFLOW_STEPS.map((step, index) => {
            const status = getStepStatus(step.id);
            const IconComponent = step.icon;
            
            return (
              <button
                key={step.id}
                onClick={() => onStepChange?.(step.id)}
                className={`
                  relative flex items-center justify-center w-7 h-7 rounded-md transition-all
                  ${status === 'current' 
                    ? 'bg-primary text-primary-foreground' 
                    : status === 'completed'
                    ? 'bg-primary/20 text-primary hover:bg-primary/30'
                    : status === 'skipped'
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }
                `}
                title={`${step.label}${status === 'skipped' ? ' (Skipped)' : ''}${step.isOptional ? ' (Optional)' : ''}`}
              >
                {status === 'completed' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : status === 'skipped' ? (
                  <MinusCircle className="w-3.5 h-3.5" />
                ) : (
                  <IconComponent className="w-3.5 h-3.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ContextOptionsPanel;
export { WORKFLOW_STEPS };
export type { StepConfig };
