#!/usr/bin/env node
import { execSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const targetPattern = ['dev', 'guard'].join('');

try {
  const result = execSync(
    `git grep -in "${targetPattern}" -- ':!CHANGELOG.md' ':!scripts/check-branding.js'`,
    { encoding: 'utf-8' },
  );

  if (result.trim()) {
    console.error(`Error: Found forbidden legacy name "${targetPattern}" in tracked files:\n`);
    console.error(result);
    process.exit(1);
  }
} catch (err) {
  // git grep returns exit code 1 when no matches are found, which is what we want!
  if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
    console.log(`✓ Clean branding check: No "${targetPattern}" references found in repository.`);
    process.exit(0);
  }
  console.error('Error executing git grep:', err);
  process.exit(2);
}
