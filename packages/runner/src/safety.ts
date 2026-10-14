import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';
import type { Endpoint, AllowedEffect, SkipReason } from '@mantis/core';

/**
 * Checks whether an IP string is a loopback address (127.0.0.0/8 or ::1).
 */
export function isLoopbackIp(ip: string): boolean {
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('127.')) return true;
  return false;
}

/**
 * Asserts that a hostname resolves strictly to local loopback addresses via DNS.
 * Throws a descriptive Error if any resolved IP is external or non-local.
 */
export async function assertHostResolvesToLocal(
  hostname: string,
  lookupFn: typeof dns.promises.lookup = dns.promises.lookup
): Promise<void> {
  const cleanHost = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(cleanHost)) {
    if (!isLoopbackIp(cleanHost)) {
      throw new Error(`Refusing non-local IP address "${hostname}". Expected local loopback.`);
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    const res = await lookupFn(cleanHost, { all: true });
    addresses = Array.isArray(res) ? res : [res];
  } catch (err) {
    throw new Error(`Failed to resolve hostname "${hostname}": ${(err as Error).message}`);
  }

  if (addresses.length === 0) {
    throw new Error(`Hostname "${hostname}" resolved to 0 addresses.`);
  }

  for (const record of addresses) {
    if (!isLoopbackIp(record.address)) {
      throw new Error(
        `Hostname "${hostname}" resolved to non-local address "${record.address}". Refusing connection without --allow-remote.`
      );
    }
  }
}

/**
 * Safely resolves an output path ensuring it cannot escape baseDir via directory traversal (..).
 */
export function resolveSafeOutputPath(
  outPath: string,
  baseDir: string = process.cwd()
): string {
  if (!outPath || typeof outPath !== 'string') {
    throw new Error('Output path must be a non-empty string');
  }

  // Check for explicit directory traversal sequences
  const segments = outPath.split(/[/\\]/);
  if (segments.includes('..')) {
    // If it's relative, check whether it escapes baseDir
    if (!path.isAbsolute(outPath)) {
      const resolvedBase = path.resolve(baseDir);
      const resolvedOut = path.resolve(resolvedBase, outPath);
      const relative = path.relative(resolvedBase, resolvedOut);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(
          `Refusing unsafe output path "${outPath}". Target path cannot traverse outside directory through "..".`
        );
      }
      return resolvedOut;
    }
    // Absolute paths containing '..' traversal sequences are unsafe
    throw new Error(
      `Refusing unsafe output path "${outPath}". Path cannot contain directory traversal "..".`
    );
  }

  if (!path.isAbsolute(outPath)) {
    const resolvedBase = path.resolve(baseDir);
    const resolvedOut = path.resolve(resolvedBase, outPath);
    const relative = path.relative(resolvedBase, resolvedOut);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Refusing unsafe output path "${outPath}". Target path cannot traverse outside directory through "..".`
      );
    }
    return resolvedOut;
  }

  return path.resolve(outPath);
}

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
const CANONICAL_IPV4_REGEX = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

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

  // Extract raw host from rawUrl for look-alike and obfuscation detection
  const protoIdx = rawUrl.indexOf('://');
  const rawAuthority = protoIdx !== -1 ? rawUrl.slice(protoIdx + 3).split(/[/?#]/)[0]! : '';

  if (rawAuthority.includes('@')) {
    throw new Error('Refusing baseUrl with embedded credentials for security reasons');
  }

  let rawHost = rawAuthority;
  if (rawHost.startsWith('[') && rawHost.includes(']')) {
    rawHost = rawHost.slice(0, rawHost.indexOf(']') + 1);
  } else if (rawHost.includes(':')) {
    rawHost = rawHost.split(':')[0]!;
  }

  const hostname = parsed.hostname.toLowerCase();

  // 1. Refuse bind-all / unspecified addresses outright
  if (
    hostname === '0.0.0.0' ||
    hostname === '[::]' ||
    hostname === '::' ||
    rawHost === '0.0.0.0' ||
    rawHost === '[::]'
  ) {
    throw new Error(`Refusing unspecified/all-interfaces bind address "${hostname}". baseUrl must target a specific service host.`);
  }

  // 2. Refuse non-canonical IPv6 loopbacks
  if (rawHost.startsWith('[') || rawHost.includes(':')) {
    if (rawHost.startsWith('[')) {
      if (rawHost.toLowerCase() !== '[::1]') {
        throw new Error(`Refusing non-canonical IPv6 address "${rawHost}" in baseUrl "${rawUrl}". Use canonical "[::1]".`);
      }
    }
  }

  // 3. Refuse shorthand, integer, or obfuscated IPv4 representations (e.g. 127.1, 2130706433)
  if (net.isIP(hostname) === 4 || hostname.startsWith('127.')) {
    if (!CANONICAL_IPV4_REGEX.test(rawHost)) {
      throw new Error(`Refusing look-alike or non-canonical IP address "${rawHost}" in baseUrl "${rawUrl}". Use canonical dotted-decimal notation (e.g. 127.0.0.1).`);
    }
  }

  const isLocal =
    LOCAL_HOST_NAMES.has(hostname) &&
    (rawHost === 'localhost' || rawHost.startsWith('127.') || rawHost === '[::1]' || rawHost.endsWith('.localhost')) ||
    hostname.endsWith('.localhost');

  if (!isLocal && !allowRemote) {
    throw new Error(
      `Refusing non-local baseUrl "${rawUrl}". By default, Mantis only executes against local hosts. To allow remote hosts, set allowRemote: true in config.`
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
