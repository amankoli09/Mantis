import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Session } from '@devguard/core';
import { runCli } from '../src/cli.js';

describe('devguard report', () => {
  let tempDir: string;
  let originalCwd: string;
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-report-test-'));
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

  const sampleCleanSession: Session = {
    meta: {
      sessionId: 'session-clean-123',
      createdAt: new Date().toISOString(),
      durationMs: 120,
      targetBaseUrl: 'http://127.0.0.1:3000',
      toolVersion: '0.1.0',
    },
    config: {
      baseUrl: 'http://127.0.0.1:3000',
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
      limits: {
        timeoutMs: 5000,
        maxResponseBytes: 1048576,
        maxRequests: 50,
        concurrency: 5,
        retries: 0,
      },
      allowRemote: false,
      followRedirects: false,
    },
    requests: [
      {
        endpointId: 'GET /health',
        durationMs: 10,
        request: {
          endpointId: 'GET /health',
          url: 'http://127.0.0.1:3000/health',
          method: 'GET',
          headers: { accept: 'application/json' },
          effect: 'read',
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: '{"status":"ok"}',
          truncated: false,
          byteLength: 15,
        },
      },
    ],
    skips: [],
  };

  const sampleBugSession: Session = {
    meta: {
      sessionId: 'session-bug-456',
      createdAt: new Date().toISOString(),
      durationMs: 250,
      targetBaseUrl: 'http://127.0.0.1:3000',
      toolVersion: '0.1.0',
    },
    config: {
      baseUrl: 'http://127.0.0.1:3000',
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
      limits: {
        timeoutMs: 5000,
        maxResponseBytes: 1048576,
        maxRequests: 50,
        concurrency: 5,
        retries: 0,
      },
      allowRemote: false,
      followRedirects: false,
    },
    requests: [
      {
        endpointId: 'GET /users',
        durationMs: 15,
        request: {
          endpointId: 'GET /users',
          url: 'http://127.0.0.1:3000/users',
          method: 'GET',
          headers: { accept: 'application/json' },
          effect: 'read',
        },
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
          body: '{"error":"database crashed"}',
          truncated: false,
          byteLength: 30,
        },
      },
    ],
    skips: [],
  };

  it('fails with exit code 2 when no sessions exist and no session argument is provided', async () => {
    const exitCode = await runCli(['node', 'devguard', 'report']);
    expect(exitCode).toBe(2);
    expect(stderrChunks.join('\n')).toContain('No recorded sessions found');
  });

  it('fails with exit code 2 when specified session file does not exist', async () => {
    const exitCode = await runCli(['node', 'devguard', 'report', 'missing-session.json']);
    expect(exitCode).toBe(2);
    expect(stderrChunks.join('\n')).toContain('Error loading session file');
  });

  it('re-renders clean session and exits 0', async () => {
    const sessionFile = path.join(tempDir, 'clean-session.json');
    await fs.writeFile(sessionFile, JSON.stringify(sampleCleanSession, null, 2), 'utf-8');

    const exitCode = await runCli(['node', 'devguard', 'report', sessionFile]);
    expect(exitCode).toBe(0);

    const output = stdoutChunks.join('\n');
    expect(output).toContain('DevGuard Session Replay');
    expect(output).toContain('session-clean-123');
    expect(output).not.toContain('Evaluated Findings');
  });

  it('re-renders session with 500 error, produces findings, and exits 1', async () => {
    const sessionFile = path.join(tempDir, 'bug-session.json');
    await fs.writeFile(sessionFile, JSON.stringify(sampleBugSession, null, 2), 'utf-8');

    const exitCode = await runCli(['node', 'devguard', 'report', sessionFile]);
    expect(exitCode).toBe(1);

    const output = stdoutChunks.join('\n');
    expect(output).toContain('DevGuard Session Replay');
    expect(output).toContain('session-bug-456');
    expect(output).toContain('server-error-on-valid-input');
    expect(output).toContain('Evaluated Findings (1):');
  });

  it('automatically discovers latest session from .devguard/sessions/', async () => {
    const sessionsDir = path.join(tempDir, '.devguard/sessions');
    await fs.mkdir(sessionsDir, { recursive: true });

    const sessionFile = path.join(sessionsDir, 'session-clean.json');
    await fs.writeFile(sessionFile, JSON.stringify(sampleCleanSession, null, 2), 'utf-8');

    const exitCode = await runCli(['node', 'devguard', 'report']);
    expect(exitCode).toBe(0);

    const output = stdoutChunks.join('\n');
    expect(output).toContain('session-clean-123');
  });

  it('outputs Report JSON and writes to file with --json and --out', async () => {
    const sessionFile = path.join(tempDir, 'bug-session.json');
    await fs.writeFile(sessionFile, JSON.stringify(sampleBugSession, null, 2), 'utf-8');

    const outFile = path.join(tempDir, 'replayed-report.json');
    const exitCode = await runCli([
      'node',
      'devguard',
      'report',
      sessionFile,
      '--json',
      '--out',
      outFile,
    ]);

    expect(exitCode).toBe(1);
    const exists = await fs
      .stat(outFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const parsed = JSON.parse(await fs.readFile(outFile, 'utf-8'));
    expect(parsed.session).toBeDefined();
    expect(parsed.findings).toBeInstanceOf(Array);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it('outputs standalone HTML report with --html and writes to file with --out', async () => {
    const sessionFile = path.join(tempDir, 'bug-session.json');
    await fs.writeFile(sessionFile, JSON.stringify(sampleBugSession, null, 2), 'utf-8');

    const htmlOut = path.join(tempDir, 'report.html');
    const exitCode = await runCli([
      'node',
      'devguard',
      'report',
      sessionFile,
      '--html',
      '--out',
      htmlOut,
    ]);

    expect(exitCode).toBe(1);
    const content = await fs.readFile(htmlOut, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('DevGuard Test Report');
    expect(content).toContain('Findings');
  });

  it('renders HTML directly from an existing report.json file', async () => {
    const reportData = {
      reportVersion: '1.0.0',
      summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
      findings: [],
      results: [
        {
          testId: 'test-1',
          endpointId: 'GET /health',
          generatorId: 'smoke',
          status: 'passed',
          request: {
            endpointId: 'GET /health',
            method: 'GET',
            url: 'http://localhost:3000/health',
            headers: {},
            effect: 'read',
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: '{"status":"ok"}',
            truncated: false,
            byteLength: 15,
          },
        },
      ],
      meta: { generatedAt: '2026-10-10T00:00:00.000Z', durationMs: 100 },
    };
    const reportJsonPath = path.join(tempDir, 'sample-report.json');
    await fs.writeFile(reportJsonPath, JSON.stringify(reportData, null, 2), 'utf-8');

    const htmlOut = path.join(tempDir, 'report-from-json.html');
    const exitCode = await runCli([
      'node',
      'devguard',
      'report',
      reportJsonPath,
      '--html',
      '--out',
      htmlOut,
    ]);

    expect(exitCode).toBe(0);
    const content = await fs.readFile(htmlOut, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Pass Rate');
    expect(content).toContain('GET /health');
  });
});
