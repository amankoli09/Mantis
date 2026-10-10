import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

const MAX_FIELDS_CAP = 5;

function getMismatchedValue(paramType?: string, paramSchema?: Record<string, unknown>): unknown {
  if (paramType === 'number' || paramSchema?.type === 'number') {
    return 'not-a-number';
  }
  if (paramType === 'boolean' || paramSchema?.type === 'boolean') {
    return 'not-a-boolean';
  }
  if (paramType === 'array' || paramSchema?.type === 'array') {
    return 'not-an-array';
  }
  // For strings and unknown, sending a number is the classic wrong-type test
  return 12345;
}

export const wrongTypeGenerator: GeneratorPlugin = {
  id: 'wrong-type',
  name: 'Wrong Type Generator',
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[] {
    const bodyParams = endpoint.params.filter((p) => p.in === 'body').slice(0, MAX_FIELDS_CAP);
    const queryParams = endpoint.params.filter((p) => p.in === 'query').slice(0, MAX_FIELDS_CAP);

    const { url, skip } = resolveEndpointUrl(endpoint, config);

    const headers: Record<string, string> = {
      accept: 'application/json, */*',
    };

    if (config.auth?.value) {
      const headerName = config.auth.header ?? 'Authorization';
      headers[headerName] = config.auth.value;
    }

    const testCases: TestCase[] = [];

    // 1. Wrong type in body fields
    if (bodyParams.length > 0) {
      headers['content-type'] = 'application/json';

      for (const targetParam of bodyParams) {
        const bodyObj: Record<string, unknown> = {};
        for (const p of bodyParams) {
          if (p.name === targetParam.name) {
            bodyObj[p.name] = getMismatchedValue(p.type, p.schema);
          } else {
            bodyObj[p.name] = p.type === 'number' ? 42 : 'test';
          }
        }

        testCases.push({
          id: `${endpoint.id}::wrong-type::body.${targetParam.name}`,
          endpointId: endpoint.id,
          generatorId: 'wrong-type',
          field: targetParam.name,
          description: `Send mismatched type for body field "${targetParam.name}" for ${endpoint.id}`,
          expectedBehavior: 'should-reject',
          request: {
            endpointId: endpoint.id,
            method: endpoint.method,
            url,
            headers,
            body: JSON.stringify(bodyObj),
            effect: endpoint.effect,
          },
          ...(skip ? { skip } : {}),
        });
      }
    }

    // 2. Wrong type in query fields for GET endpoints
    if (endpoint.method === 'GET' && queryParams.length > 0) {
      for (const targetParam of queryParams) {
        const search = new URLSearchParams();
        for (const p of queryParams) {
          if (p.name === targetParam.name) {
            search.set(p.name, String(getMismatchedValue(p.type, p.schema)));
          } else {
            search.set(p.name, 'test');
          }
        }
        const qs = search.toString();
        const fullUrl = qs ? `${url}?${qs}` : url;

        testCases.push({
          id: `${endpoint.id}::wrong-type::query.${targetParam.name}`,
          endpointId: endpoint.id,
          generatorId: 'wrong-type',
          field: targetParam.name,
          description: `Send mismatched type for query parameter "${targetParam.name}" for ${endpoint.id}`,
          expectedBehavior: 'should-reject',
          request: {
            endpointId: endpoint.id,
            method: endpoint.method,
            url: fullUrl,
            headers,
            effect: endpoint.effect,
          },
          ...(skip ? { skip } : {}),
        });
      }
    }

    return testCases;
  },
};
