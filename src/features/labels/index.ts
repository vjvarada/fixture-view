/**
 * Labels Feature Module
 * 
 * Components and utilities for 3D text label placement on baseplates.
 * 
 * @example
 * `typescript
 * import { LabelMesh, LabelTransformControls, LabelConfig } from '@/features/labels';
 * `
 */

// Types
export * from './types';

// Components
export { default as LabelMesh } from './components/LabelMesh';
export { default as LabelTransformControls } from './components/LabelTransformControls';
export { default as LabelsAccordion } from './components/LabelsAccordion';
