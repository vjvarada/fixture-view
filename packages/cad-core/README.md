# @rapidtool/cad-core

Core CAD operations and utilities for building CAD applications. This package contains **pure logic** with no React dependencies.

## Features

- **Transform System** - TransformController with presets for different CAD component types
- **CSG Engine** - Boolean operations (union, subtraction, intersection) via three-bvh-csg
- **Coordinate Utilities** - CAD (Z-up) <-> Three.js (Y-up) conversion
- **CAD Operations** - Geometry manipulation utilities

## Installation

This package is part of the rapidtool monorepo. It's available as a workspace dependency:

```json
{
  "dependencies": {
    "@rapidtool/cad-core": "*"
  }
}
```

## Usage

```typescript
import {
  // Transform system
  TransformController,
  SUPPORT_TRANSFORM_CONFIG,
  CLAMP_TRANSFORM_CONFIG,
  
  // CSG engine
  CSGEngine,
  csgUtils,
  
  // Utilities
  safeNum,
  toCadPosition,
  toCadRotation,
  identityTransform,
  
  // Types
  type Transform3D,
  type TransformConfig,
  
  // CAD operations
  CADOperations,
} from '@rapidtool/cad-core';

// Create a transform controller with support preset
const controller = new TransformController(SUPPORT_TRANSFORM_CONFIG);

// Use CSG operations
const engine = new CSGEngine();
const result = engine.subtract(baseMesh, toolMesh);

// Convert coordinates
const cadPos = toCadPosition(threeJsPosition);
```

## API Reference

### Transform System

| Export | Description |
|--------|-------------|
| `TransformController` | Main controller for managing transforms |
| `SUPPORT_TRANSFORM_CONFIG` | Preset for support components |
| `CLAMP_TRANSFORM_CONFIG` | Preset for clamp components |
| `HOLE_TRANSFORM_CONFIG` | Preset for hole components |
| `LABEL_TRANSFORM_CONFIG` | Preset for label components |
| `BASEPLATE_TRANSFORM_CONFIG` | Preset for baseplate components |
| `PART_TRANSFORM_CONFIG` | Preset for imported parts |

### CSG Engine

| Export | Description |
|--------|-------------|
| `CSGEngine` | Main CSG operations class |
| `csgUtils` | Utility functions for common operations |

### Utilities

| Export | Description |
|--------|-------------|
| `safeNum` | Safe number parsing with fallback |
| `toCadPosition` | Three.js -> CAD position conversion |
| `toCadRotation` | Three.js -> CAD rotation conversion |
| `toThreePosition` | CAD -> Three.js position conversion |
| `toThreeRotation` | CAD -> Three.js rotation conversion |
| `cadToThreeAxis` | CAD axis -> Three.js axis mapping |
| `identityTransform` | Create identity transform |
| `transformsEqual` | Compare two transforms |

## License

MIT
