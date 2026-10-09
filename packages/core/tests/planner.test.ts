import { describe, it, expect } from 'vitest';
import type { ApiModel, RunnerConfig } from '../src/index.js';
import { planTests } from '../src/index.js';

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

describe('Test Planner', () => {
  it('generates deterministic test cases in stable order', () => {
    const plan1 = planTests(mockModel, config);
    const plan2 = planTests(mockModel, config);

    expect(plan1).toEqual(plan2);
    expect(plan1.length).toBeGreaterThan(0);

    // Verify ordering is sorted by id
    const ids = plan1.map((tc) => tc.id);
    const sortedIds = [...ids].sort();
    expect(ids).toEqual(sortedIds);
  });

  it('preserves skip reasons for endpoints not in allowedEffects', () => {
    const readOnlyConfig: RunnerConfig = {
      ...config,
      allowedEffects: ['read'],
    };

    const plan = planTests(mockModel, readOnlyConfig);
    const postCases = plan.filter((tc) => tc.endpointId === 'POST /api/users');

    expect(postCases.length).toBeGreaterThan(0);
    for (const tc of postCases) {
      expect(tc.skip).toBeDefined();
      expect(tc.skip?.code).toBe('effect-not-allowed');
    }
  });
});
