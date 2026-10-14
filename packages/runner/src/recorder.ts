import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SessionSchema, type Session, type ExecutionResult } from '@mantis/core';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'proxy-authorization',
  'x-auth-token',
]);

/**
 * Redacts sensitive authentication and session headers.
 */
export function redactHeaders(
  headers: Record<string, string>,
  extraSensitiveHeaders: string[] = []
): Record<string, string> {
  const sensitiveSet = new Set(SENSITIVE_HEADER_NAMES);
  for (const h of extraSensitiveHeaders) {
    sensitiveSet.add(h.toLowerCase());
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveSet.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Replaces exact occurrences of a secret token in a string with [REDACTED].
 */
export function redactSecretValue(content: string, secret?: string): string {
  if (!secret || secret.trim().length < 3) {
    return content;
  }
  // Replace all occurrences of secret safely
  return content.split(secret).join('[REDACTED]');
}

/**
 * Recursively sorts all keys of an object for deterministic serialization.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortKeysDeep(record[key]);
    }
    return result;
  }
  return value;
}

/**
 * Creates a redacted copy of an ExecutionResult ensuring no secrets exist in headers, URLs or payloads.
 */
export function redactExecutionResult(result: ExecutionResult, secret?: string, authHeader?: string): ExecutionResult {
  const extraHeaders = authHeader ? [authHeader] : [];
  const reqHeaders = redactHeaders(result.request.headers, extraHeaders);
  let reqUrl = result.request.url;
  let reqBody = result.request.body;

  if (secret) {
    reqUrl = redactSecretValue(reqUrl, secret);
    if (reqBody) {
      reqBody = redactSecretValue(reqBody, secret);
    }
  }

  const redactedError = result.error ? { ...result.error } : undefined;
  if (redactedError && secret) {
    redactedError.message = redactSecretValue(redactedError.message, secret);
  }

  const redactedResult: ExecutionResult = {
    endpointId: result.endpointId,
    durationMs: result.durationMs,
    request: {
      ...result.request,
      url: reqUrl,
      headers: reqHeaders,
      ...(reqBody !== undefined ? { body: reqBody } : {}),
    },
    ...(redactedError ? { error: redactedError } : {}),
  };

  if (result.response) {
    const resHeaders = redactHeaders(result.response.headers, extraHeaders);
    let resBody = result.response.body;
    if (secret) {
      resBody = redactSecretValue(resBody, secret);
    }
    redactedResult.response = {
      ...result.response,
      headers: resHeaders,
      body: resBody,
    };
  }

  return redactedResult;
}

/**
 * Redacts a complete session before saving or serializing.
 */
export function redactSession(session: Session): Session {
  const secret = session.config.auth?.value;
  const authHeader = session.config.auth?.header;

  const redactedRequests = session.requests.map((r) => redactExecutionResult(r, secret, authHeader));

  const redactedConfig = {
    ...session.config,
    baseUrl: secret ? redactSecretValue(session.config.baseUrl, secret) : session.config.baseUrl,
    auth: session.config.auth
      ? {
          ...session.config.auth,
          ...(session.config.auth.value ? { value: '[REDACTED]' } : {}),
        }
      : undefined,
  };

  // Sort requests and skips deterministically
  const sortedRequests = [...redactedRequests].sort((a, b) => {
    const cmp = a.endpointId.localeCompare(b.endpointId);
    if (cmp !== 0) return cmp;
    return a.request.url.localeCompare(b.request.url);
  });

  const sortedSkips = [...session.skips].sort((a, b) => {
    const cmp = a.endpointId.localeCompare(b.endpointId);
    if (cmp !== 0) return cmp;
    return a.code.localeCompare(b.code);
  });

  return {
    meta: { ...session.meta },
    config: redactedConfig,
    requests: sortedRequests,
    skips: sortedSkips,
  };
}

/**
 * Serializes a session deterministically with alphabetically sorted object keys.
 * If includeMeta is false, excludes volatile metadata (timestamps, durations) for testing comparisons.
 */
export function serializeDeterministicSession(session: Session, includeMeta = true): string {
  const redacted = redactSession(session);
  const target: Record<string, unknown> = {
    config: redacted.config,
    requests: redacted.requests,
    skips: redacted.skips,
  };

  if (includeMeta) {
    target.meta = redacted.meta;
  }

  const sorted = sortKeysDeep(target);
  return JSON.stringify(sorted, null, 2) + '\n';
}

/**
 * Saves a session to a deterministic JSON file in .mantis/sessions/<sessionId>.json.
 */
export async function saveSession(session: Session, outputDir = '.mantis/sessions'): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `${session.meta.sessionId}.json`;
  const filePath = path.join(outputDir, filename);

  const jsonContent = serializeDeterministicSession(session, true);
  await fs.writeFile(filePath, jsonContent, 'utf8');

  return filePath;
}

/**
 * Loads a session file from disk and validates it against the core Session schema.
 */
export async function loadSession(sessionPath: string): Promise<Session> {
  const content = await fs.readFile(sessionPath, 'utf8');
  const parsed = JSON.parse(content);
  return SessionSchema.parse(parsed);
}
