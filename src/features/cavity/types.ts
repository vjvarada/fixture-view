/**
 * Cavity Feature Types
 * 
 * Re-exports CavitySettings from cad-core and defines app-specific types.
 */

// Re-export core types from cad-core
export type { CavitySettings } from '@rapidtool/cad-core';

/**
 * Props for the CavityAccordion component
 */
export interface CavityAccordionProps {
  settings: import('@rapidtool/cad-core').CavitySettings;
  isProcessing?: boolean;
  hasPreview?: boolean;
  hasModel?: boolean;
}
