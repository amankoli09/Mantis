import { describe, it, expect } from 'vitest';
import type { ApiModel, RunnerConfig, TestResult, TestRunnerEngine, Endpoint } from '../src/index.js';
import { runCrossAnalysis } from '../src/index.js';

describe('runCrossAnalysis', () => {
  const baseConfig: RunnerConfig = {
    baseUrl: 'http://127.0.0.1:3000',
    skip: [],
    allowedEffects: ['read', 'write'],
    pathParamSamples: {},
    limits: {
      timeoutMs: 5000,
      maxResponseBytes: 1024 * 1024,
      maxRequests: 50,
      concurrency: 5,
      retries: 0,
    },
    allowRemote: false,
    followRedirects: false,
    probePaths: [],
  };

  const createMockEndpoint = (id: string, method: 'GET' | 'POST', path: string): Endpoint => ({
    id,
    method,
    path,
    effect: method === 'GET' ? 'read' : 'write',
    confidence: 'confirmed',
    auth: { type: 'unknown' },
    params: [],
    responses: [],
    middleware: [],
    provenance: {
      kind: 'literal',
      filePath: 'src/routes.js',
      line: 10,
    },
  });

  const mockRunner: TestRunnerEngine = {
    execute: async (req) => ({
      endpointId: req.endpointId,
      request: req,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
        truncated: false,
        byteLength: 11,
      },
      durationMs: 5,
    }),
  };

  describe('route in code but 404 live', () => {
    it('flags endpoint returning 404 live as route-in-code-404-live', async () => {
      const ep = createMockEndpoint('GET /api/dead-route', 'GET', '/api/dead-route');
      const model: ApiModel = {
        modelVersion: '1.2.0',
        project: { name: 'test-app', root: 'test-app', framework: 'express', language: 'javascript' },
        endpoints: [ep],
        diagnostics: [],
      };

      const results: TestResult[] = [
        {
          testId: `${ep.id}::valid-baseline`,
          endpointId: ep.id,
          generatorId: 'valid-baseline',
          status: 'failed',
          request: {
            endpointId: ep.id,
            method: 'GET',
            url: 'http://127.0.0.1:3000/api/dead-route',
            headers: {},
            effect: 'read',
          },
          response: {
            status: 404,
            statusText: 'Not Found',
            headers: { 'content-type': 'text/plain' },
            body: 'Cannot GET /api/dead-route',
            truncated: false,
            byteLength: 26,
          },
        },
      ];

      const findings = await runCrossAnalysis({
        model,
        config: baseConfig,
        runner: mockRunner,
        results,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('route-in-code-404-live');
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.endpointId).toBe('GET /api/dead-route');
      expect(findings[0]?.message).toContain('returned 404 Not Found at runtime');
    });
  });

  describe('route live but not in code (opt-in probePaths)', () => {
    it('flags undeclared live route responding to probe path', async () => {
      const ep = createMockEndpoint('GET /api/known', 'GET', '/api/known');
      const model: ApiModel = {
        modelVersion: '1.2.0',
        project: { name: 'test-app', root: 'test-app', framework: 'express', language: 'javascript' },
        endpoints: [ep],
        diagnostics: [],
      };

      const configWithProbes: RunnerConfig = {
        ...baseConfig,
        probePaths: ['/healthz', '/api/known'], // /api/known is modeled, /healthz is unmodeled
      };

      const customRunner: TestRunnerEngine = {
        execute: async (req) => ({
          endpointId: req.endpointId,
          request: req,
          response: req.url.includes('/healthz')
            ? {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' } as Record<string, string>,
                body: '{"status":"healthy"}',
                truncated: false,
                byteLength: 20,
              }
            : {
                status: 404,
                statusText: 'Not Found',
                headers: {} as Record<string, string>,
                body: 'Not Found',
                truncated: false,
                byteLength: 9,
              },
          durationMs: 5,
        }),
      };

      const findings = await runCrossAnalysis({
        model,
        config: configWithProbes,
        runner: customRunner,
        results: [],
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe('live-route-not-in-code');
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.endpointId).toBe('GET /healthz');
      expect(findings[0]?.message).toContain('Live route responded at "/healthz" (HTTP 200)');
    });
  });

  describe('status code consistency for similar failures', () => {
    it('flags endpoint deviating in status code for same failure generator', async () => {
      const ep1 = createMockEndpoint('POST /api/items', 'POST', '/api/items');
      const ep2 = createMockEndpoint('POST /api/orders', 'POST', '/api/orders');
      const ep3 = createMockEndpoint('POST /api/users', 'POST', '/api/users');
      const ep4 = createMockEndpoint('POST /api/special', 'POST', '/api/special');

      const model: ApiModel = {
        modelVersion: '1.2.0',
        project: { name: 'test-app', root: 'test-app', framework: 'express', language: 'javascript' },
        endpoints: [ep1, ep2, ep3, ep4],
        diagnostics: [],
      };

      // 3 endpoints return 400 for wrong-type, but ep4 returns 422
      const makeResult = (ep: Endpoint, status: number): TestResult => ({
        testId: `${ep.id}::wrong-type`,
        endpointId: ep.id,
        generatorId: 'wrong-type',
        status: 'passed',
        request: {
          endpointId: ep.id,
          method: 'POST',
          url: `http://127.0.0.1:3000${ep.path}`,
          headers: { 'content-type': 'application/json' },
          body: '{"val":"wrong"}',
          effect: 'write',
        },
        response: {
          status,
          statusText: status === 400 ? 'Bad Request' : 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'invalid type' }),
          truncated: false,
          byteLength: 20,
        },
      });

      const results: TestResult[] = [
        makeResult(ep1, 400),
        makeResult(ep2, 400),
        makeResult(ep3, 400),
        makeResult(ep4, 422),
      ];

      const findings = await runCrossAnalysis({
        model,
        config: baseConfig,
        runner: mockRunner,
        results,
      });

      const deviation = findings.find((f) => f.ruleId === 'consistency/status-code-deviation');
      expect(deviation).toBeDefined();
      expect(deviation?.endpointId).toBe('POST /api/special');
      expect(deviation?.message).toContain('returned HTTP 422 for wrong-type, differing from dominant HTTP 400');
    });
  });

  describe('error response shape consistency', () => {
    it('flags endpoint returning error shape differing from dominant shape', async () => {
      const ep1 = createMockEndpoint('POST /api/items', 'POST', '/api/items');
      const ep2 = createMockEndpoint('POST /api/orders', 'POST', '/api/orders');
      const ep3 = createMockEndpoint('POST /api/users', 'POST', '/api/users');
      const ep4 = createMockEndpoint('POST /api/tickets', 'POST', '/api/tickets');

      const model: ApiModel = {
        modelVersion: '1.2.0',
        project: { name: 'test-app', root: 'test-app', framework: 'express', language: 'javascript' },
        endpoints: [ep1, ep2, ep3, ep4],
        diagnostics: [],
      };

      const makeResultWithBody = (ep: Endpoint, bodyObj: Record<string, unknown>): TestResult => ({
        testId: `${ep.id}::test`,
        endpointId: ep.id,
        generatorId: 'empty-body',
        status: 'passed',
        request: {
          endpointId: ep.id,
          method: 'POST',
          url: `http://127.0.0.1:3000${ep.path}`,
          headers: {},
          effect: 'write',
        },
        response: {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyObj),
          truncated: false,
          byteLength: 30,
        },
      });

      // 3 endpoints return { error: ... }, ep4 returns { message: ... }
      const results: TestResult[] = [
        makeResultWithBody(ep1, { error: 'Bad' }),
        makeResultWithBody(ep2, { error: 'Invalid' }),
        makeResultWithBody(ep3, { error: 'Missing' }),
        makeResultWithBody(ep4, { message: 'Conflict' }),
      ];

      const findings = await runCrossAnalysis({
        model,
        config: baseConfig,
        runner: mockRunner,
        results,
      });

      const shapeFinding = findings.find((f) => f.ruleId === 'consistency/error-response-shape');
      expect(shapeFinding).toBeDefined();
      expect(shapeFinding?.endpointId).toBe('POST /api/tickets');
      expect(shapeFinding?.message).toContain('differing from dominant shape [error]');
    });
  });
});
