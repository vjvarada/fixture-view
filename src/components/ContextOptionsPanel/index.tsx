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
  Loader2
} from 'lucide-react';
import { ProcessedFile } from '@/modules/FileImport/types';

// Step definitions for the workflow
export type WorkflowStep = 
  | 'import'
  | 'baseplates'
  | 'supports'
  | 'cavity'
  | 'clamps'
  | 'labels'
  | 'drill'
  | 'optimize'
  | 'export';

interface StepConfig {
  id: WorkflowStep;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  helpText: string[];
}

const WORKFLOW_STEPS: StepConfig[] = [
  {
    id: 'import',
    label: 'Import',
    description: 'Upload workpieces and models',
    icon: Upload,
    helpText: [
      'Drag & drop STL, OBJ, or GLTF files',
      'Select the correct unit system',
      'Review mesh quality and optimize if needed'
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
    ]
  },
  {
    id: 'labels',
    label: 'Labels',
    description: 'Add identification labels',
    icon: Type,
    helpText: [
      'Add version numbers and identifiers',
      'Position labels on visible surfaces',
      'Emboss or deboss text as needed'
    ]
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
    id: 'drill',
    label: 'Drill/Cutouts',
    description: 'Create holes and cutouts',
    icon: CircleDashed,
    helpText: [
      'Select drill locations on surfaces',
      'Choose standard hole sizes',
      'Create custom cutout shapes'
    ]
  },
  {
    id: 'optimize',
    label: 'Optimize',
    description: 'Save material and print time',
    icon: Scissors,
    helpText: [
      'Analyze material usage',
      'Generate infill patterns',
      'Reduce print time with hollowing'
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
  isProcessing?: boolean;
  children?: React.ReactNode;
}

const ContextOptionsPanel: React.FC<ContextOptionsPanelProps> = ({
  currentFile,
  activeStep,
  onStepChange,
  completedSteps = [],
  isProcessing = false,
  children
}) => {
  const currentStepConfig = WORKFLOW_STEPS.find(s => s.id === activeStep);
  const currentStepIndex = WORKFLOW_STEPS.findIndex(s => s.id === activeStep);
  
  // Calculate progress percentage
  const progressPercent = ((currentStepIndex + 1) / WORKFLOW_STEPS.length) * 100;

  const getStepStatus = (stepId: WorkflowStep): 'completed' | 'current' | 'upcoming' => {
    if (completedSteps.includes(stepId)) return 'completed';
    if (stepId === activeStep) return 'current';
    return 'upcoming';
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
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }
                `}
                title={step.label}
              >
                {status === 'completed' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
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
