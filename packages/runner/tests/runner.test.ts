import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ApiModel, RunnerConfig } from '@mantis/core';
import { runPlan } from '../src/runner.js';
import { loadSession } from '../src/recorder.js';

describe('Runner Orchestrator (runPlan & dry-run)', () => {
  let server: http.Server;
  let baseUrl: string;
  let requestCounter = 0;
  let tempDir: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestCounter++;
      const url = req.url || '/';

      if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url.startsWith('/users')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: '1', name: 'Alice' }]));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    requestCounter = 0;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-runner-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const sampleModel: ApiModel = {
    modelVersion: '1.2.0',
    project: {
      name: 'test-app',
      framework: 'express',
      language: 'javascript',
      root: '.',
    },
    endpoints: [
      {
        id: 'GET /health',
        method: 'GET',
        path: '/health',
        effect: 'read',
        auth: { type: 'unknown' },
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'app.js', line: 10 },
      },
      {
        id: 'GET /users',
        method: 'GET',
        path: '/users',
        effect: 'read',
        auth: { type: 'unknown' },
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'app.js', line: 15 },
      },
      {
        id: 'POST /users',
        method: 'POST',
        path: '/users',
        effect: 'write',
        auth: { type: 'unknown' },
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'app.js', line: 20 },
      },
      {
        id: 'GET /unknown',
        method: 'GET',
        path: '/unknown',
        effect: 'unknown',
        auth: { type: 'unknown' },
        confidence: 'confirmed',
        confidenceReason: null,
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'literal', filePath: 'app.js', line: 25 },
      },
      {
        id: 'GET /uncertain/<dyn>',
        method: 'GET',
        path: '/uncertain/<dyn>',
        effect: 'read',
        auth: { type: 'unknown' },
        confidence: 'uncertain',
        confidenceReason: 'MT-R003',
        params: [],
        responses: [],
        middleware: [],
        provenance: { kind: 'unresolved', filePath: 'app.js', line: 30 },
      },
    ],
    diagnostics: [],
  };

  it('dry-run sends absolutely zero network requests and returns redacted plans and skips', async () => {
    const config: RunnerConfig = {
      baseUrl,
      auth: {
        header: 'Authorization',
        value: 'SECRET_BEARER_KEY',
      },
      skip: [],
      allowedEffects: ['read'],
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
    };

    const dryRunResult = await runPlan(sampleModel, config, { dryRun: true });

    // CRITICAL: Prove zero HTTP requests reached the server
    expect(requestCounter).toBe(0);

    // Two endpoints are runnable (GET /health, GET /users)
    expect(dryRunResult.plans).toHaveLength(2);
    expect(dryRunResult.plans[0]?.url).toBe(`${baseUrl}/health`);
    expect(dryRunResult.plans[0]?.headers['Authorization']).toBe('[REDACTED]');

    // Three endpoints are skipped (POST /users: write effect; GET /unknown: unknown effect; GET /uncertain: uncertain)
    expect(dryRunResult.skips).toHaveLength(3);
    const skipCodes = dryRunResult.skips.map((s) => s.code);
    expect(skipCodes).toContain('effect-not-allowed');
    expect(skipCodes).toContain('disallowed-effect-unknown');
    expect(skipCodes).toContain('uncertain-endpoint');
  });

  it('executes runnable requests, saves session file, and redacts secrets on disk', async () => {
    const config: RunnerConfig = {
      baseUrl,
      auth: {
        header: 'Authorization',
        value: 'SECRET_BEARER_KEY',
      },
      skip: [],
      allowedEffects: ['read'],
      pathParamSamples: {},
      limits: {
        timeoutMs: 5000,
        maxResponseBytes: 1048576,
        maxRequests: 50,
        concurrency: 2,
        retries: 0,
      },
      allowRemote: false,
      followRedirects: false,
    };

    const session = await runPlan(sampleModel, config, {
      dryRun: false,
      outputDir: tempDir,
      sessionId: 'test-run-session',
    });

    // Exactly 2 requests executed
    expect(requestCounter).toBe(2);
    expect(session.requests).toHaveLength(2);
    expect(session.skips).toHaveLength(3);

    // Verify written session file on disk
    const sessionFilePath = path.join(tempDir, 'test-run-session.json');
    const loaded = await loadSession(sessionFilePath);

    expect(loaded.meta.sessionId).toBe('test-run-session');
    expect(loaded.requests).toHaveLength(2);
    expect(loaded.requests[0]?.response?.status).toBe(200);

    // Verify secret was redacted on disk
    const rawFileContent = await fs.readFile(sessionFilePath, 'utf8');
    expect(rawFileContent).not.toContain('SECRET_BEARER_KEY');
    expect(rawFileContent).toContain('[REDACTED]');
  });

  it('enforces maxRequests cap strictly', async () => {
    const config: RunnerConfig = {
      baseUrl,
      skip: [],
      allowedEffects: ['read'],
      pathParamSamples: {},
      limits: {
        timeoutMs: 5000,
        maxResponseBytes: 1048576,
        maxRequests: 1, // Only allow 1 request even though 2 are runnable!
        concurrency: 1,
        retries: 0,
      },
      allowRemote: false,
      followRedirects: false,
    };

    const session = await runPlan(sampleModel, config, {
      dryRun: false,
      outputDir: tempDir,
    });

    expect(requestCounter).toBe(1);
    expect(session.requests).toHaveLength(1);
  });

  it('enforces concurrency limit so in-flight requests never exceed configured concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const slowServer = http.createServer(async (_req, res) => {
      inFlight++;
      if (inFlight > maxInFlight) {
        maxInFlight = inFlight;
      }
      // Hold for 30ms to create concurrency overlap
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight--;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', () => resolve()));
    const slowAddr = slowServer.address() as { port: number };
    const slowUrl = `http://127.0.0.1:${slowAddr.port}`;

    try {
      const multiModel: ApiModel = {
        modelVersion: '1.2.0',
        project: { name: 'test', framework: 'express', language: 'javascript', root: '.' },
        endpoints: Array.from({ length: 6 }, (_, i) => ({
          id: `GET /item/${i}`,
          method: 'GET',
          path: `/item/${i}`,
          effect: 'read',
          auth: { type: 'unknown' },
          confidence: 'confirmed',
          confidenceReason: null,
          params: [],
          responses: [],
          middleware: [],
          provenance: { kind: 'literal', filePath: 'app.js', line: i + 1 },
        })),
        diagnostics: [],
      };

      const config: RunnerConfig = {
        baseUrl: slowUrl,
        skip: [],
        allowedEffects: ['read'],
        pathParamSamples: {},
        limits: {
          timeoutMs: 5000,
          maxResponseBytes: 1048576,
          maxRequests: 50,
          concurrency: 2, // At most 2 concurrent requests!
          retries: 0,
        },
        allowRemote: false,
        followRedirects: false,
      };

      const session = await runPlan(multiModel, config, {
        dryRun: false,
        outputDir: tempDir,
      });

      expect(session.requests).toHaveLength(6);
      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => slowServer.close(() => resolve()));
    }
  });
});
