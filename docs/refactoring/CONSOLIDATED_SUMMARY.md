# Refactoring Plan - Consolidated Summary

## The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WHAT WE'RE BUILDING                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   FROM: One monolithic fixture-view app                                     │
│                                                                             │
│   TO: A reusable platform for building step-wise 3D CAD applications        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    @rapidtool/cad-core                              │   │
│   │  • TransformController (unified gizmo logic)                        │   │
│   │  • CSGEngine (boolean operations)                                   │   │
│   │  • CoordinateSystem (CAD ↔ Three.js)                               │   │
│   │  • GeometryUtils (mesh operations)                                  │   │
│   │  100% TypeScript, no React dependency                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     @rapidtool/cad-ui                               │   │
│   │  • WizardProvider (workflow engine)                                 │   │
│   │  • Viewport (3D canvas)                                             │   │
│   │  • PivotGizmo (transform UI)                                        │   │
│   │  • AccordionPanel, TreePanel, etc.                                  │   │
│   │  React + Three.js components                                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│              ┌─────────────────────┼─────────────────────┐                  │
│              ▼                     ▼                     ▼                  │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│   │   fixture-view   │  │   mold-design    │  │  assembly-app    │         │
│   │   (your app)     │  │   (future app)   │  │  (future app)    │         │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Goals & How We Achieve Them

| Goal | Solution | Document |
|------|----------|----------|
| **Create different apps with different workflows** | WizardProvider accepts any step configuration | [10_PACKAGE_REUSABILITY.md](./10_PACKAGE_REUSABILITY.md) |
| **Update packages independently** | Semantic versioning + peer dependencies | [10_PACKAGE_REUSABILITY.md](./10_PACKAGE_REUSABILITY.md) |
| **Don't break existing functionality** | Critical systems documentation + tests | [09_CRITICAL_SYSTEMS.md](./09_CRITICAL_SYSTEMS.md) |
| **Remove duplicate code** | Unified TransformController + CSGEngine | [03_TRANSFORM_SYSTEM_SOP.md](./03_TRANSFORM_SYSTEM_SOP.md), [04_CSG_SYSTEM_SOP.md](./04_CSG_SYSTEM_SOP.md) |
| **Clean up prototype code** | Systematic audit + cleanup | [02_UNUSED_CODE_AUDIT.md](./02_UNUSED_CODE_AUDIT.md) |

---

## Document Map

```
docs/refactoring/
│
├── README.md                    ← You are here (index)
├── CONSOLIDATED_SUMMARY.md      ← This file (overview)
├── MASTER_EXECUTION_PLAN.md     ← Start execution here
│
├── STRATEGY DOCUMENTS
│   ├── 01_REFACTORING_OVERVIEW.md   # Architecture vision
│   ├── 07_UI_LIBRARY_ARCHITECTURE.md # UI component design
│   └── 10_PACKAGE_REUSABILITY.md     # Multi-app strategy
│
├── TECHNICAL SOPs
│   ├── 03_TRANSFORM_SYSTEM_SOP.md    # Transform unification
│   ├── 04_CSG_SYSTEM_SOP.md          # CSG consolidation
│   ├── 06_FEATURE_MODULE_TEMPLATE.md # Feature structure
│   └── 09_CRITICAL_SYSTEMS.md        # ⚠️ Don't break these!
│
├── CLEANUP & AUDIT
│   ├── 02_UNUSED_CODE_AUDIT.md       # What to delete
│   └── 08_CHECKLIST.md               # Task tracking
│
├── EXECUTION
│   ├── 05_AGENTIC_WORKFLOW.md        # Agent instructions
│   ├── directives/                   # Step-by-step directives
│   │   ├── 01-08 (8 directives)
│   │   └── README.md
│   └── execution/                    # Test scripts
│       ├── tests/
│       └── logs/
```

---

## Execution Phases

### Phase 1-3: Foundation (Low Risk, Do First)

| Phase | What | Risk | Time | Key Output |
|-------|------|------|------|------------|
| **1** | Cleanup | 🟢 LOW | 1 hr | Remove dead code |
| **2** | Consolidation | 🟡 MED | 3 hrs | Centralized events, utils, hooks |
| **3** | Feature Modules | 🟡 MED | 4 hrs | Organized feature folders |

### Phase 4-6: Core Extraction (High Impact, More Complex)

| Phase | What | Risk | Time | Key Output |
|-------|------|------|------|------------|
| **4** | Transform System | 🔴 HIGH | 6 hrs | Unified PivotGizmo |
| **5** | Scene Decomposition | 🔴 HIGH | 6 hrs | 3DScene.tsx < 500 lines |
| **6** | Package Extraction | 🔴 HIGH | 6 hrs | npm packages |

**Total: ~26 hours of focused work**

---

## Critical Behaviors to Preserve

These are documented in [09_CRITICAL_SYSTEMS.md](./09_CRITICAL_SYSTEMS.md):

| System | Critical Behavior | Why It Matters |
|--------|-------------------|----------------|
| **Coordinate System** | `toCadPosition` swaps Y↔Z | CAD uses Z-up, Three.js uses Y-up |
| **Transform Controls** | Anti-jitter pattern (drag start lock) | Prevents feedback loops |
| **Transform Controls** | `'YXZ'` Euler order | Clean Y-axis rotation extraction |
| **Hole CSG** | `PENETRATION_BUFFER = 4mm` | Holes must fully penetrate |
| **Baseplate Sections** | XZ coordinates (not XY) | Section bounds use floor plane |
| **Component-Specific** | Different `activeAxes` per component | Holes can't rotate, parts can |

---

## Answers to Your Questions

### Q1: Can I create similar apps with different workflows?

**✅ YES.** Here's how:

```typescript
// Each app defines its own workflow
const fixtureWorkflow = [Import → Baseplate → Supports → Clamps → Holes → Export];
const moldWorkflow = [Import → Cavity → Core → Runner → Cooling → Export];
const assemblyWorkflow = [Import → Position → Constraints → Motion → BOM];

// All use the same WizardProvider from @rapidtool/cad-ui
<WizardProvider config={yourWorkflow}>
  <YourApp />
</WizardProvider>
```

See [10_PACKAGE_REUSABILITY.md](./10_PACKAGE_REUSABILITY.md) for detailed examples.

### Q2: Can I independently update packages without breaking apps?

**✅ YES.** Here's how:

```
Package Version: @rapidtool/cad-core@1.2.3
                                    │ │ │
                                    │ │ └── Patch: Bug fix (safe)
                                    │ └──── Minor: New feature (safe)
                                    └────── Major: Breaking change (review)
```

- **Patch updates (1.0.0 → 1.0.1)**: Always safe
- **Minor updates (1.0.0 → 1.1.0)**: Always safe (new features, backwards compatible)
- **Major updates (1.0.0 → 2.0.0)**: May require app changes (breaking)

Apps use semver ranges: `"@rapidtool/cad-core": "^1.0.0"` accepts any 1.x.x

---

## How to Start

### Option A: Execute Full Refactor

```bash
# 1. Read the critical systems doc
open docs/refactoring/09_CRITICAL_SYSTEMS.md

# 2. Run baseline test
node docs/refactoring/execution/tests/full-regression.js

# 3. Start Phase 1
git checkout -b refactor/phase-1-cleanup
# Follow directives/01-delete-empty-directories.md
```

### Option B: Start with Package Extraction Only

If you want to extract packages first (for use in other apps):

1. Read [01_REFACTORING_OVERVIEW.md](./01_REFACTORING_OVERVIEW.md) for target structure
2. Read [10_PACKAGE_REUSABILITY.md](./10_PACKAGE_REUSABILITY.md) for package design
3. Skip to Phase 4-6 directives (when created)

### Option C: Create New App Now (Before Refactor)

If you need a new app immediately:
1. Copy `fixture-view` entirely
2. Modify the workflow steps
3. Replace feature components with your own
4. After refactor, migrate to use shared packages

---

## Documentation Quality Review

| Document | Status | Completeness | Notes |
|----------|--------|--------------|-------|
| 01_REFACTORING_OVERVIEW | ✅ Good | 90% | Clear architecture vision |
| 02_UNUSED_CODE_AUDIT | ✅ Good | 85% | May need updates |
| 03_TRANSFORM_SYSTEM_SOP | ✅ Good | 95% | Includes anti-jitter pattern |
| 04_CSG_SYSTEM_SOP | ✅ Good | 90% | Worker pool details good |
| 05_AGENTIC_WORKFLOW | ✅ Good | 85% | Has critical file list |
| 06_FEATURE_MODULE_TEMPLATE | ✅ Good | 90% | Clear template |
| 07_UI_LIBRARY_ARCHITECTURE | ✅ Good | 85% | WizardProvider detailed |
| 08_CHECKLIST | ⚠️ Needs work | 70% | Need more specific tasks |
| 09_CRITICAL_SYSTEMS | ✅ Excellent | 95% | **Most important doc** |
| 10_PACKAGE_REUSABILITY | ✅ New | 90% | Addresses versioning |

---

## Identified Gaps (To Address)

1. **Missing**: Detailed directives for Phase 4-6 (transform, scene, packages)
2. **Missing**: Integration test suite for packages
3. **Missing**: Storybook setup for cad-ui
4. **Missing**: Changeset configuration for versioning
5. **Incomplete**: 08_CHECKLIST needs granular tasks per directive

---

## Conclusion

The refactoring plan **will achieve your goals**:

- ✅ Create different apps with different workflows (via WizardProvider)
- ✅ Update packages independently (via semantic versioning)
- ✅ Preserve existing functionality (via critical systems documentation)
- ✅ Clean, maintainable codebase (via feature modules)

**Recommended next steps:**
1. Execute Phase 1 (low risk, quick wins)
2. Execute Phase 2-3 (establish foundation)
3. Then tackle high-impact Phase 4-6

---

*This summary was created to consolidate and validate the refactoring documentation.*
