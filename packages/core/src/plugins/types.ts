import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig, RequestPlan, ExecutionResult } from '../schema/runner.js';
import type { TestCase, Finding } from '../schema/test-engine.js';

export interface GeneratorPlugin {
  readonly id: string;
  readonly name: string;
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[];
}

export interface OraclePlugin {
  readonly id: string;
  readonly name: string;
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[];
}

export interface TestRunnerEngine {
  execute(plan: RequestPlan): Promise<ExecutionResult>;
}
