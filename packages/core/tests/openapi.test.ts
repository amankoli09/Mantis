import { describe, it, expect } from 'vitest';
import { exportOpenApi, expressPathToOpenApiPath, type ApiModel, type OpenApiDocument } from '../src/index.js';

describe('OpenAPI 3.0 Exporter', () => {
  it('converts express paths to openapi paths correctly', () => {
    expect(expressPathToOpenApiPath('/api/users/:id')).toBe('/api/users/{id}');
    expect(expressPathToOpenApiPath('/posts/:postId/comments/:commentId')).toBe(
      '/posts/{postId}/comments/{commentId}'
    );
    expect(expressPathToOpenApiPath('/health')).toBe('/health');
  });

  it('exports a complete ApiModel into an OpenAPI 3.0 specification', () => {
    const sampleModel: ApiModel = {
      modelVersion: '1.2.0',
      project: {
        name: 'test-api',
        framework: 'express',
        language: 'javascript',
        root: 'src',
      },
      endpoints: [
        {
          id: 'GET /api/users/:id',
          method: 'GET',
          path: '/api/users/:id',
          auth: { type: 'bearer' },
          effect: 'read',
          params: [
            {
              name: 'id',
              in: 'path',
              type: 'string',
              required: true,
              provenance: { kind: 'literal', filePath: 'routes.js', line: 10 },
            },
            {
              name: 'details',
              in: 'query',
              type: 'boolean',
              required: false,
              provenance: { kind: 'literal', filePath: 'routes.js', line: 11 },
            },
          ],
          responses: [],
          middleware: [],
          mountChain: [],
          provenance: { kind: 'literal', filePath: 'routes.js', line: 10 },
          confidence: 'confirmed',
          confidenceReason: null,
        },
        {
          id: 'POST /api/users',
          method: 'POST',
          path: '/api/users',
          auth: { type: 'none' },
          effect: 'write',
          params: [
            {
              name: 'email',
              in: 'body',
              type: 'string',
              required: true,
              schema: { type: 'string', format: 'email' },
              provenance: { kind: 'literal', filePath: 'routes.js', line: 20 },
            },
          ],
          responses: [],
          middleware: [],
          mountChain: [],
          provenance: { kind: 'literal', filePath: 'routes.js', line: 20 },
          confidence: 'confirmed',
          confidenceReason: null,
        },
      ],
      diagnostics: [],
    };

    const openapi: OpenApiDocument = exportOpenApi(sampleModel, { title: 'Custom Test API' });

    expect(openapi.openapi).toBe('3.0.3');
    expect(openapi.info.title).toBe('Custom Test API');
    expect(openapi.paths['/api/users/{id}']).toBeDefined();
    expect(openapi.paths['/api/users/{id}'].get).toBeDefined();

    const getOp = openapi.paths['/api/users/{id}'].get;
    expect(getOp.parameters).toHaveLength(2);
    expect(getOp.parameters[0]).toMatchObject({
      name: 'id',
      in: 'path',
      required: true,
    });
    expect(getOp.parameters[1]).toMatchObject({
      name: 'details',
      in: 'query',
      required: false,
    });
    expect(getOp.security).toEqual([{ bearerAuth: [] }]);

    const postOp = openapi.paths['/api/users'].post;
    expect(postOp).toBeDefined();
    expect(postOp.requestBody).toBeDefined();
    expect(postOp.requestBody.content['application/json'].schema.properties.email).toBeDefined();

    expect(openapi.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });
});
