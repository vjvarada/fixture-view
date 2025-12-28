# Fixture View - Comprehensive Refactoring Plan

## Executive Summary

This document outlines the strategic refactoring plan to transform the fixture-view codebase into a **modular, production-ready CAD application framework**. The goal is to create a reusable foundation for building step-wise CAD applications.

---

## Current State Analysis

### Codebase Statistics
- **Total Components**: 50+ React components
- **3DScene.tsx**: 7,200+ lines (primary candidate for decomposition)
- **AppShell.tsx**: 2,000+ lines (monolithic orchestration)
- **Transform Controls**: 4+ duplicate implementations
- **CSG Engines**: Multiple overlapping implementations

### Architecture Issues
1. **Monolithic Components** - `3DScene.tsx` handles everything from rendering to CSG
2. **Duplicated Logic** - Transform controls reimplemented for each entity type
3. **Tight Coupling** - Business logic mixed with UI components
4. **Stub Code** - Leftover prototyping code (`replicad/`, unused components)
5. **Event-Driven Spaghetti** - Heavy reliance on `window.dispatchEvent` for communication

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        @rapidtool/cad-core                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  Transform  │  │     CSG     │  │   Viewer    │  │   Scene    │ │
│  │   System    │  │   Engine    │  │   System    │  │   Graph    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        @rapidtool/cad-ui                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   Wizard    │  │   Panel     │  │    3D       │  │ Properties │ │
│  │   System    │  │  Components │  │  Viewport   │  │   Editor   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         fixture-view                                │
│           (Application using cad-core + cad-ui)                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

### 1. `@rapidtool/cad-core` (Pure Logic)
```
packages/cad-core/
├── src/
│   ├── transform/           # Transform system
│   │   ├── TransformController.ts
│   │   ├── ConstrainedTransform.ts
│   │   ├── SnapSystem.ts
│   │   └── types.ts
│   ├── csg/                 # CSG operations
│   │   ├── CSGEngine.ts
│   │   ├── BooleanOperations.ts
│   │   ├── WorkerPool.ts
│   │   └── types.ts
│   ├── geometry/            # Geometry utilities
│   │   ├── MeshAnalysis.ts
│   │   ├── MeshRepair.ts
│   │   ├── Decimation.ts
│   │   └── types.ts
│   ├── scene/               # Scene graph management
│   │   ├── SceneManager.ts
│   │   ├── EntityManager.ts
│   │   └── types.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

### 2. `@rapidtool/cad-ui` (React Components)
```
packages/cad-ui/
├── src/
│   ├── viewport/            # 3D viewport components
│   │   ├── Viewport.tsx
│   │   ├── ViewCube.tsx
│   │   ├── GridSystem.tsx
│   │   └── OrbitControls.tsx
│   ├── transform/           # Transform UI components
│   │   ├── PivotGizmo.tsx
│   │   ├── TransformOverlay.tsx
│   │   └── ConstraintIndicator.tsx
│   ├── wizard/              # Step-wise workflow system
│   │   ├── WizardProvider.tsx
│   │   ├── WizardStep.tsx
│   │   ├── StepIndicator.tsx
│   │   └── types.ts
│   ├── panels/              # Panel components
│   │   ├── PropertiesPanel.tsx
│   │   ├── AccordionPanel.tsx
│   │   └── CollapsibleSection.tsx
│   ├── primitives/          # Base UI primitives (from shadcn)
│   │   └── ... (current ui/ folder)
│   └── index.ts
├── package.json
└── tsconfig.json
```

### 3. `fixture-view` (Application)
```
src/
├── features/                # Feature-based modules
│   ├── import/             # File import feature
│   ├── baseplate/          # Baseplate configuration
│   ├── supports/           # Support placement
│   ├── clamps/             # Clamp placement
│   ├── holes/              # Mounting holes
│   ├── labels/             # Label system
│   ├── cavity/             # Cavity/CSG operations
│   └── export/             # Export functionality
├── app/                    # App-level orchestration
│   ├── App.tsx
│   ├── AppShell.tsx
│   └── routes/
├── shared/                 # Shared app utilities
│   ├── hooks/
│   ├── utils/
│   └── constants/
└── main.tsx
```

---

## Refactoring Phases

### Phase 1: Cleanup & Foundation (Week 1)
- Remove stub/unused code
- Extract reusable transform system
- Create proper TypeScript interfaces

### Phase 2: Core Module Extraction (Week 2-3)
- Extract CSG engine to core package
- Create unified transform controller
- Build scene management system

### Phase 3: UI Component Library (Week 3-4)
- Extract viewport components
- Build wizard/workflow system
- Create panel component library

### Phase 4: Feature Restructuring (Week 4-5)
- Decompose `3DScene.tsx`
- Refactor `AppShell.tsx`
- Implement feature modules

### Phase 5: Integration & Testing (Week 5-6)
- Integration testing
- Performance optimization
- Documentation completion

---

## Success Metrics

1. **Code Modularity**: No file > 500 lines
2. **Reusability**: Core modules usable in new projects
3. **Type Safety**: 100% TypeScript coverage
4. **Test Coverage**: > 80% for core modules
5. **Documentation**: Complete API docs for all public interfaces

---

## Next Steps

1. Review [02_UNUSED_CODE_AUDIT.md](./02_UNUSED_CODE_AUDIT.md)
2. Review [03_TRANSFORM_SYSTEM_SOP.md](./03_TRANSFORM_SYSTEM_SOP.md)
3. Review [04_CSG_SYSTEM_SOP.md](./04_CSG_SYSTEM_SOP.md)
4. Review [05_AGENTIC_WORKFLOW.md](./05_AGENTIC_WORKFLOW.md)
