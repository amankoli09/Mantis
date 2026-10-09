import { request } from 'undici';
import type { RequestPlan, ExecutionResult, RunnerLimits } from '@devguard/core';

export interface ExecuteRequestOptions {
  plan: RequestPlan;
  limits: RunnerLimits;
  followRedirects?: boolean;
}

/**
 * Normalizes HTTP headers from undici response into Record<string, string>.
 */
function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    if (Array.isArray(val)) {
      result[key.toLowerCase()] = val.join(', ');
    } else if (val !== undefined && val !== null) {
      result[key.toLowerCase()] = String(val);
    }
  }
  return result;
}

/**
 * Reads a response body stream up to maxResponseBytes.
 * If exceeded, truncates and destroys the stream, marking truncated = true.
 */
async function readBodyWithCap(
  bodyStream: AsyncIterable<Uint8Array | string> & { destroy?: (err?: Error) => void },
  maxBytes: number
): Promise<{ text: string; truncated: boolean; byteLength: number }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    for await (const chunk of bodyStream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (totalBytes + buf.length > maxBytes) {
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining));
          totalBytes += remaining;
        }
        truncated = true;
        if (typeof bodyStream.destroy === 'function') {
          bodyStream.destroy();
        }
        break;
      }
      chunks.push(buf);
      totalBytes += buf.length;
    }
  } catch (err: unknown) {
    // If we aborted the stream intentionally due to cap, don't rethrow
    if (!truncated) {
      throw err;
    }
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return {
    text,
    truncated,
    byteLength: totalBytes,
  };
}

/**
 * Classifies an error into structured error kinds (timeout, network, abort, other).
 */
function classifyError(err: Error): 'timeout' | 'network' | 'abort' | 'other' {
  const name = err.name?.toLowerCase() || '';
  const msg = err.message?.toLowerCase() || '';
  const code = (err as { code?: string }).code || '';

  if (name.includes('timeout') || msg.includes('timeout') || msg.includes('timed out') || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'timeout';
  }
  if (name.includes('abort') || msg.includes('abort') || code === 'ABORT_ERR') {
    return 'abort';
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code.startsWith('UND_ERR_SOCKET') ||
    msg.includes('fetch failed')
  ) {
    return 'network';
  }
  return 'other';
}

/**
 * Executes a single RequestPlan safely using undici.
 * Enforces timeout, max response bytes, redirects, and network error resilience.
 * Guaranteed never to crash: network errors and timeouts are returned as recorded results.
 */
export async function executeRequest(options: ExecuteRequestOptions): Promise<ExecutionResult> {
  const { plan, limits, followRedirects = false } = options;
  const startTime = Date.now();

  const initialUrlObj = new URL(plan.url);
  const initialHost = initialUrlObj.hostname.toLowerCase();

  let currentUrl = plan.url;
  let attempts = 0;
  const maxRedirectHops = 5;
  const maxAttempts = (limits.retries || 0) + 1;

  while (attempts < maxAttempts) {
    attempts++;
    let redirectCount = 0;
    currentUrl = plan.url;

    while (redirectCount <= maxRedirectHops) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort(new Error(`Request timed out after ${limits.timeoutMs}ms`));
      }, limits.timeoutMs);

      try {
        const response = await request(currentUrl, {
          method: plan.method,
          headers: plan.headers,
          body: plan.body,
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        const status = response.statusCode;
        const normalizedResHeaders = normalizeHeaders(response.headers as Record<string, unknown>);

        // Check redirect
        const isRedirect = status >= 300 && status < 400 && Boolean(normalizedResHeaders['location']);
        if (isRedirect) {
          if (!followRedirects) {
            // Do not follow redirects: record the redirect response as is
            const bodyResult = await readBodyWithCap(response.body, limits.maxResponseBytes);
            return {
              endpointId: plan.endpointId,
              durationMs: Date.now() - startTime,
              request: { ...plan, url: currentUrl },
              response: {
                status,
                statusText: String(status),
                headers: normalizedResHeaders,
                body: bodyResult.text,
                truncated: bodyResult.truncated,
                byteLength: bodyResult.byteLength,
              },
            };
          }

          // Follow redirect with strict same-host guard
          const targetUrlObj = new URL(normalizedResHeaders['location']!, currentUrl);
          if (targetUrlObj.hostname.toLowerCase() !== initialHost) {
            // Refuse cross-host redirect: record redirect as is and do not follow!
            const bodyResult = await readBodyWithCap(response.body, limits.maxResponseBytes);
            return {
              endpointId: plan.endpointId,
              durationMs: Date.now() - startTime,
              request: { ...plan, url: currentUrl },
              response: {
                status,
                statusText: String(status),
                headers: normalizedResHeaders,
                body: bodyResult.text,
                truncated: bodyResult.truncated,
                byteLength: bodyResult.byteLength,
              },
            };
          }

          // Drain current body and follow to next URL on same host
          await readBodyWithCap(response.body, 1024);
          currentUrl = targetUrlObj.toString();
          redirectCount++;
          continue;
        }

        // Standard response
        const bodyResult = await readBodyWithCap(response.body, limits.maxResponseBytes);

        return {
          endpointId: plan.endpointId,
          durationMs: Date.now() - startTime,
          request: { ...plan, url: currentUrl },
          response: {
            status,
            statusText: String(status),
            headers: normalizedResHeaders,
            body: bodyResult.text,
            truncated: bodyResult.truncated,
            byteLength: bodyResult.byteLength,
          },
        };
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const error = err instanceof Error ? err : new Error(String(err));
        const kind = classifyError(error);

        // If retries remain and error is network-level, continue loop
        if (attempts < maxAttempts && kind === 'network') {
          break; // break inner redirect loop to retry outer loop
        }

        // Otherwise record error result
        return {
          endpointId: plan.endpointId,
          durationMs: Date.now() - startTime,
          request: { ...plan, url: currentUrl },
          error: {
            kind,
            message: error.message,
          },
        };
      }
    }
  }

  // Fallback return if loop exhausted
  return {
    endpointId: plan.endpointId,
    durationMs: Date.now() - startTime,
    request: plan,
    error: {
      kind: 'network',
      message: 'Request failed after maximum retry attempts',
    },
  };
}
