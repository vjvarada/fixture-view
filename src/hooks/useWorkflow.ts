/**
 * Workflow Hooks for Fixture App
 * 
 * Provides fixture-specific workflow configuration and hooks.
 * Configures the generic workflow store with fixture design steps.
 */

import { useEffect, useCallback } from 'react';
import { useWorkflowStore } from '@rapidtool/cad-ui';

// Fixture workflow steps (matches existing WORKFLOW_STEPS)
export const FIXTURE_WORKFLOW_STEPS = [
  'import',
  'baseplates',
  'supports',
  'cavity',
  'clamps',
  'labels',
  'drill',
  'export',
] as const;

export type FixtureWorkflowStep = typeof FIXTURE_WORKFLOW_STEPS[number];

/**
 * Initialize the workflow store with fixture-specific steps
 * Call this once at app initialization (e.g., in App.tsx or AppShell)
 */
export function useInitializeFixtureWorkflow() {
  const configure = useWorkflowStore((state) => state.configure);
  
  useEffect(() => {
    configure({
      steps: [...FIXTURE_WORKFLOW_STEPS],
      initialStep: 'import',
      strictOrder: false, // Allow jumping between steps
    });
  }, [configure]);
}

/**
 * Hook for workflow navigation
 * Replaces: const [activeStep, setActiveStep] = useState<WorkflowStep>('import')
 */
export function useWorkflowStep() {
  const activeStep = useWorkflowStore((state) => state.activeStep) as FixtureWorkflowStep | null;
  const goToStep = useWorkflowStore((state) => state.goToStep);
  
  const setActiveStep = useCallback((step: FixtureWorkflowStep) => {
    goToStep(step);
  }, [goToStep]);
  
  return [activeStep ?? 'import' as FixtureWorkflowStep, setActiveStep] as const;
}

/**
 * Hook for completed steps
 * Replaces: const [completedSteps, setCompletedSteps] = useState<WorkflowStep[]>([])
 */
export function useCompletedSteps() {
  const completedSteps = useWorkflowStore((state) => state.completedSteps) as FixtureWorkflowStep[];
  const completeStep = useWorkflowStore((state) => state.completeStep);
  const resetProgress = useWorkflowStore((state) => state.resetProgress);
  
  const markCompleted = useCallback((step: FixtureWorkflowStep) => {
    completeStep(step);
  }, [completeStep]);
  
  // For backward compatibility - allows setting the array directly
  const setCompletedSteps = useCallback((steps: FixtureWorkflowStep[] | ((prev: FixtureWorkflowStep[]) => FixtureWorkflowStep[])) => {
    // If it's a function, call it with current state
    if (typeof steps === 'function') {
      const newSteps = steps(completedSteps);
      // Reset and re-add
      resetProgress();
      newSteps.forEach(step => completeStep(step));
    } else {
      resetProgress();
      steps.forEach(step => completeStep(step));
    }
  }, [completedSteps, completeStep, resetProgress]);
  
  return [completedSteps, setCompletedSteps, markCompleted] as const;
}

/**
 * Hook for skipped steps  
 * Replaces: const [skippedSteps, setSkippedSteps] = useState<WorkflowStep[]>([])
 */
export function useSkippedSteps() {
  const skippedSteps = useWorkflowStore((state) => state.skippedSteps) as FixtureWorkflowStep[];
  const skipStep = useWorkflowStore((state) => state.skipStep);
  
  const markSkipped = useCallback((step: FixtureWorkflowStep) => {
    skipStep(step);
  }, [skipStep]);
  
  // For backward compatibility - allows setting the array directly
  const setSkippedSteps = useCallback((steps: FixtureWorkflowStep[] | ((prev: FixtureWorkflowStep[]) => FixtureWorkflowStep[])) => {
    if (typeof steps === 'function') {
      // Get new steps from function
      const currentSkipped = useWorkflowStore.getState().skippedSteps as FixtureWorkflowStep[];
      const newSteps = steps(currentSkipped);
      // Clear current and re-add
      newSteps.forEach(step => skipStep(step));
    } else {
      steps.forEach(step => skipStep(step));
    }
  }, [skipStep]);
  
  return [skippedSteps, setSkippedSteps, markSkipped] as const;
}

/**
 * Hook for workflow navigation actions
 */
export function useWorkflowNavigation() {
  const goToStep = useWorkflowStore((state) => state.goToStep);
  const nextStep = useWorkflowStore((state) => state.nextStep);
  const prevStep = useWorkflowStore((state) => state.prevStep);
  const goBack = useWorkflowStore((state) => state.goBack);
  
  return { goToStep, nextStep, prevStep, goBack };
}

/**
 * Hook for the full workflow store (for advanced use cases)
 */
export function useWorkflow() {
  return useWorkflowStore();
}
