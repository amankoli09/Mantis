import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures');

describe('mantis test', () => {
  let tempDir: string;
  let originalCwd: string;
  let stdoutChunks: string[] = [];
  let stderrChunks: string[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-test-cmd-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      stdoutChunks.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      stderrChunks.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('dry-run and safety checks', () => {
    it('--dry-run plans test cases and sends zero network requests', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--dry-run',
        '--base-url',
        'http://127.0.0.1:9999',
      ]);

      expect(exitCode).toBe(0);
      const output = stdoutChunks.join('\n');
      expect(output).toContain('Target: http://127.0.0.1:9999');
      expect(output).toContain('Dry-run mode: planned test cases');
      expect(output).toContain('[PLAN]');
    });

    it('--dry-run with --json outputs valid JSON plan', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--dry-run',
        '--base-url',
        'http://127.0.0.1:9999',
        '--json',
      ]);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdoutChunks.join('\n'));
      expect(parsed.banner).toBeDefined();
      expect(parsed.testCases).toBeInstanceOf(Array);
      expect(parsed.testCases.length).toBeGreaterThan(0);
    });

    it('rejects remote base URL without --allow-remote with exit code 2', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        'https://external-api.example.com',
      ]);

      expect(exitCode).toBe(2);
      expect(stderrChunks.join('\n')).toContain('Host Guard Error');
    });

    it('rejects --allow-destructive in non-interactive environment without --yes', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        'http://127.0.0.1:3000',
        '--allow-destructive',
      ]);

      expect(exitCode).toBe(2);
      expect(stderrChunks.join('\n')).toContain('--allow-destructive');
    });

    it('fails with exit code 2 when no base-url and no config file exists', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli(['node', 'mantis', 'test', fixturePath]);

      expect(exitCode).toBe(2);
      expect(stderrChunks.join('\n')).toContain('No configuration found');
    });

    it('refuses allowedEffects with destructive in config file when --allow-destructive CLI flag is missing', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const tempConfigFile = path.join(tempDir, 'mantis.config.json');
      await fs.writeFile(
        tempConfigFile,
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:3000',
          allowedEffects: ['read', 'destructive'],
          skip: [],
          pathParamSamples: {},
          limits: { timeoutMs: 5000, maxResponseBytes: 1048576, maxRequests: 50, concurrency: 5, retries: 0 },
        }),
        'utf-8',
      );

      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--config',
        tempConfigFile,
      ]);

      expect(exitCode).toBe(2);
      expect(stderrChunks.join('\n')).toContain('--allow-destructive');
    });

    it('refuses path traversal in --out outside target folder', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        'http://127.0.0.1:3000',
        '--dry-run',
        '--json',
        '--out',
        '../evil-escape.json',
      ]);

      expect(exitCode).toBe(2);
      expect(stderrChunks.join('\n')).toContain('Safety Error');
    });
  });

  describe('live execution against ephemeral server', () => {
    let server: http.Server;
    let baseUrl: string;
    let requestsReceived: string[] = [];

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        requestsReceived.push(`${req.method} ${req.url}`);
        const url = req.url ?? '/';

        if (url === '/health' || url.startsWith('/users')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', users: [] }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
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

    beforeEach(() => {
      requestsReceived = [];
    });

    it('executes live tests against server returning 200 and exits 0', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        baseUrl,
      ]);

      expect(exitCode).toBe(0);
      expect(requestsReceived.length).toBeGreaterThan(0);
      const output = stdoutChunks.join('\n');
      expect(output).toContain('Target:');
      expect(output).toContain('Summary:');

      // Verify session recording file was created
      const sessionsDir = path.join(tempDir, '.mantis/sessions');
      const sessionFiles = await fs.readdir(sessionsDir).catch(() => []);
      expect(sessionFiles.length).toBeGreaterThan(0);
    });

    it('outputs Report JSON and writes to file with --json and --out', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const outFile = path.join(tempDir, 'test-report.json');

      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        baseUrl,
        '--json',
        '--out',
        outFile,
      ]);

      expect(exitCode).toBe(0);
      const exists = await fs
        .stat(outFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const parsed = JSON.parse(await fs.readFile(outFile, 'utf-8'));
      expect(parsed.summary).toBeDefined();
      expect(parsed.results).toBeInstanceOf(Array);
    });
  });

  describe('exit code 1 on findings / 500 error', () => {
    let errorServer: http.Server;
    let errorBaseUrl: string;

    beforeAll(async () => {
      errorServer = http.createServer((req, res) => {
        // Return 500 on all non-health requests to trigger findings
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', stack: 'Fake stack trace' }));
      });

      await new Promise<void>((resolve) => {
        errorServer.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = errorServer.address() as { port: number };
      errorBaseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        errorServer.close(() => resolve());
      });
    });

    it('exits with code 1 when server returns 500 and triggers oracles', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        errorBaseUrl,
      ]);

      expect(exitCode).toBe(1);
      const output = stdoutChunks.join('\n');
      expect(output).toContain('Findings (1)');
      expect(output).toContain('server-error-on-valid-input');
    });

    it('respects --fail-on error threshold', async () => {
      const fixturePath = path.join(FIXTURES_DIR, 'simple');
      const exitCode = await runCli([
        'node',
        'mantis',
        'test',
        fixturePath,
        '--base-url',
        errorBaseUrl,
        '--fail-on',
        'error',
      ]);

      expect(exitCode).toBe(1);
    });
  });
});
