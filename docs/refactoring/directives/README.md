# Refactoring Directives

This folder contains directive documents for AI agents executing the refactoring plan.

## Director of Engineering (DOE) Approach

The refactoring follows a **Director of Engineering** orchestration model:
- Each phase has specific directives
- Agents execute one directive at a time
- Testing validates each step before proceeding
- The orchestrator (DOE) reviews and approves progression

## Execution Order (Easiest → Hardest)

### Phase 1: Cleanup (Risk: LOW, Effort: LOW)
- `01-delete-empty-directories.md` - Remove empty/stub directories
- `02-delete-unused-files.md` - Remove deprecated components
- `03-fix-lint-errors.md` - Fix ESLint/TypeScript warnings

### Phase 2: Consolidation (Risk: LOW-MEDIUM, Effort: MEDIUM)
- `04-consolidate-events.md` - Centralize event constants
- `05-consolidate-utilities.md` - Merge duplicate utility functions
- `06-extract-shared-hooks.md` - Create shared hooks module

### Phase 3: Feature Module Structure (Risk: MEDIUM, Effort: MEDIUM)
- `07-create-feature-folders.md` - Organize by feature
- `08-migrate-supports-module.md` - First feature module migration
- `09-migrate-clamps-module.md` - Second feature module migration
- `10-migrate-holes-module.md` - Third feature module migration

### Phase 4: Transform System (Risk: HIGH, Effort: HIGH)
- `11-create-transform-core.md` - Core transform controller
- `12-create-pivot-gizmo.md` - Unified PivotGizmo component
- `13-migrate-transform-controls.md` - Replace all transform controls

### Phase 5: Scene Decomposition (Risk: HIGH, Effort: HIGH)
- `14-decompose-3dscene.md` - Break down 3DScene.tsx
- `15-decompose-appshell.md` - Break down AppShell.tsx

### Phase 6: Package Extraction (Risk: HIGH, Effort: HIGH)
- `16-extract-cad-core.md` - Create @rapidtool/cad-core
- `17-extract-cad-ui.md` - Create @rapidtool/cad-ui

## Testing Protocol

After each directive:
1. Run automated tests from `../execution/`
2. Manual smoke test the application
3. Commit with descriptive message
4. Document any issues in `../execution/logs/`

## Rollback Strategy

Each phase should be a separate branch:
```bash
git checkout -b refactor/phase-1-cleanup
# Execute Phase 1 directives
# Test and verify
git checkout main
git merge refactor/phase-1-cleanup
```
