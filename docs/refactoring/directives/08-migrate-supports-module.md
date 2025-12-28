# Directive 08: Migrate Supports Module

**Phase:** 3 - Feature Module Structure  
**Risk Level:** 🟡 MEDIUM  
**Effort:** 🟡 MEDIUM (2 hours)  
**Dependencies:** Directive 07 completed

---

## Objective

Migrate all support-related components to the new feature module structure. This serves as the template for subsequent feature migrations.

---

## Pre-Execution Checklist

- [ ] Directive 07 completed (feature folders exist)
- [ ] Application builds and runs correctly
- [ ] Support features work (place support, move support, delete support)

---

## Current Support Files

Located in `src/components/Supports/`:

```
Supports/
├── index.ts
├── types.ts
├── SupportMesh.tsx
├── SupportPlacement.tsx
├── SupportTransformControls.tsx
├── supportGeometry.ts
└── supportData.ts (if exists)
```

---

## Actions

### Step 1: Copy Files to New Location

```powershell
# Copy entire Supports directory to features
Copy-Item -Path "src/components/Supports/*" -Destination "src/features/supports/" -Recurse

# Reorganize into subdirectories
Move-Item "src/features/supports/SupportMesh.tsx" "src/features/supports/components/"
Move-Item "src/features/supports/SupportPlacement.tsx" "src/features/supports/components/"
Move-Item "src/features/supports/SupportTransformControls.tsx" "src/features/supports/components/"
Move-Item "src/features/supports/supportGeometry.ts" "src/features/supports/utils/"
```

### Step 2: Update Feature Index

Update `src/features/supports/index.ts`:

```typescript
/**
 * Supports Feature Module
 * 
 * Handles support placement, geometry, and transforms for fixture design.
 * 
 * Supports can be:
 * - Cylindrical (round supports)
 * - Rectangular (block supports)
 * - Custom geometry
 * 
 * @example
 * ```typescript
 * import { SupportMesh, SupportPlacement, AnySupport } from '@features/supports';
 * ```
 */

// Types
export * from './types';

// Components
export { default as SupportMesh } from './components/SupportMesh';
export { default as SupportPlacement } from './components/SupportPlacement';
export { default as SupportTransformControls } from './components/SupportTransformControls';

// Utils
export * from './utils/supportGeometry';
```

### Step 3: Update Internal Imports

In each file in `src/features/supports/`, update relative imports:

```typescript
// Before (in SupportMesh.tsx)
import { AnySupport } from './types';
import { createSupportGeometry } from './supportGeometry';

// After
import { AnySupport } from '../types';
import { createSupportGeometry } from '../utils/supportGeometry';
```

### Step 4: Update External Imports (One by One)

Find all files that import from the old location:

```powershell
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "from ['\"].*components/Supports" -Recurse
```

Update each file **one at a time**, testing after each:

```typescript
// Before
import { SupportMesh, AnySupport } from '@/components/Supports';

// After
import { SupportMesh, AnySupport } from '@features/supports';
```

**Files to update (likely):**
- `src/components/3DScene.tsx`
- `src/layout/AppShell.tsx`
- Any panel components

### Step 5: Verify Old Directory Can Be Removed

After all imports updated:

```powershell
# Check no remaining imports
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "components/Supports" -Recurse

# If no results, safe to delete
Remove-Item -Recurse -Force "src/components/Supports"
```

---

## Validation

### Build Test
```powershell
npm run build
```

### Runtime Test
```powershell
npm run dev
```

### Feature Test Script
```bash
node docs/refactoring/execution/tests/03-test-supports.js
```

### Manual Feature Tests

- [ ] Can place cylindrical support
- [ ] Can place rectangular support
- [ ] Support appears at correct position
- [ ] Support transform controls appear on click
- [ ] Can move support (XZ plane)
- [ ] Can rotate support (Y axis)
- [ ] Can adjust support height
- [ ] Support height updates correctly
- [ ] Support can be deleted
- [ ] Support parameters can be edited in panel

---

## Troubleshooting

### Import Not Found

```
Module not found: Can't resolve '@features/supports'
```

**Fix:** Check `vite.config.ts` alias configuration

### Type Errors After Move

```
Type 'X' is not assignable to type 'Y'
```

**Fix:** Ensure all exports in `index.ts` are correct

### Component Not Rendering

Check browser console for errors. Likely a default vs named export issue.

---

## Success Criteria

- [ ] All support files in `src/features/supports/`
- [ ] Old `src/components/Supports/` deleted
- [ ] All imports updated
- [ ] Build passes
- [ ] All support features work

---

## Next Directive

After successful completion, proceed to: `09-migrate-clamps-module.md`

Use this directive as a template - the process is identical for clamps, holes, labels.
