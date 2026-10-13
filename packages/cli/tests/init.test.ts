import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCli } from '../src/cli.js';

describe('mantis init', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-init-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates mantis.config.json with starter configuration', async () => {
    const exitCode = await runCli(['node', 'mantis', 'init']);
    expect(exitCode).toBe(0);

    const configPath = path.join(tempDir, 'mantis.config.json');
    const exists = await fs
      .stat(configPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const content = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(content.baseUrl).toBe('http://127.0.0.1:3000');
    expect(content.allowedEffects).toEqual(['read']);
    expect(content.limits).toBeDefined();
    expect(content.limits.maxRequests).toBe(50);
  });

  it('fails with exit code 2 when config file already exists', async () => {
    // First creation succeeds
    const exitCode1 = await runCli(['node', 'mantis', 'init']);
    expect(exitCode1).toBe(0);

    // Second creation must refuse to overwrite and exit 2
    const exitCode2 = await runCli(['node', 'mantis', 'init']);
    expect(exitCode2).toBe(2);
  });

  it('supports custom output path with --out', async () => {
    const customOut = path.join(tempDir, 'custom-config.json');
    const exitCode = await runCli(['node', 'mantis', 'init', '--out', customOut]);
    expect(exitCode).toBe(0);

    const exists = await fs
      .stat(customOut)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});
