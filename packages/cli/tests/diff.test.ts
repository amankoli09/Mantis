import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ApiModel, Report } from '@mantis/core';
import { runCli } from '../src/cli.js';

describe('mantis diff', () => {
  let tempDir: string;
  let originalCwd: string;
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-diff-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
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
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const baseModel: ApiModel = {
    modelVersion: '1.2.0',
    project: {
      root: '/app',
      framework: 'express',
      language: 'javascript',
    },
    endpoints: [
      {
        id: 'GET /users',
        method: 'GET',
        path: '/users',
        auth: { type: 'none' },
        effect: 'read',
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'index.js', line: 10 },
      },
      {
        id: 'POST /users',
        method: 'POST',
        path: '/users',
        auth: { type: 'bearer' },
        effect: 'write',
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'index.js', line: 20 },
      },
    ],
    diagnostics: [],
  };

  const updatedModel: ApiModel = {
    modelVersion: '1.2.0',
    project: {
      root: '/app',
      framework: 'express',
      language: 'javascript',
    },
    endpoints: [
      // GET /users modified auth to apiKey
      {
        id: 'GET /users',
        method: 'GET',
        path: '/users',
        auth: { type: 'apiKey', details: 'x-api-key' },
        effect: 'read',
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'index.js', line: 10 },
      },
      // POST /users removed
      // DELETE /users/:id added
      {
        id: 'DELETE /users/:id',
        method: 'DELETE',
        path: '/users/:id',
        auth: { type: 'bearer' },
        effect: 'destructive',
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'index.js', line: 30 },
      },
    ],
    diagnostics: [],
  };

  const baseReport: Report = {
    reportVersion: '1.0.0',
    summary: { total: 5, passed: 5, failed: 0, skipped: 0 },
    findings: [],
    results: [],
  };

  const regressedReport: Report = {
    reportVersion: '1.0.0',
    summary: { total: 6, passed: 5, failed: 1, skipped: 0 },
    findings: [
      {
        ruleId: 'MT-ORACLE-001',
        severity: 'error',
        endpointId: 'DELETE /users/:id',
        message: 'Endpoint returned 500 Internal Server Error',
        evidence: {
          request: { method: 'DELETE', path: '/users/1' },
          response: { status: 500, bodySnippet: 'Crash' },
        },
        source: { file: 'index.js', line: 30 },
        confidence: 'high',
      },
    ],
    results: [],
  };

  it('compares two ApiModels and reports added, removed, and modified endpoints', async () => {
    const fileA = path.join(tempDir, 'modelA.json');
    const fileB = path.join(tempDir, 'modelB.json');
    await fs.writeFile(fileA, JSON.stringify(baseModel, null, 2), 'utf-8');
    await fs.writeFile(fileB, JSON.stringify(updatedModel, null, 2), 'utf-8');

    const exitCode = await runCli(['node', 'mantis', 'diff', fileA, fileB]);
    expect(exitCode).toBe(0);

    const out = stdoutChunks.join('\n');
    expect(out).toContain('+1 added');
    expect(out).toContain('-1 removed');
    expect(out).toContain('~1 modified');
    expect(out).toContain('DELETE /users/:id');
    expect(out).toContain('POST /users');
  });

  it('outputs ApiModel diff in JSON format with --json and --out', async () => {
    const fileA = path.join(tempDir, 'modelA.json');
    const fileB = path.join(tempDir, 'modelB.json');
    const diffOut = path.join(tempDir, 'diff.json');
    await fs.writeFile(fileA, JSON.stringify(baseModel, null, 2), 'utf-8');
    await fs.writeFile(fileB, JSON.stringify(updatedModel, null, 2), 'utf-8');

    const exitCode = await runCli([
      'node',
      'mantis',
      'diff',
      fileA,
      fileB,
      '--json',
      '--out',
      diffOut,
    ]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(await fs.readFile(diffOut, 'utf-8'));
    expect(parsed.kind).toBe('api-model');
    expect(parsed.addedEndpoints.length).toBe(1);
    expect(parsed.removedEndpoints.length).toBe(1);
    expect(parsed.modifiedEndpoints.length).toBe(1);
  });

  it('compares two Reports and returns exit code 1 on regression / new findings', async () => {
    const reportA = path.join(tempDir, 'reportA.json');
    const reportB = path.join(tempDir, 'reportB.json');
    await fs.writeFile(reportA, JSON.stringify(baseReport, null, 2), 'utf-8');
    await fs.writeFile(reportB, JSON.stringify(regressedReport, null, 2), 'utf-8');

    const exitCode = await runCli(['node', 'mantis', 'diff', reportA, reportB]);
    expect(exitCode).toBe(1);

    const out = stdoutChunks.join('\n');
    expect(out).toContain('1 new');
    expect(out).toContain('MT-ORACLE-001');
    expect(out).toContain('DELETE /users/:id');
  });

  it('compares two Reports and returns exit code 0 when clean', async () => {
    const reportA = path.join(tempDir, 'reportA.json');
    const reportB = path.join(tempDir, 'reportB.json');
    await fs.writeFile(reportA, JSON.stringify(baseReport, null, 2), 'utf-8');
    await fs.writeFile(reportB, JSON.stringify(baseReport, null, 2), 'utf-8');

    const exitCode = await runCli(['node', 'mantis', 'diff', reportA, reportB]);
    expect(exitCode).toBe(0);

    const out = stdoutChunks.join('\n');
    expect(out).toContain('0 new');
  });

  it('returns exit code 2 on invalid or incompatible files', async () => {
    const fileA = path.join(tempDir, 'invalidA.json');
    const fileB = path.join(tempDir, 'invalidB.json');
    await fs.writeFile(fileA, JSON.stringify({ foo: 'bar' }), 'utf-8');
    await fs.writeFile(fileB, JSON.stringify({ baz: 'qux' }), 'utf-8');

    const exitCode = await runCli(['node', 'mantis', 'diff', fileA, fileB]);
    expect(exitCode).toBe(2);
    expect(stderrChunks.join('\n')).toContain('Error:');
  });
});
