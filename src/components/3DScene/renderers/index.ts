/**
 * Renderer components for 3DScene
 * Export all renderer components from a single entry point
 */

export { default as ScalableGrid } from './ScalableGrid';
export { default as ModelMesh } from './ModelMesh';
export type { ModelMeshProps } from './ModelMesh';

export { 
  DebugPerimeterLine, 
  DebugSilhouetteLine, 
  FixtureComponent 
} from './DebugVisualization';
export type { 
  DebugPerimeterLineProps, 
  DebugSilhouetteLineProps, 
  FixtureComponentProps 
} from './DebugVisualization';

export { LabelsRenderer } from './LabelsRenderer';
export type { LabelsRendererProps } from './LabelsRenderer';

export { SupportsRenderer } from './SupportsRenderer';
export type { SupportsRendererProps } from './SupportsRenderer';

export { SceneLighting } from './SceneLighting';
