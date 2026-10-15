#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPackageDir = path.resolve(repoRoot, 'packages/cli');

console.log('[pack:smoke] Starting Mantis package smoke test & tarball verification...');

// 1. Build CLI package
console.log('1. Building packages...');
execSync('pnpm --filter mantis build', {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, NO_COLOR: '1' },
});

// 2. Pack tarball in a temporary workspace
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-pack-smoke-'));
let tarballPath = '';

try {
  console.log('2. Packing mantis tarball...');
  const packOutput = execFileSync('npm', ['pack', cliPackageDir, '--pack-destination', tempDir], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  const tarballName = packOutput.split('\n').filter(Boolean).pop().trim();
  tarballPath = path.join(tempDir, tarballName);

  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Tarball not found at ${tarballPath}`);
  }

  const stat = fs.statSync(tarballPath);
  const sizeKb = stat.size / 1024;
  console.log(`   ✓ Tarball created: ${tarballName} (${sizeKb.toFixed(1)} KB)`);

  // 3. Inspect tarball contents
  console.log('3. Inspecting tarball contents & enforcing whitelist/budget...');
  const tarList = execFileSync('tar', ['-tf', tarballPath], {
    encoding: 'utf-8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Blacklist check
  const forbiddenPatterns = [
    /fixtures\//i,
    /benchmarks\//i,
    /\.mantis\//i,
    /\.env/i,
    /\/?src\//i,
    /\/?tests\//i,
    /\.tsbuildinfo/i,
  ];

  for (const entry of tarList) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(entry)) {
        throw new Error(
          `Tarball contains forbidden path matching ${pattern}: "${entry}"`,
        );
      }
    }
  }

  // Whitelist check: every file under package/ must belong to allowed categories
  const allowedTopPrefixes = [
    'package/dist/',
    'package/README.md',
    'package/LICENSE',
    'package/CHANGELOG.md',
    'package/package.json',
  ];

  for (const entry of tarList) {
    // skip directory entries themselves
    if (entry.endsWith('/')) continue;
    const isAllowed = allowedTopPrefixes.some(
      (prefix) => entry === prefix || entry.startsWith(prefix),
    );
    if (!isAllowed) {
      throw new Error(`Tarball contains unexpected non-whitelisted file: "${entry}"`);
    }
  }

  console.log(`   ✓ Whitelist enforced: ${tarList.length} items verified with 0 forbidden files.`);

  // Size budget check (compressed size budget: 350 KB)
  const MAX_COMPRESSED_KB = 350;
  if (sizeKb > MAX_COMPRESSED_KB) {
    throw new Error(
      `Tarball size (${sizeKb.toFixed(1)} KB) exceeds budget of ${MAX_COMPRESSED_KB} KB`,
    );
  }
  console.log(`   ✓ Size budget check passed (${sizeKb.toFixed(1)} KB < ${MAX_COMPRESSED_KB} KB)`);

  // 4. Install into clean consumer test directory and execute commands
  console.log('4. Installing tarball into clean temporary consumer project...');
  const consumerDir = path.join(tempDir, 'consumer');
  fs.mkdirSync(consumerDir);

  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'smoke-consumer',
        version: '1.0.0',
        private: true,
      },
      null,
      2,
    ),
  );

  execSync(`npm install "${tarballPath}"`, {
    cwd: consumerDir,
    stdio: 'pipe',
  });

  // Verify CLI execution: npx mantis --help
  console.log('5. Testing npx mantis --help in installed project...');
  const helpOutput = execSync('npx mantis --help', {
    cwd: consumerDir,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });

  if (!helpOutput.includes('Mantis — Evidence-backed API Model extractor')) {
    throw new Error(`Unexpected --help output:\n${helpOutput}`);
  }
  console.log('   ✓ npx mantis --help succeeded');

  // Verify CLI execution: npx mantis scan on sample app
  console.log('6. Testing npx mantis scan on sample Express app...');
  fs.writeFileSync(
    path.join(consumerDir, 'app.js'),
    `const express = require('express');
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/items', (req, res) => res.json([]));
module.exports = app;
`,
  );

  const scanOutput = execSync('npx mantis scan .', {
    cwd: consumerDir,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
  });

  if (!scanOutput.includes('/health') || !scanOutput.includes('/api/items')) {
    throw new Error(`Unexpected scan output:\n${scanOutput}`);
  }
  console.log('   ✓ npx mantis scan succeeded and discovered endpoints');

  // 7. Run publint & @arethetypeswrong/cli
  console.log('7. Running publint verification...');
  execSync(`npx -y publint "${cliPackageDir}"`, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  console.log('8. Running @arethetypeswrong/cli verification...');
  execSync(`npx -y @arethetypeswrong/cli "${tarballPath}"`, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  console.log('\n✓ Pack smoke test PASSED successfully!');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}
