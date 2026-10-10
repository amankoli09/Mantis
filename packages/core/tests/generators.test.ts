import { describe, it, expect } from 'vitest';
import type { Endpoint, RunnerConfig } from '../src/index.js';
import {
  validBaselineGenerator,
  emptyBodyGenerator,
  missingFieldGenerator,
  wrongTypeGenerator,
  boundaryValueGenerator,
  authProbeGenerator,
} from '../src/index.js';

const mockGetEndpoint: Endpoint = {
  id: 'GET /api/users/:id',
  method: 'GET',
  path: '/api/users/:id',
  effect: 'read',
  confidence: 'confirmed',
  auth: { type: 'unknown' },
  params: [
    {
      name: 'id',
      in: 'path',
      required: true,
      type: 'string',
      provenance: { kind: 'literal', filePath: 'routes.js', line: 10 },
    },
    {
      name: 'filter',
      in: 'query',
      required: 'unknown',
      type: 'unknown',
      provenance: { kind: 'inferred', filePath: 'routes.js', line: 11 },
    },
  ],
  responses: [],
  middleware: [],
  provenance: { kind: 'literal', filePath: 'routes.js', line: 10 },
};

const mockPostEndpoint: Endpoint = {
  id: 'POST /api/items',
  method: 'POST',
  path: '/api/items',
  effect: 'write',
  confidence: 'confirmed',
  auth: { type: 'unknown' },
  params: [
    {
      name: 'title',
      in: 'body',
      required: 'unknown',
      type: 'unknown',
      provenance: { kind: 'inferred', filePath: 'routes.js', line: 21 },
    },
    {
      name: 'count',
      in: 'body',
      required: 'unknown',
      type: 'number',
      provenance: { kind: 'inferred', filePath: 'routes.js', line: 22 },
    },
  ],
  responses: [],
  middleware: [],
  provenance: { kind: 'literal', filePath: 'routes.js', line: 20 },
};

const baseConfig: RunnerConfig = {
  baseUrl: 'http://127.0.0.1:3000',
  skip: [],
  allowedEffects: ['read'],
  pathParamSamples: { id: 'u123' },
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

describe('Input Generators', () => {
  it('valid-baseline resolves path params and query strings for GET', () => {
    const cases = validBaselineGenerator.generate(mockGetEndpoint, baseConfig);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.skip).toBeUndefined();
    expect(cases[0]?.expectedBehavior).toBe('should-accept');
    expect(cases[0]?.request.url).toBe('http://127.0.0.1:3000/api/users/u123?filter=test');
    expect(cases[0]?.baselineConfidence).toBe('high');
  });

  it('valid-baseline skips when path param sample is missing', () => {
    const configWithoutSample: RunnerConfig = {
      ...baseConfig,
      pathParamSamples: {},
    };
    const cases = validBaselineGenerator.generate(mockGetEndpoint, configWithoutSample);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.skip?.code).toBe('no-sample-for-path-param');
    expect(cases[0]?.skip?.paramName).toBe('id');
  });

  it('valid-baseline marks write endpoint as effect-not-allowed under safe read-only config', () => {
    const cases = validBaselineGenerator.generate(mockPostEndpoint, baseConfig);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.skip?.code).toBe('effect-not-allowed');
  });

  it('valid-baseline builds json body and flags low baselineConfidence when types are unknown', () => {
    const writeAllowedConfig: RunnerConfig = {
      ...baseConfig,
      allowedEffects: ['read', 'write'],
    };
    const cases = validBaselineGenerator.generate(mockPostEndpoint, writeAllowedConfig);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.skip).toBeUndefined();
    expect(cases[0]?.baselineConfidence).toBe('low');
    const parsedBody = JSON.parse(cases[0]?.request.body ?? '{}');
    expect(parsedBody).toHaveProperty('title');
    expect(parsedBody).toHaveProperty('count', 42);
  });

  it('empty-body generates empty payload for POST endpoints', () => {
    const writeAllowedConfig: RunnerConfig = {
      ...baseConfig,
      allowedEffects: ['read', 'write'],
    };
    const cases = emptyBodyGenerator.generate(mockPostEndpoint, writeAllowedConfig);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expectedBehavior).toBe('should-reject');
    expect(cases[0]?.request.body).toBe('{}');
  });

  it('empty-body produces 0 test cases for GET without body params', () => {
    const cases = emptyBodyGenerator.generate(mockGetEndpoint, baseConfig);
    expect(cases).toHaveLength(0);
  });

  it('missing-field generates test cases omitting one field at a time', () => {
    const writeAllowedConfig: RunnerConfig = {
      ...baseConfig,
      allowedEffects: ['read', 'write'],
    };
    const cases = missingFieldGenerator.generate(mockPostEndpoint, writeAllowedConfig);
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.field)).toEqual(['title', 'count']);

    // When title is omitted, count remains
    const omitTitleCase = cases.find((c) => c.field === 'title');
    const bodyObj1 = JSON.parse(omitTitleCase?.request.body ?? '{}');
    expect(bodyObj1).not.toHaveProperty('title');
    expect(bodyObj1).toHaveProperty('count', 42);

    // When count is omitted, title remains
    const omitCountCase = cases.find((c) => c.field === 'count');
    const bodyObj2 = JSON.parse(omitCountCase?.request.body ?? '{}');
    expect(bodyObj2).not.toHaveProperty('count');
    expect(bodyObj2).toHaveProperty('title', 'test');
  });

  it('wrong-type generates test cases with mismatched data types', () => {
    const writeAllowedConfig: RunnerConfig = {
      ...baseConfig,
      allowedEffects: ['read', 'write'],
    };
    const cases = wrongTypeGenerator.generate(mockPostEndpoint, writeAllowedConfig);
    expect(cases).toHaveLength(2);

    // String/unknown title receives a number
    const titleCase = cases.find((c) => c.field === 'title');
    const body1 = JSON.parse(titleCase?.request.body ?? '{}');
    expect(typeof body1.title).toBe('number');

    // Number count receives a string
    const countCase = cases.find((c) => c.field === 'count');
    const body2 = JSON.parse(countCase?.request.body ?? '{}');
    expect(typeof body2.count).toBe('string');
  });

  it('boundary-values generates test cases for min/max and string constraints', () => {
    const constrainedEndpoint: Endpoint = {
      id: 'POST /api/constrained',
      method: 'POST',
      path: '/api/constrained',
      effect: 'write',
      confidence: 'confirmed',
      auth: { type: 'unknown' },
      params: [
        {
          name: 'age',
          in: 'body',
          required: true,
          type: 'number',
          schema: { type: 'number', minimum: 18, maximum: 99 },
          provenance: { kind: 'resolved', filePath: 'schema.js', line: 10 },
        },
        {
          name: 'username',
          in: 'body',
          required: true,
          type: 'string',
          schema: { type: 'string', minLength: 3, maxLength: 20 },
          provenance: { kind: 'resolved', filePath: 'schema.js', line: 11 },
        },
        {
          name: 'email',
          in: 'body',
          required: true,
          type: 'string',
          schema: { type: 'string', format: 'email' },
          provenance: { kind: 'resolved', filePath: 'schema.js', line: 12 },
        },
      ],
      responses: [],
      middleware: [],
      provenance: { kind: 'literal', filePath: 'routes.js', line: 5 },
    };

    const writeAllowedConfig: RunnerConfig = {
      ...baseConfig,
      allowedEffects: ['read', 'write'],
    };

    const cases = boundaryValueGenerator.generate(constrainedEndpoint, writeAllowedConfig);
    expect(cases.length).toBeGreaterThanOrEqual(4);

    // Below minimum test: age = 17
    const belowMinCase = cases.find((c) => c.id.includes('below-min'));
    expect(belowMinCase).toBeDefined();
    const belowMinBody = JSON.parse(belowMinCase?.request.body ?? '{}');
    expect(belowMinBody.age).toBe(17);

    // Above maximum test: age = 100
    const aboveMaxCase = cases.find((c) => c.id.includes('above-max'));
    expect(aboveMaxCase).toBeDefined();
    const aboveMaxBody = JSON.parse(aboveMaxCase?.request.body ?? '{}');
    expect(aboveMaxBody.age).toBe(100);

    // Too short string test: username length < 3
    const tooShortCase = cases.find((c) => c.id.includes('too-short'));
    expect(tooShortCase).toBeDefined();
    const tooShortBody = JSON.parse(tooShortCase?.request.body ?? '{}');
    expect(tooShortBody.username.length).toBe(2);

    // Too long string test: username length > 20
    const tooLongCase = cases.find((c) => c.id.includes('too-long'));
    expect(tooLongCase).toBeDefined();
    const tooLongBody = JSON.parse(tooLongCase?.request.body ?? '{}');
    expect(tooLongBody.username.length).toBe(21);
  });
});

describe('authProbeGenerator', () => {
  const baseConfig: RunnerConfig = {
    baseUrl: 'http://127.0.0.1:3000',
    skip: [],
    allowedEffects: ['read'],
    pathParamSamples: { id: '123' },
    limits: {
      timeoutMs: 5000,
      maxResponseBytes: 1048576,
      maxRequests: 50,
      concurrency: 5,
      retries: 0,
    },
    allowRemote: false,
    followRedirects: false,
    probePaths: [],
  };

  const bearerReadEndpoint: Endpoint = {
    ...mockGetEndpoint,
    id: 'GET /api/secure/profile',
    path: '/api/secure/profile',
    params: [],
    auth: { type: 'bearer' },
    effect: 'read',
  };

  const bearerWriteEndpoint: Endpoint = {
    ...mockPostEndpoint,
    id: 'POST /api/secure/items',
    path: '/api/secure/items',
    auth: { type: 'bearer' },
    effect: 'write',
  };

  it('generates unauthenticated probe test case for read bearer endpoint', () => {
    const cases = authProbeGenerator.generate(bearerReadEndpoint, baseConfig);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toBe('GET /api/secure/profile::auth-probe::unauthenticated');
    expect(cases[0]?.expectedBehavior).toBe('should-reject');
    expect(cases[0]?.request.headers.authorization).toBeUndefined();
    expect(cases[0]?.skip).toBeUndefined();
  });

  it('skips write endpoint in safe mode (when allowedEffects is read only)', () => {
    const cases = authProbeGenerator.generate(bearerWriteEndpoint, baseConfig);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.skip).toBeDefined();
    expect(cases[0]?.skip?.code).toBe('effect-not-allowed');
  });

  it('produces 0 test cases for endpoints without bearer or cookie auth', () => {
    const cases = authProbeGenerator.generate(mockGetEndpoint, baseConfig);
    expect(cases).toHaveLength(0);
  });
});
