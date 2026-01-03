/**
 * Workflow Navigation Types
 * 
 * Type definitions for the workflow navigation system that manages
 * step transitions, accordion states, and component highlighting.
 */

/**
 * Standard workflow step identifiers
 */
export type WorkflowStepId = 
  | 'import'
  | 'baseplates'
  | 'supports'
  | 'cavity'
  | 'clamps'
  | 'labels'
  | 'drill'
  | 'export'
  | string; // Allow custom steps

/**
 * Component categories that can be selected/highlighted
 */
export type ComponentCategory = 
  | 'part'
  | 'baseplate'
  | 'support'
  | 'clamp'
  | 'label'
  | 'hole'
  | 'cavity';

/**
 * Accordion section identifiers
 */
export type AccordionSection = 
  | 'parts'
  | 'baseplate'
  | 'supports'
  | 'clamps'
  | 'labels'
  | 'holes'
  | 'cavity'
  | string; // Allow custom sections

/**
 * Maps component categories to their corresponding workflow steps
 */
export const CATEGORY_TO_STEP: Record<ComponentCategory, WorkflowStepId> = {
  part: 'import',
  baseplate: 'baseplates',
  support: 'supports',
  clamp: 'clamps',
  label: 'labels',
  hole: 'drill',
  cavity: 'cavity',
};

/**
 * Maps component categories to their accordion sections
 */
export const CATEGORY_TO_ACCORDION: Record<ComponentCategory, AccordionSection> = {
  part: 'parts',
  baseplate: 'baseplate',
  support: 'supports',
  clamp: 'clamps',
  label: 'labels',
  hole: 'holes',
  cavity: 'cavity',
};

/**
 * Maps workflow steps to their default accordion sections
 */
export const STEP_TO_ACCORDION: Record<WorkflowStepId, AccordionSection> = {
  import: 'parts',
  baseplates: 'baseplate',
  supports: 'supports',
  cavity: 'cavity',
  clamps: 'clamps',
  labels: 'labels',
  drill: 'holes',
  export: 'parts',
};

/**
 * Selection state for a component
 */
export interface ComponentSelection {
  category: ComponentCategory;
  id: string;
  subId?: string; // For nested items (e.g., baseplate section)
}

/**
 * Navigation state
 */
export interface NavigationState {
  /** Current active workflow step */
  activeStep: WorkflowStepId;
  /** Currently expanded accordion section */
  expandedAccordion: AccordionSection | null;
  /** Currently selected component */
  selectedComponent: ComponentSelection | null;
  /** Completed workflow steps */
  completedSteps: WorkflowStepId[];
  /** Skipped workflow steps */
  skippedSteps: WorkflowStepId[];
}

/**
 * Navigation actions
 */
export interface NavigationActions {
  /** Navigate to a workflow step */
  goToStep: (step: WorkflowStepId) => void;
  /** Expand an accordion section */
  expandAccordion: (section: AccordionSection | null) => void;
  /** Select a component (auto-navigates to step and expands accordion) */
  selectComponent: (selection: ComponentSelection | null) => void;
  /** Highlight a component (double-click behavior) */
  highlightComponent: (selection: ComponentSelection) => void;
  /** Mark a step as completed */
  completeStep: (step: WorkflowStepId) => void;
  /** Mark a step as skipped */
  skipStep: (step: WorkflowStepId) => void;
  /** Reset navigation state */
  reset: () => void;
}

/**
 * Event payloads for navigation events
 */
export interface NavigationEvents {
  'step-changed': { step: WorkflowStepId; previousStep: WorkflowStepId };
  'accordion-changed': { section: AccordionSection | null };
  'component-selected': ComponentSelection | null;
  'component-highlighted': ComponentSelection;
}
