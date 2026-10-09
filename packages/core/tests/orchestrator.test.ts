import { describe, it, expect } from 'vitest';
import type { ApiModel, RunnerConfig, TestRunnerEngine, ExecutionResult } from '../src/index.js';
import { runTests, validateReport } from '../src/index.js';

const mockModel: ApiModel = {
  modelVersion: '1.2.0',
  project: {
    name: 'test-app',
    framework: 'express',
    language: 'javascript',
    root: '.',
  },
  endpoints: [
    {
      id: 'GET /api/health',
      method: 'GET',
      path: '/api/health',
      effect: 'read',
      confidence: 'confirmed',
      auth: { type: 'unknown' },
      params: [],
      responses: [],
      middleware: [],
      provenance: { kind: 'literal', filePath: 'app.js', line: 10 },
    },
    {
      id: 'POST /api/users',
      method: 'POST',
      path: '/api/users',
      effect: 'write',
      confidence: 'confirmed',
      auth: { type: 'unknown' },
      params: [
        {
          name: 'email',
          in: 'body',
          required: 'unknown',
          type: 'unknown',
          provenance: { kind: 'inferred', filePath: 'app.js', line: 25 },
        },
      ],
      responses: [],
      middleware: [],
      provenance: { kind: 'literal', filePath: 'app.js', line: 20 },
    },
  ],
  diagnostics: [],
};

const config: RunnerConfig = {
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
};

describe('Orchestrator runTests', () => {
  it('executes planned tests and tallies summary counts correctly', async () => {
    const mockRunner: TestRunnerEngine = {
      async execute(plan): Promise<ExecutionResult> {
        if (plan.endpointId === 'GET /api/health') {
          return {
            endpointId: plan.endpointId,
            request: plan,
            response: {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ status: 'ok' }),
              truncated: false,
              byteLength: 16,
            },
            durationMs: 5,
          };
        }

        // For POST /api/users: baseline succeeds, but bad input returns 500
        const isBadInput = !plan.body || plan.body === '{}' || plan.body.includes('12345');
        return {
          endpointId: plan.endpointId,
          request: plan,
          response: {
            status: isBadInput ? 500 : 201,
            statusText: isBadInput ? 'Internal Server Error' : 'Created',
            headers: { 'content-type': 'application/json' },
            body: isBadInput ? JSON.stringify({ error: 'Crash' }) : JSON.stringify({ id: 1 }),
            truncated: false,
            byteLength: 20,
          },
          durationMs: 10,
        };
      },
    };

    const report = await runTests({
      model: mockModel,
      config,
      runner: mockRunner,
    });

    expect(report.reportVersion).toBe('1.0.0');
    expect(report.summary.total).toBe(5);
    expect(report.summary.passed).toBe(2); // health + valid-baseline
    expect(report.summary.failed).toBe(3); // empty-body, missing-field, wrong-type
    expect(report.summary.skipped).toBe(0);

    // Findings are deduplicated: exactly 1 finding for POST /api/users
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.ruleId).toBe('no-5xx-on-bad-input');
    expect(report.findings[0]?.endpointId).toBe('POST /api/users');

    // Validates against Zod report schema
    const validation = validateReport(report);
    expect(validation.success).toBe(true);
  });

  it('guarantees deterministic reports across two consecutive runs', async () => {
    const mockRunner: TestRunnerEngine = {
      async execute(plan): Promise<ExecutionResult> {
        return {
          endpointId: plan.endpointId,
          request: plan,
          response: {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: true }),
            truncated: false,
            byteLength: 11,
          },
          durationMs: 5,
        };
      },
    };

    const report1 = await runTests({ model: mockModel, config, runner: mockRunner });
    const report2 = await runTests({ model: mockModel, config, runner: mockRunner });

    // Exclude volatile timestamps
    const report1Clean = { ...report1, meta: undefined };
    const report2Clean = { ...report2, meta: undefined };

    expect(report1Clean).toEqual(report2Clean);
  });
});
