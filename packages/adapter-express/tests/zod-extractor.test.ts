import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import _traverse, { type Scope, type TraverseOptions } from '@babel/traverse';
import type { File, Expression, CallExpression, FunctionDeclaration, Node } from '@babel/types';
import {
  parseZodObjectSchema,
  extractZodSchemasFromHandler,
  extractZodSchemasFromMiddlewareCall,
  buildParamsAndBodyFromZod,
  mergeZodIntoParams,
} from '../src/extract/zod-extractor.js';
import type { ModuleGraph } from '../src/module-graph.js';
import type { ParamDefinition } from '@devguard/core';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;
const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

function getScopeAndAst(code: string): { ast: File; scope: Scope } {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  let scope!: Scope;
  traverse(ast, {
    Program(path) {
      scope = path.scope;
    },
  });
  return { ast, scope };
}

describe('zod-extractor', () => {
  describe('parseZodObjectSchema', () => {
    it('parses base primitive fields and constraints', () => {
      const code = `
        const schema = z.object({
          name: z.string().min(2).max(50),
          email: z.string().email(),
          id: z.string().uuid(),
          age: z.number().min(0).max(120),
          isActive: z.boolean(),
          role: z.enum(['admin', 'user', 'guest']),
          tags: z.array(z.string().min(1)),
          bio: z.string().optional(),
          notes: z.string().nullable(),
          avatar: z.string().nullish(),
        });
      `;
      const { ast } = getScopeAndAst(code);
      let schemaExpr!: Expression;
      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.type === 'Identifier' && path.node.id.name === 'schema') {
            schemaExpr = path.node.init as Expression;
          }
        },
      });

      const parsed = parseZodObjectSchema(schemaExpr, 'schemas.js', 'body');
      expect(parsed).not.toBeNull();
      expect(parsed?.target).toBe('body');
      expect(parsed?.schemaFilePath).toBe('schemas.js');

      const fieldMap = new Map(parsed!.fields.map((f) => [f.name, f]));

      // name
      const nameField = fieldMap.get('name')!;
      expect(nameField.type).toBe('string');
      expect(nameField.required).toBe(true);
      expect(nameField.schema).toEqual({ type: 'string', minLength: 2, maxLength: 50 });

      // email
      const emailField = fieldMap.get('email')!;
      expect(emailField.type).toBe('string');
      expect(emailField.required).toBe(true);
      expect(emailField.schema).toEqual({ type: 'string', format: 'email' });

      // id (uuid)
      const idField = fieldMap.get('id')!;
      expect(idField.type).toBe('string');
      expect(idField.schema).toEqual({ type: 'string', format: 'uuid' });

      // age
      const ageField = fieldMap.get('age')!;
      expect(ageField.type).toBe('number');
      expect(ageField.required).toBe(true);
      expect(ageField.schema).toEqual({ type: 'number', minimum: 0, maximum: 120 });

      // isActive
      const activeField = fieldMap.get('isActive')!;
      expect(activeField.type).toBe('boolean');
      expect(activeField.required).toBe(true);

      // role (enum)
      const roleField = fieldMap.get('role')!;
      expect(roleField.type).toBe('string');
      expect(roleField.schema).toEqual({ type: 'string', enum: ['admin', 'user', 'guest'] });

      // tags (array)
      const tagsField = fieldMap.get('tags')!;
      expect(tagsField.type).toBe('array');
      expect(tagsField.schema).toEqual({
        type: 'array',
        items: { type: 'string', minLength: 1 },
      });

      // bio (optional)
      const bioField = fieldMap.get('bio')!;
      expect(bioField.required).toBe(false);

      // notes (nullable)
      const notesField = fieldMap.get('notes')!;
      expect(notesField.nullable).toBe(true);
      expect(notesField.schema.nullable).toBe(true);

      // avatar (nullish)
      const avatarField = fieldMap.get('avatar')!;
      expect(avatarField.required).toBe(false);
      expect(avatarField.nullable).toBe(true);

      // Whole object schema
      expect(parsed?.objectSchema.type).toBe('object');
      expect((parsed?.objectSchema.required as string[])).toContain('name');
      expect((parsed?.objectSchema.required as string[])).toContain('email');
      expect((parsed?.objectSchema.required as string[])).not.toContain('bio');
    });

    it('marks unsupported types as unknown', () => {
      const code = `
        const schema = z.object({
          metadata: z.custom((val) => typeof val === 'object'),
          createdAt: z.date(),
        });
      `;
      const { ast } = getScopeAndAst(code);
      let schemaExpr!: Expression;
      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.type === 'Identifier' && path.node.id.name === 'schema') {
            schemaExpr = path.node.init as Expression;
          }
        },
      });

      const parsed = parseZodObjectSchema(schemaExpr, 'app.js');
      expect(parsed).not.toBeNull();
      const metaField = parsed!.fields.find((f) => f.name === 'metadata')!;
      expect(metaField.type).toBe('unknown');
      const dateField = parsed!.fields.find((f) => f.name === 'createdAt')!;
      expect(dateField.type).toBe('unknown');
    });
  });

  describe('extractZodSchemasFromHandler', () => {
    it('detects schema.parse(req.body) and safeParse', () => {
      const code = `
        const userSchema = z.object({
          username: z.string().min(3),
        });

        async function handler(req, res) {
          const body = userSchema.parse(req.body);
          res.json(body);
        }
      `;
      const { ast, scope } = getScopeAndAst(code);
      const fnNode = ast.program.body.find((n): n is FunctionDeclaration => n.type === 'FunctionDeclaration')!;

      const extracted = extractZodSchemasFromHandler(
        fnNode,
        ast,
        scope,
        'app.js',
        'app.js'
      );

      expect(extracted).toHaveLength(1);
      expect(extracted[0]?.target).toBe('body');
      expect(extracted[0]?.fields[0]?.name).toBe('username');
      expect(extracted[0]?.fields[0]?.type).toBe('string');
      expect(extracted[0]?.fields[0]?.required).toBe(true);
    });

    it('detects schema.safeParse(req.query) for query parameters', () => {
      const code = `
        const filterSchema = z.object({
          limit: z.number().min(1).max(100),
        });

        function handler(req, res) {
          const result = filterSchema.safeParse(req.query);
          res.send(result);
        }
      `;
      const { ast, scope } = getScopeAndAst(code);
      const fnNode = ast.program.body.find((n): n is FunctionDeclaration => n.type === 'FunctionDeclaration')!;

      const extracted = extractZodSchemasFromHandler(
        fnNode,
        ast,
        scope,
        'app.js',
        'app.js'
      );

      expect(extracted).toHaveLength(1);
      expect(extracted[0]?.target).toBe('query');
      expect(extracted[0]?.fields[0]?.name).toBe('limit');
      expect(extracted[0]?.fields[0]?.type).toBe('number');
    });

    it('resolves schema imported from another module (1-hop)', () => {
      const schemaCode = `
        export const createPostSchema = z.object({
          title: z.string().min(1),
          content: z.string(),
        });
      `;
      const schemaAst = parse(schemaCode, { sourceType: 'module' });

      const handlerCode = `
        import { createPostSchema } from './schemas.js';

        function handler(req, res) {
          createPostSchema.parse(req.body);
          res.sendStatus(201);
        }
      `;
      const { ast: handlerAst, scope: handlerScope } = getScopeAndAst(handlerCode);
      const fnNode = handlerAst.program.body.find((n): n is FunctionDeclaration => n.type === 'FunctionDeclaration')!;

      const moduleGraph: ModuleGraph = {
        nodes: new Map([
          [
            'handler.js',
            {
              filePath: 'handler.js',
              imports: [
                {
                  localName: 'createPostSchema',
                  importedName: 'createPostSchema',
                  sourcePath: 'schemas.js',
                  specifier: './schemas.js',
                  line: 2,
                  isExternal: false,
                },
              ],
              exports: [],
            },
          ],
        ]),
        diagnostics: [],
      };

      const astCache = new Map<string, { ast: File; code: string }>([
        ['schemas.js', { ast: schemaAst, code: schemaCode }],
      ]);

      const extracted = extractZodSchemasFromHandler(
        fnNode,
        handlerAst,
        handlerScope,
        'handler.js',
        'handler.js',
        moduleGraph,
        astCache
      );

      expect(extracted).toHaveLength(1);
      expect(extracted[0]?.schemaFilePath).toBe('schemas.js');
      expect(extracted[0]?.fields).toHaveLength(2);
      expect(extracted[0]?.fields[0]?.name).toBe('title');
    });
  });

  describe('extractZodSchemasFromMiddlewareCall', () => {
    it('detects validate(schema) middleware', () => {
      const code = `
        const itemSchema = z.object({
          sku: z.string(),
        });

        const mw = validate(itemSchema);
      `;
      const { ast, scope } = getScopeAndAst(code);
      let callExpr!: CallExpression;
      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.type === 'Identifier' && path.node.id.name === 'mw') {
            callExpr = path.node.init as CallExpression;
          }
        },
      });

      const extracted = extractZodSchemasFromMiddlewareCall(
        callExpr,
        scope,
        ast,
        'app.js',
        'app.js'
      );

      expect(extracted).toHaveLength(1);
      expect(extracted[0]?.target).toBe('body');
      expect(extracted[0]?.fields[0]?.name).toBe('sku');
    });

    it('detects validate({ body: bSchema, query: qSchema }) middleware map', () => {
      const code = `
        const bSchema = z.object({ name: z.string() });
        const qSchema = z.object({ page: z.number() });

        const mw = validate({ body: bSchema, query: qSchema });
      `;
      const { ast, scope } = getScopeAndAst(code);
      let callExpr!: CallExpression;
      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.type === 'Identifier' && path.node.id.name === 'mw') {
            callExpr = path.node.init as CallExpression;
          }
        },
      });

      const extracted = extractZodSchemasFromMiddlewareCall(
        callExpr,
        scope,
        ast,
        'app.js',
        'app.js'
      );

      expect(extracted).toHaveLength(2);
      expect(extracted.map((e) => e.target)).toEqual(['body', 'query']);
    });
  });

  describe('buildParamsAndBodyFromZod & mergeZodIntoParams', () => {
    it('constructs params and requestBody with resolved provenance', () => {
      const code = `
        const schema = z.object({
          email: z.string().email(),
          age: z.number().min(18),
        });
      `;
      const { ast } = getScopeAndAst(code);
      let schemaExpr!: Expression;
      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.type === 'Identifier' && path.node.id.name === 'schema') {
            schemaExpr = path.node.init as Expression;
          }
        },
      });

      const parsed = parseZodObjectSchema(schemaExpr, 'schemas.js', 'body')!;
      const { params, requestBody } = buildParamsAndBodyFromZod([parsed]);

      expect(requestBody).toBeDefined();
      expect(requestBody?.contentType).toBe('application/json');
      expect(requestBody?.required).toBe(true);
      expect(requestBody?.provenance).toEqual({
        kind: 'resolved',
        filePath: 'schemas.js',
        line: 2,
      });

      expect(params).toHaveLength(2);
      expect(params[0]?.name).toBe('email');
      expect(params[0]?.type).toBe('string');
      expect(params[0]?.schema).toEqual({ type: 'string', format: 'email' });
      expect(params[0]?.provenance).toEqual({
        kind: 'resolved',
        filePath: 'schemas.js',
        line: 3,
      });

      // Now test merge with existing inferred params
      const existingParams: ParamDefinition[] = [
        {
          name: 'email',
          in: 'body',
          type: 'unknown',
          required: 'unknown',
          provenance: { kind: 'inferred', filePath: 'app.js', line: 10 },
        },
      ];

      const merged = mergeZodIntoParams(existingParams, params);
      expect(merged).toHaveLength(2);

      const emailParam = merged.find((p) => p.name === 'email')!;
      expect(emailParam.type).toBe('string');
      expect(emailParam.required).toBe(true);
      expect(emailParam.schema).toEqual({ type: 'string', format: 'email' });
      expect(emailParam.provenance?.kind).toBe('resolved');
      expect(emailParam.provenance?.filePath).toBe('schemas.js');

      const ageParam = merged.find((p) => p.name === 'age')!;
      expect(ageParam.type).toBe('number');
      expect(ageParam.required).toBe(true);
    });
  });
});
