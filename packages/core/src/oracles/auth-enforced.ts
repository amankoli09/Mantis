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

export const authEnforcedOracle: OraclePlugin = {
  id: 'auth-enforced',
  name: 'Authentication Enforcement Oracle',
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[] {
    // Only applies to endpoints classified as requiring bearer or cookie authentication
    if (endpoint.auth.type !== 'bearer' && endpoint.auth.type !== 'cookie') {
      return [];
    }

    // If endpoint has optional authentication, unauthenticated access is permitted
    if (endpoint.auth.details && /optional/i.test(endpoint.auth.details)) {
      return [];
    }

    // Check if the request was sent without credentials
    const authHeader =
      testCase.request.headers['authorization'] ||
      testCase.request.headers['Authorization'];
    const cookieHeader =
      testCase.request.headers['cookie'] ||
      testCase.request.headers['Cookie'];

    if (authHeader || cookieHeader) {
      return [];
    }

    const status = result.response?.status;
    if (status === undefined || status < 200 || status >= 300) {
      return [];
    }

    const requestHeaders = extractSemanticHeaders(testCase.request.headers);
    const responseHeaders = extractSemanticHeaders(result.response?.headers);

    // If endpoint confidence is uncertain, report with medium confidence
    const confidence = endpoint.confidence === 'uncertain' ? 'medium' : 'high';

    return [
      {
        ruleId: 'auth-enforced',
        severity: 'error',
        endpointId: endpoint.id,
        message: `Endpoint classified with ${endpoint.auth.type} authentication responded with HTTP ${status} without credentials`,
        evidence: {
          request: {
            method: testCase.request.method,
            path: extractPath(testCase.request.url),
            ...(requestHeaders ? { headers: requestHeaders } : {}),
            ...(testCase.request.body !== undefined ? { body: testCase.request.body } : {}),
          },
          response: {
            status,
            ...(responseHeaders ? { headers: responseHeaders } : {}),
            ...(result.response?.body !== undefined
              ? { bodySnippet: result.response.body.slice(0, 500) }
              : {}),
          },
        },
        source: {
          file: endpoint.provenance.filePath,
          line: endpoint.provenance.line,
        },
        confidence,
        confidenceReason: `Endpoint classified with ${endpoint.auth.type} authentication responded with HTTP ${status} without credentials`,
      },
    ];
  },
};
