export const PACKAGE_NAME = '@devguard/runner';

// Safety engine & host guard
export * from './safety.js';

// Configuration loader & validator
export * from './config.js';

// Safe HTTP client
export * from './http-client.js';

// Session recording & redaction
export * from './recorder.js';

// Runner orchestrator
export * from './runner.js';

import type { RunnerConfig, RequestPlan, ExecutionResult, TestRunnerEngine } from '@devguard/core';
import { executeRequest } from './http-client.js';

/**
 * Creates a TestRunnerEngine adapter backed by the safe undici HTTP client.
 */
export function createTestRunner(config: RunnerConfig): TestRunnerEngine {
  return {
    execute(plan: RequestPlan): Promise<ExecutionResult> {
      return executeRequest({
        plan,
        limits: config.limits,
        followRedirects: config.followRedirects,
      });
    },
  };
}
