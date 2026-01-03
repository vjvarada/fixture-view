/**
 * Workflow Navigation Context
 * 
 * React context that provides centralized navigation state management
 * for workflow steps, accordion panels, and component selection.
 * 
 * Features:
 * - Auto-open accordion when step changes or component is placed
 * - Navigate to step when component is double-clicked
 * - Sync mini-map with current step
 * - Centralized selection state management
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type {
  WorkflowStepId,
  AccordionSection,
  ComponentSelection,
  NavigationState,
  NavigationActions,
  ComponentCategory,
} from './types';
import {
  CATEGORY_TO_STEP,
  CATEGORY_TO_ACCORDION,
  STEP_TO_ACCORDION,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────────────────

interface NavigationContextValue extends NavigationState, NavigationActions {}

const NavigationContext = createContext<NavigationContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────────────

type NavigationAction =
  | { type: 'GO_TO_STEP'; step: WorkflowStepId }
  | { type: 'EXPAND_ACCORDION'; section: AccordionSection | null }
  | { type: 'SELECT_COMPONENT'; selection: ComponentSelection | null }
  | { type: 'COMPLETE_STEP'; step: WorkflowStepId }
  | { type: 'SKIP_STEP'; step: WorkflowStepId }
  | { type: 'RESET' };

const initialState: NavigationState = {
  activeStep: 'import',
  expandedAccordion: 'parts',
  selectedComponent: null,
  completedSteps: [],
  skippedSteps: [],
};

function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'GO_TO_STEP': {
      const newAccordion = STEP_TO_ACCORDION[action.step] || state.expandedAccordion;
      return {
        ...state,
        activeStep: action.step,
        expandedAccordion: newAccordion,
      };
    }
    
    case 'EXPAND_ACCORDION':
      return {
        ...state,
        expandedAccordion: action.section,
      };
    
    case 'SELECT_COMPONENT': {
      if (!action.selection) {
        return {
          ...state,
          selectedComponent: null,
        };
      }
      
      // Auto-expand accordion for the selected component's category
      const accordion = CATEGORY_TO_ACCORDION[action.selection.category];
      return {
        ...state,
        selectedComponent: action.selection,
        expandedAccordion: accordion || state.expandedAccordion,
      };
    }
    
    case 'COMPLETE_STEP':
      if (state.completedSteps.includes(action.step)) {
        return state;
      }
      return {
        ...state,
        completedSteps: [...state.completedSteps, action.step],
        skippedSteps: state.skippedSteps.filter(s => s !== action.step),
      };
    
    case 'SKIP_STEP':
      if (state.skippedSteps.includes(action.step)) {
        return state;
      }
      return {
        ...state,
        skippedSteps: [...state.skippedSteps, action.step],
        completedSteps: state.completedSteps.filter(s => s !== action.step),
      };
    
    case 'RESET':
      return initialState;
    
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Component
// ─────────────────────────────────────────────────────────────────────────────

interface WorkflowNavigationProviderProps {
  children: React.ReactNode;
  /** Initial step to start on */
  initialStep?: WorkflowStepId;
  /** Callback when step changes */
  onStepChange?: (step: WorkflowStepId, previousStep: WorkflowStepId) => void;
  /** Callback when accordion changes */
  onAccordionChange?: (section: AccordionSection | null) => void;
  /** Callback when component is selected */
  onComponentSelect?: (selection: ComponentSelection | null) => void;
  /** Callback when component is highlighted (double-click) */
  onComponentHighlight?: (selection: ComponentSelection) => void;
}

export const WorkflowNavigationProvider: React.FC<WorkflowNavigationProviderProps> = ({
  children,
  initialStep = 'import',
  onStepChange,
  onAccordionChange,
  onComponentSelect,
  onComponentHighlight,
}) => {
  const [state, dispatch] = useReducer(navigationReducer, {
    ...initialState,
    activeStep: initialStep,
    expandedAccordion: STEP_TO_ACCORDION[initialStep] || 'parts',
  });

  // Action: Navigate to step
  const goToStep = useCallback((step: WorkflowStepId) => {
    const previousStep = state.activeStep;
    dispatch({ type: 'GO_TO_STEP', step });
    
    // Fire event for external listeners
    window.dispatchEvent(new CustomEvent('workflow-step-changed', {
      detail: { step, previousStep }
    }));
    
    onStepChange?.(step, previousStep);
  }, [state.activeStep, onStepChange]);

  // Action: Expand accordion
  const expandAccordion = useCallback((section: AccordionSection | null) => {
    dispatch({ type: 'EXPAND_ACCORDION', section });
    
    window.dispatchEvent(new CustomEvent('workflow-accordion-changed', {
      detail: { section }
    }));
    
    onAccordionChange?.(section);
  }, [onAccordionChange]);

  // Action: Select component
  const selectComponent = useCallback((selection: ComponentSelection | null) => {
    dispatch({ type: 'SELECT_COMPONENT', selection });
    
    window.dispatchEvent(new CustomEvent('workflow-component-selected', {
      detail: selection
    }));
    
    onComponentSelect?.(selection);
  }, [onComponentSelect]);

  // Action: Highlight component (double-click behavior)
  const highlightComponent = useCallback((selection: ComponentSelection) => {
    // Navigate to the step for this component type
    const step = CATEGORY_TO_STEP[selection.category];
    if (step) {
      dispatch({ type: 'GO_TO_STEP', step });
    }
    
    // Select the component (which will also expand the accordion)
    dispatch({ type: 'SELECT_COMPONENT', selection });
    
    // Fire highlight event
    window.dispatchEvent(new CustomEvent('workflow-component-highlighted', {
      detail: selection
    }));
    
    onComponentHighlight?.(selection);
  }, [onComponentHighlight]);

  // Action: Complete step
  const completeStep = useCallback((step: WorkflowStepId) => {
    dispatch({ type: 'COMPLETE_STEP', step });
    
    window.dispatchEvent(new CustomEvent('workflow-step-completed', {
      detail: { step }
    }));
  }, []);

  // Action: Skip step
  const skipStep = useCallback((step: WorkflowStepId) => {
    dispatch({ type: 'SKIP_STEP', step });
    
    window.dispatchEvent(new CustomEvent('workflow-step-skipped', {
      detail: { step }
    }));
  }, []);

  // Action: Reset
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    
    window.dispatchEvent(new CustomEvent('workflow-navigation-reset'));
  }, []);

  // Listen for external navigation requests
  useEffect(() => {
    const handleNavigateToStep = (e: CustomEvent<{ step: WorkflowStepId }>) => {
      goToStep(e.detail.step);
    };

    const handleHighlightComponent = (e: CustomEvent<ComponentSelection>) => {
      highlightComponent(e.detail);
    };

    const handleSelectComponent = (e: CustomEvent<ComponentSelection | null>) => {
      selectComponent(e.detail);
    };

    window.addEventListener('navigate-to-step', handleNavigateToStep as EventListener);
    window.addEventListener('highlight-component', handleHighlightComponent as EventListener);
    window.addEventListener('select-component-nav', handleSelectComponent as EventListener);

    return () => {
      window.removeEventListener('navigate-to-step', handleNavigateToStep as EventListener);
      window.removeEventListener('highlight-component', handleHighlightComponent as EventListener);
      window.removeEventListener('select-component-nav', handleSelectComponent as EventListener);
    };
  }, [goToStep, highlightComponent, selectComponent]);

  const value: NavigationContextValue = {
    ...state,
    goToStep,
    expandAccordion,
    selectComponent,
    highlightComponent,
    completeStep,
    skipStep,
    reset,
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to access workflow navigation state and actions
 */
export function useWorkflowNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useWorkflowNavigation must be used within a WorkflowNavigationProvider');
  }
  return context;
}

/**
 * Hook to get navigation state without actions (for display components)
 */
export function useNavigationState(): NavigationState {
  const { activeStep, expandedAccordion, selectedComponent, completedSteps, skippedSteps } = useWorkflowNavigation();
  return { activeStep, expandedAccordion, selectedComponent, completedSteps, skippedSteps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a navigation event to go to a specific step
 */
export function navigateToStep(step: WorkflowStepId): void {
  window.dispatchEvent(new CustomEvent('navigate-to-step', {
    detail: { step }
  }));
}

/**
 * Dispatch a navigation event to highlight a component
 */
export function highlightComponentNav(category: ComponentCategory, id: string, subId?: string): void {
  window.dispatchEvent(new CustomEvent('highlight-component', {
    detail: { category, id, subId }
  }));
}

/**
 * Dispatch a navigation event to select a component
 */
export function selectComponentNav(category: ComponentCategory, id: string, subId?: string): void {
  window.dispatchEvent(new CustomEvent('select-component-nav', {
    detail: { category, id, subId }
  }));
}

/**
 * Clear component selection
 */
export function clearComponentSelection(): void {
  window.dispatchEvent(new CustomEvent('select-component-nav', {
    detail: null
  }));
}
