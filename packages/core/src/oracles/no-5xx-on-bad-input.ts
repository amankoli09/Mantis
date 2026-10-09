import type { Endpoint } from '../schema/endpoint.js';
import type { ExecutionResult } from '../schema/runner.js';
import type { TestCase, Finding } from '../schema/test-engine.js';
import type { OraclePlugin } from '../plugins/types.js';

function extractPath(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.pathname;
  } catch {
    return urlStr;
  }
}

function extractSemanticHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const result: Record<string, string> = {};
  if (headers['content-type']) {
    result['content-type'] = headers['content-type'];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export const no5xxOnBadInputOracle: OraclePlugin = {
  id: 'no-5xx-on-bad-input',
  name: 'No 5xx on Bad Input Oracle',
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[] {
    const status = result.response?.status;
    if (status === undefined || status < 500) {
      return [];
    }

    const requestHeaders = extractSemanticHeaders(testCase.request.headers);
    const responseHeaders = extractSemanticHeaders(result.response?.headers);

    const requestExcerpt = {
      method: testCase.request.method,
      path: extractPath(testCase.request.url),
      ...(requestHeaders ? { headers: requestHeaders } : {}),
      ...(testCase.request.body !== undefined ? { body: testCase.request.body } : {}),
    };

    const responseExcerpt = {
      status,
      ...(responseHeaders ? { headers: responseHeaders } : {}),
      ...(result.response?.body !== undefined ? { bodySnippet: result.response.body.slice(0, 500) } : {}),
    };

    // Attach field provenance if test targeted a field or if endpoint has inferred body fields
    let fieldProvenance = undefined;
    const targetParam = testCase.field
      ? endpoint.params.find((p) => p.name === testCase.field)
      : endpoint.params.find((p) => p.in === 'body');

    if (targetParam?.provenance) {
      fieldProvenance = {
        ...targetParam.provenance,
        name: targetParam.name,
      };
    }

    if (testCase.expectedBehavior === 'should-reject') {
      return [
        {
          ruleId: 'no-5xx-on-bad-input',
          severity: 'error',
          endpointId: endpoint.id,
          message: `Expected 4xx for invalid input, but server responded with ${status}`,
          evidence: {
            request: requestExcerpt,
            response: responseExcerpt,
          },
          source: {
            file: endpoint.provenance.filePath,
            line: endpoint.provenance.line,
            ...(fieldProvenance ? { fieldProvenance } : {}),
          },
          confidence: 'high',
        },
      ];
    }

    // 5xx on baseline input is a weaker claim since our guessed input may be incomplete/invalid
    return [
      {
        ruleId: 'server-error-on-valid-input',
        severity: 'warning',
        endpointId: endpoint.id,
        message: `Server responded with ${status} on presumed valid baseline request`,
        evidence: {
          request: requestExcerpt,
          response: responseExcerpt,
        },
        source: {
          file: endpoint.provenance.filePath,
          line: endpoint.provenance.line,
        },
        confidence: 'low',
      },
    ];
  },
};
