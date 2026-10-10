import type { ApiModel } from '../schema/model.js';
import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig } from '../schema/runner.js';
import type { TestResult, Finding } from '../schema/test-engine.js';
import type { TestRunnerEngine } from '../plugins/types.js';

export interface CrossAnalysisOptions {
  model: ApiModel;
  config: RunnerConfig;
  runner: TestRunnerEngine;
  results: TestResult[];
}

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

function normalizePathPattern(path: string): RegExp {
  // Convert Express path segments like :id to regex wildcard [^/]+
  const regexStr = '^' + path.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$';
  return new RegExp(regexStr);
}

function doesEndpointMatchPath(endpoint: Endpoint, probePath: string): boolean {
  if (endpoint.path === probePath) return true;
  try {
    const pattern = normalizePathPattern(endpoint.path);
    return pattern.test(probePath);
  } catch {
    return false;
  }
}

function extractJsonShape(bodyStr?: string): string {
  if (!bodyStr) return 'empty';
  try {
    const parsed = JSON.parse(bodyStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed).sort();
      return keys.length > 0 ? keys.join(',') : 'empty-object';
    }
    if (Array.isArray(parsed)) {
      return 'array';
    }
    return typeof parsed;
  } catch {
    return 'non-json';
  }
}

/**
 * Runs cross-analysis correlating static code findings with live execution results:
 * 1. Route in code but 404 live.
 * 2. Route live but not in code (opt-in probePaths).
 * 3. Status code differences for similar failures.
 * 4. Error response shape differences across endpoints.
 */
export async function runCrossAnalysis(options: CrossAnalysisOptions): Promise<Finding[]> {
  const { model, config, runner, results } = options;
  const findings: Finding[] = [];
  const endpointMap = new Map(model.endpoints.map((e) => [e.id, e]));

  // -------------------------------------------------------------
  // 1. Route in code but 404 live
  // -------------------------------------------------------------
  for (const endpoint of model.endpoints) {
    const executedResults = results.filter(
      (r) => r.endpointId === endpoint.id && r.status !== 'skipped' && r.response !== undefined
    );

    if (executedResults.length > 0) {
      const all404 = executedResults.every((r) => r.response?.status === 404);
      if (all404) {
        const baselineResult =
          executedResults.find((r) => r.generatorId === 'valid-baseline') ?? executedResults[0]!;

        const reqHeaders = extractSemanticHeaders(baselineResult.request.headers);
        const resHeaders = extractSemanticHeaders(baselineResult.response?.headers);

        findings.push({
          ruleId: 'route-in-code-404-live',
          severity: 'warning',
          endpointId: endpoint.id,
          message: `Endpoint "${endpoint.id}" defined in code returned 404 Not Found at runtime`,
          evidence: {
            request: {
              method: baselineResult.request.method,
              path: extractPath(baselineResult.request.url),
              ...(reqHeaders ? { headers: reqHeaders } : {}),
              ...(baselineResult.request.body !== undefined ? { body: baselineResult.request.body } : {}),
            },
            response: {
              status: 404,
              ...(resHeaders ? { headers: resHeaders } : {}),
              ...(baselineResult.response?.body !== undefined
                ? { bodySnippet: baselineResult.response.body.slice(0, 500) }
                : {}),
            },
          },
          source: {
            file: endpoint.provenance.filePath,
            line: endpoint.provenance.line,
          },
          confidence: 'high',
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Route live but not in code (opt-in probePaths)
  // -------------------------------------------------------------
  if (config.probePaths && config.probePaths.length > 0) {
    for (const probePath of config.probePaths) {
      const matchesAnyStaticRoute = model.endpoints.some((e) =>
        e.method === 'GET' && doesEndpointMatchPath(e, probePath)
      );

      if (!matchesAnyStaticRoute) {
        const normalizedBase = config.baseUrl.replace(/\/$/, '');
        const normalizedPath = probePath.startsWith('/') ? probePath : `/${probePath}`;
        const probeUrl = `${normalizedBase}${normalizedPath}`;

        const probeResult = await runner.execute({
          endpointId: `GET ${probePath}`,
          method: 'GET',
          url: probeUrl,
          headers: {
            accept: 'application/json, */*',
          },
          effect: 'read',
        });

        if (probeResult.response && probeResult.response.status !== 404) {
          const resHeaders = extractSemanticHeaders(probeResult.response.headers);
          findings.push({
            ruleId: 'live-route-not-in-code',
            severity: 'warning',
            endpointId: `GET ${probePath}`,
            message: `Live route responded at "${probePath}" (HTTP ${probeResult.response.status}), but was not found in static code analysis`,
            evidence: {
              request: {
                method: 'GET',
                path: probePath,
                headers: { accept: 'application/json, */*' },
              },
              response: {
                status: probeResult.response.status,
                ...(resHeaders ? { headers: resHeaders } : {}),
                ...(probeResult.response.body
                  ? { bodySnippet: probeResult.response.body.slice(0, 500) }
                  : {}),
              },
            },
            source: {
              file: model.project?.root || 'devguard.config.json',
              line: 1,
            },
            confidence: 'high',
          });
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 3. Consistency: Status code differences for similar failures
  // -------------------------------------------------------------
  const failureGenerators = ['wrong-type', 'boundary-values', 'missing-field'];
  for (const genId of failureGenerators) {
    const genResults = results.filter(
      (r) =>
        r.generatorId === genId &&
        r.response !== undefined &&
        r.response.status >= 400 &&
        r.response.status < 500
    );

    // Group by endpointId -> first status
    const endpointStatusMap = new Map<string, { status: number; result: TestResult }>();
    for (const r of genResults) {
      if (!endpointStatusMap.has(r.endpointId) && r.response) {
        endpointStatusMap.set(r.endpointId, { status: r.response.status, result: r });
      }
    }

    if (endpointStatusMap.size >= 3) {
      const counts = new Map<number, number>();
      for (const { status } of endpointStatusMap.values()) {
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }

      // Find dominant status code
      let dominantStatus: number | null = null;
      let maxCount = 0;
      for (const [status, count] of counts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          dominantStatus = status;
        }
      }

      const ratio = maxCount / endpointStatusMap.size;
      if (dominantStatus !== null && ratio >= 0.6) {
        for (const [epId, { status, result }] of endpointStatusMap.entries()) {
          if (status !== dominantStatus) {
            const ep = endpointMap.get(epId);
            if (ep) {
              const reqHeaders = extractSemanticHeaders(result.request.headers);
              const resHeaders = extractSemanticHeaders(result.response?.headers);

              findings.push({
                ruleId: 'consistency/status-code-deviation',
                severity: 'info',
                endpointId: epId,
                message: `Endpoint "${epId}" returned HTTP ${status} for ${genId}, differing from dominant HTTP ${dominantStatus} across the API`,
                evidence: {
                  request: {
                    method: result.request.method,
                    path: extractPath(result.request.url),
                    ...(reqHeaders ? { headers: reqHeaders } : {}),
                    ...(result.request.body !== undefined ? { body: result.request.body } : {}),
                  },
                  response: {
                    status,
                    ...(resHeaders ? { headers: resHeaders } : {}),
                    ...(result.response?.body !== undefined
                      ? { bodySnippet: result.response.body.slice(0, 500) }
                      : {}),
                  },
                },
                source: {
                  file: ep.provenance.filePath,
                  line: ep.provenance.line,
                },
                confidence: 'medium',
              });
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Consistency: Error response shape differences between endpoints
  // -------------------------------------------------------------
  const all4xxResults = results.filter(
    (r) =>
      r.response !== undefined &&
      r.response.status >= 400 &&
      r.response.status < 500 &&
      r.response.body
  );

  const endpointShapeMap = new Map<string, { shape: string; result: TestResult }>();
  for (const r of all4xxResults) {
    if (!endpointShapeMap.has(r.endpointId)) {
      const shape = extractJsonShape(r.response?.body);
      endpointShapeMap.set(r.endpointId, { shape, result: r });
    }
  }

  if (endpointShapeMap.size >= 3) {
    const shapeCounts = new Map<string, number>();
    for (const { shape } of endpointShapeMap.values()) {
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
    }

    let dominantShape: string | null = null;
    let maxCount = 0;
    for (const [shape, count] of shapeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantShape = shape;
      }
    }

    const ratio = maxCount / endpointShapeMap.size;
    if (dominantShape !== null && ratio >= 0.6) {
      for (const [epId, { shape, result }] of endpointShapeMap.entries()) {
        if (shape !== dominantShape) {
          const ep = endpointMap.get(epId);
          if (ep) {
            const reqHeaders = extractSemanticHeaders(result.request.headers);
            const resHeaders = extractSemanticHeaders(result.response?.headers);

            findings.push({
              ruleId: 'consistency/error-response-shape',
              severity: 'info',
              endpointId: epId,
              message: `Endpoint "${epId}" returned error response shape with keys [${shape}], differing from dominant shape [${dominantShape}] across the API`,
              evidence: {
                request: {
                  method: result.request.method,
                  path: extractPath(result.request.url),
                  ...(reqHeaders ? { headers: reqHeaders } : {}),
                  ...(result.request.body !== undefined ? { body: result.request.body } : {}),
                },
                response: {
                  status: result.response?.status,
                  ...(resHeaders ? { headers: resHeaders } : {}),
                  ...(result.response?.body !== undefined
                    ? { bodySnippet: result.response.body.slice(0, 500) }
                    : {}),
                },
              },
              source: {
                file: ep.provenance.filePath,
                line: ep.provenance.line,
              },
              confidence: 'medium',
            });
          }
        }
      }
    }
  }

  return findings;
}
