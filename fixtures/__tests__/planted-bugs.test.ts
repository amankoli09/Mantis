import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scanProject } from '../../packages/adapter-express/src/index.js';
import { runTests, validateReport } from '../../packages/core/src/index.js';
import type { RunnerConfig, Finding, Report } from '../../packages/core/src/index.js';
import { createTestRunner } from '../../packages/runner/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURE_DIR = resolve(REPO_ROOT, 'fixtures/planted-bugs/app');
const EXPECTED_FINDINGS_PATH = resolve(REPO_ROOT, 'fixtures/planted-bugs/expected.findings.json');

describe('Planted Bugs Fixture — End-to-End Test Engine', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Start fixture app on ephemeral port (127.0.0.1:0)
    const app = require(resolve(FIXTURE_DIR, 'app.js'));
    await new Promise<void>((resolvePromise) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolvePromise();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });

  it('scans fixture, executes safely, and matches expected.findings.json with toStrictEqual', async () => {
    // 1. Scan the fixture codebase to produce the ApiModel
    const model = await scanProject(FIXTURE_DIR);
    expect(model.endpoints.length).toBe(6);

    // 2. Configure runner with explicit write effect enabled for this test
    const config: RunnerConfig = {
      baseUrl,
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

    // 3. Execute test pipeline via runner
    const runner = createTestRunner(config);
    const report = await runTests({
      model,
      config,
      runner,
    });

    // 4. Validate Report schema
    const validation = validateReport(report);
    expect(validation.success).toBe(true);

    // 5. Load golden expected findings
    const expectedRaw = readFileSync(EXPECTED_FINDINGS_PATH, 'utf-8');
    const expectedFindings = JSON.parse(expectedRaw) as Finding[];

    // 6. Strict equality check (no misses, no extras)
    expect(report.findings).toStrictEqual(expectedFindings);

    // 7. False-positive guards: Clean endpoints must produce 0 findings
    const healthFindings = report.findings.filter((f) => f.endpointId === 'GET /api/health');
    expect(healthFindings).toHaveLength(0);

    const echoFindings = report.findings.filter((f) => f.endpointId === 'POST /api/echo');
    expect(echoFindings).toHaveLength(0);
  });

  it('guarantees deterministic reports across two consecutive runs against running server', async () => {
    const model = await scanProject(FIXTURE_DIR);
    const config: RunnerConfig = {
      baseUrl,
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

    const runner = createTestRunner(config);

    const report1 = await runTests({ model, config, runner });
    const report2 = await runTests({ model, config, runner });

    // Exclude volatile timestamps
    const stripMeta = (r: Report) => {
      const { meta, ...rest } = r;
      return rest;
    };

    expect(stripMeta(report1)).toStrictEqual(stripMeta(report2));
  });
});
