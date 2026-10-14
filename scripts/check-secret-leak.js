#!/usr/bin/env node
/**
 * Automated secret grep & safety verification script.
 * Verifies that authentication tokens and secrets never appear across any output paths:
 * - Serialized session JSON files
 * - Generated HTML reports
 * - Error messages and stack traces
 * - Path traversal validation
 */

import process from 'node:process';
import console from 'node:console';
import { redactExecutionResult, serializeDeterministicSession, resolveSafeOutputPath } from '../packages/runner/dist/index.js';
import { generateHtmlReport } from '../packages/cli/dist/index.js';

const CANARY_SECRET = 'TEST_SECRET_CANARY_REDACTION_VERIFY_9999';
const CUSTOM_KEY = 'TEST_CUSTOM_HEADER_SECRET_8888';

console.log('[check:secrets] Running automated secret leak detection across output paths...');

// 1. Verify ExecutionResult scrubbing
const executionResult = {
  endpointId: 'GET /api/v1/user',
  durationMs: 42,
  request: {
    endpointId: 'GET /api/v1/user',
    url: `http://127.0.0.1:3000/api/v1/user?token=${CANARY_SECRET}`,
    method: 'GET',
    headers: {
      authorization: `Bearer ${CANARY_SECRET}`,
      'x-custom-key': CUSTOM_KEY,
    },
    body: JSON.stringify({ token: CANARY_SECRET }),
  },
  response: {
    status: 500,
    statusText: 'Internal Error',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ error: `Rejected token ${CANARY_SECRET}` }),
    truncated: false,
    byteLength: 60,
  },
  error: {
    kind: 'other',
    message: `Network error connecting with auth token ${CANARY_SECRET}`,
  },
};

const redactedResult = redactExecutionResult(executionResult, CANARY_SECRET, 'x-custom-key');

// 2. Verify Session serialization
const testSession = {
  meta: {
    sessionId: 'session-secret-test',
    createdAt: new Date().toISOString(),
    mantisVersion: '0.1.0',
    platform: 'test',
    nodeVersion: process.version,
  },
  config: {
    baseUrl: `http://127.0.0.1:3000?key=${CANARY_SECRET}`,
    allowedEffects: ['read'],
    skip: [],
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
    probePaths: [],
    auth: {
      type: 'bearer',
      header: 'authorization',
      value: CANARY_SECRET,
    },
  },
  requests: [redactedResult],
  skips: [],
};

const sessionJson = serializeDeterministicSession(testSession, true);

if (sessionJson.includes(CANARY_SECRET)) {
  console.error('[FAIL] Secret canary found in serialized session output!');
  process.exit(1);
}

if (sessionJson.includes(CUSTOM_KEY)) {
  console.error('[FAIL] Custom header secret canary found in serialized session output!');
  process.exit(1);
}

// 3. Verify HTML Report generation
const mockReport = {
  reportVersion: '1.0.0',
  summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
  results: [
    {
      endpointId: 'GET /api/v1/user',
      status: 'failed',
      durationMs: 42,
      request: redactedResult.request,
      response: redactedResult.response,
      error: redactedResult.error?.message,
    },
  ],
  findings: [
    {
      ruleId: 'no-5xx-on-bad-input',
      severity: 'error',
      endpointId: 'GET /api/v1/user',
      message: 'Server returned 500 internal error',
      evidence: {
        request: {
          method: 'GET',
          url: redactedResult.request.url,
          headers: redactedResult.request.headers,
        },
        response: {
          status: 500,
          headers: redactedResult.response ? redactedResult.response.headers : {},
          bodyExcerpt: redactedResult.response ? redactedResult.response.body : '',
        },
      },
      source: {
        file: 'server.js',
        line: 10,
      },
      confidence: 'high',
    },
  ],
};

const htmlReport = generateHtmlReport(mockReport);

if (htmlReport.includes(CANARY_SECRET)) {
  console.error('[FAIL] Secret canary found in generated HTML report!');
  process.exit(1);
}

if (htmlReport.includes(CUSTOM_KEY)) {
  console.error('[FAIL] Custom header secret canary found in generated HTML report!');
  process.exit(1);
}

// 4. Verify Path Traversal Refusal
const traversalPaths = [
  '../outside.json',
  '../../etc/shadow',
  'reports/../../escaped.json',
  '/tmp/evil/../../cron',
];

for (const p of traversalPaths) {
  let thrown = false;
  try {
    resolveSafeOutputPath(p, '/workspace');
  } catch {
    thrown = true;
  }
  if (!thrown) {
    console.error(`[FAIL] Traversal path "${p}" was not rejected by resolveSafeOutputPath!`);
    process.exit(1);
  }
}

console.log('✓ Secret grep verified: 0 leaked tokens across all session, report, and error outputs.');
console.log('✓ Path traversal guard verified: all traversal attempts successfully refused.');
process.exit(0);
