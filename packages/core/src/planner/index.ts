import type { ApiModel } from '../schema/model.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { BUILTIN_GENERATORS } from '../generators/index.js';
import { sortEndpoints } from '../helpers/endpoint-helpers.js';

/**
 * Produces a deterministic test plan from an ApiModel and RunnerConfig.
 * Preserves stable alphabetical ordering and ensures skipped endpoints
 * receive structured skip reasons rather than being dropped.
 */
export function planTests(
  model: ApiModel,
  config: RunnerConfig,
  generators: GeneratorPlugin[] = BUILTIN_GENERATORS,
): TestCase[] {
  const sortedEndpoints = sortEndpoints([...model.endpoints]);
  const testCases: TestCase[] = [];

  for (const endpoint of sortedEndpoints) {
    for (const generator of generators) {
      const generated = generator.generate(endpoint, config);
      testCases.push(...generated);
    }
  }

  // Ensure deterministic test case order by test id
  return testCases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
