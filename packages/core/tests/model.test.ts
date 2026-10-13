import { describe, it, expect } from 'vitest';
import { validateModel, type ApiModel } from '../src/index.js';

describe('ApiModel Validation', () => {
  describe('Valid Models (at least 3 distinct samples)', () => {
    it('Sample 1: validates a minimal valid ApiModel with confirmed endpoint and project info', () => {
      const minimalModel: ApiModel = {
        modelVersion: '1.0.0',
        project: {
          framework: 'express',
          language: 'javascript',
          root: './backend',
        },
        endpoints: [
          {
            id: 'GET /health',
            method: 'GET',
            path: '/health',
            provenance: {
              kind: 'literal',
              filePath: 'src/routes/health.js',
              line: 12,
            },
            auth: { type: 'none' },
            effect: 'read',
            params: [],
            responses: [{ statusCode: 200 }],
            middleware: [],
            confidence: 'confirmed',
          },
        ],
        diagnostics: [],
      };

      const result = validateModel(minimalModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelVersion).toBe('1.0.0');
        expect(result.data.endpoints).toHaveLength(1);
        expect(result.data.endpoints[0].provenance.kind).toBe('literal');
      }
    });

    it('Sample 2: validates a rich comprehensive ApiModel with destructive effect and inferred params', () => {
      const richModel: ApiModel = {
        modelVersion: '1.0.0',
        project: {
          name: 'E-Commerce API',
          framework: 'express',
          language: 'javascript',
          root: '/workspace/ecommerce-backend',
        },
        endpoints: [
          {
            id: 'POST /api/v1/orders',
            method: 'POST',
            path: '/api/v1/orders',
            description: 'Create a new order for authenticated customer',
            auth: {
              type: 'bearer',
              details: 'Requires Customer JWT role',
            },
            effect: 'write',
            params: [
              {
                name: 'X-Idempotency-Key',
                in: 'header',
                required: true,
                description: 'Unique UUID to prevent double charges',
                provenance: {
                  kind: 'literal',
                  filePath: 'src/controllers/orders.js',
                  line: 46,
                },
              },
            ],
            requestBody: {
              contentType: 'application/json',
              required: true,
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array' },
                  totalAmount: { type: 'number' },
                },
              },
              provenance: {
                kind: 'inferred',
                filePath: 'src/controllers/orders.js',
                line: 48,
              },
            },
            responses: [
              { statusCode: 201, description: 'Order created' },
              { statusCode: 400, description: 'Invalid payload' },
              { statusCode: 401, description: 'Unauthorized' },
            ],
            middleware: ['authenticate', 'validateBody'],
            provenance: {
              kind: 'resolved',
              filePath: 'src/controllers/orders.js',
              line: 45,
              column: 8,
              snippet: 'router.post("/api/v1/orders", authMiddleware, createOrderHandler);',
            },
            confidence: 'confirmed',
          },
          {
            id: 'DELETE /api/v1/orders/:id',
            method: 'DELETE',
            path: '/api/v1/orders/:id',
            auth: { type: 'bearer' },
            effect: 'destructive',
            params: [
              {
                name: 'id',
                in: 'path',
                required: true,
                provenance: {
                  kind: 'literal',
                  filePath: 'src/controllers/orders.js',
                  line: 98,
                },
              },
            ],
            responses: [{ statusCode: 204 }],
            middleware: ['authenticate'],
            provenance: {
              kind: 'literal',
              filePath: 'src/controllers/orders.js',
              line: 98,
            },
            confidence: 'confirmed',
          },
        ],
        diagnostics: [],
      };

      const result = validateModel(richModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endpoints).toHaveLength(2);
        expect(result.data.endpoints[1].effect).toBe('destructive');
      }
    });

    it('Sample 3: validates an ApiModel with uncertain endpoint having confidenceReason and diagnostics with file/line', () => {
      const modelWithUncertain: ApiModel = {
        modelVersion: '1.0.0',
        metadata: {
          rootDir: '/workspace/dynamic-routes-app',
        },
        endpoints: [
          {
            id: 'GET /api/dynamic',
            method: 'GET',
            path: '/api/dynamic',
            provenance: {
              kind: 'unresolved',
              filePath: 'routes/dynamic.js',
              line: 15,
            },
            auth: { type: 'unknown' },
            effect: 'unknown',
            params: [],
            responses: [],
            middleware: [],
            confidence: 'uncertain',
            confidenceReason: 'MT-R003',
          },
        ],
        diagnostics: [
          {
            code: 'MT-R003',
            severity: 'info',
            message: 'Route path uses dynamic runtime expression: config.apiPrefix + "/dynamic"',
            file: 'routes/dynamic.js',
            line: 15,
          },
          {
            code: 'MT-R001',
            severity: 'warning',
            message: 'Could not resolve import "./missing-auth" from "routes/dynamic.js"',
            file: 'routes/dynamic.js',
            line: 2,
          },
        ],
      };

      const result = validateModel(modelWithUncertain);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.endpoints[0].confidence).toBe('uncertain');
        expect(result.data.endpoints[0].confidenceReason).toBe('MT-R003');
        expect(result.data.diagnostics[0].file).toBe('routes/dynamic.js');
      }
    });
  });

  describe('Invalid Models (testing failure reasons)', () => {
    it('Failure 1: fails when confidence is "uncertain" but confidenceReason is missing', () => {
      const uncertainWithoutReason = {
        modelVersion: '1.0.0',
        project: { root: './app' },
        endpoints: [
          {
            id: 'GET /dynamic',
            method: 'GET',
            path: '/dynamic',
            provenance: { kind: 'unresolved', filePath: 'app.js', line: 10 },
            confidence: 'uncertain',
            // Missing confidenceReason
          },
        ],
        diagnostics: [],
      };

      const result = validateModel(uncertainWithoutReason);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.errors.some(
            (e) => e.path.includes('confidenceReason') || e.message.includes('confidenceReason'),
          ),
        ).toBe(true);
      }
    });

    it('Failure 2: fails when provenance kind is invalid or missing', () => {
      const invalidProvenanceKind = {
        modelVersion: '1.0.0',
        project: { root: './app' },
        endpoints: [
          {
            id: 'GET /items',
            method: 'GET',
            path: '/items',
            provenance: {
              kind: 'guessed', // Invalid kind enum
              filePath: 'app.js',
              line: 10,
            },
          },
        ],
        diagnostics: [],
      };

      const result = validateModel(invalidProvenanceKind);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('provenance.kind'))).toBe(true);
      }
    });

    it('Failure 3: fails when effect value is old "delete" instead of "destructive"', () => {
      const oldDeleteEffect = {
        modelVersion: '1.0.0',
        project: { root: './app' },
        endpoints: [
          {
            id: 'DELETE /items/:id',
            method: 'DELETE',
            path: '/items/:id',
            effect: 'delete', // Invalid - should be 'destructive'
            provenance: { kind: 'literal', filePath: 'app.js', line: 10 },
          },
        ],
        diagnostics: [],
      };

      const result = validateModel(oldDeleteEffect);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('endpoints.0.effect'))).toBe(true);
      }
    });

    it('Failure 4: fails when modelVersion is invalid or unsupported', () => {
      const invalidVersion = {
        modelVersion: '2.0.0', // Unsupported version
        project: { root: './app' },
        endpoints: [],
        diagnostics: [],
      };

      const result = validateModel(invalidVersion);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path === 'modelVersion')).toBe(true);
      }
    });

    it('Failure 5: fails when neither project.root nor metadata.rootDir is provided', () => {
      const missingRoot = {
        modelVersion: '1.0.0',
        endpoints: [],
        diagnostics: [],
      };

      const result = validateModel(missingRoot);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('project'))).toBe(true);
      }
    });

    it('Failure 6: fails when a diagnostic code is unregistered / invalid', () => {
      const invalidDiagnosticCode = {
        modelVersion: '1.0.0',
        project: { root: './app' },
        endpoints: [],
        diagnostics: [
          {
            code: 'MT-UNKNOWN-999',
            severity: 'error',
            message: 'Unknown failure',
          },
        ],
      };

      const result = validateModel(invalidDiagnosticCode);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('diagnostics.0.code'))).toBe(true);
      }
    });

    it('Sample 3: validates modelVersion 1.1.0 with mountChain and in: body parameters', () => {
      const v11Model: ApiModel = {
        modelVersion: '1.1.0',
        project: {
          name: 'v1.1.0-app',
          framework: 'express',
          language: 'javascript',
          root: './backend',
        },
        endpoints: [
          {
            id: 'POST /api/users',
            method: 'POST',
            path: '/api/users',
            auth: { type: 'unknown' },
            effect: 'write',
            params: [
              {
                name: 'email',
                in: 'body',
                required: 'unknown',
                type: 'unknown',
                provenance: {
                  kind: 'inferred',
                  filePath: 'routes/users.js',
                  line: 25,
                },
              },
            ],
            responses: [],
            middleware: [],
            mountChain: [
              { filePath: 'app.js', line: 12 },
              { filePath: 'routes/api.js', line: 5 },
            ],
            provenance: {
              kind: 'resolved',
              filePath: 'routes/users.js',
              line: 20,
            },
            confidence: 'confirmed',
            confidenceReason: null,
          },
        ],
        diagnostics: [],
      };

      const result = validateModel(v11Model);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelVersion).toBe('1.1.0');
        expect(result.data.endpoints[0].params[0].in).toBe('body');
        expect(result.data.endpoints[0].mountChain).toHaveLength(2);
      }
    });
  });
});
