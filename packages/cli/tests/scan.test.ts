import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ApiModelSchema } from '@devguard/core';
import { runCli } from '../src/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures');

describe('devguard scan', () => {
  let tempDir: string;
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-test-'));
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      stdoutChunks.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      stderrChunks.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('scans fixtures/simple successfully and exits 0', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'simple');
    const exitCode = await runCli(['node', 'devguard', 'scan', fixturePath]);

    expect(exitCode).toBe(0);
    const combinedOutput = stdoutChunks.join('\n');
    expect(combinedOutput).toContain('DevGuard Scanner');
    expect(combinedOutput).toContain('/users');
  });

  it('fails with exit code 2 when directory does not exist', async () => {
    const nonExistent = path.join(tempDir, 'does-not-exist');
    const exitCode = await runCli(['node', 'devguard', 'scan', nonExistent]);

    expect(exitCode).toBe(2);
    expect(stderrChunks.join('\n')).toContain('does not exist');
  });

  it('fails with exit code 2 when target is not an Express app', async () => {
    const notExpressPath = path.join(FIXTURES_DIR, 'not-express');
    const exitCode = await runCli(['node', 'devguard', 'scan', notExpressPath]);

    expect(exitCode).toBe(2);
    expect(stderrChunks.join('\n')).toContain('No Express backend detected');
  });

  it('outputs valid ApiModel JSON when --json is provided', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'simple');
    const exitCode = await runCli(['node', 'devguard', 'scan', fixturePath, '--json']);

    expect(exitCode).toBe(0);
    const rawJson = stdoutChunks.join('\n');
    const parsed = JSON.parse(rawJson);

    // Validate against the ApiModel Zod schema
    const validated = ApiModelSchema.safeParse(parsed);
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.endpoints.length).toBeGreaterThan(0);
    }
  });

  it('writes output to file when --out is specified', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'simple');
    const outFile = path.join(tempDir, 'api-model.json');

    const exitCode = await runCli([
      'node',
      'devguard',
      'scan',
      fixturePath,
      '--json',
      '--out',
      outFile,
    ]);

    expect(exitCode).toBe(0);
    const exists = await fs
      .stat(outFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const fileContent = JSON.parse(await fs.readFile(outFile, 'utf-8'));
    expect(fileContent.endpoints).toBeDefined();
  });

  it('supports --verbose flag in terminal output', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'simple');
    const exitCode = await runCli(['node', 'devguard', 'scan', fixturePath, '--verbose']);

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join('\n');
    expect(output).toContain('DevGuard Scanner');
    expect(output).toContain('param email');
  });
});
