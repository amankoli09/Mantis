import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

function getBaselineValue(paramName: string, paramType?: string): unknown {
  const lower = paramName.toLowerCase();
  if (lower.includes('email')) return 'user@example.com';
  if (lower.includes('name')) return 'test-user';
  if (lower.includes('message')) return 'hello world';
  if (lower.includes('id')) return 'id_123';
  if (paramType === 'number') return 42;
  if (paramType === 'boolean') return true;
  return 'test';
}

export const validBaselineGenerator: GeneratorPlugin = {
  id: 'valid-baseline',
  name: 'Valid Baseline Input Generator',
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[] {
    const { url, skip } = resolveEndpointUrl(endpoint, config);

    const queryParams = endpoint.params.filter((p) => p.in === 'query');
    const bodyParams = endpoint.params.filter((p) => p.in === 'body');

    let finalUrl = url;
    if (queryParams.length > 0) {
      const search = new URLSearchParams();
      for (const q of queryParams) {
        search.set(q.name, String(getBaselineValue(q.name, q.type)));
      }
      finalUrl += `?${search.toString()}`;
    }

    const headers: Record<string, string> = {
      accept: 'application/json, */*',
    };

    if (config.auth?.value) {
      const headerName = config.auth.header ?? 'Authorization';
      headers[headerName] = config.auth.value;
    }

    let body: string | undefined;
    let baselineConfidence: 'high' | 'low' = 'high';

    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) || bodyParams.length > 0) {
      headers['content-type'] = 'application/json';
      const bodyObj: Record<string, unknown> = {};

      for (const b of bodyParams) {
        if (b.type === 'unknown') {
          baselineConfidence = 'low';
        }
        bodyObj[b.name] = getBaselineValue(b.name, b.type);
      }
      body = JSON.stringify(bodyObj);
    }

    const testCase: TestCase = {
      id: `${endpoint.id}::valid-baseline`,
      endpointId: endpoint.id,
      generatorId: 'valid-baseline',
      description: `Baseline request with valid inputs for ${endpoint.id}`,
      expectedBehavior: 'should-accept',
      baselineConfidence,
      request: {
        endpointId: endpoint.id,
        method: endpoint.method,
        url: finalUrl,
        headers,
        effect: endpoint.effect,
        ...(body !== undefined ? { body } : {}),
      },
      ...(skip ? { skip } : {}),
    };

    return [testCase];
  },
};
