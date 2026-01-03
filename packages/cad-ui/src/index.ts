/**
 * @rapidtool/cad-ui
 * 
 * Reusable React components for building CAD applications.
 * Works with Three.js/React Three Fiber for 3D rendering.
 * 
 * Features:
 * - Layout components (CADLayout - main app shell)
 * - Toolbar components (VerticalToolbar - customizable workflow toolbar)
 * - Panel components (CollapsiblePanel - accordion panels for properties)
 * - Viewport components (ViewCube, ScalableGrid, SnapIndicator)
 * - Transform controls (SelectableTransformControls)
 * - Loading components (LoadingIndicator, LoadingOverlay)
 * - Primitive inputs (NumberInput, PositionControl, RotationControl)
 * 
 * Usage:
 * ```tsx
 * import { CADLayout, VerticalToolbar, CollapsiblePanel, ViewCube } from '@rapidtool/cad-ui';
 * 
 * function MyCADApp() {
 *   return (
 *     <CADLayout
 *       toolbar={<VerticalToolbar items={myTools} />}
 *       sidebar={<CollapsiblePanel title="Properties">...</CollapsiblePanel>}
 *     >
 *       <Canvas>
 *         <ViewCube />
 *         ...
 *       </Canvas>
 *     </CADLayout>
 *   );
 * }
 * ```
 */

// Layout components
export * from './layout';

// Toolbar components
export * from './toolbar';

// Panel components
export * from './panels';

// Viewport components
export * from './viewport';

// Controls
export * from './controls';

// Transform components
export * from './transform';

// Loading components  
export * from './loading';

// Primitive input components
export * from './primitives';

// Navigation (workflow step management)
export * from './navigation';

// State management (Zustand stores)
export * from './stores';
