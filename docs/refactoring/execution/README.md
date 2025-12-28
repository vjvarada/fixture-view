# Execution Scripts

This folder contains test scripts and automation for the refactoring process.

## Structure

```
execution/
├── README.md                  # This file
├── tests/                     # Automated test scripts
│   ├── 01-test-cleanup.js     # Phase 1 validation
│   ├── 02-test-consolidation.js # Phase 2 validation
│   ├── 03-test-supports.js    # Support feature tests
│   ├── phase-1-complete.js    # Full Phase 1 check
│   ├── phase-2-complete.js    # Full Phase 2 check
│   └── full-regression.js     # Complete regression test
├── scripts/                   # Utility scripts
│   ├── find-duplicates.js     # Find duplicate code
│   ├── find-unused.js         # Find unused exports
│   └── update-imports.js      # Batch import updates
└── logs/                      # Test output logs
    └── .gitkeep
```

## Running Tests

### Single Phase Test
```bash
node docs/refactoring/execution/tests/01-test-cleanup.js
```

### Full Regression
```bash
node docs/refactoring/execution/tests/full-regression.js
```

## Test Script Requirements

Tests use Node.js with:
- `child_process` for running npm commands
- `fs` for file system checks
- `path` for cross-platform paths

No additional dependencies required.

## Test Output

Tests output results to `logs/` directory:
- `lint-report.txt` - ESLint output
- `tsc-report.txt` - TypeScript errors
- `test-results-YYYY-MM-DD.json` - Structured test results

## Adding New Tests

1. Copy template from existing test
2. Add to appropriate phase file
3. Update `full-regression.js` to include new test
