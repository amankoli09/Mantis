import type { Endpoint } from '../schema/endpoint.js';
import type { RunnerConfig, SkipReason, AllowedEffect } from '../schema/runner.js';

export interface ResolvedEndpointUrl {
  url: string;
  path: string;
  skip?: SkipReason;
}

export function resolveEndpointUrl(
  endpoint: Endpoint,
  config: RunnerConfig,
): ResolvedEndpointUrl {
  const normalizedBase = config.baseUrl.replace(/\/$/, '');

  // 1. Unknown effect check
  if (endpoint.effect === 'unknown') {
    return {
      url: `${normalizedBase}${endpoint.path}`,
      path: endpoint.path,
      skip: {
        code: 'disallowed-effect-unknown',
        message: `Endpoint "${endpoint.id}" has unknown mutation effect and cannot run safely`,
        endpointId: endpoint.id,
      },
    };
  }

  // 2. Uncertain route check
  if (endpoint.confidence === 'uncertain') {
    return {
      url: `${normalizedBase}${endpoint.path}`,
      path: endpoint.path,
      skip: {
        code: 'uncertain-endpoint',
        message: `Endpoint "${endpoint.id}" has uncertain route definition`,
        endpointId: endpoint.id,
      },
    };
  }

  // 3. Explicit skip list
  if (config.skip.includes(endpoint.id)) {
    return {
      url: `${normalizedBase}${endpoint.path}`,
      path: endpoint.path,
      skip: {
        code: 'explicitly-skipped',
        message: `Endpoint "${endpoint.id}" is explicitly listed in skip list`,
        endpointId: endpoint.id,
      },
    };
  }

  // 4. Allowed effects check
  if (!config.allowedEffects.includes(endpoint.effect as AllowedEffect)) {
    return {
      url: `${normalizedBase}${endpoint.path}`,
      path: endpoint.path,
      skip: {
        code: 'effect-not-allowed',
        message: `Endpoint effect "${endpoint.effect}" is not allowed by configuration`,
        endpointId: endpoint.id,
      },
    };
  }

  // 5. Path param resolution
  const pathParams = endpoint.params.filter((p) => p.in === 'path');
  let resolvedPath = endpoint.path;

  for (const p of pathParams) {
    const sample = config.pathParamSamples[p.name];
    if (sample === undefined || sample === null) {
      return {
        url: `${normalizedBase}${endpoint.path}`,
        path: endpoint.path,
        skip: {
          code: 'no-sample-for-path-param',
          message: `No sample value provided for path parameter ":${p.name}" on "${endpoint.id}"`,
          endpointId: endpoint.id,
          paramName: p.name,
        },
      };
    }
    resolvedPath = resolvedPath.replace(`:${p.name}`, encodeURIComponent(String(sample)));
  }

  const cleanPath = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
  return {
    url: `${normalizedBase}${cleanPath}`,
    path: cleanPath,
  };
}
