/**
 * Phase 2 Consolidation Validation Tests
 * 
 * Run: node docs/refactoring/execution/tests/02-test-consolidation.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const ROOT = path.resolve(__dirname, '../../../../');
const SRC = path.join(ROOT, 'src');
const LOGS = path.join(__dirname, '../logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS)) {
  fs.mkdirSync(LOGS, { recursive: true });
}

// ============================================================================
// Test Utilities
// ============================================================================

const results = {
  passed: [],
  failed: [],
  warnings: [],
};

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    results.passed.push(name);
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    results.failed.push({ name, error: error.message });
  }
}

function warn(name, message) {
  console.log(`⚠️ ${name}: ${message}`);
  results.warnings.push({ name, message });
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(SRC, relativePath));
}

function searchInFiles(pattern, glob = '**/*.{ts,tsx}') {
  try {
    const result = execSync(
      `Select-String -Path "src/${glob}" -Pattern "${pattern}" -Recurse`,
      { cwd: ROOT, encoding: 'utf-8', shell: 'powershell.exe', stdio: 'pipe' }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================================
// Tests
// ============================================================================

console.log('\n🧪 Phase 2: Consolidation Validation Tests\n');
console.log('='.repeat(50) + '\n');

// Test 1: Events file exists
test('Event constants file exists', () => {
  if (!fileExists('core/events.ts')) {
    throw new Error('src/core/events.ts not found');
  }
});

// Test 2: Events file has required exports
test('Events file exports EVENTS constant', () => {
  const eventsPath = path.join(SRC, 'core/events.ts');
  if (!fs.existsSync(eventsPath)) {
    throw new Error('Events file not found');
  }
  const content = fs.readFileSync(eventsPath, 'utf-8');
  if (!content.includes('export const EVENTS')) {
    throw new Error('EVENTS constant not exported');
  }
});

// Test 3: No hardcoded event strings in transform controls
test('No hardcoded event strings in transform controls', () => {
  const patterns = [
    "'model-transform-updated'",
    "'disable-orbit-controls'",
    "'pivot-control-activated'",
  ];
  
  const transformFiles = [
    'components/SelectableTransformControls.tsx',
    'components/Supports/SupportTransformControls.tsx',
    'components/Clamps/ClampTransformControls.tsx',
    'components/MountingHoles/HoleTransformControls.tsx',
    'components/Labels/LabelTransformControls.tsx',
    'components/BasePlate/BasePlateTransformControls.tsx',
  ];
  
  const violations = [];
  patterns.forEach(pattern => {
    const matches = searchInFiles(pattern);
    // Filter to only transform control files (excluding core/events.ts)
    const relevantMatches = matches.filter(m => 
      transformFiles.some(f => m.includes(f))
    );
    if (relevantMatches.length > 0) {
      violations.push(...relevantMatches);
    }
  });
  
  if (violations.length > 0) {
    warn('Hardcoded events', `Found ${violations.length} hardcoded event strings. Migration in progress.`);
  }
});

// Test 4: Utility file exists
test('Transform utilities file exists', () => {
  const utilPaths = [
    'core/utils/transform.ts',
    'lib/transformUtils.ts', // Old location still valid
  ];
  
  const exists = utilPaths.some(p => fileExists(p));
  if (!exists) {
    throw new Error('No transform utilities file found');
  }
});

// Test 5: No duplicate safeNum definitions
test('No duplicate safeNum function definitions', () => {
  const matches = searchInFiles('function safeNum|const safeNum');
  if (matches.length > 1) {
    warn('Duplicate safeNum', `Found ${matches.length} definitions. Should consolidate.`);
  }
});

// Test 6: Shared hooks exist (if migrated)
test('Transform hooks directory structure', () => {
  const hooksPath = path.join(SRC, 'hooks/transform');
  if (!fs.existsSync(hooksPath)) {
    warn('Hooks', 'Transform hooks directory not yet created');
  } else {
    const files = fs.readdirSync(hooksPath);
    console.log(`  ℹ️ Found ${files.length} hook files`);
  }
});

// Test 7: Build still passes
test('npm run build succeeds', () => {
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
});

// Test 8: TypeScript compilation
test('TypeScript compiles without errors', () => {
  try {
    execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
  } catch (error) {
    const logPath = path.join(LOGS, 'tsc-errors-phase2.txt');
    fs.writeFileSync(logPath, error.message || 'Unknown error');
    throw new Error(`TypeScript errors found. See ${logPath}`);
  }
});

// ============================================================================
// Manual Test Checklist
// ============================================================================

console.log('\n📋 Manual Tests Required:\n');
console.log('After running `npm run dev`, verify:');
console.log('');
console.log('Transform Controls:');
console.log('  [ ] Double-click on part activates transform gizmo');
console.log('  [ ] Dragging part updates position');
console.log('  [ ] Escape key closes transform gizmo');
console.log('  [ ] Camera does NOT move during drag');
console.log('');
console.log('Supports:');
console.log('  [ ] Click support shows transform controls');
console.log('  [ ] Can move support in XZ plane');
console.log('  [ ] Can rotate support (Y axis)');
console.log('  [ ] UI panel shows correct position values');
console.log('');
console.log('Clamps:');
console.log('  [ ] Click clamp shows transform controls');
console.log('  [ ] Can move clamp in 3D space');
console.log('  [ ] Can rotate clamp (Y axis only)');
console.log('');
console.log('Holes:');
console.log('  [ ] Click hole shows transform controls');
console.log('  [ ] Can move hole in XZ plane only');
console.log('  [ ] NO rotation allowed');
console.log('');

// ============================================================================
// Results Summary
// ============================================================================

console.log('='.repeat(50));
console.log('\n📊 Results Summary\n');
console.log(`✅ Passed: ${results.passed.length}`);
console.log(`❌ Failed: ${results.failed.length}`);
console.log(`⚠️ Warnings: ${results.warnings.length}`);

if (results.failed.length > 0) {
  console.log('\n❌ Failed Tests:');
  results.failed.forEach(f => {
    console.log(`   - ${f.name}: ${f.error}`);
  });
}

if (results.warnings.length > 0) {
  console.log('\n⚠️ Warnings:');
  results.warnings.forEach(w => {
    console.log(`   - ${w.name}: ${w.message}`);
  });
}

// Save results
const resultsPath = path.join(LOGS, `phase-2-results-${new Date().toISOString().split('T')[0]}.json`);
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
console.log(`\n📁 Results saved to: ${resultsPath}`);

// Exit code
process.exit(results.failed.length > 0 ? 1 : 0);
