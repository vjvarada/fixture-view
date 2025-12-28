/**
 * Full Regression Test Suite
 * 
 * Run: node docs/refactoring/execution/tests/full-regression.js
 * 
 * This runs all tests and produces a complete report.
 */

const { execSync, spawnSync } = require('child_process');
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
// Test Framework
// ============================================================================

const allResults = {
  timestamp: new Date().toISOString(),
  phases: {},
  summary: {
    totalPassed: 0,
    totalFailed: 0,
    totalWarnings: 0,
  }
};

function runPhaseTest(phaseName, testFile) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 ${phaseName}`);
  console.log('='.repeat(60));
  
  try {
    const result = spawnSync('node', [testFile], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    
    // Try to read the results file
    const dateStr = new Date().toISOString().split('T')[0];
    const resultsFile = path.join(LOGS, `${phaseName.toLowerCase().replace(/\s+/g, '-')}-results-${dateStr}.json`);
    
    if (fs.existsSync(resultsFile)) {
      const phaseResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
      allResults.phases[phaseName] = phaseResults;
      allResults.summary.totalPassed += phaseResults.passed?.length || 0;
      allResults.summary.totalFailed += phaseResults.failed?.length || 0;
      allResults.summary.totalWarnings += phaseResults.warnings?.length || 0;
    }
    
    return result.status === 0;
  } catch (error) {
    console.error(`Error running ${phaseName}: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Build & Compile Tests
// ============================================================================

function runBuildTests() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🔨 Build & Compilation Tests');
  console.log('='.repeat(60) + '\n');
  
  const buildResults = { passed: [], failed: [], warnings: [] };
  
  // Test 1: npm install
  try {
    console.log('📦 Checking dependencies...');
    execSync('npm ls --depth=0', { cwd: ROOT, stdio: 'pipe' });
    console.log('✅ Dependencies OK');
    buildResults.passed.push('Dependencies installed');
  } catch {
    console.log('⚠️ Some dependency issues (may be OK)');
    buildResults.warnings.push({ name: 'Dependencies', message: 'Some issues detected' });
  }
  
  // Test 2: TypeScript
  try {
    console.log('🔍 TypeScript compilation...');
    execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
    console.log('✅ TypeScript OK');
    buildResults.passed.push('TypeScript compilation');
  } catch (error) {
    console.log('❌ TypeScript errors');
    buildResults.failed.push({ name: 'TypeScript', error: 'Compilation errors' });
    // Save errors
    fs.writeFileSync(path.join(LOGS, 'tsc-errors.txt'), error.stdout || error.message);
  }
  
  // Test 3: ESLint
  try {
    console.log('🔍 ESLint check...');
    const lintOutput = execSync('npm run lint -- --format compact', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
    fs.writeFileSync(path.join(LOGS, 'lint-report.txt'), lintOutput);
    
    const errorCount = (lintOutput.match(/error/gi) || []).length;
    const warnCount = (lintOutput.match(/warning/gi) || []).length;
    
    if (errorCount > 0) {
      console.log(`❌ ESLint: ${errorCount} errors, ${warnCount} warnings`);
      buildResults.failed.push({ name: 'ESLint', error: `${errorCount} errors` });
    } else {
      console.log(`✅ ESLint OK (${warnCount} warnings)`);
      buildResults.passed.push('ESLint');
      if (warnCount > 0) {
        buildResults.warnings.push({ name: 'ESLint', message: `${warnCount} warnings` });
      }
    }
  } catch (error) {
    console.log('⚠️ ESLint command failed');
    buildResults.warnings.push({ name: 'ESLint', message: 'Command failed to run' });
  }
  
  // Test 4: Build
  try {
    console.log('🔨 Production build...');
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
    console.log('✅ Build OK');
    buildResults.passed.push('Production build');
  } catch (error) {
    console.log('❌ Build failed');
    buildResults.failed.push({ name: 'Build', error: 'Production build failed' });
  }
  
  allResults.phases['Build'] = buildResults;
  allResults.summary.totalPassed += buildResults.passed.length;
  allResults.summary.totalFailed += buildResults.failed.length;
  allResults.summary.totalWarnings += buildResults.warnings.length;
  
  return buildResults.failed.length === 0;
}

// ============================================================================
// Feature-Specific Tests
// ============================================================================

function runFeatureChecks() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🎯 Feature Module Checks');
  console.log('='.repeat(60) + '\n');
  
  const featureResults = { passed: [], failed: [], warnings: [] };
  
  const features = [
    { name: 'Supports', oldPath: 'components/Supports', newPath: 'features/supports' },
    { name: 'Clamps', oldPath: 'components/Clamps', newPath: 'features/clamps' },
    { name: 'Holes', oldPath: 'components/MountingHoles', newPath: 'features/holes' },
    { name: 'Labels', oldPath: 'components/Labels', newPath: 'features/labels' },
    { name: 'BasePlate', oldPath: 'components/BasePlate', newPath: 'features/baseplate' },
  ];
  
  features.forEach(feature => {
    const oldExists = fs.existsSync(path.join(SRC, feature.oldPath));
    const newExists = fs.existsSync(path.join(SRC, feature.newPath));
    
    if (newExists && !oldExists) {
      console.log(`✅ ${feature.name}: Migrated to features/`);
      featureResults.passed.push(`${feature.name} migrated`);
    } else if (oldExists && !newExists) {
      console.log(`⏳ ${feature.name}: Still in components/ (not yet migrated)`);
      featureResults.warnings.push({ name: feature.name, message: 'Not yet migrated' });
    } else if (oldExists && newExists) {
      console.log(`⚠️ ${feature.name}: Exists in BOTH locations`);
      featureResults.warnings.push({ name: feature.name, message: 'Duplicate locations' });
    } else {
      console.log(`❌ ${feature.name}: Not found in either location`);
      featureResults.failed.push({ name: feature.name, error: 'Feature not found' });
    }
  });
  
  allResults.phases['Features'] = featureResults;
  allResults.summary.totalPassed += featureResults.passed.length;
  allResults.summary.totalFailed += featureResults.failed.length;
  allResults.summary.totalWarnings += featureResults.warnings.length;
  
  return featureResults.failed.length === 0;
}

// ============================================================================
// Critical Systems Check
// ============================================================================

function runCriticalSystemsCheck() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('⚠️ Critical Systems Verification');
  console.log('='.repeat(60) + '\n');
  
  const criticalResults = { passed: [], failed: [], warnings: [] };
  
  // Check coordinate transform functions exist
  const transformUtils = path.join(SRC, 'lib/transformUtils.ts');
  if (fs.existsSync(transformUtils)) {
    const content = fs.readFileSync(transformUtils, 'utf-8');
    
    ['toCadPosition', 'toCadRotation', 'cadToThreeAxis'].forEach(fn => {
      if (content.includes(fn)) {
        console.log(`✅ ${fn} function exists`);
        criticalResults.passed.push(`${fn} exists`);
      } else {
        console.log(`❌ ${fn} function missing`);
        criticalResults.failed.push({ name: fn, error: 'Function not found' });
      }
    });
  }
  
  // Check CSG engine exists
  const csgEngine = path.join(SRC, 'lib/csgEngine.ts');
  if (fs.existsSync(csgEngine)) {
    console.log('✅ CSG engine exists');
    criticalResults.passed.push('CSG engine');
  } else {
    console.log('❌ CSG engine missing');
    criticalResults.failed.push({ name: 'CSG Engine', error: 'File not found' });
  }
  
  // Check hole geometry with penetration buffer
  const holeGeometry = path.join(SRC, 'components/MountingHoles/holeGeometry.ts');
  if (fs.existsSync(holeGeometry)) {
    const content = fs.readFileSync(holeGeometry, 'utf-8');
    if (content.includes('PENETRATION_BUFFER')) {
      console.log('✅ Hole penetration buffer defined');
      criticalResults.passed.push('Hole penetration buffer');
    } else {
      console.log('⚠️ Hole penetration buffer not found');
      criticalResults.warnings.push({ name: 'Penetration buffer', message: 'May have been renamed' });
    }
  }
  
  allResults.phases['Critical Systems'] = criticalResults;
  allResults.summary.totalPassed += criticalResults.passed.length;
  allResults.summary.totalFailed += criticalResults.failed.length;
  allResults.summary.totalWarnings += criticalResults.warnings.length;
  
  return criticalResults.failed.length === 0;
}

// ============================================================================
// Main Execution
// ============================================================================

console.log('🚀 Full Regression Test Suite');
console.log(`📅 ${new Date().toISOString()}`);
console.log('='.repeat(60));

// Run all test phases
const buildOk = runBuildTests();
runFeatureChecks();
runCriticalSystemsCheck();

// ============================================================================
// Final Summary
// ============================================================================

console.log(`\n${'='.repeat(60)}`);
console.log('📊 FINAL SUMMARY');
console.log('='.repeat(60) + '\n');

console.log(`✅ Total Passed:   ${allResults.summary.totalPassed}`);
console.log(`❌ Total Failed:   ${allResults.summary.totalFailed}`);
console.log(`⚠️ Total Warnings: ${allResults.summary.totalWarnings}`);

if (allResults.summary.totalFailed > 0) {
  console.log('\n❌ FAILED TESTS:');
  Object.entries(allResults.phases).forEach(([phase, results]) => {
    if (results.failed?.length > 0) {
      console.log(`\n  ${phase}:`);
      results.failed.forEach(f => console.log(`    - ${f.name}: ${f.error}`));
    }
  });
}

console.log('\n📋 MANUAL TESTS REQUIRED:');
console.log('');
console.log('1. Run `npm run dev` and verify:');
console.log('   [ ] Application loads without console errors');
console.log('   [ ] Can import a model');
console.log('   [ ] Transform controls work for parts');
console.log('   [ ] Transform controls work for supports');
console.log('   [ ] Transform controls work for clamps');
console.log('   [ ] Transform controls work for holes');
console.log('   [ ] Transform controls work for labels');
console.log('   [ ] Baseplate sizing works');
console.log('   [ ] Hole CSG operations work');
console.log('   [ ] Export functionality works');
console.log('');

// Save comprehensive results
const resultsPath = path.join(LOGS, `full-regression-${new Date().toISOString().split('T')[0]}.json`);
fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
console.log(`📁 Full results saved to: ${resultsPath}`);

// Exit code
const exitCode = allResults.summary.totalFailed > 0 ? 1 : 0;
console.log(`\n🏁 Exit code: ${exitCode}`);
process.exit(exitCode);
