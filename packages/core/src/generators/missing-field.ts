import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

const MAX_FIELDS_CAP = 5;

export const missingFieldGenerator: GeneratorPlugin = {
  id: 'missing-field',
  name: 'Missing Field Generator',
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

    // 1. Missing body fields
    if (bodyParams.length > 0) {
      headers['content-type'] = 'application/json';

      for (const targetParam of bodyParams) {
        const bodyObj: Record<string, unknown> = {};
        for (const other of bodyParams) {
          if (other.name !== targetParam.name) {
            bodyObj[other.name] = other.type === 'number' ? 42 : 'test';
          }
        }

        testCases.push({
          id: `${endpoint.id}::missing-field::body.${targetParam.name}`,
          endpointId: endpoint.id,
          generatorId: 'missing-field',
          field: targetParam.name,
          description: `Omit body field "${targetParam.name}" for ${endpoint.id}`,
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

    // 2. Missing query fields for GET endpoints
    if (endpoint.method === 'GET' && queryParams.length > 0) {
      for (const targetParam of queryParams) {
        const search = new URLSearchParams();
        for (const other of queryParams) {
          if (other.name !== targetParam.name) {
            search.set(other.name, 'test');
          }
        }
        const qs = search.toString();
        const fullUrl = qs ? `${url}?${qs}` : url;

        testCases.push({
          id: `${endpoint.id}::missing-field::query.${targetParam.name}`,
          endpointId: endpoint.id,
          generatorId: 'missing-field',
          field: targetParam.name,
          description: `Omit query parameter "${targetParam.name}" for ${endpoint.id}`,
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
