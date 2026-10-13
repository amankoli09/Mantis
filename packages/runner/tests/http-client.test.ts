import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { executeRequest } from '../src/http-client.js';
import type { RequestPlan, RunnerLimits } from '@mantis/core';

describe('Safe HTTP Client (Undici Wrapper)', () => {
  let server: http.Server;
  let baseUrl: string;

  const defaultLimits: RunnerLimits = {
    timeoutMs: 300, // fast timeout for tests
    maxResponseBytes: 1024, // 1KB cap for tests
    maxRequests: 50,
    concurrency: 5,
    retries: 0,
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', count: 42 }));
        return;
      }

      if (url === '/error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error: Database connection lost\n  at Database.query (/app/db.js:42:11)');
        return;
      }

      if (url === '/hang') {
        // Intentionally do not write or end response to test timeout
        return;
      }

      if (url === '/huge') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        // Send ~20KB of data to exceed 1KB cap
        const chunk = 'A'.repeat(1024);
        for (let i = 0; i < 20; i++) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      if (url === '/echo-headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.headers));
        return;
      }

      if (url === '/redirect-same-host') {
        res.writeHead(302, { Location: '/json' });
        res.end('Redirecting to /json');
        return;
      }

      if (url === '/redirect-cross-host') {
        res.writeHead(302, { Location: 'https://example.com/external' });
        res.end('Redirecting to external host');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
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

  it('successfully executes a GET request returning 200 JSON', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /json',
      method: 'GET',
      url: `${baseUrl}/json`,
      headers: { accept: 'application/json' },
      effect: 'read',
    };

    const result = await executeRequest({ plan, limits: defaultLimits });
    expect(result.error).toBeUndefined();
    expect(result.response).toBeDefined();
    expect(result.response?.status).toBe(200);
    expect(result.response?.body).toContain('"status":"ok"');
    expect(result.response?.truncated).toBe(false);
  });

  it('records 500 error responses with stack-trace body cleanly', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /error',
      method: 'GET',
      url: `${baseUrl}/error`,
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({ plan, limits: defaultLimits });
    expect(result.error).toBeUndefined();
    expect(result.response?.status).toBe(500);
    expect(result.response?.body).toContain('Database connection lost');
  });

  it('enforces request timeout when server hangs without crashing', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /hang',
      method: 'GET',
      url: `${baseUrl}/hang`,
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({
      plan,
      limits: { ...defaultLimits, timeoutMs: 100 },
    });

    expect(result.response).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error?.kind).toBe('timeout');
    expect(result.error?.message).toMatch(/timeout|timed out|abort/i);
  });

  it('enforces response size cap and marks truncated when response exceeds maxResponseBytes', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /huge',
      method: 'GET',
      url: `${baseUrl}/huge`,
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({
      plan,
      limits: { ...defaultLimits, maxResponseBytes: 500 }, // 500 bytes cap
    });

    expect(result.error).toBeUndefined();
    expect(result.response).toBeDefined();
    expect(result.response?.truncated).toBe(true);
    expect(result.response?.byteLength).toBe(500);
    expect(result.response?.body.length).toBe(500);
  });

  it('proves secrets are sent over the wire by echoing headers', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /echo-headers',
      method: 'GET',
      url: `${baseUrl}/echo-headers`,
      headers: {
        authorization: 'Bearer REAL_SECRET_TOKEN_123',
        'x-custom-key': 'VALUE_456',
      },
      effect: 'read',
    };

    const result = await executeRequest({ plan, limits: defaultLimits });
    expect(result.response?.status).toBe(200);

    const echoedHeaders = JSON.parse(result.response!.body);
    expect(echoedHeaders['authorization']).toBe('Bearer REAL_SECRET_TOKEN_123');
    expect(echoedHeaders['x-custom-key']).toBe('VALUE_456');
  });

  it('records redirect response as is when followRedirects is false', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /redirect-same-host',
      method: 'GET',
      url: `${baseUrl}/redirect-same-host`,
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({
      plan,
      limits: defaultLimits,
      followRedirects: false,
    });

    expect(result.response?.status).toBe(302);
    expect(result.response?.headers['location']).toBe('/json');
  });

  it('follows redirect to same host when followRedirects is true', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /redirect-same-host',
      method: 'GET',
      url: `${baseUrl}/redirect-same-host`,
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({
      plan,
      limits: defaultLimits,
      followRedirects: true,
    });

    expect(result.response?.status).toBe(200);
    expect(result.response?.body).toContain('"status":"ok"');
  });

  it('refuses to follow redirect to another host even when followRedirects is true', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /redirect-cross-host',
      method: 'GET',
      url: `${baseUrl}/redirect-cross-host`,
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({
      plan,
      limits: defaultLimits,
      followRedirects: true,
    });

    // Cross-host redirect must NOT be followed; recorded as 302 response!
    expect(result.response?.status).toBe(302);
    expect(result.response?.headers['location']).toBe('https://example.com/external');
  });

  it('handles connection refused without crashing', async () => {
    const plan: RequestPlan = {
      endpointId: 'GET /offline',
      method: 'GET',
      url: 'http://127.0.0.1:54321/nonexistent',
      headers: {},
      effect: 'read',
    };

    const result = await executeRequest({
      plan,
      limits: { ...defaultLimits, retries: 0 },
    });

    expect(result.response).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error?.kind).toBe('network');
  });
});
