import type { ApiModel } from '../schema/model.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { Report, TestResult, Finding } from '../schema/test-engine.js';
import type { GeneratorPlugin, OraclePlugin, TestRunnerEngine } from '../plugins/types.js';
import { BUILTIN_GENERATORS } from '../generators/index.js';
import { BUILTIN_ORACLES } from '../oracles/index.js';
import { planTests } from '../planner/index.js';
import { runCrossAnalysis } from '../analysis/cross-analysis.js';

export interface RunTestsOptions {
  model: ApiModel;
  config: RunnerConfig;
  runner: TestRunnerEngine;
  generators?: GeneratorPlugin[];
  oracles?: OraclePlugin[];
}

/**
 * Runs a deterministic test cycle:
 * 1. Plans test cases from ApiModel + config.
 * 2. Safely executes non-skipped test cases via injected TestRunnerEngine.
 * 3. Judges outputs using response Oracles.
 * 4. Deduplicates findings deterministically and produces validated Report.
 */
export async function runTests(options: RunTestsOptions): Promise<Report> {
  const startTime = Date.now();
  const generators = options.generators ?? BUILTIN_GENERATORS;
  const oracles = options.oracles ?? BUILTIN_ORACLES;

  const testCases = planTests(options.model, options.config, generators);
  const endpointMap = new Map(options.model.endpoints.map((e) => [e.id, e]));

  const results: TestResult[] = [];
  const rawFindings: Finding[] = [];

  for (const testCase of testCases) {
    const endpoint = endpointMap.get(testCase.endpointId);
    if (!endpoint) {
      continue;
    }

    if (testCase.skip) {
      results.push({
        testId: testCase.id,
        endpointId: testCase.endpointId,
        generatorId: testCase.generatorId,
        status: 'skipped',
        skipReason: testCase.skip,
        request: testCase.request,
      });
      continue;
    }

    const executionResult = await options.runner.execute(testCase.request);

    let testCasePassed = true;
    for (const oracle of oracles) {
      const oracleFindings = oracle.judge(testCase, executionResult, endpoint);
      if (oracleFindings.length > 0) {
        testCasePassed = false;
        rawFindings.push(...oracleFindings);
      }
    }

    if (executionResult.error && !executionResult.response) {
      testCasePassed = false;
    }

    results.push({
      testId: testCase.id,
      endpointId: testCase.endpointId,
      generatorId: testCase.generatorId,
      status: testCasePassed ? 'passed' : 'failed',
      request: testCase.request,
      ...(executionResult.response ? { response: executionResult.response } : {}),
      ...(executionResult.error ? { error: executionResult.error.message } : {}),
    });
  }

  // Cross-analysis: route in code 404 live, live route not in code, consistency checks
  const crossFindings = await runCrossAnalysis({
    model: options.model,
    config: options.config,
    runner: options.runner,
    results,
  });
  rawFindings.push(...crossFindings);

  // Deduplicate findings deterministically by (endpointId, ruleId)
  const findingMap = new Map<string, Finding>();
  for (const f of rawFindings) {
    const key = `${f.endpointId}::${f.ruleId}`;
    if (!findingMap.has(key)) {
      findingMap.set(key, f);
    }
  }

  const findings = Array.from(findingMap.values()).sort((a, b) => {
    if (a.endpointId !== b.endpointId) {
      return a.endpointId < b.endpointId ? -1 : 1;
    }
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });

  const total = results.length;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  return {
    reportVersion: '1.0.0',
    summary: {
      total,
      passed,
      failed,
      skipped,
    },
    findings,
    results,
    meta: {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}
