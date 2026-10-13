import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPackageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(cliPackageRoot, 'dist');
const distJsPath = path.resolve(distDir, 'index.js');
const distCjsPath = path.resolve(distDir, 'index.cjs');

describe('built CLI binary (dist verification)', () => {
  beforeAll(() => {
    // Ensure built artifacts exist on a fresh clone when running plain `pnpm test`
    if (!fs.existsSync(distJsPath) || !fs.existsSync(distCjsPath)) {
      execSync('pnpm --filter @mantis/cli build', {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    }
  });

  it('must have built files in dist', () => {
    expect(fs.existsSync(distJsPath)).toBe(true);
    expect(fs.existsSync(distCjsPath)).toBe(true);
  });

  it('must have executable permissions on dist/index.js', () => {
    const stats = fs.statSync(distJsPath);
    // Must be executable by owner/group/others
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable).toBe(true);
  });

  it('must have exactly one valid shebang on line 1 and no duplicate shebang on line 2 in dist/index.js', () => {
    const content = fs.readFileSync(distJsPath, 'utf8');
    const lines = content.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env node');
    expect(lines[1]?.startsWith('#!')).toBe(false);
  });

  it('must have exactly one valid shebang on line 1 and no duplicate shebang on line 2 in dist/index.cjs', () => {
    const content = fs.readFileSync(distCjsPath, 'utf8');
    const lines = content.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env node');
    expect(lines[1]?.startsWith('#!')).toBe(false);
  });

  const cleanEnv = { ...process.env };
  delete cleanEnv.VITEST;

  it('executes dist/index.js directly with --help and outputs usage', () => {
    const res = spawnSync(distJsPath, ['--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cleanEnv,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Usage: mantis [options] [command]');
    expect(res.stdout).toContain('scan [options] <path>');
    expect(res.stdout).toContain('test [options] [path]');
    expect(res.stdout).toContain('report [options] [session]');
  });

  it('executes dist/index.js directly with scan on fixtures/simple and asserts real output', () => {
    const res = spawnSync(distJsPath, ['scan', 'fixtures/simple'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cleanEnv,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Mantis Scanner');
    expect(res.stdout).toContain('Framework: Express (javascript) | Root: fixtures/simple');
    expect(res.stdout).toContain('Endpoints (6 discovered: 6 confirmed, 0 uncertain)');
    expect(res.stdout).toContain('GET     /health');
    expect(res.stdout).toContain('GET     /users');
    expect(res.stdout).toContain('POST    /users');
    expect(res.stdout).toContain('GET     /users/:id');
    expect(res.stdout).toContain('PUT     /users/:id');
    expect(res.stdout).toContain('DELETE  /users/:id');
  });

  it('executes dist/index.js scan on fixtures/nested-routers/app', () => {
    const res = spawnSync(distJsPath, ['scan', 'fixtures/nested-routers/app'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cleanEnv,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Endpoints (6 discovered: 5 confirmed, 1 uncertain)');
    expect(res.stdout).toContain('[MT-R003]');
  });

  it('fails if build output is missing or corrupt', () => {
    const nonExistentPath = path.resolve(distDir, 'non-existent.js');
    expect(fs.existsSync(nonExistentPath)).toBe(false);

    // Verify executing a missing file fails with non-zero exit code
    const missingRes = spawnSync(process.execPath, [nonExistentPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(missingRes.status).not.toBe(0);

    // Verify executing code with a duplicate shebang on line 2 fails with SyntaxError
    const doubleShebangScript = '#!/usr/bin/env node\n#!/usr/bin/env node\nconsole.log("ok");';
    const syntaxErrRes = spawnSync(process.execPath, ['--input-type=module', '-e', doubleShebangScript], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(syntaxErrRes.status).not.toBe(0);
    expect(syntaxErrRes.stderr).toContain('SyntaxError');
  });
});
