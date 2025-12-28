# Refactoring Documentation Index

## Overview

This folder contains comprehensive documentation for refactoring the fixture-view codebase into a modular, production-ready CAD application framework.

**📖 New here? Start with [CONSOLIDATED_SUMMARY.md](./CONSOLIDATED_SUMMARY.md)** - A complete overview of the plan.

---

## 🚀 Quick Start - DOE Orchestration

**Start here for step-by-step execution:**

1. **Read**: [CONSOLIDATED_SUMMARY.md](./CONSOLIDATED_SUMMARY.md) - Understand the big picture
2. **Read**: [MASTER_EXECUTION_PLAN.md](./MASTER_EXECUTION_PLAN.md) - Orchestration control
3. **Execute**: [directives/](./directives/) - Step-by-step agent directives
4. **Test**: [execution/](./execution/) - Automated test scripts

---

## Document Index

### Execution Documents (NEW)

| Document | Purpose |
|----------|---------|
| **[MASTER_EXECUTION_PLAN.md](./MASTER_EXECUTION_PLAN.md)** | **DOE orchestration - start here** |
| [directives/README.md](./directives/README.md) | Index of all agent directives |
| [execution/README.md](./execution/README.md) | Test scripts and automation |

### Reference Documents

| # | Document | Purpose |
|---|----------|---------|
| 01 | [Refactoring Overview](./01_REFACTORING_OVERVIEW.md) | High-level strategy, target architecture, and timeline |
| 02 | [Unused Code Audit](./02_UNUSED_CODE_AUDIT.md) | Identifies stub code, duplicates, and deprecated items |
| 03 | [Transform System SOP](./03_TRANSFORM_SYSTEM_SOP.md) | How to unify all transform controls into one system |
| 04 | [CSG System SOP](./04_CSG_SYSTEM_SOP.md) | How to consolidate CSG operations |
| 05 | [Agentic Workflow](./05_AGENTIC_WORKFLOW.md) | Step-by-step execution guide for AI agents |
| 06 | [Feature Module Template](./06_FEATURE_MODULE_TEMPLATE.md) | Standard structure for feature modules |
| 07 | [UI Library Architecture](./07_UI_LIBRARY_ARCHITECTURE.md) | Reusable UI component system design |
| 08 | [Checklist](./08_CHECKLIST.md) | Task tracking checklist for all phases |
| **09** | **[Critical Systems](./09_CRITICAL_SYSTEMS.md)** | **⚠️ MUST READ: Behavior preservation for transforms, CSG, baseplates** |
| **10** | **[Package Reusability](./10_PACKAGE_REUSABILITY.md)** | **How to create new apps & update packages independently** |

---

## Execution Phases (Ordered by Difficulty)

| Phase | Name | Risk | Directives | Est. Time |
|-------|------|------|------------|-----------|
| 1 | **Cleanup** | 🟢 LOW | 01-03 | 1 hour |
| 2 | **Consolidation** | 🟡 MED | 04-06 | 3 hours |
| 3 | **Feature Modules** | 🟡 MED | 07-10 | 4 hours |
| 4 | Transform System | 🔴 HIGH | 11-13 | 6 hours |
| 5 | Scene Decomposition | 🔴 HIGH | 14-15 | 6 hours |
| 6 | Package Extraction | 🔴 HIGH | 16-17 | 6 hours |

**Start with Phase 1 (lowest risk, immediate wins)**

---

## Quick Commands

```powershell
# Run full regression test
node docs/refactoring/execution/tests/full-regression.js

# Run Phase 1 test
node docs/refactoring/execution/tests/01-test-cleanup.js

# Run Phase 2 test
node docs/refactoring/execution/tests/02-test-consolidation.js
```

---

## Architecture Summary

### Current State
```
fixture-view/
├── src/components/     # 50+ components, many monolithic
├── src/lib/           # Utility functions
├── src/modules/       # FileImport module (good pattern)
└── src/hooks/         # Scattered hooks
```

### Target State
```
packages/
├── cad-core/          # Pure logic (transforms, CSG, geometry)
└── cad-ui/            # React components (viewport, wizard, panels)

fixture-view/
├── src/features/      # Feature-based modules
│   ├── import/
│   ├── baseplate/
│   ├── supports/
│   ├── clamps/
│   ├── holes/
│   ├── labels/
│   ├── cavity/
│   └── export/
├── src/app/           # App orchestration
└── src/shared/        # Shared utilities
```

---

## Key Patterns

### Transform Controls
**Problem**: 7+ duplicate implementations
**Solution**: Unified `TransformController` with constraint presets

See: [03_TRANSFORM_SYSTEM_SOP.md](./03_TRANSFORM_SYSTEM_SOP.md)
**Problem**: Multiple engines, inconsistent APIs
**Solution**: Single `CSGEngine` class with worker support

See: [04_CSG_SYSTEM_SOP.md](./04_CSG_SYSTEM_SOP.md)

### Feature Modules
**Problem**: Logic scattered across components
**Solution**: Feature-based module structure

See: [06_FEATURE_MODULE_TEMPLATE.md](./06_FEATURE_MODULE_TEMPLATE.md)

### Workflow System
**Problem**: Step logic in monolithic AppShell
**Solution**: `WizardProvider` with step configuration

See: [07_UI_LIBRARY_ARCHITECTURE.md](./07_UI_LIBRARY_ARCHITECTURE.md)

---

## Timeline Estimate

| Phase | Tasks | Estimate |
|-------|-------|----------|
| Phase 1 | Cleanup | 2-4 hours |
| Phase 2 | Core Package | 4-6 hours |
| Phase 3 | UI Package | 4-6 hours |
| Phase 4 | Feature Migration | 6-8 hours |
| Phase 5 | Transform Migration | 4-6 hours |
| Phase 6 | Scene Decomposition | 6-8 hours |
| Phase 7 | Final Cleanup | 2-4 hours |
| **Total** | | **28-42 hours** |

---

## Success Metrics

### Code Quality
- No file > 500 lines
- 100% TypeScript strict mode
- No circular dependencies
- Clean import paths

### Reusability
- Core package usable standalone
- UI package usable for new apps
- Feature modules self-contained

### Maintainability
- Clear separation of concerns
- Documented public APIs
- Consistent patterns

---

## Important Notes

### Do NOT Delete Without Verification
Always verify a file is unused before deleting:
```bash
grep -r "import.*ComponentName" src/
grep -r "from.*filename" src/
```

### Preserve Functionality
The goal is refactoring, not rewriting. All current functionality must continue to work.

### Incremental Commits
Make small, focused commits. Each commit should leave the app in a working state.

### Test After Each Change
Run `npm run build` and manual tests after each significant change.
