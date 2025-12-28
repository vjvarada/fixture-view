# Directive 01: Delete Empty Directories

**Phase:** 1 - Cleanup  
**Risk Level:** 🟢 LOW  
**Effort:** 🟢 LOW (5 minutes)  
**Dependencies:** None

---

## Objective

Remove empty directories and stub modules that were created during prototyping but never implemented.

---

## Pre-Execution Checklist

- [ ] Application builds successfully (`npm run build`)
- [ ] Application runs locally (`npm run dev`)
- [ ] Git working directory is clean

---

## Actions

### 1. Delete Empty Directories

```bash
# Delete the empty replicad directory
Remove-Item -Recurse -Force "src/components/replicad"
```

### 2. Verify No Imports Reference These

Search the codebase for any imports from deleted directories:

```bash
# Should return NO results
grep -r "from.*replicad" src/
grep -r "import.*replicad" src/
```

---

## Files to Delete

| Path | Reason |
|------|--------|
| `src/components/replicad/` | Empty directory, never implemented |

---

## Validation

Run the test script:
```bash
node docs/refactoring/execution/tests/01-test-cleanup.js
```

### Manual Verification
1. `npm run build` completes without errors
2. `npm run dev` starts the application
3. Navigate through all major features:
   - [ ] Load the app
   - [ ] Import a model (if available)
   - [ ] Access baseplate settings
   - [ ] Access support placement
   - [ ] Access clamp placement
   - [ ] Access hole placement

---

## Rollback

```bash
# If something goes wrong, recreate the directory
New-Item -ItemType Directory -Path "src/components/replicad"
```

---

## Success Criteria

- [ ] Build passes
- [ ] Dev server starts
- [ ] No console errors
- [ ] All features accessible
- [ ] No broken imports

---

## Next Directive

After successful completion, proceed to: `02-delete-unused-files.md`
