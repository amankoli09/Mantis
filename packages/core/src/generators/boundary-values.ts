import type { Endpoint, ParamDefinition } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestCase } from '../schema/test-engine.js';
import type { GeneratorPlugin } from '../plugins/types.js';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

interface BoundaryViolation {
  label: string;
  value: unknown;
  description: string;
}

function getBoundaryViolations(param: ParamDefinition): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const schema = param.schema;
  if (!schema) return violations;

  // Number / Integer boundary constraints
  if (typeof schema.minimum === 'number') {
    const minVal = schema.minimum;
    violations.push({
      label: 'below-min',
      value: minVal - 1,
      description: `Send value ${minVal - 1} below minimum ${minVal} for field "${param.name}"`,
    });
  }

  if (typeof schema.maximum === 'number') {
    const maxVal = schema.maximum;
    violations.push({
      label: 'above-max',
      value: maxVal + 1,
      description: `Send value ${maxVal + 1} above maximum ${maxVal} for field "${param.name}"`,
    });
  }

  // String length constraints
  if (typeof schema.minLength === 'number' && schema.minLength > 0) {
    const minLen = schema.minLength;
    violations.push({
      label: 'too-short',
      value: 'a'.repeat(minLen - 1),
      description: `Send string with length ${minLen - 1} shorter than minLength ${minLen} for field "${param.name}"`,
    });
  }

  if (typeof schema.maxLength === 'number') {
    const maxLen = schema.maxLength;
    violations.push({
      label: 'too-long',
      value: 'a'.repeat(maxLen + 1),
      description: `Send string with length ${maxLen + 1} longer than maxLength ${maxLen} for field "${param.name}"`,
    });
  }

  // String format constraints
  if (schema.format === 'email') {
    violations.push({
      label: 'invalid-email',
      value: 'not-an-email',
      description: `Send malformed email format for field "${param.name}"`,
    });
  }

  if (schema.format === 'uuid') {
    violations.push({
      label: 'invalid-uuid',
      value: 'not-a-uuid-format',
      description: `Send malformed UUID format for field "${param.name}"`,
    });
  }

  // Enum constraints
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    violations.push({
      label: 'invalid-enum',
      value: '__INVALID_ENUM_OPTION__',
      description: `Send value not in enum options for field "${param.name}"`,
    });
  }

  return violations;
}

function getValidSampleForParam(param: ParamDefinition): unknown {
  const schema = param.schema;
  if (schema) {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum[0];
    }
    if (schema.format === 'email') {
      return 'user@example.com';
    }
    if (schema.format === 'uuid') {
      return '123e4567-e89b-12d3-a456-426614174000';
    }
    if (typeof schema.minimum === 'number') {
      return schema.minimum;
    }
    if (typeof schema.minLength === 'number') {
      return 'test'.padEnd(schema.minLength, 'x');
    }
  }

  if (param.type === 'number') return 42;
  if (param.type === 'boolean') return true;
  return 'test';
}

export const boundaryValueGenerator: GeneratorPlugin = {
  id: 'boundary-values',
  name: 'Boundary Value Input Generator',
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[] {
    const bodyParams = endpoint.params.filter((p) => p.in === 'body');
    const queryParams = endpoint.params.filter((p) => p.in === 'query');

    const { url, skip } = resolveEndpointUrl(endpoint, config);

    const headers: Record<string, string> = {
      accept: 'application/json, */*',
    };

    if (config.auth?.value) {
      const headerName = config.auth.header ?? 'Authorization';
      headers[headerName] = config.auth.value;
    }

    const testCases: TestCase[] = [];

    // 1. Boundary violations for body parameters
    if (bodyParams.length > 0) {
      headers['content-type'] = 'application/json';

      for (const targetParam of bodyParams) {
        const violations = getBoundaryViolations(targetParam);
        for (const violation of violations) {
          const bodyObj: Record<string, unknown> = {};
          for (const p of bodyParams) {
            if (p.name === targetParam.name) {
              bodyObj[p.name] = violation.value;
            } else {
              bodyObj[p.name] = getValidSampleForParam(p);
            }
          }

          testCases.push({
            id: `${endpoint.id}::boundary-values::body.${targetParam.name}.${violation.label}`,
            endpointId: endpoint.id,
            generatorId: 'boundary-values',
            field: targetParam.name,
            description: `${violation.description} for ${endpoint.id}`,
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
    }

    // 2. Boundary violations for query parameters
    if (queryParams.length > 0) {
      for (const targetParam of queryParams) {
        const violations = getBoundaryViolations(targetParam);
        for (const violation of violations) {
          const search = new URLSearchParams();
          for (const p of queryParams) {
            if (p.name === targetParam.name) {
              search.set(p.name, String(violation.value));
            } else {
              search.set(p.name, String(getValidSampleForParam(p)));
            }
          }
          const qs = search.toString();
          const fullUrl = qs ? `${url}?${qs}` : url;

          testCases.push({
            id: `${endpoint.id}::boundary-values::query.${targetParam.name}.${violation.label}`,
            endpointId: endpoint.id,
            generatorId: 'boundary-values',
            field: targetParam.name,
            description: `${violation.description} for ${endpoint.id}`,
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
    }

    return testCases;
  },
};
