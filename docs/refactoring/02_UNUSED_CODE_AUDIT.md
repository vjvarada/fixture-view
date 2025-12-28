# Unused Code Audit

## Summary

This document identifies code that should be removed or consolidated during refactoring.

---

## Category 1: Empty/Stub Directories

### `src/components/replicad/` - **DELETE**
- **Status**: Empty folder
- **Reason**: Leftover from prototyping with replicad library
- **Action**: Delete entire directory

---

## Category 2: Unused/Redundant Components

### `src/components/STLEditor.tsx` - **EVALUATE**
- **Lines**: 288
- **Issue**: Standalone transform editor not integrated into main workflow
- **Evidence**: No imports found in active codebase
- **Action**: Evaluate if needed, otherwise delete

### `src/components/BooleanOperations.tsx` - **CONSOLIDATE**
- **Lines**: 273
- **Issue**: Overlaps with `CSGOperations.tsx` and `csgEngine.ts`
- **Evidence**: Similar functionality implemented in `CSGOperations.tsx`
- **Action**: Consolidate into unified CSG system

### `src/components/BooleanOperationsPanel.tsx` - **CONSOLIDATE**
- **Issue**: Panel wrapper for BooleanOperations
- **Action**: Merge with CSGOperations into unified panel

### `src/components/TransformControlsUI.tsx` - **EVALUATE**
- **Issue**: May overlap with other transform implementations
- **Action**: Audit usage, consolidate into unified transform system

### `src/components/EnhancedComponentLibrary.tsx` - **CONSOLIDATE**
- **Issue**: Enhanced version of `ComponentLibraryPanel.tsx`
- **Action**: Keep one version, delete redundant

### `src/components/ParameterPanel.tsx` - **EVALUATE**
- **Issue**: Standalone parameter panel
- **Action**: Check integration with workflow, consolidate or delete

### `src/components/ClampCreation.tsx` - **CONSOLIDATE**
- **Issue**: Separate from main clamp workflow in `Clamps/`
- **Action**: Consolidate into `Clamps/` feature module

### `src/components/BaseplateConfigModal.tsx` - **CONSOLIDATE**
- **Issue**: Modal version exists alongside accordion version
- **Action**: Keep accordion-based UI, remove modal

### `src/components/BaseplateDialog.tsx` - **CONSOLIDATE**
- **Issue**: Another baseplate configuration component
- **Action**: Consolidate with `BasePlate/` module

### `src/components/BaseplateSelector.tsx` - **CONSOLIDATE**
- **Issue**: Selection component separate from main module
- **Action**: Move into `BasePlate/` feature

---

## Category 3: Deprecated Code Markers

### `src/modules/FileImport/services/meshAnalysisService.ts`
Contains multiple `@deprecated` markers:
```typescript
@deprecated Use tiltXZ and tiltYZ instead for accurate classification (line 104)
@deprecated Use strength instead. Smoothing method (line 121)
@deprecated Use strength=0 for pure Taubin (lines 123, 125)
@deprecated HC alpha/beta (lines 127, 129)
@deprecated Use strength instead. Gaussian sigma (line 131)
@deprecated Use iterations instead (lines 133, 135, 137)
```
**Action**: Remove deprecated parameters and their handling code

### `src/modules/FileImport/hooks/useViewer.ts`
Contains TODO comments for unimplemented features:
```typescript
// TODO: implement cylindrical (line 698)
// TODO: implement v-block (line 700)
// TODO: implement hexagonal (line 702)
// TODO: Add perforated pattern to baseplate (line 705)
```
**Action**: Implement or remove TODO comments, create tickets for future work

### `src/core/cad/cadOperations.ts`
```typescript
// TODO: Implement proper CSG operations when three-csg is available (line 59)
```
**Action**: CSG is now implemented via three-bvh-csg, remove stub code

---

## Category 4: Duplicate Transform Implementations

### Current Transform Controls:
1. `src/components/ModelTransformControls.tsx` (194 lines)
2. `src/components/SelectableTransformControls.tsx` (448 lines)
3. `src/components/TransformGizmo.tsx` (270 lines)
4. `src/components/Clamps/ClampTransformControls.tsx` (206 lines)
5. `src/components/Supports/SupportTransformControls.tsx` (227 lines)
6. `src/components/MountingHoles/HoleTransformControls.tsx` (247 lines)
7. `src/components/BasePlate/BasePlateTransformControls.tsx` (320 lines)

**Total**: ~1,900 lines of similar code

**Action**: Create unified `TransformController` in core package with constraint configuration

---

## Category 5: Potentially Unused UI Components

Review these shadcn components for actual usage:

### Likely Unused (verify with grep):
- `carousel.tsx`
- `input-otp.tsx`
- `menubar.tsx`
- `navigation-menu.tsx`
- `pagination.tsx`
- `calendar.tsx`
- `avatar.tsx`
- `aspect-ratio.tsx`

**Action**: Run import analysis, remove unused components

---

## Category 6: Unused Dependencies

### Review in `package.json`:
```json
"date-fns": "^3.6.0"          // Calendar/date functionality - verify usage
"embla-carousel-react"         // Carousel - likely unused
"input-otp"                    // OTP input - likely unused
"react-day-picker"             // Day picker - likely unused
"recharts"                     // Charts - verify usage
```

**Action**: Run `depcheck` or manual audit to identify unused deps

---

## Cleanup Script

Create a cleanup script to safely remove identified code:

```bash
#!/bin/bash
# cleanup-unused-code.sh

# Empty directories
rm -rf src/components/replicad/

# After verification, uncomment to remove:
# rm src/components/STLEditor.tsx
# rm src/components/BooleanOperations.tsx
# rm src/components/BooleanOperationsPanel.tsx
# rm src/components/BaseplateConfigModal.tsx
# rm src/components/BaseplateDialog.tsx
```

---

## Verification Process

Before deleting any file:

1. **Search for imports**:
   ```bash
   grep -r "from.*<filename>" src/
   grep -r "import.*<ComponentName>" src/
   ```

2. **Search for dynamic imports**:
   ```bash
   grep -r "lazy.*<filename>" src/
   ```

3. **Check event listeners**:
   ```bash
   grep -r "addEventListener.*<related-event>" src/
   ```

4. **Test the application** after each removal

---

## Priority Order

1. **Immediate** (Safe to delete now):
   - Empty `replicad/` directory
   
2. **High Priority** (After verification):
   - Duplicate transform implementations
   - Deprecated code in meshAnalysisService.ts
   
3. **Medium Priority** (After refactoring starts):
   - Consolidate CSG components
   - Merge baseplate components
   
4. **Low Priority** (During UI cleanup):
   - Remove unused shadcn components
   - Clean up unused dependencies
