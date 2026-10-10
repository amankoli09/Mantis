import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scanProject } from '../../packages/adapter-express/src/index.js';
import { runTests, validateReport } from '../../packages/core/src/index.js';
import type { RunnerConfig, Finding } from '../../packages/core/src/index.js';
import { createTestRunner } from '../../packages/runner/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURE_DIR = resolve(REPO_ROOT, 'fixtures/cross-analysis/app');
const EXPECTED_FINDINGS_PATH = resolve(REPO_ROOT, 'fixtures/cross-analysis/expected.findings.json');

describe('Cross-Analysis (Step 11) — End-to-End Test Engine', () => {
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

  it('scans fixture, executes live tests and cross-analysis, and matches expected.findings.json', async () => {
    // 1. Scan codebase to produce ApiModel
    const model = await scanProject(FIXTURE_DIR);
    expect(model.endpoints.length).toBe(7);

    // 2. Configure runner with probePaths opt-in and allowedEffects
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
      probePaths: ['/healthz', '/unmodeled-404'],
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

    // 5. Verify individual Step 11 cross-analysis findings
    // 5a. Auth enforced oracle
    const authEnforcedFinding = report.findings.find(
      (f) => f.ruleId === 'auth-enforced' && f.endpointId === 'GET /api/secure/profile'
    );
    expect(authEnforcedFinding).toBeDefined();
    expect(authEnforcedFinding?.severity).toBe('error');
    expect(authEnforcedFinding?.message).toContain('HTTP 200 without credentials');

    // Negative check: /api/secure/settings must NOT produce auth-enforced finding
    const settingsAuthFinding = report.findings.find(
      (f) => f.ruleId === 'auth-enforced' && f.endpointId === 'GET /api/secure/settings'
    );
    expect(settingsAuthFinding).toBeUndefined();

    // 5b. Route in code but 404 live
    const deadRouteFinding = report.findings.find(
      (f) => f.ruleId === 'route-in-code-404-live' && f.endpointId === 'GET /api/dead-route'
    );
    expect(deadRouteFinding).toBeDefined();
    expect(deadRouteFinding?.severity).toBe('warning');

    // 5c. Route live but not in code (opt-in probePaths)
    const liveRouteFinding = report.findings.find(
      (f) => f.ruleId === 'live-route-not-in-code' && f.endpointId === 'GET /healthz'
    );
    expect(liveRouteFinding).toBeDefined();
    expect(liveRouteFinding?.severity).toBe('warning');

    // Negative probe check: /unmodeled-404 returned 404 so must NOT produce finding
    const notFoundProbeFinding = report.findings.find(
      (f) => f.ruleId === 'live-route-not-in-code' && f.endpointId === 'GET /unmodeled-404'
    );
    expect(notFoundProbeFinding).toBeUndefined();

    // 5d. Status code consistency deviation
    const statusDeviation = report.findings.find(
      (f) => f.ruleId === 'consistency/status-code-deviation' && f.endpointId === 'POST /api/tickets'
    );
    expect(statusDeviation).toBeDefined();
    expect(statusDeviation?.message).toContain('returned HTTP 422 for wrong-type, differing from dominant HTTP 400');

    // 5e. Error response shape deviation
    const shapeDeviation = report.findings.find(
      (f) => f.ruleId === 'consistency/error-response-shape' && f.endpointId === 'POST /api/tickets'
    );
    expect(shapeDeviation).toBeDefined();
    expect(shapeDeviation?.message).toContain('differing from dominant shape [error]');

    // 6. Write or load golden findings
    if (!existsSync(EXPECTED_FINDINGS_PATH)) {
      writeFileSync(EXPECTED_FINDINGS_PATH, JSON.stringify(report.findings, null, 2) + '\n', 'utf-8');
    }

    const expectedRaw = readFileSync(EXPECTED_FINDINGS_PATH, 'utf-8');
    const expectedFindings = JSON.parse(expectedRaw) as Finding[];

    // 7. Strict equality check against golden
    expect(report.findings).toStrictEqual(expectedFindings);
  });
});
