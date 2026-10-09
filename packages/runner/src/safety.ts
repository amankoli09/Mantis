import type { Endpoint, AllowedEffect, SkipReason } from '@devguard/core';

export interface SafetyEvaluation {
  runnable: boolean;
  skipReason?: SkipReason;
  resolvedPath?: string;
}

export interface SafetyConfig {
  allowedEffects: AllowedEffect[];
  skip: string[];
  pathParamSamples: Record<string, string | number>;
}

const LOCAL_HOST_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Validates a target base URL according to strict host-guard safety rules.
 * Throws a descriptive Error if the URL is insecure, contains credentials, or targets non-local hosts without allowRemote.
 */
export function validateBaseUrl(rawUrl: string, allowRemote = false): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('baseUrl must be a valid URL string');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`baseUrl must be a valid URL: received "${rawUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`baseUrl must use http or https scheme: received "${parsed.protocol}"`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Refusing baseUrl with embedded credentials for security reasons');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal =
    LOCAL_HOST_NAMES.has(hostname) ||
    hostname.endsWith('.localhost');

  if (!isLocal && !allowRemote) {
    throw new Error(
      `Refusing non-local baseUrl "${rawUrl}". By default, DevGuard only executes against local hosts. To allow remote hosts, set allowRemote: true in config.`
    );
  }

  return parsed;
}

/**
 * Checks whether a pattern (e.g. "GET /items", "/items*", "POST *") matches an endpoint ID or path.
 */
function matchesSkipPattern(pattern: string, endpointId: string, endpointPath: string): boolean {
  if (pattern === endpointId || pattern === endpointPath) {
    return true;
  }

  // Support wildcard prefix matching, e.g. "/items*" or "GET /items*"
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    if (endpointId.startsWith(prefix) || endpointPath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether an endpoint from the API Model can safely be run.
 * Follows the strict safety decision table:
 * - Effect "unknown" is NEVER runnable.
 * - Confidence "uncertain" is NEVER runnable.
 * - Endpoints in config.skip are skipped.
 * - Effect must be in config.allowedEffects.
 * - Path parameters must have explicit sample values provided in config.
 */
export function evaluateEndpointSafety(endpoint: Endpoint, config: SafetyConfig): SafetyEvaluation {
  // 1. Check effect unknown
  if (endpoint.effect === 'unknown') {
    return {
      runnable: false,
      skipReason: {
        code: 'disallowed-effect-unknown',
        message: `Endpoint "${endpoint.id}" has unknown mutation effect and cannot safely be executed.`,
        endpointId: endpoint.id,
      },
    };
  }

  // 2. Check confidence uncertain (e.g. contains unresolved placeholders)
  if (endpoint.confidence === 'uncertain') {
    return {
      runnable: false,
      skipReason: {
        code: 'uncertain-endpoint',
        message: `Endpoint "${endpoint.id}" has uncertain path or definition (${endpoint.confidenceReason ?? 'unresolved'}).`,
        endpointId: endpoint.id,
      },
    };
  }

  // 3. Check skip list
  for (const pattern of config.skip) {
    if (matchesSkipPattern(pattern, endpoint.id, endpoint.path)) {
      return {
        runnable: false,
        skipReason: {
          code: 'explicitly-skipped',
          message: `Endpoint "${endpoint.id}" matches skip pattern "${pattern}".`,
          endpointId: endpoint.id,
        },
      };
    }
  }

  // 4. Check allowedEffects
  if (!config.allowedEffects.includes(endpoint.effect as AllowedEffect)) {
    return {
      runnable: false,
      skipReason: {
        code: 'effect-not-allowed',
        message: `Mutation effect "${endpoint.effect}" is not permitted by allowedEffects: [${config.allowedEffects.join(', ')}].`,
        endpointId: endpoint.id,
      },
    };
  }

  // 5. Check path parameters
  const pathParamMatches = [...endpoint.path.matchAll(/:([a-zA-Z0-9_]+)/g)];
  let resolvedPath = endpoint.path;

  for (const match of pathParamMatches) {
    const paramName = match[1]!;
    const sample = config.pathParamSamples[paramName];
    if (sample === undefined || sample === null || String(sample).trim() === '') {
      return {
        runnable: false,
        skipReason: {
          code: 'no-sample-for-path-param',
          message: `No sample value provided for path parameter :${paramName} in endpoint "${endpoint.id}".`,
          endpointId: endpoint.id,
          paramName,
        },
      };
    }
    resolvedPath = resolvedPath.replace(`:${paramName}`, encodeURIComponent(String(sample)));
  }

  return {
    runnable: true,
    resolvedPath,
  };
}
