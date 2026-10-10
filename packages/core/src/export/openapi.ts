import type { ApiModel } from '../schema/model.js';

export interface OpenApiExportOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
}

/**
 * Converts Express-style colon path segments (:param) into OpenAPI curly bracket format ({param}).
 */
export function expressPathToOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

/**
 * Generates a clean operation ID from an HTTP method and path.
 */
function generateOperationId(method: string, path: string): string {
  const cleanPath = path
    .replace(/[{}:]/g, '')
    .split('/')
    .filter(Boolean)
    .map((seg, idx) => (idx === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
    .join('');
  return `${method.toLowerCase()}${cleanPath ? cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1) : 'Root'}`;
}

/**
 * Exports an ApiModel into an OpenAPI 3.0.3 specification object.
 */
export function exportOpenApi(
  model: ApiModel,
  options: OpenApiExportOptions = {}
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const usedSecuritySchemes = new Set<string>();

  for (const endpoint of model.endpoints) {
    const openApiPath = expressPathToOpenApiPath(endpoint.path);
    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    const methodLower = endpoint.method.toLowerCase();
    const parameters: Array<Record<string, unknown>> = [];

    // 1. Map parameters
    for (const param of endpoint.params) {
      if (param.in === 'path') {
        parameters.push({
          name: param.name,
          in: 'path',
          required: true,
          description: param.description ?? `Path parameter ${param.name}`,
          schema: param.schema ?? {
            type: param.type === 'unknown' ? 'string' : param.type,
          },
        });
      } else if (param.in === 'query') {
        parameters.push({
          name: param.name,
          in: 'query',
          required: param.required === true,
          description: param.description ?? `Query parameter ${param.name}`,
          schema: param.schema ?? {
            type: param.type === 'unknown' ? 'string' : param.type,
          },
        });
      } else if (param.in === 'header') {
        parameters.push({
          name: param.name,
          in: 'header',
          required: param.required === true,
          description: param.description ?? `Header ${param.name}`,
          schema: { type: 'string' },
        });
      }
    }

    // 2. Map request body
    let requestBody: Record<string, unknown> | undefined;
    if (endpoint.requestBody?.schema) {
      requestBody = {
        required: endpoint.requestBody.required ?? true,
        content: {
          'application/json': {
            schema: endpoint.requestBody.schema,
          },
        },
      };
    } else {
      const bodyParams = endpoint.params.filter((p) => p.in === 'body');
      if (bodyParams.length > 0) {
        const properties: Record<string, unknown> = {};
        const requiredFields: string[] = [];

        for (const bp of bodyParams) {
          properties[bp.name] = bp.schema ?? {
            type: bp.type === 'unknown' ? 'string' : bp.type,
            ...(bp.description ? { description: bp.description } : {}),
          };
          if (bp.required === true) {
            requiredFields.push(bp.name);
          }
        }

        requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties,
                ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
              },
            },
          },
        };
      }
    }

    // 3. Map security
    const security: Array<Record<string, string[]>> = [];
    if (endpoint.auth.type === 'bearer') {
      security.push({ bearerAuth: [] });
      usedSecuritySchemes.add('bearerAuth');
    } else if (endpoint.auth.type === 'cookie') {
      security.push({ cookieAuth: [] });
      usedSecuritySchemes.add('cookieAuth');
    } else if (endpoint.auth.type === 'apiKey') {
      security.push({ apiKeyAuth: [] });
      usedSecuritySchemes.add('apiKeyAuth');
    }

    // 4. Default responses
    const responses: Record<string, unknown> = {
      '200': {
        description:
          endpoint.effect === 'destructive'
            ? 'Resource deleted successfully'
            : endpoint.method === 'POST'
              ? 'Resource created successfully'
              : 'Successful operation',
      },
    };

    if (endpoint.auth.type !== 'none' && endpoint.auth.type !== 'unknown') {
      responses['401'] = { description: 'Unauthorized — missing or invalid credentials' };
    }
    if (endpoint.params.length > 0 || endpoint.requestBody) {
      responses['400'] = { description: 'Bad Request — validation or parameter constraint violation' };
    }

    const operation: Record<string, unknown> = {
      operationId: generateOperationId(endpoint.method, endpoint.path),
      summary: `${endpoint.method} ${endpoint.path}`,
      description: `Inferred effect: ${endpoint.effect}. Confidence: ${endpoint.confidence}.`,
      responses,
    };

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }
    if (requestBody) {
      operation.requestBody = requestBody;
    }
    if (security.length > 0) {
      operation.security = security;
    }

    paths[openApiPath]![methodLower] = operation;
  }

  // 5. Components & Security Schemes
  const components: Record<string, unknown> = {};
  if (usedSecuritySchemes.size > 0) {
    const securitySchemes: Record<string, unknown> = {};
    if (usedSecuritySchemes.has('bearerAuth')) {
      securitySchemes.bearerAuth = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      };
    }
    if (usedSecuritySchemes.has('apiKeyAuth')) {
      securitySchemes.apiKeyAuth = {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      };
    }
    if (usedSecuritySchemes.has('cookieAuth')) {
      securitySchemes.cookieAuth = {
        type: 'apiKey',
        in: 'cookie',
        name: 'sessionId',
      };
    }
    components.securitySchemes = securitySchemes;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: options.title ?? model.project?.name ?? 'DevGuard Exported API',
      version: options.version ?? '1.0.0',
      description:
        options.description ??
        `OpenAPI 3.0 specification statically generated by DevGuard from ${model.project?.framework ?? 'Express'} backend.`,
    },
    ...(options.servers && options.servers.length > 0 ? { servers: options.servers } : {}),
    paths,
    ...(Object.keys(components).length > 0 ? { components } : {}),
  };
}
