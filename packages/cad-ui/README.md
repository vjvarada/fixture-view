# @rapidtool/cad-ui

Reusable React components for building CAD applications. Built on top of `@rapidtool/cad-core`, Three.js, and React Three Fiber.

## Features

- **Viewport Components** - ViewCube, ScalableGrid for 3D viewport
- **UI Primitives** - (Planned) Base components built on shadcn/ui

## Installation

This package is part of the rapidtool monorepo. It's available as a workspace dependency:

```json
{
  "dependencies": {
    "@rapidtool/cad-ui": "*"
  }
}
```

## Usage

```tsx
import {
  // Viewport Components
  ViewCube,
  ScalableGrid,
  
  // Types
  type BoundsSummary,
  type ViewOrientation,
  type GridConfig,
  
  // Also re-exports all of cad-core
  TransformController,
  CSGEngine,
} from '@rapidtool/cad-ui';

// ViewCube for camera orientation
<ViewCube 
  onViewChange={(orientation) => handleViewChange(orientation)}
  size={120}
/>

// ScalableGrid adapts to model bounds
<ScalableGrid
  bounds={modelBounds}
  mainColor={0x888888}
  subColor={0x444444}
  opacity={0.5}
/>
```

## API Reference

### Viewport Components

| Component | Description |
|-----------|-------------|
| `ViewCube` | Interactive 3D cube for camera orientation control |
| `ScalableGrid` | Adaptive floor grid that scales with model bounds |

### Types

| Type | Description |
|------|-------------|
| `BoundsSummary` | Object bounding box with computed metrics |
| `ViewOrientation` | Standard view orientations (front, back, top, etc.) |
| `GridConfig` | Configuration for ScalableGrid |

### ViewCube Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onViewChange` | `(orientation: string) => void` | Required | Callback when view changes |
| `className` | `string` | `''` | Additional CSS classes |
| `size` | `number` | `120` | Size in pixels |

### ScalableGrid Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `bounds` | `BoundsSummary \| null` | `null` | Model bounds for adaptive sizing |
| `mainColor` | `string \| number` | `0x888888` | Main grid line color |
| `subColor` | `string \| number` | `0x444444` | Subdivision line color |
| `opacity` | `number` | `0.5` | Grid line opacity |
| `divisions` | `number` | `10` | Number of grid divisions |

## Peer Dependencies

- `react` ^18.0.0
- `three` >=0.160.0
- `@react-three/fiber` ^8.0.0
- `@react-three/drei` ^9.0.0

## License

MIT
