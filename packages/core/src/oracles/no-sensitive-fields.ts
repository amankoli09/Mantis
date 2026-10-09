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

const DEFAULT_SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'passwordhash',
  'token',
  'secret',
  '__v',
  'apikey',
  'access_token',
  'refresh_token',
  'private_key',
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  for (const pattern of DEFAULT_SENSITIVE_FIELD_NAMES) {
    const normPattern = pattern.toLowerCase().replace(/[-_]/g, '');
    if (normalized === normPattern || normalized.endsWith(normPattern)) {
      return true;
    }
  }
  return false;
}

function findSensitivePathsAndRedact(
  val: unknown,
  currentPath: string,
  foundPaths: string[],
): unknown {
  if (val === null || val === undefined || typeof val !== 'object') {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item, idx) =>
      findSensitivePathsAndRedact(item, `${currentPath}[${idx}]`, foundPaths),
    );
  }

  const record = val as Record<string, unknown>;
  const redactedObj: Record<string, unknown> = {};

  const sortedKeys = Object.keys(record).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const key of sortedKeys) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    if (isSensitiveKey(key)) {
      foundPaths.push(nextPath);
      redactedObj[key] = '[REDACTED]';
    } else {
      redactedObj[key] = findSensitivePathsAndRedact(
        record[key],
        nextPath,
        foundPaths,
      );
    }
  }

  return redactedObj;
}

export const noSensitiveFieldsOracle: OraclePlugin = {
  id: 'no-sensitive-fields',
  name: 'No Sensitive Fields Oracle',
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[] {
    const body = result.response?.body;
    if (!body || typeof body !== 'string') {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }

    const sensitivePaths: string[] = [];
    const redactedBodyObj = findSensitivePathsAndRedact(parsed, '', sensitivePaths);

    if (sensitivePaths.length === 0) {
      return [];
    }

    sensitivePaths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const requestHeaders = extractSemanticHeaders(testCase.request.headers);
    const responseHeaders = extractSemanticHeaders(result.response?.headers);

    return [
      {
        ruleId: 'no-sensitive-fields',
        severity: 'warning',
        endpointId: endpoint.id,
        message: `Response JSON contains sensitive field at path: ${sensitivePaths.join(', ')}`,
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
            bodySnippet: JSON.stringify(redactedBodyObj),
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
