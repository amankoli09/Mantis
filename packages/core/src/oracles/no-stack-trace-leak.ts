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

const STACK_TRACE_PATTERNS = [
  /at\s+Object\.<anonymous>/i,
  /at\s+Module\._compile/i,
  /node_modules\//i,
  /Error:[^\n]+\n\s+at\s+/i,
  /(?:^|\n)\s*at\s+[\w$./<>_-]+\s+\([^)]+:\d+:\d+\)/i,
  /<pre>(?:TypeError|ReferenceError|SyntaxError|Error):/i,
];

export const noStackTraceLeakOracle: OraclePlugin = {
  id: 'no-stack-trace-leak',
  name: 'No Stack Trace Leak Oracle',
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[] {
    const body = result.response?.body;
    if (!body || typeof body !== 'string') {
      return [];
    }

    const hasLeak = STACK_TRACE_PATTERNS.some((pattern) => pattern.test(body));
    if (!hasLeak) {
      return [];
    }

    const requestHeaders = extractSemanticHeaders(testCase.request.headers);
    const responseHeaders = extractSemanticHeaders(result.response?.headers);

    return [
      {
        ruleId: 'no-stack-trace-leak',
        severity: 'warning',
        endpointId: endpoint.id,
        message: 'Response body contains stack trace or debug leak',
        evidence: {
          request: {
            method: testCase.request.method,
            path: extractPath(testCase.request.url),
            ...(requestHeaders ? { headers: requestHeaders } : {}),
            ...(testCase.request.body !== undefined ? { body: testCase.request.body } : {}),
          },
          response: {
            status: result.response?.status,
            ...(responseHeaders ? { headers: responseHeaders } : {}),
            bodySnippet: body.slice(0, 500),
          },
        },
        source: {
          file: endpoint.provenance.filePath,
          line: endpoint.provenance.line,
        },
        confidence: 'high',
      },
    ];
  },
};
