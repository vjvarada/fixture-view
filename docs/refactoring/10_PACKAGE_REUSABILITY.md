# Package Architecture & Reusability Guide

## Executive Summary

This document addresses the core questions:
1. **Can I create different apps with different workflows?** → YES
2. **Can I independently update packages without breaking apps?** → YES, with proper versioning

---

## How the Package Architecture Enables Reusability

### The Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR APPS                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ fixture-view │  │ mold-design  │  │ assembly-app │   + more     │
│  │  (fixtures)  │  │  (molds)     │  │ (assemblies) │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         ▼                 ▼                 ▼                       │
├─────────────────────────────────────────────────────────────────────┤
│                      @rapidtool/cad-ui                              │
│                                                                     │
│  Reusable React Components:                                         │
│  • WizardProvider (different steps per app)                         │
│  • Viewport (3D canvas + controls)                                  │
│  • PivotGizmo (transform controls)                                  │
│  • AccordionPanel, TreePanel, etc.                                  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                      @rapidtool/cad-core                            │
│                                                                     │
│  Pure Logic (no React):                                             │
│  • CSGEngine (boolean operations)                                   │
│  • TransformController (constrained transforms)                     │
│  • CoordinateSystem (CAD ↔ Three.js conversion)                    │
│  • GeometryUtils (mesh analysis, repair)                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Creating Different Apps with Different Workflows

### Example: Three Different Apps Using Same Packages

#### App 1: Fixture Design (Current App)
```typescript
// fixture-view/src/app/wizardConfig.ts
import { WizardConfig } from '@rapidtool/cad-ui';
import { ImportStep, BaseplateStep, SupportsStep, ClampsStep, HolesStep, ExportStep } from '../features';

export const fixtureWizardConfig: WizardConfig = {
  steps: [
    { id: 'import', label: 'Import Part', component: ImportStep },
    { id: 'baseplate', label: 'Baseplate', component: BaseplateStep },
    { id: 'supports', label: 'Supports', component: SupportsStep },
    { id: 'clamps', label: 'Clamps', component: ClampsStep },
    { id: 'holes', label: 'Mounting Holes', component: HolesStep },
    { id: 'export', label: 'Export', component: ExportStep },
  ],
  allowBack: true,
  persistState: true,
};
```

#### App 2: Mold Design (New App)
```typescript
// mold-design/src/app/wizardConfig.ts
import { WizardConfig } from '@rapidtool/cad-ui';
import { ImportStep, CavityStep, CoreStep, RunnerStep, CoolingStep, ExportStep } from '../features';

export const moldWizardConfig: WizardConfig = {
  steps: [
    { id: 'import', label: 'Import Part', component: ImportStep },
    { id: 'cavity', label: 'Cavity', component: CavityStep },
    { id: 'core', label: 'Core', component: CoreStep },
    { id: 'runner', label: 'Runner System', component: RunnerStep },
    { id: 'cooling', label: 'Cooling Channels', component: CoolingStep },
    { id: 'export', label: 'Export', component: ExportStep },
  ],
  allowBack: true,
};
```

#### App 3: Assembly Design (Another New App)
```typescript
// assembly-app/src/app/wizardConfig.ts
import { WizardConfig } from '@rapidtool/cad-ui';
import { ImportStep, PositionStep, ConstraintStep, MotionStep, BOMStep } from '../features';

export const assemblyWizardConfig: WizardConfig = {
  steps: [
    { id: 'import', label: 'Import Parts', component: ImportStep },
    { id: 'position', label: 'Position', component: PositionStep },
    { id: 'constraints', label: 'Constraints', component: ConstraintStep },
    { id: 'motion', label: 'Motion Study', component: MotionStep },
    { id: 'bom', label: 'Bill of Materials', component: BOMStep },
  ],
};
```

### Each App Uses the Same Core Components

```typescript
// Any app can use these from @rapidtool/cad-ui
import { 
  WizardProvider,      // Manages workflow state
  Viewport,            // 3D canvas
  PivotGizmo,          // Transform controls
  ViewCube,            // Camera orientation
  AccordionPanel,      // Collapsible panels
  PropertiesPanel,     // Entity properties
} from '@rapidtool/cad-ui';

// Any app can use these from @rapidtool/cad-core
import {
  CSGEngine,           // Boolean operations
  TransformController, // Constrained transforms
  toCadPosition,       // Coordinate conversion
  MeshAnalyzer,        // Geometry analysis
} from '@rapidtool/cad-core';
```

---

## Independent Package Updates (Semantic Versioning)

### Package Version Strategy

```
@rapidtool/cad-core@1.0.0
@rapidtool/cad-ui@1.0.0

Versioning follows SEMVER:
  MAJOR.MINOR.PATCH
  │     │     └── Bug fixes (safe to update)
  │     └──────── New features, backwards compatible (safe to update)
  └────────────── Breaking changes (requires app changes)
```

### Package Dependencies

```json
// @rapidtool/cad-core/package.json
{
  "name": "@rapidtool/cad-core",
  "version": "1.0.0",
  "peerDependencies": {
    "three": "^0.160.0"  // App provides THREE.js
  }
}

// @rapidtool/cad-ui/package.json
{
  "name": "@rapidtool/cad-ui",
  "version": "1.0.0",
  "dependencies": {
    "@rapidtool/cad-core": "^1.0.0"  // UI depends on core
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "three": "^0.160.0",
    "@react-three/fiber": "^8.0.0",
    "@react-three/drei": "^9.0.0"
  }
}

// fixture-view/package.json (your app)
{
  "dependencies": {
    "@rapidtool/cad-core": "^1.2.0",  // Can update independently
    "@rapidtool/cad-ui": "^1.1.0",    // Can update independently
    "three": "0.166.1",
    "react": "18.3.1"
  }
}
```

### Safe Update Scenarios

| Update | Risk | Notes |
|--------|------|-------|
| `cad-core` 1.0.0 → 1.0.1 | 🟢 SAFE | Bug fix |
| `cad-core` 1.0.0 → 1.1.0 | 🟢 SAFE | New features, backwards compatible |
| `cad-core` 1.0.0 → 2.0.0 | 🔴 BREAKING | Review changelog, update app code |
| `cad-ui` 1.0.0 → 1.1.0 | 🟢 SAFE | New components/props |
| Update `cad-core` only | 🟢 SAFE | `cad-ui` uses peer dep range |
| Update `cad-ui` only | 🟢 SAFE | As long as core version compatible |

### API Stability Contract

```typescript
// @rapidtool/cad-core - STABLE API (won't break in minor versions)

// ✅ Stable - will not change signature in 1.x
export function toCadPosition(threePos: THREE.Vector3): CadPosition;
export function toCadRotation(threeRot: THREE.Euler): CadRotation;

// ✅ Stable - class API
export class CSGEngine {
  execute(config: CSGOperationConfig): Promise<CSGResult>;
  // New methods may be added, existing won't change
}

// ⚠️ Experimental - may change
/** @experimental */
export function advancedMeshRepair(geometry: THREE.BufferGeometry): THREE.BufferGeometry;
```

---

## Monorepo Structure for Managing Multiple Apps

### Recommended Repository Structure

```
rapidtool/                          # Monorepo root
├── packages/                       # Shared packages
│   ├── cad-core/                   # @rapidtool/cad-core
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cad-ui/                     # @rapidtool/cad-ui
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── apps/                           # Applications using the packages
│   ├── fixture-view/               # Current app
│   │   ├── src/features/
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── mold-design/                # Future app
│   │   └── ...
│   └── assembly-app/               # Future app
│       └── ...
│
├── package.json                    # Workspace root
├── pnpm-workspace.yaml             # Workspace config
└── turbo.json                      # Build orchestration
```

### Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

```json
// Root package.json
{
  "name": "rapidtool",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "publish-packages": "turbo run build && changeset publish"
  }
}
```

---

## How to Create a New App

### Step 1: Scaffold the App

```bash
cd apps
npm create vite@latest my-new-app -- --template react-ts
cd my-new-app
```

### Step 2: Add Package Dependencies

```bash
pnpm add @rapidtool/cad-core @rapidtool/cad-ui
pnpm add three @react-three/fiber @react-three/drei
```

### Step 3: Configure Your Workflow

```typescript
// my-new-app/src/app/wizardConfig.ts
import { WizardConfig } from '@rapidtool/cad-ui';

export const myWizardConfig: WizardConfig = {
  steps: [
    // Define your app's unique workflow steps
  ],
};
```

### Step 4: Create Your App Shell

```typescript
// my-new-app/src/App.tsx
import { WizardProvider, Viewport, StepIndicator } from '@rapidtool/cad-ui';
import { myWizardConfig } from './app/wizardConfig';
import { MyFeatureRenderer } from './features';

export default function App() {
  return (
    <WizardProvider config={myWizardConfig}>
      <div className="app-layout">
        <aside>
          <StepIndicator orientation="vertical" />
        </aside>
        <main>
          <Viewport>
            <MyFeatureRenderer />
          </Viewport>
        </main>
      </div>
    </WizardProvider>
  );
}
```

---

## Summary: Answers to Your Questions

### Q1: Can I create similar apps with different workflows?

**YES.** The architecture enables this by:

1. **WizardProvider is workflow-agnostic** - You define the steps, it manages state
2. **Components are composable** - Use only what you need
3. **Core logic is pure** - No UI assumptions, works with any React app
4. **Feature modules are templates** - Copy and customize for new features

### Q2: Can I independently update packages without breaking apps?

**YES.** This is achieved through:

1. **Semantic versioning** - Clear contract for breaking changes
2. **Peer dependencies** - Apps control their own THREE.js/React versions
3. **Stable API surface** - Core functions won't change signature in minor versions
4. **TypeScript** - Compiler catches breaking changes at build time
5. **Monorepo** - Test all apps against package changes before release

### Key Benefits

| Benefit | How It's Achieved |
|---------|-------------------|
| Different workflows | WizardProvider + custom steps |
| Code reuse | Shared packages |
| Safe updates | Semantic versioning |
| Type safety | TypeScript throughout |
| Independent deployment | Separate packages |
| Test isolation | Each package has own tests |

---

## Action Items for Full Reusability

### Must-Do Before Package Extraction

1. ✅ Define stable API surface (documented in 03, 04, 09)
2. ⬜ Add `@stable` / `@experimental` JSDoc tags to APIs
3. ⬜ Create package.json templates with proper peer deps
4. ⬜ Set up Changesets for version management
5. ⬜ Create integration tests for package consumers

### Nice-to-Have

1. ⬜ Storybook for cad-ui components
2. ⬜ API documentation generation (TypeDoc)
3. ⬜ Example apps in the monorepo

---

*This document complements the existing refactoring documentation and focuses on the reusability and versioning aspects.*
