# Directive 02: Delete Unused Files

**Phase:** 1 - Cleanup  
**Risk Level:** 🟢 LOW  
**Effort:** 🟢 LOW (15 minutes)  
**Dependencies:** Directive 01 completed

---

## Objective

Remove deprecated components and files that are no longer used in the application.

---

## Pre-Execution Checklist

- [ ] Directive 01 completed successfully
- [ ] Application builds successfully (`npm run build`)
- [ ] Git working directory is clean

---

## Analysis Required

Before deleting, verify each file is truly unused:

### Step 1: Search for Imports

For each candidate file, search for imports:

```powershell
# Example: Check if FixtureDesigner is imported anywhere
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "FixtureDesigner" -Recurse
```

### Step 2: Search for Dynamic Usage

Check for dynamic imports or lazy loading:

```powershell
Select-String -Path "src/**/*.tsx","src/**/*.ts" -Pattern "lazy\(.*FixtureDesigner" -Recurse
```

---

## Candidate Files for Deletion

⚠️ **VERIFY EACH BEFORE DELETING** - Run the search commands above!

| File | Status | Reason |
|------|--------|--------|
| `src/components/FixtureDesigner.tsx` | VERIFY | Possibly replaced by 3DScene |
| `src/components/STLEditor.tsx` | VERIFY | Check if used |
| `src/components/BooleanOperations.tsx` | VERIFY | May be replaced by CSGOperations |
| `src/components/BooleanOperationsPanel.tsx` | VERIFY | May be replaced |
| `src/components/TransformGizmo.tsx` | VERIFY | Generic wrapper, check usage |
| `src/components/ModelTransformControls.tsx` | VERIFY | May be replaced by SelectableTransformControls |

---

## Actions

### For Each Confirmed Unused File:

1. **Verify no imports exist**
2. **Comment out the file first** (safer than deletion)
3. **Run build and test**
4. **If successful, delete the file**

```powershell
# Example workflow for one file
# 1. Rename to .bak
Rename-Item "src/components/FixtureDesigner.tsx" "src/components/FixtureDesigner.tsx.bak"

# 2. Run build
npm run build

# 3. If build succeeds, delete
Remove-Item "src/components/FixtureDesigner.tsx.bak"

# 3. If build fails, restore
# Rename-Item "src/components/FixtureDesigner.tsx.bak" "src/components/FixtureDesigner.tsx"
```

---

## Safe Deletion Script

```powershell
# Create backup directory
New-Item -ItemType Directory -Force -Path "backup/deleted-files"

# For each file to delete:
# Move-Item "src/components/FILE.tsx" "backup/deleted-files/"
```

---

## Validation

Run the test script:
```bash
node docs/refactoring/execution/tests/01-test-cleanup.js
```

### Manual Verification
1. `npm run build` completes without errors
2. `npm run dev` starts the application
3. Full feature walkthrough:
   - [ ] Import model works
   - [ ] Transform controls work (drag parts)
   - [ ] Baseplate sizing works
   - [ ] Support placement works
   - [ ] Clamp placement works
   - [ ] Hole placement works
   - [ ] Label placement works

---

## Rollback

```powershell
# Restore all deleted files from backup
Copy-Item "backup/deleted-files/*" "src/components/" -Recurse
```

---

## Success Criteria

- [ ] Build passes
- [ ] Dev server starts
- [ ] No console errors related to missing modules
- [ ] All features work as before
- [ ] Code size reduced (check bundle size)

---

## Documentation

Record which files were deleted:

```markdown
## Deleted Files Log

| File | Date | Verified By | Reason |
|------|------|-------------|--------|
| ... | ... | ... | ... |
```

---

## Next Directive

After successful completion, proceed to: `03-fix-lint-errors.md`
