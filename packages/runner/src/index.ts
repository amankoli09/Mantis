export const PACKAGE_NAME = '@mantis/runner';

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

import type { RunnerConfig, RequestPlan, ExecutionResult, TestRunnerEngine } from '@mantis/core';
import { executeRequest } from './http-client.js';
import { redactExecutionResult } from './recorder.js';

/**
 * Creates a TestRunnerEngine adapter backed by the safe undici HTTP client.
 * Guarantees that returned ExecutionResults have auth credentials, tokens and sensitive headers redacted.
 */
export function createTestRunner(config: RunnerConfig): TestRunnerEngine {
  return {
    async execute(plan: RequestPlan): Promise<ExecutionResult> {
      const result = await executeRequest({
        plan,
        limits: config.limits,
        followRedirects: config.followRedirects,
      });
      return redactExecutionResult(result, config.auth?.value, config.auth?.header);
    },
  };
}
