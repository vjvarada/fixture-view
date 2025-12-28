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

**Branch:** `refactor/phase-3-features`

| Order | Directive | Time | Checkpoint |
|-------|-----------|------|------------|
| 3.1 | `07-create-feature-folders.md` | 30 min | Folder structure created |
| 3.2 | `08-migrate-supports-module.md` | 2 hr | Supports feature works |
| 3.3 | `09-migrate-clamps-module.md` | 1.5 hr | Clamps feature works |
| 3.4 | `10-migrate-holes-module.md` | 1.5 hr | Holes feature works |

**Phase 3 Gate:**
```bash
node docs/refactoring/execution/tests/full-regression.js
# Full feature test
```

---

### Phase 4-6: Advanced (Future)

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
| 1 | ⏳ Not Started | - | - | - |
| 2 | ⏳ Not Started | - | - | - |
| 3 | ⏳ Not Started | - | - | - |
| 4 | ⏳ Not Started | - | - | - |
| 5 | ⏳ Not Started | - | - | - |
| 6 | ⏳ Not Started | - | - | - |

### Directive Checklist

**Phase 1:**
- [ ] 01-delete-empty-directories
- [ ] 02-delete-unused-files  
- [ ] 03-fix-lint-errors

**Phase 2:**
- [ ] 04-consolidate-events
- [ ] 05-consolidate-utilities
- [ ] 06-extract-shared-hooks

**Phase 3:**
- [ ] 07-create-feature-folders
- [ ] 08-migrate-supports-module
- [ ] 09-migrate-clamps-module
- [ ] 10-migrate-holes-module

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

*Last Updated: December 2024*
*Next Action: Start Phase 1, Directive 01*
