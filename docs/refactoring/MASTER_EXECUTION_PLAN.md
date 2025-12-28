# Master Execution Plan

## Director of Engineering (DOE) Orchestration

This document serves as the master control for the refactoring process. The DOE (orchestrator) manages agent execution through directives, validates results, and controls progression.

---

## Execution Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                     DOE ORCHESTRATION LOOP                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  Select  │───▶│  Agent   │───▶│   Test   │───▶│  Review  │ │
│   │Directive │    │ Execute  │    │ Validate │    │ & Commit │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│        ▲                                               │        │
│        │                                               │        │
│        └───────────────────────────────────────────────┘        │
│                                                                 │
│   If PASS: Next directive                                       │
│   If FAIL: Fix issues, re-test                                  │
│   If BLOCKED: Escalate, document, skip if possible              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase Overview (Ordered by Difficulty)

| Phase | Name | Risk | Effort | Directives | Est. Time |
|-------|------|------|--------|------------|-----------|
| **1** | Cleanup | 🟢 LOW | 🟢 LOW | 01-03 | 1 hour |
| **2** | Consolidation | 🟡 LOW-MED | 🟡 MED | 04-06 | 3 hours |
| **3** | Feature Modules | 🟡 MED | 🟡 MED | 07-10 | 4 hours |
| **4** | Transform System | 🔴 HIGH | 🔴 HIGH | 11-13 | 6 hours |
| **5** | Scene Decomposition | 🔴 HIGH | 🔴 HIGH | 14-15 | 6 hours |
| **6** | Package Extraction | 🔴 HIGH | 🔴 HIGH | 16-17 | 6 hours |

**Total Estimated Time: 26 hours**

---

## Detailed Execution Schedule

### Phase 1: Cleanup (Start Here) 🟢

**Branch:** `refactor/phase-1-cleanup`

| Order | Directive | Time | Checkpoint |
|-------|-----------|------|------------|
| 1.1 | `01-delete-empty-directories.md` | 5 min | Build passes |
| 1.2 | `02-delete-unused-files.md` | 15 min | Build passes, no broken imports |
| 1.3 | `03-fix-lint-errors.md` | 30 min | ESLint errors = 0 |

**Phase 1 Gate:**
```bash
node docs/refactoring/execution/tests/01-test-cleanup.js
# Must pass before proceeding
```

**Commit:**
```bash
git add -A
git commit -m "refactor(phase-1): cleanup - remove unused code"
```

---

### Phase 2: Consolidation 🟡

**Branch:** `refactor/phase-2-consolidation`

| Order | Directive | Time | Checkpoint |
|-------|-----------|------|------------|
| 2.1 | `04-consolidate-events.md` | 1 hr | Events centralized, all features work |
| 2.2 | `05-consolidate-utilities.md` | 1 hr | No duplicate utils, transforms work |
| 2.3 | `06-extract-shared-hooks.md` | 1.5 hr | Hooks extracted, one control migrated |

**Phase 2 Gate:**
```bash
node docs/refactoring/execution/tests/02-test-consolidation.js
# Must pass before proceeding
```

**Commit:**
```bash
git add -A
git commit -m "refactor(phase-2): consolidate events, utilities, hooks"
```

---

### Phase 3: Feature Module Structure 🟡

**Branch:** `phase-3-features`

| Order | Directive | Time | Checkpoint |
|-------|-----------|------|------------|
| 3.1 | Create feature folders | 15 min | Folder structure created |
| 3.2 | Migrate supports module | 30 min | Supports feature works |
| 3.3 | Migrate clamps module | 30 min | Clamps feature works |
| 3.4 | Migrate holes module | 20 min | Holes feature works |
| 3.5 | Migrate labels module | 20 min | Labels feature works |
| 3.6 | Migrate baseplate module | 30 min | Baseplate feature works |

**Phase 3 Gate:**
```bash
npm run build
# Build must pass with all features migrated
```

---

### Phase 4: Transform System Unification 🔴

**Branch:** `phase-4-transform`

**⚠️ HIGH RISK PHASE - Read `09_CRITICAL_SYSTEMS.md` before starting!**

| Order | Directive | Time | Checkpoint |
|-------|-----------|------|------------|
| 4.1 | `11-create-transform-core.md` | 2 hr | Core system in `src/core/transform/` |
| 4.2 | `12-create-transform-hooks.md` | 2 hr | Hooks created, build passes |
| 4.3 | `13-migrate-transform-controls.md` | 3 hr | All 6 controls migrated, manual tests pass |

**Critical Files Being Replaced:**
- `SupportTransformControls.tsx` (~227 lines)
- `ClampTransformControls.tsx` (~206 lines)
- `HoleTransformControls.tsx` (~247 lines)
- `LabelTransformControls.tsx` (~180 lines)
- `BasePlateTransformControls.tsx` (~320 lines)
- `SelectableTransformControls.tsx` (~448 lines)

**Migration Order (Safest First):**
1. HoleTransformControls (XZ only)
2. BasePlateTransformControls (XZ only)
3. SupportTransformControls (Y rotation)
4. LabelTransformControls (Y rotation + depth)
5. ClampTransformControls (rotation in degrees)
6. SelectableTransformControls (full transform + baking)

**Phase 4 Gate:**
```bash
npm run build
# PLUS manual testing of ALL transform controls:
# - Gizmo position correct
# - Correct axes enabled
# - Transform applies correctly
# - UI values update
# - Deselection works
# - No jittering
```

**Commit:**
```bash
git add -A
git commit -m "refactor(phase-4): unified transform system"
```

---

### Phase 5-6: Advanced (Future)

These phases require the foundation from Phases 1-3 and are more complex. Detailed directives will be created after Phase 3 completion.

---

## Agent Instructions

### For Each Directive:

1. **Read the directive completely** before starting
2. **Check pre-execution checklist** - all items must be true
3. **Execute actions** in order
4. **Run validation tests** specified in directive
5. **Report results** to DOE before proceeding

### Agent Response Format:

```markdown
## Directive Execution Report

**Directive:** [name]
**Status:** ✅ COMPLETE | ⚠️ PARTIAL | ❌ BLOCKED

### Actions Completed:
- [ ] Action 1
- [ ] Action 2

### Test Results:
- Build: ✅/❌
- Manual tests: ✅/❌

### Issues Encountered:
- None | [description]

### Ready for Next Directive: YES/NO
```

---

## Quick Start Commands

### Before Starting Any Work:

```powershell
# 1. Ensure clean state
git status
git stash  # if needed

# 2. Create phase branch
git checkout -b refactor/phase-1-cleanup

# 3. Run baseline test
node docs/refactoring/execution/tests/full-regression.js
```

### During Work:

```powershell
# After each directive
npm run build
npm run dev
# Test manually
# Then run phase test
```

### After Completing Phase:

```powershell
# Commit phase
git add -A
git commit -m "refactor(phase-N): description"

# Merge to main
git checkout main
git merge refactor/phase-N-name

# Create next phase branch
git checkout -b refactor/phase-N+1-name
```

---

## Rollback Procedures

### Single File Rollback:
```powershell
git checkout HEAD -- path/to/file.tsx
```

### Directive Rollback:
```powershell
git reset --soft HEAD~1  # Undo last commit, keep changes
git checkout -- .        # Discard all changes
```

### Phase Rollback:
```powershell
git checkout main
git branch -D refactor/phase-N-name  # Delete failed branch
git checkout -b refactor/phase-N-name  # Start fresh
```

---

## Progress Tracking

### Current Status

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| 1 | ✅ Complete | Dec 29, 2025 | Dec 29, 2025 | Commit `558fbd1` |
| 2 | ✅ Complete | Dec 29, 2025 | Dec 29, 2025 | Commit `ebfd88d` |
| 3 | ✅ Complete | Dec 29, 2025 | Dec 29, 2025 | Commit `24e501a` |
| 4 | ⏳ Not Started | - | - | - |
| 5 | ⏳ Not Started | - | - | - |
| 6 | ⏳ Not Started | - | - | - |

### Directive Checklist

**Phase 1:** ✅ Complete
- [x] 01-delete-empty-directories
- [x] 02-delete-unused-files  
- [x] 03-fix-lint-errors (20 auto-fixed)

**Phase 2:** ✅ Complete
- [x] 04-consolidate-events (`src/core/events.ts`)
- [x] 05-consolidate-utilities (`src/lib/transformUtils.ts`)
- [x] 06-extract-shared-hooks (`src/hooks/transform/`)

**Phase 3:** ✅ Complete
- [x] Create feature folders (`src/features/`)
- [x] Migrate supports module (`@/features/supports`)
- [x] Migrate clamps module (`@/features/clamps`)
- [x] Migrate holes module (`@/features/holes`)
- [x] Migrate labels module (`@/features/labels`)
- [x] Migrate baseplate module (`@/features/baseplate`)

**Phase 4:** ⏳ Not Started
- [ ] 11-create-transform-core (`src/core/transform/`)
- [ ] 12-create-transform-hooks (`src/core/transform/hooks/`)
- [ ] 13-migrate-transform-controls (6 components)

**Phase 5:** ⏳ Planned
- [ ] 14-decompose-3dscene (TBD)
- [ ] 15-create-scene-modules (TBD)

**Phase 6:** ⏳ Planned
- [ ] 16-extract-cad-core-package (TBD)
- [ ] 17-extract-cad-ui-package (TBD)

---

## Communication Protocol

### DOE to Agent:
```
Execute directive: [directive name]
Context: [any additional context]
Priority: [normal/high/critical]
```

### Agent to DOE:
```
Directive [name] execution report:
- Status: [complete/blocked/failed]
- Tests: [pass/fail]
- Issues: [none/description]
- Ready for next: [yes/no]
```

---

## Success Metrics

### Per Directive:
- Build passes
- No new TypeScript errors
- Feature functionality preserved
- Tests pass

### Per Phase:
- All directives complete
- Phase test passes
- No regressions
- Code review approved

### Overall:
- All phases complete
- Full regression passes
- Bundle size same or smaller
- Performance maintained or improved

---

*Last Updated: December 29, 2025*
*Next Action: Start Phase 4 (Transform System)*
