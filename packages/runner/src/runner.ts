import crypto from 'node:crypto';
import type {
  ApiModel,
  RunnerConfig,
  RequestPlan,
  SkipReason,
  Session,
  DryRunResult,
  ExecutionResult,
} from '@mantis/core';
import { validateBaseUrl, evaluateEndpointSafety } from './safety.js';
import { executeRequest } from './http-client.js';
import { saveSession, redactHeaders, redactSecretValue } from './recorder.js';

export interface RunOptions {
  dryRun?: boolean;
  outputDir?: string;
  sessionId?: string;
}

/**
 * Executes async tasks with a maximum concurrency limit.
 */
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]!);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Evaluates an ApiModel against safety rules and executes requests safely or performs a dry run.
 *
 * When dryRun is true:
 * - Emits zero network traffic.
 * - Returns structured request plans with secrets redacted, alongside all structured skip reasons.
 *
 * When dryRun is false:
 * - Executes requests respecting concurrency and request caps.
 * - Collects results and saves a deterministic, redacted session file to .mantis/sessions/<sessionId>.json.
 */
export async function runPlan(
  apiModel: ApiModel,
  config: RunnerConfig,
  options: { dryRun: true; outputDir?: string; sessionId?: string }
): Promise<DryRunResult>;
export async function runPlan(
  apiModel: ApiModel,
  config: RunnerConfig,
  options?: { dryRun?: false; outputDir?: string; sessionId?: string }
): Promise<Session>;
export async function runPlan(
  apiModel: ApiModel,
  config: RunnerConfig,
  options: RunOptions = {}
): Promise<Session | DryRunResult> {
  // 1. Host guard check
  const baseUrlObj = validateBaseUrl(config.baseUrl, config.allowRemote);
  const normalizedBase = baseUrlObj.toString().replace(/\/$/, '');

  const skips: SkipReason[] = [];
  const runnablePlans: RequestPlan[] = [];

  // 2. Evaluate each endpoint against the safety engine
  for (const endpoint of apiModel.endpoints) {
    const safety = evaluateEndpointSafety(endpoint, {
      allowedEffects: config.allowedEffects,
      skip: config.skip,
      pathParamSamples: config.pathParamSamples,
    });

    if (!safety.runnable || !safety.resolvedPath) {
      if (safety.skipReason) {
        skips.push(safety.skipReason);
      }
      continue;
    }

    const cleanPath = safety.resolvedPath.startsWith('/')
      ? safety.resolvedPath
      : '/' + safety.resolvedPath;

    const headers: Record<string, string> = {
      accept: 'application/json, */*',
    };

    if (config.auth?.value) {
      const headerName = config.auth.header ?? 'Authorization';
      headers[headerName] = config.auth.value;
    }

    runnablePlans.push({
      endpointId: endpoint.id,
      method: endpoint.method,
      url: `${normalizedBase}${cleanPath}`,
      headers,
      effect: endpoint.effect,
    });
  }

  // 3. Dry-run mode: return without opening any network sockets
  if (options.dryRun) {
    const secret = config.auth?.value;
    const authHeader = config.auth?.header;
    const extraHeaders = authHeader ? [authHeader] : [];

    const redactedPlans: RequestPlan[] = runnablePlans.map((p) => {
      let url = p.url;
      let body = p.body;
      if (secret) {
        url = redactSecretValue(url, secret);
        if (body) {
          body = redactSecretValue(body, secret);
        }
      }
      return {
        ...p,
        url,
        headers: redactHeaders(p.headers, extraHeaders),
        ...(body !== undefined ? { body } : {}),
      };
    });

    return {
      plans: redactedPlans,
      skips,
    };
  }

  // 4. Execution mode: Enforce maxRequests cap and run with concurrency limiter
  const maxRequests = config.limits.maxRequests ?? 50;
  const plansToRun = runnablePlans.slice(0, maxRequests);

  const startTime = Date.now();

  const results: ExecutionResult[] = await mapConcurrent(
    plansToRun,
    config.limits.concurrency ?? 5,
    async (plan) => {
      return executeRequest({
        plan,
        limits: config.limits,
        followRedirects: config.followRedirects,
      });
    }
  );

  const durationMs = Date.now() - startTime;
  const sessionId = options.sessionId ?? crypto.randomUUID();

  const session: Session = {
    meta: {
      sessionId,
      createdAt: new Date().toISOString(),
      durationMs,
      targetBaseUrl: normalizedBase,
      toolVersion: '0.1.0',
    },
    config,
    requests: results,
    skips,
  };

  // 5. Save session to disk with secret redaction
  await saveSession(session, options.outputDir ?? '.mantis/sessions');

  return session;
}
