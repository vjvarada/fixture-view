/**
 * useWorkflowState Hook
 * 
 * Manages the workflow step state for the CAD application.
 * Tracks active step, completed steps, and skipped steps.
 */

import { useState, useCallback } from 'react';
import type { WorkflowStep } from '@/components/ContextOptionsPanel';

export interface UseWorkflowStateReturn {
  /** Currently active workflow step */
  activeStep: WorkflowStep;
  /** Array of completed workflow steps */
  completedSteps: WorkflowStep[];
  /** Array of skipped workflow steps */
  skippedSteps: WorkflowStep[];
  /** Set the active workflow step */
  setActiveStep: (step: WorkflowStep) => void;
  /** Mark a step as completed */
  markStepCompleted: (step: WorkflowStep) => void;
  /** Mark a step as incomplete (remove from completed) */
  markStepIncomplete: (step: WorkflowStep) => void;
  /** Skip a step */
  skipStep: (step: WorkflowStep) => void;
  /** Unskip a step */
  unskipStep: (step: WorkflowStep) => void;
  /** Check if a step is completed */
  isStepCompleted: (step: WorkflowStep) => boolean;
  /** Check if a step is skipped */
  isStepSkipped: (step: WorkflowStep) => boolean;
  /** Reset all workflow state */
  resetWorkflow: () => void;
}

export function useWorkflowState(
  initialStep: WorkflowStep = 'import'
): UseWorkflowStateReturn {
  const [activeStep, setActiveStep] = useState<WorkflowStep>(initialStep);
  const [completedSteps, setCompletedSteps] = useState<WorkflowStep[]>([]);
  const [skippedSteps, setSkippedSteps] = useState<WorkflowStep[]>([]);

  const markStepCompleted = useCallback((step: WorkflowStep) => {
    setCompletedSteps(prev => {
      if (prev.includes(step)) return prev;
      return [...prev, step];
    });
  }, []);

  const markStepIncomplete = useCallback((step: WorkflowStep) => {
    setCompletedSteps(prev => prev.filter(s => s !== step));
  }, []);

  const skipStep = useCallback((step: WorkflowStep) => {
    setSkippedSteps(prev => {
      if (prev.includes(step)) return prev;
      return [...prev, step];
    });
  }, []);

  const unskipStep = useCallback((step: WorkflowStep) => {
    setSkippedSteps(prev => prev.filter(s => s !== step));
  }, []);

  const isStepCompleted = useCallback(
    (step: WorkflowStep) => completedSteps.includes(step),
    [completedSteps]
  );

  const isStepSkipped = useCallback(
    (step: WorkflowStep) => skippedSteps.includes(step),
    [skippedSteps]
  );

  const resetWorkflow = useCallback(() => {
    setActiveStep(initialStep);
    setCompletedSteps([]);
    setSkippedSteps([]);
  }, [initialStep]);

  return {
    activeStep,
    completedSteps,
    skippedSteps,
    setActiveStep,
    markStepCompleted,
    markStepIncomplete,
    skipStep,
    unskipStep,
    isStepCompleted,
    isStepSkipped,
    resetWorkflow,
  };
}
