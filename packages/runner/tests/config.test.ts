import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, validateConfig } from '../src/config.js';

describe('Runner Config Loader & Validator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-config-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('validates a valid minimal config with default values', () => {
    const config = validateConfig({
      baseUrl: 'http://localhost:3000',
    });

    expect(config.baseUrl).toBe('http://localhost:3000');
    expect(config.allowedEffects).toEqual(['read']);
    expect(config.skip).toEqual([]);
    expect(config.pathParamSamples).toEqual({});
    expect(config.allowRemote).toBe(false);
    expect(config.followRedirects).toBe(false);
    expect(config.limits.timeoutMs).toBe(5000);
    expect(config.limits.maxResponseBytes).toBe(1024 * 1024);
    expect(config.limits.maxRequests).toBe(50);
    expect(config.limits.concurrency).toBe(5);
    expect(config.limits.retries).toBe(0);
  });

  it('provides friendly error messages when required keys are missing or invalid', () => {
    expect(() => validateConfig({})).toThrowError(/baseUrl/);
    expect(() => validateConfig({ baseUrl: 'invalid-url' })).toThrowError(/valid URL/i);
    expect(() => validateConfig({
      baseUrl: 'http://localhost:3000',
      allowedEffects: ['invalidEffect'],
    })).toThrowError(/allowedEffects/);
  });

  it('loads valid configuration file from disk', async () => {
    const configPath = path.join(tempDir, 'devguard.config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        baseUrl: 'http://localhost:8080',
        allowedEffects: ['read', 'write'],
        skip: ['DELETE /users/:id'],
        pathParamSamples: { id: '42' },
        limits: {
          timeoutMs: 3000,
          maxRequests: 20,
        },
      })
    );

    const loaded = await loadConfig(configPath);
    expect(loaded.baseUrl).toBe('http://localhost:8080');
    expect(loaded.allowedEffects).toEqual(['read', 'write']);
    expect(loaded.skip).toEqual(['DELETE /users/:id']);
    expect(loaded.pathParamSamples).toEqual({ id: '42' });
    expect(loaded.limits.timeoutMs).toBe(3000);
    expect(loaded.limits.maxRequests).toBe(20);
    expect(loaded.limits.concurrency).toBe(5); // default preserved
  });

  it('resolves auth token from environment variable', async () => {
    const configPath = path.join(tempDir, 'devguard.config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        baseUrl: 'http://localhost:3000',
        auth: {
          header: 'Authorization',
          envVar: 'MY_TEST_TOKEN',
        },
      })
    );

    const loaded = await loadConfig(configPath, { MY_TEST_TOKEN: 'Bearer secret-123' });
    expect(loaded.auth?.value).toBe('Bearer secret-123');
  });

  it('throws friendly error when auth envVar is missing from environment', async () => {
    const configPath = path.join(tempDir, 'devguard.config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        baseUrl: 'http://localhost:3000',
        auth: {
          envVar: 'NON_EXISTENT_VAR',
        },
      })
    );

    await expect(loadConfig(configPath, {})).rejects.toThrowError(/NON_EXISTENT_VAR/);
  });

  it('throws friendly error when config file contains invalid JSON', async () => {
    const configPath = path.join(tempDir, 'devguard.config.json');
    await fs.writeFile(configPath, '{ invalid JSON');

    await expect(loadConfig(configPath)).rejects.toThrowError(/malformed JSON/i);
  });

  it('throws error when explicit config path does not exist', async () => {
    const missingPath = path.join(tempDir, 'nonexistent.config.json');
    await expect(loadConfig(missingPath)).rejects.toThrowError(/does not exist/i);
  });
});
