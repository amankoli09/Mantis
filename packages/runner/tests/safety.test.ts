import { describe, it, expect } from 'vitest';
import type { Endpoint } from '@mantis/core';
import { validateBaseUrl, evaluateEndpointSafety } from '../src/safety.js';

describe('Safety Engine - Host Guard (validateBaseUrl)', () => {
  it('allows standard local URLs by default', () => {
    expect(() => validateBaseUrl('http://localhost:3000', false)).not.toThrow();
    expect(() => validateBaseUrl('http://127.0.0.1:8080', false)).not.toThrow();
    expect(() => validateBaseUrl('http://[::1]:4000', false)).not.toThrow();
    expect(() => validateBaseUrl('http://sub.localhost:3000', false)).not.toThrow();
  });

  it('refuses non-local URLs when allowRemote is false', () => {
    expect(() => validateBaseUrl('https://example.com', false)).toThrow(/non-local/i);
    expect(() => validateBaseUrl('http://10.0.0.5:8000', false)).toThrow(/non-local/i);
    expect(() => validateBaseUrl('http://192.168.1.1:3000', false)).toThrow(/non-local/i);
    expect(() => validateBaseUrl('http://localhost.evil.com', false)).toThrow(/non-local/i);
  });

  it('allows non-local URLs when allowRemote is explicitly true', () => {
    expect(() => validateBaseUrl('https://example.com', true)).not.toThrow();
    expect(() => validateBaseUrl('http://10.0.0.5:8000', true)).not.toThrow();
  });

  it('refuses URLs with embedded credentials regardless of allowRemote', () => {
    expect(() => validateBaseUrl('http://user:pass@localhost:3000', false)).toThrow(/credentials/i);
    expect(() => validateBaseUrl('http://user:pass@localhost:3000', true)).toThrow(/credentials/i);
    expect(() => validateBaseUrl('https://admin@example.com', true)).toThrow(/credentials/i);
  });

  it('refuses non-http/https protocols', () => {
    expect(() => validateBaseUrl('ftp://localhost:21', false)).toThrow(/protocol|scheme/i);
    expect(() => validateBaseUrl('ws://localhost:3000', false)).toThrow(/protocol|scheme/i);
    expect(() => validateBaseUrl('file:///etc/passwd', false)).toThrow(/protocol|scheme/i);
  });

  it('refuses malformed or invalid URLs', () => {
    expect(() => validateBaseUrl('not-a-valid-url', false)).toThrow(/valid URL/i);
    expect(() => validateBaseUrl('', false)).toThrow(/valid URL/i);
  });
});

describe('Safety Engine - Decision Table (evaluateEndpointSafety)', () => {
  const baseEndpoint: Endpoint = {
    id: 'GET /items',
    method: 'GET',
    path: '/items',
    effect: 'read',
    auth: { type: 'unknown' },
    confidence: 'confirmed',
    confidenceReason: null,
    params: [],
    responses: [],
    middleware: [],
    provenance: { kind: 'literal', filePath: 'app.js', line: 10 },
  };

  it('allows confirmed endpoint with allowed effect and no path params', () => {
    const decision = evaluateEndpointSafety(baseEndpoint, {
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(true);
    expect(decision.skipReason).toBeUndefined();
  });

  it('skips endpoint when effect is unknown (regardless of allowedEffects or confidence)', () => {
    const ep: Endpoint = { ...baseEndpoint, effect: 'unknown' };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read', 'write', 'destructive'],
      skip: [],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('disallowed-effect-unknown');
    expect(decision.skipReason?.message).toContain('unknown mutation effect');
  });

  it('skips endpoint when confidence is uncertain (e.g. contains placeholders)', () => {
    const ep: Endpoint = {
      ...baseEndpoint,
      id: 'GET /items/<dynamic>',
      path: '/items/<dynamic>',
      confidence: 'uncertain',
      confidenceReason: 'MT-R003',
    };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('uncertain-endpoint');
    expect(decision.skipReason?.message).toContain('uncertain path or definition');
  });

  it('skips endpoint when explicitly in the skip list by exact ID', () => {
    const decision = evaluateEndpointSafety(baseEndpoint, {
      allowedEffects: ['read'],
      skip: ['GET /items'],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('explicitly-skipped');
  });

  it('skips endpoint when matched by wildcard path pattern in skip list', () => {
    const decision = evaluateEndpointSafety(baseEndpoint, {
      allowedEffects: ['read'],
      skip: ['/items*'],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('explicitly-skipped');
  });

  it('skips write endpoint when only read is allowed', () => {
    const ep: Endpoint = { ...baseEndpoint, id: 'POST /items', method: 'POST', effect: 'write' };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('effect-not-allowed');
    expect(decision.skipReason?.message).toContain('write');
  });

  it('allows write endpoint when write is explicitly in allowedEffects', () => {
    const ep: Endpoint = { ...baseEndpoint, id: 'POST /items', method: 'POST', effect: 'write' };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read', 'write'],
      skip: [],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(true);
  });

  it('skips destructive endpoint when only read and write are allowed', () => {
    const ep: Endpoint = { ...baseEndpoint, id: 'DELETE /items/:id', method: 'DELETE', effect: 'destructive' };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read', 'write'],
      skip: [],
      pathParamSamples: { id: '123' },
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('effect-not-allowed');
    expect(decision.skipReason?.message).toContain('destructive');
  });

  it('allows destructive endpoint when destructive is explicitly in allowedEffects and sample provided', () => {
    const ep: Endpoint = { ...baseEndpoint, id: 'DELETE /items/:id', method: 'DELETE', effect: 'destructive' };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read', 'write', 'destructive'],
      skip: [],
      pathParamSamples: { id: '123' },
    });
    expect(decision.runnable).toBe(true);
  });

  it('skips endpoint with path param if sample is missing', () => {
    const ep: Endpoint = {
      ...baseEndpoint,
      id: 'GET /items/:id',
      path: '/items/:id',
      params: [
        {
          name: 'id',
          in: 'path',
          required: true,
          type: 'string',
          provenance: { kind: 'literal', filePath: 'app.js', line: 10 },
        },
      ],
    };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason).toBeDefined();
    expect(decision.skipReason?.code).toBe('no-sample-for-path-param');
    expect(decision.skipReason?.paramName).toBe('id');
    expect(decision.skipReason?.message).toContain(':id');
  });

  it('allows endpoint with path param when sample is provided', () => {
    const ep: Endpoint = {
      ...baseEndpoint,
      id: 'GET /items/:id',
      path: '/items/:id',
      params: [
        {
          name: 'id',
          in: 'path',
          required: true,
          type: 'string',
          provenance: { kind: 'literal', filePath: 'app.js', line: 10 },
        },
      ],
    };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: { id: 'item-99' },
    });
    expect(decision.runnable).toBe(true);
    expect(decision.resolvedPath).toBe('/items/item-99');
  });

  it('skips endpoint with multiple path params if any sample is missing', () => {
    const ep: Endpoint = {
      ...baseEndpoint,
      id: 'GET /users/:userId/posts/:postId',
      path: '/users/:userId/posts/:postId',
      params: [
        { name: 'userId', in: 'path', required: true, type: 'string', provenance: { kind: 'literal', filePath: 'app.js', line: 1 } },
        { name: 'postId', in: 'path', required: true, type: 'string', provenance: { kind: 'literal', filePath: 'app.js', line: 1 } },
      ],
    };
    const decision = evaluateEndpointSafety(ep, {
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: { userId: 'u1' },
    });
    expect(decision.runnable).toBe(false);
    expect(decision.skipReason?.code).toBe('no-sample-for-path-param');
    expect(decision.skipReason?.paramName).toBe('postId');
  });
});
