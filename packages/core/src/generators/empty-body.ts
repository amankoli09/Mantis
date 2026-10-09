import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

export const emptyBodyGenerator: GeneratorPlugin = {
  id: 'empty-body',
  name: 'Empty Body Generator',
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[] {
    const bodyParams = endpoint.params.filter((p) => p.in === 'body');
    const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);

    if (!isBodyMethod && bodyParams.length === 0) {
      return [];
    }

    const { url, skip } = resolveEndpointUrl(endpoint, config);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, */*',
    };

    if (config.auth?.value) {
      const headerName = config.auth.header ?? 'Authorization';
      headers[headerName] = config.auth.value;
    }

    return [
      {
        id: `${endpoint.id}::empty-body`,
        endpointId: endpoint.id,
        generatorId: 'empty-body',
        description: `Empty JSON body for ${endpoint.id}`,
        expectedBehavior: 'should-reject',
        request: {
          endpointId: endpoint.id,
          method: endpoint.method,
          url,
          headers,
          body: '{}',
          effect: endpoint.effect,
        },
        ...(skip ? { skip } : {}),
      },
    ];
  },
};
