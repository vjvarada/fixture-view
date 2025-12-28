# Directive 07: Create Feature Module Structure

**Phase:** 3 - Feature Module Structure  
**Risk Level:** 🟡 MEDIUM  
**Effort:** 🟡 MEDIUM (1 hour)  
**Dependencies:** Phase 2 completed

---

## Objective

Reorganize the codebase into feature-based modules with consistent internal structure.

---

## Pre-Execution Checklist

- [ ] Phase 2 completed and merged
- [ ] Application builds and runs correctly
- [ ] Created branch: `git checkout -b refactor/phase-3-feature-modules`

---

## Target Structure

Each feature module follows this pattern:

```
src/features/
├── supports/
│   ├── index.ts              # Public exports
│   ├── types.ts              # TypeScript types
│   ├── constants.ts          # Feature constants
│   ├── components/           # React components
│   │   ├── SupportMesh.tsx
│   │   ├── SupportTransformControls.tsx
│   │   └── SupportPlacement.tsx
│   ├── hooks/                # Feature-specific hooks
│   │   └── useSupport.ts
│   ├── utils/                # Feature utilities
│   │   └── supportGeometry.ts
│   └── store/                # Feature state (if using Zustand)
│       └── supportStore.ts
├── clamps/
│   └── ... (same structure)
├── holes/
│   └── ... (same structure)
├── labels/
│   └── ... (same structure)
├── baseplate/
│   └── ... (same structure)
└── parts/
    └── ... (same structure)
```

---

## Actions

### Step 1: Create Feature Directory Structure

```powershell
# Create main features directory
New-Item -ItemType Directory -Force -Path "src/features"

# Create subdirectories for each feature
$features = @("supports", "clamps", "holes", "labels", "baseplate", "parts")

foreach ($feature in $features) {
    New-Item -ItemType Directory -Force -Path "src/features/$feature"
    New-Item -ItemType Directory -Force -Path "src/features/$feature/components"
    New-Item -ItemType Directory -Force -Path "src/features/$feature/hooks"
    New-Item -ItemType Directory -Force -Path "src/features/$feature/utils"
}
```

### Step 2: Create Feature Index Template

Create `src/features/_template/index.ts` as a reference:

```typescript
/**
 * Feature Module: [Feature Name]
 * 
 * This module encapsulates all functionality related to [feature].
 * 
 * Usage:
 * ```typescript
 * import { FeatureComponent, useFeature, FeatureType } from '@/features/featureName';
 * ```
 */

// Types
export * from './types';

// Components
export { FeatureComponent } from './components/FeatureComponent';

// Hooks
export { useFeature } from './hooks/useFeature';

// Utils (internal, but may need external access)
export { featureUtil } from './utils/featureUtil';
```

### Step 3: Create Path Alias

Update `tsconfig.json` to add feature path alias:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@features/*": ["./src/features/*"]
    }
  }
}
```

Update `vite.config.ts`:

```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@features': path.resolve(__dirname, './src/features'),
  },
},
```

### Step 4: Create Feature Index Files

Create empty index files for each feature (to be populated in subsequent directives):

```typescript
// src/features/supports/index.ts
/**
 * Supports Feature Module
 * 
 * Handles support placement, geometry, and transforms.
 */

// TODO: Add exports after migration
export {};

// src/features/clamps/index.ts
/**
 * Clamps Feature Module
 * 
 * Handles clamp placement, loading, and transforms.
 */

export {};

// etc. for each feature
```

---

## Do NOT Do Yet

- ❌ Do not move files yet (that's in subsequent directives)
- ❌ Do not delete the old component directories
- ❌ Do not update imports yet

This directive only creates the structure.

---

## Validation

```powershell
# Verify directory structure
Get-ChildItem -Path "src/features" -Recurse -Directory | Select-Object FullName
```

Expected output:
```
src/features/supports
src/features/supports/components
src/features/supports/hooks
src/features/supports/utils
src/features/clamps
...
```

### Build Test

```powershell
npm run build
npm run dev
```

Should still work since we haven't moved anything yet.

---

## Success Criteria

- [ ] All feature directories created
- [ ] All subdirectories created
- [ ] Path aliases configured
- [ ] Build passes
- [ ] No files moved yet

---

## Next Directive

After successful completion, proceed to: `08-migrate-supports-module.md`
