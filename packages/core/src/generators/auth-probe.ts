import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

export const authProbeGenerator: GeneratorPlugin = {
  id: 'auth-probe',
  name: 'Unauthenticated Request Probe Generator',
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[] {
    // Only generate for endpoints classified as requiring authentication
    if (endpoint.auth.type !== 'bearer' && endpoint.auth.type !== 'cookie') {
      return [];
    }

    const { url, skip } = resolveEndpointUrl(endpoint, config);

    // Deliberately omit all authentication headers and cookies
    const headers: Record<string, string> = {
      accept: 'application/json, */*',
    };

    let body: string | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      headers['content-type'] = 'application/json';
      body = '{}';
    }

    return [
      {
        id: `${endpoint.id}::auth-probe::unauthenticated`,
        endpointId: endpoint.id,
        generatorId: 'auth-probe',
        description: `Verify that protected endpoint ${endpoint.id} rejects unauthenticated requests`,
        expectedBehavior: 'should-reject',
        request: {
          endpointId: endpoint.id,
          method: endpoint.method,
          url,
          headers,
          body,
          effect: endpoint.effect,
        },
        ...(skip ? { skip } : {}),
      },
    ];
  },
};
