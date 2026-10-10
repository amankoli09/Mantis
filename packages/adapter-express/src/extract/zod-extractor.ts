import _traverse, { type Scope, type TraverseOptions } from '@babel/traverse';
import type {
  File,
  Node,
  Expression,
  CallExpression,
  ObjectExpression,
} from '@babel/types';
import type { ParamDefinition, RequestBodyDefinition } from '@devguard/core';
import type { ModuleGraph } from '../module-graph.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

export interface ExtractedZodField {
  name: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  schema: Record<string, unknown>;
  line: number;
}

export interface ExtractedZodSchema {
  target: 'body' | 'query' | 'path';
  fields: ExtractedZodField[];
  objectSchema: Record<string, unknown>;
  schemaFilePath: string;
  schemaLine: number;
}

interface MethodCall {
  name: string;
  args: Node[];
  line: number;
}

/**
 * Unwraps chained method calls on a Zod type expression (e.g. z.string().min(3).max(50).optional()).
 * Returns the innermost base call (e.g. z.string()) and the list of outer chained calls.
 */
function unwrapZodCallChain(expr: Expression): { baseCall: CallExpression | null; methodChain: MethodCall[] } {
  let curr: Expression = expr;
  const methodChain: MethodCall[] = [];

  while (curr.type === 'CallExpression') {
    const call = curr as CallExpression;
    if (call.callee.type === 'MemberExpression') {
      const prop = call.callee.property;
      const propName = prop.type === 'Identifier' ? prop.name : prop.type === 'StringLiteral' ? prop.value : null;
      if (propName) {
        // If the method is a schema wrapper like strict/passthrough/strip, record it
        methodChain.unshift({
          name: propName,
          args: call.arguments,
          line: call.loc?.start.line ?? 1,
        });
        curr = call.callee.object as Expression;
        continue;
      }
    }
    break;
  }

  // If curr was unwrapped down to a CallExpression that is the base Zod constructor (e.g. z.string(), z.object())
  if (curr.type === 'CallExpression') {
    const call = curr as CallExpression;
    if (call.callee.type === 'MemberExpression') {
      const prop = call.callee.property;
      const propName = prop.type === 'Identifier' ? prop.name : prop.type === 'StringLiteral' ? prop.value : null;
      if (propName) {
        methodChain.unshift({
          name: propName,
          args: call.arguments,
          line: call.loc?.start.line ?? 1,
        });
        return { baseCall: call, methodChain };
      }
    }
  }

  return { baseCall: null, methodChain };
}

/**
 * Parses a single Zod field expression into its type, required status, and JSON Schema constraints.
 */
function parseZodField(
  fieldName: string,
  fieldExpr: Expression,
  fallbackLine: number
): ExtractedZodField {
  const line = fieldExpr.loc?.start.line ?? fallbackLine;
  const { methodChain } = unwrapZodCallChain(fieldExpr);

  if (methodChain.length === 0) {
    return {
      name: fieldName,
      type: 'unknown',
      required: 'unknown' as unknown as boolean,
      schema: {},
      line,
    };
  }

  // The base type is the first method in the chain (e.g. string, number, boolean, enum, array, object)
  const baseMethod = methodChain[0]!;
  const baseTypeName = baseMethod.name;

  let type = 'unknown';
  let required = true;
  let nullable = false;
  const schema: Record<string, unknown> = {};

  switch (baseTypeName) {
    case 'string': {
      type = 'string';
      schema.type = 'string';
      break;
    }
    case 'number': {
      type = 'number';
      schema.type = 'number';
      break;
    }
    case 'boolean': {
      type = 'boolean';
      schema.type = 'boolean';
      break;
    }
    case 'enum': {
      type = 'string';
      schema.type = 'string';
      if (baseMethod.args.length > 0 && baseMethod.args[0]?.type === 'ArrayExpression') {
        const enumValues: string[] = [];
        for (const el of baseMethod.args[0].elements) {
          if (el && el.type === 'StringLiteral') {
            enumValues.push(el.value);
          }
        }
        if (enumValues.length > 0) {
          schema.enum = enumValues;
        }
      }
      break;
    }
    case 'array': {
      type = 'array';
      schema.type = 'array';
      if (baseMethod.args.length > 0) {
        const innerExpr = baseMethod.args[0] as Expression;
        const innerParsed = parseZodField('item', innerExpr, line);
        schema.items = innerParsed.schema;
      }
      break;
    }
    case 'object': {
      type = 'object';
      schema.type = 'object';
      if (baseMethod.args.length > 0 && baseMethod.args[0]?.type === 'ObjectExpression') {
        const objExpr = baseMethod.args[0] as ObjectExpression;
        const properties: Record<string, unknown> = {};
        const requiredProps: string[] = [];

        for (const prop of objExpr.properties) {
          if (prop.type === 'ObjectProperty') {
            const propKey = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
            if (propKey) {
              const parsedProp = parseZodField(propKey, prop.value as Expression, prop.loc?.start.line ?? line);
              properties[propKey] = parsedProp.schema;
              if (parsedProp.required) {
                requiredProps.push(propKey);
              }
            }
          }
        }
        schema.properties = properties;
        if (requiredProps.length > 0) {
          schema.required = requiredProps;
        }
      }
      break;
    }
    default: {
      type = 'unknown';
      break;
    }
  }

  // Process modifiers chained after the base type (from index 1 onward)
  for (let i = 1; i < methodChain.length; i++) {
    const modifier = methodChain[i]!;
    const modName = modifier.name;

    switch (modName) {
      case 'optional': {
        required = false;
        break;
      }
      case 'nullable': {
        nullable = true;
        schema.nullable = true;
        break;
      }
      case 'nullish': {
        required = false;
        nullable = true;
        schema.nullable = true;
        break;
      }
      case 'email': {
        schema.format = 'email';
        break;
      }
      case 'uuid': {
        schema.format = 'uuid';
        break;
      }
      case 'min':
      case 'gte': {
        if (modifier.args.length > 0 && modifier.args[0]?.type === 'NumericLiteral') {
          const val = modifier.args[0].value;
          if (type === 'string') {
            schema.minLength = val;
          } else if (type === 'number') {
            schema.minimum = val;
          } else if (type === 'array') {
            schema.minItems = val;
          }
        }
        break;
      }
      case 'max':
      case 'lte': {
        if (modifier.args.length > 0 && modifier.args[0]?.type === 'NumericLiteral') {
          const val = modifier.args[0].value;
          if (type === 'string') {
            schema.maxLength = val;
          } else if (type === 'number') {
            schema.maximum = val;
          } else if (type === 'array') {
            schema.maxItems = val;
          }
        }
        break;
      }
      case 'int': {
        if (type === 'number') {
          schema.type = 'integer';
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    name: fieldName,
    type,
    required,
    nullable: nullable || undefined,
    schema,
    line,
  };
}

/**
 * Parses a Zod schema object AST (e.g. z.object({ ... })) into field definitions and whole JSON Schema.
 */
export function parseZodObjectSchema(
  schemaExpr: Expression,
  schemaFilePath: string,
  targetLocation: 'body' | 'query' | 'path' = 'body'
): ExtractedZodSchema | null {
  const schemaLine = schemaExpr.loc?.start.line ?? 1;
  const { methodChain } = unwrapZodCallChain(schemaExpr);

  // Find z.object(...) in the chain
  const objectCall = methodChain.find((m) => m.name === 'object');
  if (!objectCall || objectCall.args.length === 0 || objectCall.args[0]?.type !== 'ObjectExpression') {
    return null;
  }

  const objExpr = objectCall.args[0] as ObjectExpression;
  const fields: ExtractedZodField[] = [];
  const properties: Record<string, unknown> = {};
  const requiredFields: string[] = [];

  for (const prop of objExpr.properties) {
    if (prop.type === 'ObjectProperty') {
      const fieldName =
        prop.key.type === 'Identifier'
          ? prop.key.name
          : prop.key.type === 'StringLiteral'
            ? prop.key.value
            : null;

      if (fieldName) {
        const propLine = prop.loc?.start.line ?? schemaLine;
        const parsed = parseZodField(fieldName, prop.value as Expression, propLine);
        fields.push(parsed);
        properties[fieldName] = parsed.schema;
        if (parsed.required) {
          requiredFields.push(fieldName);
        }
      }
    }
  }

  const objectSchema: Record<string, unknown> = {
    type: 'object',
    properties,
    ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
  };

  return {
    target: targetLocation,
    fields,
    objectSchema,
    schemaFilePath,
    schemaLine,
  };
}

/**
 * Resolves a schema identifier to its AST node and file path (locally or via 1-hop module graph).
 */
export function resolveZodSchemaIdentifier(
  identifierName: string,
  scope: Scope,
  _ast: File,
  relFile: string,
  filePathForProvenance: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): { schemaExpr: Expression; schemaFilePath: string } | null {
  // 1. Local scope binding
  const binding = scope.getBinding(identifierName);
  if (binding) {
    if (
      binding.path.node.type === 'VariableDeclarator' &&
      binding.path.node.init &&
      binding.path.node.init.type !== 'Identifier'
    ) {
      return {
        schemaExpr: binding.path.node.init as Expression,
        schemaFilePath: filePathForProvenance,
      };
    }
  }

  // 2. Module graph 1-hop import
  if (moduleGraph && astCache) {
    const modNode = moduleGraph.nodes.get(relFile);
    if (modNode) {
      const imp = modNode.imports.find((i) => i.localName === identifierName);
      if (imp && imp.sourcePath && !imp.isExternal) {
        const targetEntry = astCache.get(imp.sourcePath);
        if (targetEntry) {
          let targetProvenance = imp.sourcePath;
          if (filePathForProvenance.endsWith(relFile)) {
            const rootPrefix = filePathForProvenance.slice(0, filePathForProvenance.length - relFile.length);
            targetProvenance = rootPrefix + imp.sourcePath;
          }

          let foundExpr: Expression | null = null;
          traverse(targetEntry.ast, {
            enter(p) {
              if (foundExpr) return;
              if (p.node.type === 'ExportNamedDeclaration' && p.node.declaration) {
                if (p.node.declaration.type === 'VariableDeclaration') {
                  for (const decl of p.node.declaration.declarations) {
                    if (
                      decl.id.type === 'Identifier' &&
                      decl.id.name === imp.importedName &&
                      decl.init
                    ) {
                      foundExpr = decl.init as Expression;
                      p.stop();
                      return;
                    }
                  }
                }
              }
              // CommonJS: exports.<name> = ... or module.exports = { <name>: ... }
              if (
                p.node.type === 'AssignmentExpression' &&
                p.node.left.type === 'MemberExpression' &&
                p.node.left.property.type === 'Identifier' &&
                p.node.left.property.name === imp.importedName
              ) {
                foundExpr = p.node.right as Expression;
                p.stop();
                return;
              }
            },
          });

          if (foundExpr) {
            return {
              schemaExpr: foundExpr,
              schemaFilePath: targetProvenance,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Determines target location ('body' | 'query' | 'path') from parse argument AST.
 */
function getTargetLocationFromExpr(expr: Node): 'body' | 'query' | 'path' | null {
  if (expr.type === 'MemberExpression') {
    const prop = expr.property;
    const propName = prop.type === 'Identifier' ? prop.name : prop.type === 'StringLiteral' ? prop.value : null;
    if (propName === 'body') return 'body';
    if (propName === 'query') return 'query';
    if (propName === 'params') return 'path';
  }
  return null;
}

/**
 * Inspects a handler function AST for schema.parse(req.body) or schema.safeParse(req.body) invocations.
 */
export function extractZodSchemasFromHandler(
  fnNode: Node,
  fnAst: File,
  _scope: Scope,
  relFile: string,
  filePathForProvenance: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): ExtractedZodSchema[] {
  const extracted: ExtractedZodSchema[] = [];

  traverse(fnAst, {
    Function(fnPath) {
      if (fnPath.node !== fnNode) return;

      fnPath.traverse({
        CallExpression(callPath) {
          const call = callPath.node;
          if (call.callee.type === 'MemberExpression') {
            const member = call.callee;
            const prop = member.property;
            const methodName = prop.type === 'Identifier' ? prop.name : prop.type === 'StringLiteral' ? prop.value : null;

            if (methodName === 'parse' || methodName === 'safeParse') {
              if (call.arguments.length > 0) {
                const targetLocation = getTargetLocationFromExpr(call.arguments[0]!) ?? 'body';
                const calleeObj = member.object;

                // Case 1: Inline schema: z.object({...}).parse(...)
                if (calleeObj.type === 'CallExpression') {
                  const parsed = parseZodObjectSchema(calleeObj as Expression, filePathForProvenance, targetLocation);
                  if (parsed) {
                    extracted.push(parsed);
                    return;
                  }
                }

                // Case 2: Schema identifier: userSchema.parse(...)
                if (calleeObj.type === 'Identifier') {
                  const resolved = resolveZodSchemaIdentifier(
                    calleeObj.name,
                    callPath.scope,
                    fnAst,
                    relFile,
                    filePathForProvenance,
                    moduleGraph,
                    astCache
                  );
                  if (resolved) {
                    const parsed = parseZodObjectSchema(resolved.schemaExpr, resolved.schemaFilePath, targetLocation);
                    if (parsed) {
                      extracted.push(parsed);
                      return;
                    }
                  }
                }
              }
            }
          }
        },
      });
    },
  });

  return extracted;
}

/**
 * Inspects middleware call expressions (e.g. validate(schema), validateBody(schema))
 * for Zod schemas attached at the route declaration level.
 */
export function extractZodSchemasFromMiddlewareCall(
  middlewareArg: Node,
  scope: Scope,
  ast: File,
  relFile: string,
  filePathForProvenance: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): ExtractedZodSchema[] {
  const extracted: ExtractedZodSchema[] = [];

  if (middlewareArg.type === 'CallExpression') {
    const call = middlewareArg as CallExpression;
    let middlewareName = '';

    if (call.callee.type === 'Identifier') {
      middlewareName = call.callee.name;
    } else if (call.callee.type === 'MemberExpression' && call.callee.property.type === 'Identifier') {
      middlewareName = call.callee.property.name;
    }

    const lowerName = middlewareName.toLowerCase();
    const isValidationMw =
      lowerName.includes('validate') ||
      lowerName.includes('validator') ||
      lowerName.includes('schema');

    if (isValidationMw && call.arguments.length > 0) {
      let defaultTarget: 'body' | 'query' | 'path' = 'body';
      if (lowerName.includes('query')) defaultTarget = 'query';
      if (lowerName.includes('param')) defaultTarget = 'path';

      const firstArg = call.arguments[0]!;

      // Inline schema: validate(z.object({...}))
      if (firstArg.type === 'CallExpression') {
        const parsed = parseZodObjectSchema(firstArg as Expression, filePathForProvenance, defaultTarget);
        if (parsed) {
          extracted.push(parsed);
          return extracted;
        }
      }

      // Schema identifier: validate(userSchema)
      if (firstArg.type === 'Identifier') {
        const resolved = resolveZodSchemaIdentifier(
          firstArg.name,
          scope,
          ast,
          relFile,
          filePathForProvenance,
          moduleGraph,
          astCache
        );
        if (resolved) {
          const parsed = parseZodObjectSchema(resolved.schemaExpr, resolved.schemaFilePath, defaultTarget);
          if (parsed) {
            extracted.push(parsed);
            return extracted;
          }
        }
      }

      // Schema map object: validate({ body: userSchema, query: querySchema })
      if (firstArg.type === 'ObjectExpression') {
        for (const prop of firstArg.properties) {
          if (prop.type === 'ObjectProperty') {
            const locKey =
              prop.key.type === 'Identifier'
                ? prop.key.name
                : prop.key.type === 'StringLiteral'
                  ? prop.key.value
                  : null;

            let targetLoc: 'body' | 'query' | 'path' | null = null;
            if (locKey === 'body') targetLoc = 'body';
            if (locKey === 'query') targetLoc = 'query';
            if (locKey === 'params') targetLoc = 'path';

            if (targetLoc && prop.value) {
              if (prop.value.type === 'CallExpression') {
                const parsed = parseZodObjectSchema(prop.value as Expression, filePathForProvenance, targetLoc);
                if (parsed) extracted.push(parsed);
              } else if (prop.value.type === 'Identifier') {
                const resolved = resolveZodSchemaIdentifier(
                  prop.value.name,
                  scope,
                  ast,
                  relFile,
                  filePathForProvenance,
                  moduleGraph,
                  astCache
                );
                if (resolved) {
                  const parsed = parseZodObjectSchema(resolved.schemaExpr, resolved.schemaFilePath, targetLoc);
                  if (parsed) extracted.push(parsed);
                }
              }
            }
          }
        }
      }
    }
  }

  return extracted;
}

/**
 * Converts extracted Zod schemas into ParamDefinition[] and RequestBodyDefinition (if body).
 */
export function buildParamsAndBodyFromZod(
  schemas: ExtractedZodSchema[]
): { params: ParamDefinition[]; requestBody?: RequestBodyDefinition } {
  const params: ParamDefinition[] = [];
  let requestBody: RequestBodyDefinition | undefined;

  for (const schema of schemas) {
    if (schema.target === 'body') {
      requestBody = {
        contentType: 'application/json',
        required: true,
        schema: schema.objectSchema,
        provenance: {
          kind: 'resolved',
          filePath: schema.schemaFilePath,
          line: schema.schemaLine,
        },
      };
    }

    for (const f of schema.fields) {
      params.push({
        name: f.name,
        in: schema.target,
        required: f.required,
        type: f.type,
        schema: Object.keys(f.schema).length > 0 ? f.schema : undefined,
        provenance: {
          kind: 'resolved',
          filePath: schema.schemaFilePath,
          line: f.line,
        },
      });
    }
  }

  return { params, requestBody };
}

/**
 * Merges existing inferred parameters with authoritative Zod-extracted parameters.
 * If a parameter exists in both, Zod fields (type, required, schema, provenance) overwrite inferred unknowns.
 */
export function mergeZodIntoParams(
  existingParams: ParamDefinition[],
  zodParams: ParamDefinition[]
): ParamDefinition[] {
  const zodParamMap = new Map<string, ParamDefinition>();
  for (const zp of zodParams) {
    zodParamMap.set(`${zp.in}:${zp.name}`, zp);
  }

  const result: ParamDefinition[] = [];
  const processedZodKeys = new Set<string>();

  for (const ep of existingParams) {
    const key = `${ep.in}:${ep.name}`;
    const zodMatch = zodParamMap.get(key);
    if (zodMatch) {
      processedZodKeys.add(key);
      result.push({
        ...ep,
        type: zodMatch.type ?? ep.type,
        required: zodMatch.required,
        schema: zodMatch.schema ?? ep.schema,
        provenance: zodMatch.provenance ?? ep.provenance,
      });
    } else {
      result.push(ep);
    }
  }

  // Add any Zod fields that were not accessed directly in handler code
  for (const zp of zodParams) {
    const key = `${zp.in}:${zp.name}`;
    if (!processedZodKeys.has(key)) {
      result.push(zp);
    }
  }

  return result;
}
