# Directive 03: Fix Lint and TypeScript Errors

**Phase:** 1 - Cleanup  
**Risk Level:** 🟢 LOW  
**Effort:** 🟡 MEDIUM (30 minutes)  
**Dependencies:** Directive 02 completed

---

## Objective

Fix all ESLint warnings and TypeScript strict mode errors to establish a clean baseline before major refactoring.

---

## Pre-Execution Checklist

- [ ] Directive 02 completed successfully
- [ ] Application builds successfully
- [ ] Git working directory is clean

---

## Actions

### Step 1: Run ESLint Analysis

```powershell
# Get full lint report
npm run lint 2>&1 | Out-File -FilePath "docs/refactoring/execution/logs/lint-report.txt"

# Count errors by type
npm run lint -- --format compact
```

### Step 2: Auto-Fix Safe Issues

```powershell
# Auto-fix what ESLint can handle
npm run lint -- --fix
```

### Step 3: Manual Fixes by Category

#### A. Unused Variables
```typescript
// Before
const unusedVar = something;

// After - Remove or prefix with underscore
const _unusedVar = something; // if needed for debugging
// OR delete entirely
```

#### B. Missing Dependencies in useEffect
```typescript
// Before
useEffect(() => {
  doSomething(value);
}, []); // Missing 'value' in deps

// After
useEffect(() => {
  doSomething(value);
}, [value]);
```

#### C. Any Types
```typescript
// Before
const handleClick = (e: any) => { ... }

// After
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => { ... }
```

### Step 4: TypeScript Strict Checks

```powershell
# Run TypeScript compiler in strict mode
npx tsc --noEmit --strict 2>&1 | Out-File -FilePath "docs/refactoring/execution/logs/tsc-report.txt"
```

---

## Priority Fixes

Focus on these categories first (highest impact, lowest risk):

| Priority | Category | Fix Approach |
|----------|----------|--------------|
| 1 | Unused imports | Delete them |
| 2 | Unused variables | Delete or prefix with `_` |
| 3 | Missing React keys | Add unique keys |
| 4 | useEffect dependencies | Add missing deps carefully |
| 5 | Any types | Add proper types |

---

## Files to Focus On

Based on typical patterns, check these files:

- `src/components/3DScene.tsx` (large file, likely has issues)
- `src/layout/AppShell.tsx` (large file)
- `src/lib/csgEngine.ts`
- Transform control files

---

## Do NOT Change

⚠️ These patterns are intentional, do not "fix":

```typescript
// Intentionally empty deps - runs once on mount
useEffect(() => {
  initializeScene();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Refs don't need to be in deps
useEffect(() => {
  if (meshRef.current) { ... }
}, [otherDep]); // meshRef intentionally excluded
```

---

## Validation

Run the test script:
```bash
node docs/refactoring/execution/tests/01-test-cleanup.js
```

### Verification Steps
1. `npm run lint` returns 0 errors (warnings OK)
2. `npm run build` completes successfully
3. `npm run dev` starts without errors
4. Console has no new warnings

---

## Success Criteria

- [ ] ESLint errors: 0
- [ ] ESLint warnings: reduced by 50%+
- [ ] Build passes
- [ ] No runtime errors introduced
- [ ] Type coverage improved

---

## Metrics to Record

Before/After comparison:

```markdown
## Lint Metrics

| Metric | Before | After |
|--------|--------|-------|
| ESLint Errors | ? | 0 |
| ESLint Warnings | ? | ? |
| TypeScript Errors | ? | ? |
| `any` type usage | ? | ? |
```

---

## Next Directive

After successful completion, proceed to: `04-consolidate-events.md`

---

## Phase 1 Complete Checkpoint

After completing Directive 03, perform a full integration test:

```bash
node docs/refactoring/execution/tests/phase-1-complete.js
```

Commit all Phase 1 changes:
```bash
git add -A
git commit -m "refactor(phase-1): cleanup - delete unused, fix lint"
```
