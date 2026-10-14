import { describe, it, expect } from 'vitest';
import type { Endpoint, TestCase, ExecutionResult, Finding } from '../src/index.js';
import {
  no5xxOnBadInputOracle,
  noStackTraceLeakOracle,
  noSensitiveFieldsOracle,
  authEnforcedOracle,
  filterFindingsByConfidence,
} from '../src/index.js';

const mockEndpoint: Endpoint = {
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
      provenance: {
        kind: 'inferred',
        filePath: 'src/routes/users.js',
        line: 25,
      },
    },
  ],
  responses: [],
  middleware: [],
  provenance: {
    kind: 'literal',
    filePath: 'src/routes/users.js',
    line: 20,
  },
};

const rejectTestCase: TestCase = {
  id: 'POST /api/users::empty-body',
  endpointId: 'POST /api/users',
  generatorId: 'empty-body',
  description: 'Empty body test',
  expectedBehavior: 'should-reject',
  field: 'email',
  request: {
    endpointId: 'POST /api/users',
    method: 'POST',
    url: 'http://127.0.0.1:3000/api/users',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    effect: 'write',
  },
};

const acceptTestCase: TestCase = {
  id: 'POST /api/users::valid-baseline',
  endpointId: 'POST /api/users',
  generatorId: 'valid-baseline',
  description: 'Valid baseline test',
  expectedBehavior: 'should-accept',
  baselineConfidence: 'low',
  request: {
    endpointId: 'POST /api/users',
    method: 'POST',
    url: 'http://127.0.0.1:3000/api/users',
    headers: { 'content-type': 'application/json' },
    body: '{"email":"test@example.com"}',
    effect: 'write',
  },
};

describe('no-5xx-on-bad-input Oracle', () => {
  it('detects 500 response on should-reject input (positive case)', () => {
    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: rejectTestCase.request,
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Internal server error' }),
        truncated: false,
        byteLength: 35,
      },
      durationMs: 15,
    };

    const findings = no5xxOnBadInputOracle.judge(rejectTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('no-5xx-on-bad-input');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.confidence).toBe('high');
    expect(findings[0]?.source.file).toBe('src/routes/users.js');
    expect(findings[0]?.source.line).toBe(20);
    expect(findings[0]?.source.fieldProvenance?.name).toBe('email');
    expect(findings[0]?.source.fieldProvenance?.line).toBe(25);
  });

  it('produces no findings on 400 Bad Request for should-reject input (negative case)', () => {
    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: rejectTestCase.request,
      response: {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Email is required' }),
        truncated: false,
        byteLength: 31,
      },
      durationMs: 10,
    };

    const findings = no5xxOnBadInputOracle.judge(rejectTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('emits lower-confidence server-error-on-valid-input when should-accept returns 500', () => {
    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: acceptTestCase.request,
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Database offline' }),
        truncated: false,
        byteLength: 30,
      },
      durationMs: 20,
    };

    const findings = no5xxOnBadInputOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('server-error-on-valid-input');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.confidence).toBe('low');
  });

  it('produces no findings on 200 OK for should-accept input (negative case)', () => {
    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 1 }),
        truncated: false,
        byteLength: 8,
      },
      durationMs: 12,
    };

    const findings = no5xxOnBadInputOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });
});

describe('no-stack-trace-leak Oracle', () => {
  it('detects stack traces in response body (positive case)', () => {
    const stackSnippet =
      'Error: Database pool timeout\n    at Object.<anonymous> (/app/db.js:10:5)\n    at Module._compile (node_modules/loader.js:4:2)';
    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: acceptTestCase.request,
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: stackSnippet }),
        truncated: false,
        byteLength: 120,
      },
      durationMs: 15,
    };

    const findings = noStackTraceLeakOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('no-stack-trace-leak');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.confidence).toBe('high');
  });

  it('produces no findings on clean error messages (negative case)', () => {
    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: acceptTestCase.request,
      response: {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid email address format' }),
        truncated: false,
        byteLength: 42,
      },
      durationMs: 10,
    };

    const findings = noStackTraceLeakOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });
});

describe('no-sensitive-fields Oracle', () => {
  it('detects sensitive fields in response JSON and redacts them in evidence (positive case)', () => {
    const sensitivePayload = {
      user: {
        id: 123,
        username: 'alice',
        passwordHash: '$2b$12$e8uq0w1298319208310',
        apiKey: 'sk_live_very_secret_key',
      },
    };

    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sensitivePayload),
        truncated: false,
        byteLength: 100,
      },
      durationMs: 15,
    };

    const findings = noSensitiveFieldsOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('no-sensitive-fields');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('user.apiKey, user.passwordHash');

    // Never print secret values in message or evidence
    expect(findings[0]?.message).not.toContain('sk_live_very_secret_key');
    expect(findings[0]?.message).not.toContain('$2b$12$');
    expect(findings[0]?.evidence.response.bodySnippet).toContain('[REDACTED]');
    expect(findings[0]?.evidence.response.bodySnippet).not.toContain('sk_live_very_secret_key');
  });

  it('produces no findings on clean response JSON (negative case)', () => {
    const cleanPayload = {
      user: {
        id: 123,
        username: 'alice',
        email: 'alice@example.com',
      },
    };

    const result: ExecutionResult = {
      endpointId: 'POST /api/users',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cleanPayload),
        truncated: false,
        byteLength: 60,
      },
      durationMs: 15,
    };

    const findings = noSensitiveFieldsOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });
});

describe('authEnforcedOracle', () => {
  const protectedBearerEndpoint: Endpoint = {
    ...mockEndpoint,
    id: 'GET /api/secure/profile',
    method: 'GET',
    path: '/api/secure/profile',
    effect: 'read',
    auth: { type: 'bearer' },
  };

  const unauthenticatedTestCase: TestCase = {
    id: 'GET /api/secure/profile::auth-probe::unauthenticated',
    endpointId: 'GET /api/secure/profile',
    generatorId: 'auth-probe',
    description: 'Unauthenticated test',
    expectedBehavior: 'should-reject',
    request: {
      endpointId: 'GET /api/secure/profile',
      method: 'GET',
      url: 'http://127.0.0.1:3000/api/secure/profile',
      headers: { accept: 'application/json' },
      effect: 'read',
    },
  };

  it('flags 200 response on bearer endpoint without credentials as error finding', () => {
    const result: ExecutionResult = {
      endpointId: 'GET /api/secure/profile',
      request: unauthenticatedTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"username":"alice"}',
        truncated: false,
        byteLength: 20,
      },
      durationMs: 10,
    };

    const findings = authEnforcedOracle.judge(unauthenticatedTestCase, result, protectedBearerEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('auth-enforced');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('HTTP 200 without credentials');
    expect(findings[0]?.evidence.response.status).toBe(200);
    expect(findings[0]?.source.file).toBe(protectedBearerEndpoint.provenance.filePath);
    expect(findings[0]?.source.line).toBe(protectedBearerEndpoint.provenance.line);
  });

  it('produces 0 findings when protected endpoint responds 401 Unauthorized', () => {
    const result: ExecutionResult = {
      endpointId: 'GET /api/secure/profile',
      request: unauthenticatedTestCase.request,
      response: {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
        body: '{"error":"Unauthorized"}',
        truncated: false,
        byteLength: 24,
      },
      durationMs: 10,
    };

    const findings = authEnforcedOracle.judge(unauthenticatedTestCase, result, protectedBearerEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('produces 0 findings when request includes Authorization header', () => {
    const authTestCase: TestCase = {
      ...unauthenticatedTestCase,
      request: {
        ...unauthenticatedTestCase.request,
        headers: {
          accept: 'application/json',
          authorization: 'Bearer valid_token',
        },
      },
    };

    const result: ExecutionResult = {
      endpointId: 'GET /api/secure/profile',
      request: authTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"username":"alice"}',
        truncated: false,
        byteLength: 20,
      },
      durationMs: 10,
    };

    const findings = authEnforcedOracle.judge(authTestCase, result, protectedBearerEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('produces 0 findings when endpoint specifies optional authentication', () => {
    const optionalAuthEndpoint: Endpoint = {
      ...protectedBearerEndpoint,
      auth: { type: 'bearer', details: 'optional bearer token' },
    };

    const result: ExecutionResult = {
      endpointId: 'GET /api/secure/profile',
      request: unauthenticatedTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"articles":[]}',
        truncated: false,
        byteLength: 15,
      },
      durationMs: 10,
    };

    const findings = authEnforcedOracle.judge(unauthenticatedTestCase, result, optionalAuthEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('downgrades confidence to medium when endpoint classification is uncertain', () => {
    const uncertainEndpoint: Endpoint = {
      ...protectedBearerEndpoint,
      confidence: 'uncertain',
    };

    const result: ExecutionResult = {
      endpointId: 'GET /api/secure/profile',
      request: unauthenticatedTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"data":123}',
        truncated: false,
        byteLength: 12,
      },
      durationMs: 10,
    };

    const findings = authEnforcedOracle.judge(unauthenticatedTestCase, result, uncertainEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe('medium');
    expect(findings[0]?.confidenceReason).toBeDefined();
  });
});

describe('False-Positive Regression Canned-Response Tests', () => {
  it('does NOT flag Mongoose internal __v document version key as sensitive field leak', () => {
    const mongoosePayload = {
      _id: '507f1f77bcf86cd799439011',
      text: 'Complete Mantis validation',
      done: true,
      __v: 0,
    };

    const result: ExecutionResult = {
      endpointId: 'GET /api/todos',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mongoosePayload),
        truncated: false,
        byteLength: 80,
      },
      durationMs: 5,
    };

    const findings = noSensitiveFieldsOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag non-secret tokens (csrfToken, deviceToken, pageToken) as leaks', () => {
    const tokenPayload = {
      csrfToken: 'd3b07384d113edec49eaa6238ad5ff00',
      deviceToken: 'fcm-device-token-12345',
      pageToken: 'cursor_offset_100',
      continuationToken: 'cont_abc',
    };

    const result: ExecutionResult = {
      endpointId: 'GET /api/app-config',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tokenPayload),
        truncated: false,
        byteLength: 150,
      },
      durationMs: 5,
    };

    const findings = noSensitiveFieldsOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag jwt tokens returned on authentication or login endpoints', () => {
    const authEndpoint: Endpoint = {
      ...mockEndpoint,
      id: 'POST /api/auth/login',
      path: '/api/auth/login',
    };

    const authLoginResponse = {
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      accessToken: 'access_jwt_string',
      refreshToken: 'refresh_jwt_string',
      user: {
        id: 1,
        username: 'react_dev',
      },
    };

    const result: ExecutionResult = {
      endpointId: 'POST /api/auth/login',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(authLoginResponse),
        truncated: false,
        byteLength: 200,
      },
      durationMs: 12,
    };

    const findings = noSensitiveFieldsOracle.judge(acceptTestCase, result, authEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('STILL flags password or secret leak even on auth endpoints', () => {
    const authEndpoint: Endpoint = {
      ...mockEndpoint,
      id: 'POST /api/auth/login',
      path: '/api/auth/login',
    };

    const leakyAuthResponse = {
      token: 'valid_jwt_token',
      user: {
        id: 1,
        username: 'react_dev',
        passwordHash: '$2b$10$hashed_password_leak',
      },
    };

    const result: ExecutionResult = {
      endpointId: 'POST /api/auth/login',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(leakyAuthResponse),
        truncated: false,
        byteLength: 150,
      },
      durationMs: 12,
    };

    const findings = noSensitiveFieldsOracle.judge(acceptTestCase, result, authEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('user.passwordHash');
    expect(findings[0]?.confidenceReason).toContain('user.passwordHash');
  });

  it('does NOT flag bare benign node_modules string in documentation or asset responses', () => {
    const benignDocResponse = {
      status: 'ok',
      message: 'Static fonts are bundled from /vendor/node_modules/font-awesome/fonts',
      path: 'node_modules/sample/asset.png',
    };

    const result: ExecutionResult = {
      endpointId: 'GET /api/docs',
      request: acceptTestCase.request,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(benignDocResponse),
        truncated: false,
        byteLength: 100,
      },
      durationMs: 5,
    };

    const findings = noStackTraceLeakOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(0);
  });

  it('flags real Node.js stack trace with high confidence and provides confidenceReason', () => {
    const stackTraceBody =
      'TypeError: Cannot read property of undefined\n' +
      '    at Object.<anonymous> (/app/server.js:14:10)\n' +
      '    at Module._compile (node_modules/v8-compile-cache/loader.js:20:5)';

    const result: ExecutionResult = {
      endpointId: 'GET /api/crash',
      request: acceptTestCase.request,
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'text/plain' },
        body: stackTraceBody,
        truncated: false,
        byteLength: 200,
      },
      durationMs: 8,
    };

    const findings = noStackTraceLeakOracle.judge(acceptTestCase, result, mockEndpoint);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe('high');
    expect(findings[0]?.confidenceReason).toContain('execution stack trace frames');
  });
});

describe('filterFindingsByConfidence', () => {
  const dummyFindings: Finding[] = [
    {
      ruleId: 'high-rule',
      severity: 'error',
      endpointId: 'POST /api/high',
      message: 'High finding',
      evidence: { request: { method: 'POST', path: '/api/high' }, response: { status: 500 } },
      source: { file: 'app.js', line: 10 },
      confidence: 'high',
      confidenceReason: 'High reason',
    },
    {
      ruleId: 'med-rule',
      severity: 'warning',
      endpointId: 'POST /api/med',
      message: 'Medium finding',
      evidence: { request: { method: 'POST', path: '/api/med' }, response: { status: 422 } },
      source: { file: 'app.js', line: 20 },
      confidence: 'medium',
      confidenceReason: 'Medium reason',
    },
    {
      ruleId: 'low-rule',
      severity: 'info',
      endpointId: 'POST /api/low',
      message: 'Low finding',
      evidence: { request: { method: 'POST', path: '/api/low' }, response: { status: 500 } },
      source: { file: 'app.js', line: 30 },
      confidence: 'low',
      confidenceReason: 'Low reason',
    },
  ];

  it('filters to high only when minConfidence is high', () => {
    const filtered = filterFindingsByConfidence(dummyFindings, 'high');
    expect(filtered.map((f) => f.ruleId)).toEqual(['high-rule']);
  });

  it('filters to medium and high when minConfidence is medium', () => {
    const filtered = filterFindingsByConfidence(dummyFindings, 'medium');
    expect(filtered.map((f) => f.ruleId)).toEqual(['high-rule', 'med-rule']);
  });

  it('preserves all findings when minConfidence is low', () => {
    const filtered = filterFindingsByConfidence(dummyFindings, 'low');
    expect(filtered.map((f) => f.ruleId)).toEqual(['high-rule', 'med-rule', 'low-rule']);
  });
});
