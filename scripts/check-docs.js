#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.resolve(repoRoot, 'packages/cli/dist/index.js');

console.log('[docs:check] Verifying all README and Quick Start documentation commands...');

if (!fs.existsSync(cliPath)) {
  console.error(`Error: Compiled CLI not found at ${cliPath}. Run "pnpm build" first.`);
  process.exit(1);
}

function runMantis(args, cwd) {
  try {
    const output = execFileSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { status: 0, output };
  } catch (err) {
    const stdout = err.stdout?.toString() || '';
    const stderr = err.stderr?.toString() || '';
    return {
      status: err.status ?? 1,
      output: stdout + '\n' + stderr,
      error: err,
    };
  }
}

// 1. Verify in-repo commands documented in README Quick Start
console.log('Testing documented in-repo commands:');

// Command: mantis scan ./fixtures/simple
console.log('  1. Running: mantis scan ./fixtures/simple');
const repoScanResult = runMantis(['scan', './fixtures/simple'], repoRoot);
if (repoScanResult.status !== 0) {
  console.error('Failed: mantis scan ./fixtures/simple exited with code', repoScanResult.status);
  console.error(repoScanResult.output);
  process.exit(1);
}
if (!repoScanResult.output.includes('Endpoints') || !repoScanResult.output.includes('/health')) {
  console.error('Failed: unexpected output from scan command:\n', repoScanResult.output);
  process.exit(1);
}
console.log('     ✓ scan successful');

// Command: mantis test ./fixtures/simple --dry-run --base-url http://127.0.0.1:3000
console.log(
  '  2. Running: mantis test ./fixtures/simple --dry-run --base-url http://127.0.0.1:3000',
);
const repoTestResult = runMantis(
  ['test', './fixtures/simple', '--dry-run', '--base-url', 'http://127.0.0.1:3000'],
  repoRoot,
);
if (repoTestResult.status !== 0) {
  console.error('Failed: mantis test --dry-run exited with code', repoTestResult.status);
  console.error(repoTestResult.output);
  process.exit(1);
}
if (
  !repoTestResult.output.includes('Dry-run mode') ||
  !repoTestResult.output.includes('0 network requests executed')
) {
  console.error('Failed: unexpected output from test dry-run:\n', repoTestResult.output);
  process.exit(1);
}
console.log('     ✓ test --dry-run successful');

// 2. Verify stranger experience in a fresh, isolated temporary directory
console.log('Testing fresh-machine stranger workflow in an isolated temp directory:');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-docs-check-'));

try {
  // Command 1 in temp dir: mantis init
  console.log('  3. Running: mantis init (in isolated temp directory)');
  const initResult = runMantis(['init'], tmpDir);
  if (initResult.status !== 0) {
    console.error('Failed: mantis init in temp directory exited with code', initResult.status);
    console.error(initResult.output);
    process.exit(1);
  }
  const configPath = path.join(tmpDir, 'mantis.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Failed: mantis.config.json was not created by mantis init');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!config.baseUrl || !Array.isArray(config.allowedEffects)) {
    console.error('Failed: mantis.config.json missing required schema fields');
    process.exit(1);
  }
  console.log('     ✓ init created valid mantis.config.json');

  // Set up a minimal Express application in the temp directory
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify(
      {
        name: 'sample-express-app',
        version: '1.0.0',
        dependencies: {
          express: '^4.18.2',
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(tmpDir, 'app.js'),
    `const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/items', (req, res) => {
  res.json([{ id: 1, name: 'Item 1' }]);
});

app.post('/api/items', (req, res) => {
  const name = req.body.name;
  res.status(201).json({ id: 2, name });
});

module.exports = app;
`,
  );

  // Command 2 in temp dir: mantis scan .
  console.log('  4. Running: mantis scan . (in isolated temp directory)');
  const scanResult = runMantis(['scan', '.'], tmpDir);
  if (scanResult.status !== 0) {
    console.error('Failed: mantis scan . in temp directory exited with code', scanResult.status);
    console.error(scanResult.output);
    process.exit(1);
  }
  if (!scanResult.output.includes('/health') || !scanResult.output.includes('/api/items')) {
    console.error('Failed: scan output missing expected endpoints:\n', scanResult.output);
    process.exit(1);
  }
  console.log('     ✓ scan . successfully extracted endpoints with provenance');

  // Command 3 in temp dir: mantis test . --dry-run --base-url http://127.0.0.1:3000
  console.log('  5. Running: mantis test . --dry-run --base-url http://127.0.0.1:3000');
  const testResult = runMantis(
    ['test', '.', '--dry-run', '--base-url', 'http://127.0.0.1:3000'],
    tmpDir,
  );
  if (testResult.status !== 0) {
    console.error(
      'Failed: mantis test . --dry-run in temp directory exited with code',
      testResult.status,
    );
    console.error(testResult.output);
    process.exit(1);
  }
  if (!testResult.output.includes('0 network requests executed')) {
    console.error('Failed: test dry-run output unexpected:\n', testResult.output);
    process.exit(1);
  }
  console.log('     ✓ test . --dry-run successfully planned test cases with 0 network requests');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('✓ All documentation commands executed and verified successfully.');
process.exit(0);
