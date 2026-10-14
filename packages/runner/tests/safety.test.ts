import dns from 'node:dns';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { describe, it, expect } from 'vitest';
import type { Endpoint, ExecutionResult, Session } from '@mantis/core';
import { scanProject } from '@mantis/adapter-express';
import {
  validateBaseUrl,
  evaluateEndpointSafety,
  assertHostResolvesToLocal,
  resolveSafeOutputPath,
} from '../src/safety.js';
import { redactExecutionResult, serializeDeterministicSession } from '../src/recorder.js';
import { executeRequest } from '../src/http-client.js';

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

describe('Red-Team Attack 1: Where requests may go (URL Look-alikes and Host Guard)', () => {
  it('refuses look-alike hostnames and IP representations', () => {
    const lookAlikes = [
      'http://localhost.evil.com',
      'http://127.0.0.1@evil.com',
      'http://10.0.0.5',
      'http://0.0.0.0',
      'http://0.0.0.0:3000',
      'http://127.1',
      'http://127.1:3000',
      'http://2130706433',
      'http://2130706433:8080',
      'http://[::ffff:127.0.0.1]',
      'http://[::ffff:127.0.0.1]:3000',
      'http://[0:0:0:0:0:0:0:1]',
      'http://[::]',
    ];

    for (const url of lookAlikes) {
      expect(() => validateBaseUrl(url, false)).toThrow();
    }
  });

  it('refuses 0.0.0.0 and [::] even if allowRemote is true', () => {
    expect(() => validateBaseUrl('http://0.0.0.0:3000', true)).toThrow(/bind address|unspecified/i);
    expect(() => validateBaseUrl('http://[::]:3000', true)).toThrow(/bind address|unspecified|non-canonical/i);
  });

  it('refuses obfuscated integer/short IPs even if allowRemote is true', () => {
    expect(() => validateBaseUrl('http://127.1:3000', true)).toThrow(/non-canonical|look-alike/i);
    expect(() => validateBaseUrl('http://2130706433:3000', true)).toThrow(/non-canonical|look-alike/i);
  });

  it('refuses hostnames that resolve via DNS to non-local IP addresses', async () => {
    const fakeLookup = (async () => [
      { address: '93.184.216.34', family: 4 },
    ]) as unknown as typeof dns.promises.lookup;
    await expect(assertHostResolvesToLocal('my-app.localhost', fakeLookup)).rejects.toThrow(
      /non-local address/i
    );
  });

  it('permits hostnames that resolve via DNS to local loopback addresses', async () => {
    const fakeLookup = (async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ]) as unknown as typeof dns.promises.lookup;
    await expect(assertHostResolvesToLocal('localhost', fakeLookup)).resolves.not.toThrow();
  });
});

describe('Red-Team Attack: Path Traversal Defense (--out)', () => {
  it('allows safe output paths within target directory', () => {
    const baseDir = '/workspace/project';
    expect(resolveSafeOutputPath('report.json', baseDir)).toBe('/workspace/project/report.json');
    expect(resolveSafeOutputPath('reports/out.html', baseDir)).toBe('/workspace/project/reports/out.html');
  });

  it('refuses paths traversing outside target directory using ..', () => {
    const baseDir = '/workspace/project';
    expect(() => resolveSafeOutputPath('../outside.json', baseDir)).toThrow(/unsafe output path/i);
    expect(() => resolveSafeOutputPath('reports/../../escaped.json', baseDir)).toThrow(/unsafe output path/i);
  });

  it('refuses absolute paths containing traversal sequences', () => {
    const baseDir = '/workspace/project';
    expect(() => resolveSafeOutputPath('/etc/cron.d/../evil', baseDir)).toThrow(/unsafe output path/i);
    expect(() => resolveSafeOutputPath('/tmp/pwned/../../shadow', baseDir)).toThrow(/unsafe output path/i);
  });
});

describe('Red-Team Attack 3: Secret and Token Scrubbing', () => {
  it('redacts tokens from error messages and response bodies in ExecutionResult', () => {
    const secret = 'super-secret-token-12345';
    const result: ExecutionResult = {
      endpointId: 'GET /secure',
      durationMs: 40,
      request: {
        endpointId: 'GET /secure',
        url: `http://localhost:3000/secure?token=${secret}`,
        method: 'GET',
        effect: 'read',
        headers: {
          authorization: `Bearer ${secret}`,
          'x-custom-key': secret,
        },
      },
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: `Failed to authenticate token ${secret}` }),
        truncated: false,
        byteLength: 50,
      },
      error: {
        kind: 'other',
        message: `Connection failed with auth token ${secret} at http://localhost:3000`,
      },
    };

    const redacted = redactExecutionResult(result, secret, 'x-custom-key');
    expect(redacted.request.url).not.toContain(secret);
    expect(redacted.request.headers['authorization']).toBe('[REDACTED]');
    expect(redacted.request.headers['x-custom-key']).toBe('[REDACTED]');
    expect(redacted.response?.body).not.toContain(secret);
    expect(redacted.response?.body).toContain('[REDACTED]');
    expect(redacted.error?.message).not.toContain(secret);
    expect(redacted.error?.message).toContain('[REDACTED]');
  });

  it('automated secret grep over serialized session proves zero token leakage', () => {
    const secret = 'ghp_secret_credential_abcdef123456';
    const session: Session = {
      meta: {
        sessionId: 'test-session-1',
        createdAt: '2026-10-14T12:00:00Z',
        durationMs: 40,
        targetBaseUrl: 'http://localhost:3000',
        toolVersion: '0.1.0',
      },
      config: {
        baseUrl: `http://localhost:3000?key=${secret}`,
        allowedEffects: ['read'],
        skip: [],
        pathParamSamples: {},
        limits: { timeoutMs: 5000, maxResponseBytes: 1024, maxRequests: 10, concurrency: 1, retries: 0 },
        allowRemote: false,
        followRedirects: false,
        probePaths: [],
        auth: {
          header: 'authorization',
          value: secret,
        },
      },
      requests: [
        {
          endpointId: 'GET /items',
          durationMs: 15,
          request: {
            endpointId: 'GET /items',
            url: `http://localhost:3000/items?access_token=${secret}`,
            method: 'GET',
            effect: 'read',
            headers: { authorization: `Bearer ${secret}` },
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: `{"userToken": "${secret}"}`,
            truncated: false,
            byteLength: 40,
          },
          error: {
            kind: 'other',
            message: `Trace: auth token ${secret} rejected`,
          },
        },
      ],
      skips: [],
    };

    const serialized = serializeDeterministicSession(session);
    expect(serialized).not.toContain(secret);
    expect(serialized.includes(secret)).toBe(false);
  });
});

describe('Red-Team Attack 4: AST Scan Never Executes Target Code', () => {
  it('proves scanning does not execute top-level malicious side effects', async () => {
    const fixtureRoot = path.resolve(__dirname, '../../../fixtures/safety-malicious-code/app');
    const canaryFile = path.join(fixtureRoot, 'PWNED_CANARY.txt');

    // Ensure canary does not exist beforehand
    try {
      await fs.unlink(canaryFile);
    } catch {
      // Ignore if file does not exist
    }

    const model = await scanProject(fixtureRoot);

    expect(model.endpoints.length).toBeGreaterThan(0);
    expect(model.endpoints.map(e => e.id)).toContain('GET /health');

    // Prove canary file was NEVER created
    let canaryExists = false;
    try {
      await fs.access(canaryFile);
      canaryExists = true;
    } catch {
      canaryExists = false;
    }

    expect(canaryExists).toBe(false);
  });
});

describe('Red-Team Attack: Hostile Server Caps & Proxy Isolation', () => {
  it('caps response bytes and aborts stream under infinite hostile server response', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      // Send indefinite chunks
      const interval = setInterval(() => {
        try {
          res.write('A'.repeat(1024));
        } catch {
          clearInterval(interval);
        }
      }, 5);

      res.on('close', () => {
        clearInterval(interval);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await executeRequest({
        plan: {
          endpointId: 'GET /infinite',
          url: `http://127.0.0.1:${port}/infinite`,
          method: 'GET',
          effect: 'read',
          headers: {},
        },
        limits: {
          timeoutMs: 3000,
          maxResponseBytes: 2048,
          maxRequests: 5,
          concurrency: 1,
          retries: 0,
        },
      });

      expect(result.response).toBeDefined();
      expect(result.response?.truncated).toBe(true);
      expect(result.response?.byteLength).toBeLessThanOrEqual(2048);
    } finally {
      server.close();
    }
  });

  it('times out cleanly under slowloris hostile server', async () => {
    const server = http.createServer(() => {
      // Intentionally never respond or hang
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await executeRequest({
        plan: {
          endpointId: 'GET /slow',
          url: `http://127.0.0.1:${port}/slow`,
          method: 'GET',
          effect: 'read',
          headers: {},
        },
        limits: {
          timeoutMs: 150,
          maxResponseBytes: 1024,
          maxRequests: 5,
          concurrency: 1,
          retries: 0,
        },
      });

      expect(result.error).toBeDefined();
      expect(result.error?.kind).toMatch(/timeout|abort/);
    } finally {
      server.close();
    }
  });

  it('bypasses ambient HTTP_PROXY env var and connects directly to local server', async () => {
    let hitLocal = false;
    const server = http.createServer((_req, res) => {
      hitLocal = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const originalHttpProxy = process.env.HTTP_PROXY;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    try {
      // Point proxy to non-existent or blackhole address
      process.env.HTTP_PROXY = 'http://198.51.100.254:9999';
      process.env.HTTPS_PROXY = 'http://198.51.100.254:9999';

      const result = await executeRequest({
        plan: {
          endpointId: 'GET /proxy-check',
          url: `http://127.0.0.1:${port}/proxy-check`,
          method: 'GET',
          effect: 'read',
          headers: {},
        },
        limits: {
          timeoutMs: 2000,
          maxResponseBytes: 1024,
          maxRequests: 5,
          concurrency: 1,
          retries: 0,
        },
      });

      expect(hitLocal).toBe(true);
      expect(result.response?.status).toBe(200);
    } finally {
      process.env.HTTP_PROXY = originalHttpProxy;
      process.env.HTTPS_PROXY = originalHttpsProxy;
      server.close();
    }
  });
});
