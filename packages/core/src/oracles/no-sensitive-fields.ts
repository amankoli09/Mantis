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

const STRICT_SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'passwordhash',
  'passwd',
  'secret',
  'apikey',
  'privatekey',
]);

const AUTH_TOKEN_FIELD_NAMES = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'sessiontoken',
  'bearer',
  'bearertoken',
]);

const EXEMPT_TOKEN_FIELD_NAMES = new Set([
  'csrftoken',
  'xsrftoken',
  'devicetoken',
  'pagetoken',
  'nextpagetoken',
  'continuationtoken',
  'fcmtoken',
  'pushtoken',
]);

const AUTH_ENDPOINT_PATH_REGEX = /(?:auth|login|signin|signup|register|oauth|token|session)s?(?:[/?#]|$)/i;

function isAuthEndpoint(endpoint: Endpoint): boolean {
  return AUTH_ENDPOINT_PATH_REGEX.test(endpoint.path) || AUTH_ENDPOINT_PATH_REGEX.test(endpoint.id);
}

function isSensitiveKey(key: string, isAuthRoute: boolean): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');

  if (EXEMPT_TOKEN_FIELD_NAMES.has(normalized)) {
    return false;
  }

  if (STRICT_SENSITIVE_FIELD_NAMES.has(normalized)) {
    return true;
  }

  // Auth tokens returned on auth endpoints are expected behavior, not a leak
  if (AUTH_TOKEN_FIELD_NAMES.has(normalized)) {
    return !isAuthRoute;
  }

  // Compound keys ending in strict sensitive patterns (e.g. user_password, client_secret)
  for (const pattern of STRICT_SENSITIVE_FIELD_NAMES) {
    if (normalized.endsWith(pattern)) {
      return true;
    }
  }

  return false;
}

function findSensitivePathsAndRedact(
  val: unknown,
  currentPath: string,
  foundPaths: string[],
  isAuthRoute: boolean,
): unknown {
  if (val === null || val === undefined || typeof val !== 'object') {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item, idx) =>
      findSensitivePathsAndRedact(item, `${currentPath}[${idx}]`, foundPaths, isAuthRoute),
    );
  }

  const record = val as Record<string, unknown>;
  const redactedObj: Record<string, unknown> = {};

  const sortedKeys = Object.keys(record).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const key of sortedKeys) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    if (isSensitiveKey(key, isAuthRoute)) {
      foundPaths.push(nextPath);
      redactedObj[key] = '[REDACTED]';
    } else {
      redactedObj[key] = findSensitivePathsAndRedact(
        record[key],
        nextPath,
        foundPaths,
        isAuthRoute,
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

    const isAuthRoute = isAuthEndpoint(endpoint);
    const sensitivePaths: string[] = [];
    const redactedBodyObj = findSensitivePathsAndRedact(parsed, '', sensitivePaths, isAuthRoute);

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
        confidenceReason: `Response JSON exposed sensitive credential field at: ${sensitivePaths.join(', ')}`,
      },
    ];
  },
};
