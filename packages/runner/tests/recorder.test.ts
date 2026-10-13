import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Session, ExecutionResult, SkipReason, RunnerConfig } from '@mantis/core';
import { redactHeaders, redactSecretValue, saveSession, loadSession, serializeDeterministicSession } from '../src/recorder.js';

describe('Session Recorder & Redactor', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-recorder-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const sampleConfig: RunnerConfig = {
    baseUrl: 'http://localhost:3000',
    auth: {
      header: 'Authorization',
      value: 'SUPER_SECRET_TOKEN_XYZ',
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

  const sampleExecutionResult: ExecutionResult = {
    endpointId: 'GET /profile',
    durationMs: 45,
    request: {
      endpointId: 'GET /profile',
      method: 'GET',
      url: 'http://localhost:3000/profile',
      headers: {
        authorization: 'Bearer SUPER_SECRET_TOKEN_XYZ',
        'x-api-key': 'MY_API_KEY_123',
        accept: 'application/json',
      },
      effect: 'read',
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=abc123secret; HttpOnly',
      },
      body: JSON.stringify({ user: 'alice', tokenEcho: 'SUPER_SECRET_TOKEN_XYZ' }),
      truncated: false,
      byteLength: 60,
    },
  };

  const sampleSkip: SkipReason = {
    code: 'effect-not-allowed',
    message: 'Write effect not allowed',
    endpointId: 'DELETE /users/1',
  };

  it('redacts sensitive headers case-insensitively', () => {
    const headers = {
      Authorization: 'Bearer secret123',
      COOKIE: 'sessionId=abc',
      'X-Api-Key': 'key999',
      'User-Agent': 'Mantis/0.1.0',
    };

    const redacted = redactHeaders(headers, ['Authorization']);
    expect(redacted['Authorization']).toBe('[REDACTED]');
    expect(redacted['COOKIE']).toBe('[REDACTED]');
    expect(redacted['X-Api-Key']).toBe('[REDACTED]');
    expect(redacted['User-Agent']).toBe('Mantis/0.1.0');
  });

  it('redacts known secret strings from text content', () => {
    const text = 'Sent authorization with SUPER_SECRET_TOKEN_XYZ in payload';
    const redacted = redactSecretValue(text, 'SUPER_SECRET_TOKEN_XYZ');
    expect(redacted).toBe('Sent authorization with [REDACTED] in payload');
    expect(redacted).not.toContain('SUPER_SECRET_TOKEN_XYZ');
  });

  it('writes session file to disk and guarantees no secret token exists in file', async () => {
    const session: Session = {
      meta: {
        sessionId: 'test-session-001',
        createdAt: new Date().toISOString(),
        durationMs: 120,
        targetBaseUrl: 'http://localhost:3000',
        toolVersion: '0.1.0',
      },
      config: sampleConfig,
      requests: [sampleExecutionResult],
      skips: [sampleSkip],
    };

    const filePath = await saveSession(session, tempDir);
    expect(filePath).toContain('test-session-001.json');

    const fileContent = await fs.readFile(filePath, 'utf8');
    // Critical safety requirement: Secret token must NEVER be written to disk!
    expect(fileContent).not.toContain('SUPER_SECRET_TOKEN_XYZ');
    expect(fileContent).not.toContain('MY_API_KEY_123');
    expect(fileContent).toContain('[REDACTED]');
  });

  it('round-trips loadSession successfully', async () => {
    const session: Session = {
      meta: {
        sessionId: 'test-session-roundtrip',
        createdAt: new Date().toISOString(),
        durationMs: 200,
        targetBaseUrl: 'http://localhost:3000',
        toolVersion: '0.1.0',
      },
      config: sampleConfig,
      requests: [sampleExecutionResult],
      skips: [sampleSkip],
    };

    const filePath = await saveSession(session, tempDir);
    const loaded = await loadSession(filePath);

    expect(loaded.meta.sessionId).toBe('test-session-roundtrip');
    expect(loaded.requests).toHaveLength(1);
    expect(loaded.skips).toHaveLength(1);
    expect(loaded.requests[0]?.endpointId).toBe('GET /profile');
  });

  it('produces deterministic output across runs with identical bodies', () => {
    const sessionA: Session = {
      meta: {
        sessionId: 'session-a',
        createdAt: '2026-10-09T00:00:00.000Z',
        durationMs: 100,
        targetBaseUrl: 'http://localhost:3000',
        toolVersion: '0.1.0',
      },
      config: sampleConfig,
      requests: [sampleExecutionResult],
      skips: [sampleSkip],
    };

    const sessionB: Session = {
      meta: {
        sessionId: 'session-b',
        createdAt: '2026-10-09T01:23:45.678Z',
        durationMs: 250,
        targetBaseUrl: 'http://localhost:3000',
        toolVersion: '0.1.0',
      },
      config: { ...sampleConfig },
      requests: [{ ...sampleExecutionResult }],
      skips: [{ ...sampleSkip }],
    };

    const bodyA = serializeDeterministicSession(sessionA, false);
    const bodyB = serializeDeterministicSession(sessionB, false);

    expect(bodyA).toBe(bodyB);
  });
});
