import _traverse, { type NodePath, type Binding, type TraverseOptions } from '@babel/traverse';
import type {
  File,
  Node,
  MemberExpression,
  ImportDeclaration,
  VariableDeclarator,
  CallExpression,
} from '@babel/types';
import {
  createDiagnostic,
  generateEndpointId,
  type Diagnostic,
  type Endpoint,
  type Effect,
  type HttpMethod,
  type ParamDefinition,
} from '@devguard/core';
import type { ModuleGraph } from '../module-graph.js';
import {
  resolvePathConstant,
  formatPlaceholder,
  getRawExpressionText,
  type PathResolution,
} from './path-evaluator.js';
import { findHandler } from './handler-resolver.js';
import {
  inferParamsFromHandler,
  mergeAndSortParams,
} from './param-inference.js';
import type {
  ExtractedRouter,
  ExtractedMount,
  FileDeclarations,
} from './types.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

const SUPPORTED_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

export function getEffectForMethod(method: string): Effect {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'destructive';
    default:
      return 'unknown';
  }
}

/**
 * Extracts Express app declarations, direct routes, router instances, and app.use mounts
 * from a single file's AST.
 */
export function extractFileDeclarations(
  ast: File,
  relFile: string,
  filePathForProvenance: string,
  code: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): FileDeclarations {
  const directEndpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];
  const routers = new Map<string, ExtractedRouter>();
  const mounts: ExtractedMount[] = [];

  const codeLines = code.split('\n');

  const expressFactoryBindings = new Set<Binding>();
  const expressRouterFactoryBindings = new Set<Binding>();
  const expressAppBindings = new Set<Binding>();
  const expressRouterBindings = new Map<Binding, ExtractedRouter>();

  // Phase 1: Identify Express factory and Router imports / requires
  traverse(ast, {
    ImportDeclaration(pathNode: NodePath<ImportDeclaration>) {
      if (pathNode.node.source.value === 'express') {
        for (const specifier of pathNode.node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
            const binding = pathNode.scope.getBinding(specifier.local.name);
            if (binding) {
              expressFactoryBindings.add(binding);
            }
          } else if (specifier.type === 'ImportSpecifier') {
            const importedName =
              specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
            if (importedName === 'Router') {
              const binding = pathNode.scope.getBinding(specifier.local.name);
              if (binding) {
                expressRouterFactoryBindings.add(binding);
              }
            }
          }
        }
      }
    },

    VariableDeclarator(pathNode: NodePath<VariableDeclarator>) {
      const init = pathNode.node.init;
      if (!init) return;

      // require('express')
      if (
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments.length > 0 &&
        init.arguments[0]?.type === 'StringLiteral' &&
        init.arguments[0].value === 'express'
      ) {
        if (pathNode.node.id.type === 'Identifier') {
          const binding = pathNode.scope.getBinding(pathNode.node.id.name);
          if (binding) {
            expressFactoryBindings.add(binding);
          }
        } else if (pathNode.node.id.type === 'ObjectPattern') {
          for (const prop of pathNode.node.id.properties) {
            if (prop.type === 'ObjectProperty') {
              const keyName =
                prop.key.type === 'Identifier'
                  ? prop.key.name
                  : prop.key.type === 'StringLiteral'
                    ? prop.key.value
                    : null;
              if (keyName === 'Router' && prop.value.type === 'Identifier') {
                const binding = pathNode.scope.getBinding(prop.value.name);
                if (binding) {
                  expressRouterFactoryBindings.add(binding);
                }
              }
            }
          }
        }
      }

      // Direct instantiation: const app = require('express')()
      if (
        init.type === 'CallExpression' &&
        init.callee.type === 'CallExpression' &&
        init.callee.callee.type === 'Identifier' &&
        init.callee.callee.name === 'require' &&
        init.callee.arguments.length > 0 &&
        init.callee.arguments[0]?.type === 'StringLiteral' &&
        init.callee.arguments[0].value === 'express'
      ) {
        if (pathNode.node.id.type === 'Identifier') {
          const binding = pathNode.scope.getBinding(pathNode.node.id.name);
          if (binding) {
            expressAppBindings.add(binding);
          }
        }
      }
    },
  });

  // Phase 2: Identify Express app and Router instance declarations
  traverse(ast, {
    VariableDeclarator(pathNode: NodePath<VariableDeclarator>) {
      const init = pathNode.node.init;
      if (!init || init.type !== 'CallExpression') return;

      const varName = pathNode.node.id.type === 'Identifier' ? pathNode.node.id.name : null;
      if (!varName) return;

      const declLine = pathNode.node.loc?.start.line ?? 1;
      const declCol = pathNode.node.loc?.start.column;

      // 1. Check: const app = express()
      let isExpressAppCall = false;
      if (init.callee.type === 'Identifier') {
        const calleeBinding = pathNode.scope.getBinding(init.callee.name);
        if (calleeBinding && expressFactoryBindings.has(calleeBinding)) {
          isExpressAppCall = true;
        }
      }
      if (isExpressAppCall) {
        const appBinding = pathNode.scope.getBinding(varName);
        if (appBinding) {
          expressAppBindings.add(appBinding);
        }
        return;
      }

      // 2. Check: const r = express.Router()
      let isExpressRouterCall = false;
      if (
        init.callee.type === 'MemberExpression' &&
        init.callee.property.type === 'Identifier' &&
        init.callee.property.name === 'Router' &&
        init.callee.object.type === 'Identifier'
      ) {
        const objBinding = pathNode.scope.getBinding(init.callee.object.name);
        if (objBinding && expressFactoryBindings.has(objBinding)) {
          isExpressRouterCall = true;
        }
      }

      // 3. Check: const r = Router() (from const { Router } = require('express'))
      if (init.callee.type === 'Identifier') {
        const routerBinding = pathNode.scope.getBinding(init.callee.name);
        if (routerBinding && expressRouterFactoryBindings.has(routerBinding)) {
          isExpressRouterCall = true;
        }
      }

      // 4. Check: const r = require('express').Router()
      if (
        init.callee.type === 'MemberExpression' &&
        init.callee.property.type === 'Identifier' &&
        init.callee.property.name === 'Router' &&
        init.callee.object.type === 'CallExpression' &&
        init.callee.object.callee.type === 'Identifier' &&
        init.callee.object.callee.name === 'require' &&
        init.callee.object.arguments.length > 0 &&
        init.callee.object.arguments[0]?.type === 'StringLiteral' &&
        init.callee.object.arguments[0].value === 'express'
      ) {
        isExpressRouterCall = true;
      }

      if (isExpressRouterCall) {
        const routerBinding = pathNode.scope.getBinding(varName);
        if (routerBinding) {
          const routerRecord: ExtractedRouter = {
            id: `${relFile}:${varName}`,
            relFile,
            filePathForProvenance,
            varName,
            declLine,
            declCol,
            routes: [],
            mounts: [],
          };
          expressRouterBindings.set(routerBinding, routerRecord);
          routers.set(varName, routerRecord);
        }
      }
    },
  });

  // Phase 3: Extract direct route definitions on app & router instances, and app.use() mounts
  traverse(ast, {
    CallExpression(pathNode: NodePath<CallExpression>) {
      const node = pathNode.node;
      if (node.callee.type !== 'MemberExpression') return;

      const memberExpr = node.callee as MemberExpression;
      if (memberExpr.property.type !== 'Identifier') return;

      const methodName = memberExpr.property.name.toLowerCase();

      // Check if callee object is an App or Router
      let appBinding: Binding | null = null;
      let routerRecord: ExtractedRouter | null = null;

      if (memberExpr.object.type === 'Identifier') {
        const bound = pathNode.scope.getBinding(memberExpr.object.name);
        if (bound) {
          if (expressAppBindings.has(bound)) {
            appBinding = bound;
          }
          if (expressRouterBindings.has(bound)) {
            routerRecord = expressRouterBindings.get(bound)!;
          }
        }
      }

      // 1. Check for app.use('/prefix', ...) or router.use(...) mounts
      if ((appBinding || routerRecord) && methodName === 'use' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        let candidateArgs = node.arguments;

        let prefixes = ['/'];

        if (firstArg) {
          const res = resolvePathConstant(firstArg as Node, code, pathNode.scope, moduleGraph, astCache, relFile, new Set());
          if (res.capExceeded) {
            diagnostics.push(
              createDiagnostic(
                'DG-R003',
                { rawExpression: `Array product cap exceeded (>100 combinations): ${res.rawExpr || 'expression'}` },
                { file: filePathForProvenance, line: node.loc?.start.line ?? 1, column: node.loc?.start.column }
              )
            );
          }
          const isPathExpression =
            firstArg.type === 'StringLiteral' ||
            firstArg.type === 'TemplateLiteral' ||
            firstArg.type === 'BinaryExpression' ||
            firstArg.type === 'ArrayExpression';

          if (
            res.isResolvable ||
            isPathExpression ||
            (firstArg.type === 'Identifier' &&
              (res.isResolvable || (res.rawExpr === firstArg.name && res.partialValues?.length)))
          ) {
            if (res.isResolvable) {
              prefixes = res.values;
            } else {
              prefixes = res.partialValues?.length ? res.partialValues : [formatPlaceholder(res.rawExpr || 'expression')];
            }
            candidateArgs = node.arguments.slice(1);
          }
        }

        for (const arg of candidateArgs) {
          const line = arg.loc?.start.line ?? node.loc?.start.line ?? 1;
          const column = arg.loc?.start.column ?? node.loc?.start.column;
          const sourceRouterId = routerRecord ? routerRecord.id : undefined;

          for (const prefix of prefixes) {
            if (arg.type === 'Identifier') {
              mounts.push({
                prefix,
                line,
                column,
                mountFilePath: relFile,
                sourceRouterId,
                target: { type: 'identifier', name: arg.name },
              });
            } else if (arg.type === 'MemberExpression' && arg.object.type === 'Identifier') {
              const propName =
                arg.property.type === 'Identifier'
                  ? arg.property.name
                  : arg.property.type === 'StringLiteral'
                    ? arg.property.value
                    : null;
              if (propName) {
                mounts.push({
                  prefix,
                  line,
                  column,
                  mountFilePath: relFile,
                  sourceRouterId,
                  target: { type: 'member', objectName: arg.object.name, propertyName: propName },
                });
              }
            } else if (
              arg.type === 'CallExpression' &&
              arg.callee.type === 'Identifier' &&
              arg.callee.name === 'require' &&
              arg.arguments.length > 0 &&
              arg.arguments[0]?.type === 'StringLiteral'
            ) {
              mounts.push({
                prefix,
                line,
                column,
                mountFilePath: relFile,
                sourceRouterId,
                target: { type: 'require', specifier: arg.arguments[0].value },
              });
            }
          }
        }
        return;
      }

      // 2. Check for HTTP method calls: get, post, put, delete, etc.
      if (!SUPPORTED_HTTP_METHODS.has(methodName)) return;

      let isLiteralPath = false;
      let routePath = '';
      let rawExpr = '';

      let effectiveAppBinding = appBinding;
      let effectiveRouterRecord = routerRecord;
      let isChainedRoute = false;

      // Handle route chaining: e.g. router.route('/users').get(...)
      let currentObj = memberExpr.object;
      while (currentObj.type === 'CallExpression') {
        const callee = currentObj.callee;
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          const propName = callee.property.name.toLowerCase();
          if (SUPPORTED_HTTP_METHODS.has(propName)) {
            // It's another HTTP method in the chain, keep going up
            currentObj = callee.object;
            continue;
          } else if (propName === 'route') {
            // Found .route(...)
            isChainedRoute = true;
            if (currentObj.arguments.length > 0) {
              const routeArg = currentObj.arguments[0];
              if (routeArg && routeArg.type === 'StringLiteral') {
                isLiteralPath = true;
                routePath = routeArg.value;
              } else if (routeArg) {
                isLiteralPath = false;
                  rawExpr = getRawExpressionText(routeArg, code);
              }
            }
            // Determine if the base of .route() is an app or router
            if (callee.object.type === 'Identifier') {
              const bound = pathNode.scope.getBinding(callee.object.name);
              if (bound) {
                if (expressAppBindings.has(bound)) effectiveAppBinding = bound;
                if (expressRouterBindings.has(bound)) effectiveRouterRecord = expressRouterBindings.get(bound)!;
              }
            }
            break;
          }
        }
        break;
      }

      let res: PathResolution | undefined = undefined;
      let isLiteralKind = false;

      if (!isChainedRoute) {
        if (node.arguments.length === 0) return;
        const firstArg = node.arguments[0];
        if (firstArg) {
          res = resolvePathConstant(firstArg as Node, code, pathNode.scope, moduleGraph, astCache, relFile, new Set());
          if (
            firstArg.type === 'StringLiteral' ||
            (firstArg.type === 'ArrayExpression' &&
              (firstArg as { elements: Array<{ type: string } | null> }).elements.every(
                (e) => e && e.type === 'StringLiteral'
              ))
          ) {
            isLiteralKind = true;
          }
        }
      } else {
        res = {
          isResolvable: isLiteralPath,
          values: isLiteralPath ? [routePath] : [],
          rawExpr,
          partialValues: isLiteralPath ? undefined : [formatPlaceholder(rawExpr)],
        };
        isLiteralKind = isLiteralPath;
      }

      if (!effectiveAppBinding && !effectiveRouterRecord) return;

      const handlerArgs = isChainedRoute ? node.arguments : node.arguments.slice(1);
      let candidate: Node | undefined = undefined;
      if (handlerArgs.length > 0) {
        const lastArg = handlerArgs[handlerArgs.length - 1];
        if (lastArg?.type === 'ArrayExpression') {
          if (lastArg.elements.length > 0) {
            candidate = (lastArg.elements[lastArg.elements.length - 1] as Node) ?? undefined;
          }
        } else {
          candidate = lastArg as Node;
        }
      }

      const handlerResult = findHandler(
        candidate,
        pathNode.scope,
        ast,
        relFile,
        filePathForProvenance,
        code,
        moduleGraph,
        astCache
      );

      let inferredParams: ParamDefinition[] = [];
      if (
        handlerResult.resolved &&
        handlerResult.fnNode &&
        handlerResult.fnAst &&
        handlerResult.handlerFilePathForProvenance &&
        handlerResult.handlerCode
      ) {
        inferredParams = inferParamsFromHandler(
          handlerResult.fnNode,
          handlerResult.fnAst,
          handlerResult.handlerFilePathForProvenance,
          handlerResult.handlerCode
        );
      } else {
        // Unresolvable handler: emit DG-I001
        diagnostics.push(
          createDiagnostic(
            'DG-I001',
            { handlerName: handlerResult.handlerExprString },
            {
              file: filePathForProvenance,
              line: handlerResult.line ?? memberExpr.property.loc?.start.line ?? node.loc?.start.line ?? 1,
            }
          )
        );
      }

      const startLine = memberExpr.property.loc?.start.line ?? node.loc?.start.line ?? 1;
      const startCol = memberExpr.property.loc?.start.column ?? node.loc?.start.column;
      const snippet = codeLines[startLine - 1]?.trim();

      if (res) {
        const paths = res.isResolvable
          ? res.values
          : res.partialValues?.length
            ? res.partialValues
            : [formatPlaceholder(res.rawExpr || 'expression')];

        for (const p of paths) {
          // Direct app route
          if (effectiveAppBinding) {
            const methodUpper = methodName.toUpperCase() as HttpMethod;
            const effect = getEffectForMethod(methodName);

            if (res.isResolvable) {
              const paramMatches = [...p.matchAll(/:([a-zA-Z0-9_]+)/g)];
              const params = paramMatches.map((match) => ({
                name: match[1] ?? '',
                in: 'path' as const,
                required: true,
                type: 'string',
                description: `User identifier extracted from path segment :${match[1]}.`,
                provenance: {
                  kind: 'literal' as const,
                  filePath: filePathForProvenance,
                  line: startLine,
                },
              }));

              const mergedParams = mergeAndSortParams(params, inferredParams);

              directEndpoints.push({
                id: generateEndpointId(methodUpper, p),
                method: methodUpper,
                path: p,
                auth: { type: 'unknown' },
                effect,
                params: mergedParams,
                responses: [],
                middleware: [],
                mountChain: [],
                provenance: {
                  kind: isLiteralKind ? 'literal' : 'resolved',
                  filePath: filePathForProvenance,
                  line: startLine,
                  ...(startCol !== undefined ? { column: startCol } : {}),
                  ...(snippet ? { snippet } : {}),
                },
                confidence: 'confirmed',
                confidenceReason: null,
              });
            } else {
              const diagExpr = res.capExceeded
                ? `Array product cap exceeded (>100 combinations): ${res.rawExpr || p}`
                : (res.rawExpr || p);
              diagnostics.push(
                createDiagnostic(
                  'DG-R003',
                  { rawExpression: diagExpr },
                  { file: filePathForProvenance, line: startLine, column: startCol }
                )
              );

              const placeholderPath = p.startsWith('/') ? p : '/' + p;
              directEndpoints.push({
                id: generateEndpointId(methodUpper, placeholderPath),
                method: methodUpper,
                path: placeholderPath,
                auth: { type: 'unknown' },
                effect,
                params: [],
                responses: [],
                middleware: [],
                mountChain: [],
                provenance: {
                  kind: 'unresolved',
                  filePath: filePathForProvenance,
                  line: startLine,
                  ...(startCol !== undefined ? { column: startCol } : {}),
                  ...(snippet ? { snippet } : {}),
                },
                confidence: 'uncertain',
                confidenceReason: 'DG-R003',
              });
            }
          }

          // Route defined on router instance
          if (effectiveRouterRecord) {
            const diagExpr = res.capExceeded
              ? `Array product cap exceeded (>100 combinations): ${res.rawExpr || p}`
              : (res.rawExpr || p);
            effectiveRouterRecord.routes.push({
              method: methodName,
              routePath: p,
              startLine,
              startCol,
              snippet,
              isDynamic: !res.isResolvable,
              rawExpr: diagExpr,
              inferredParams,
            });
          }
        }
      }
    },
  });

  return {
    relFile,
    filePathForProvenance,
    directEndpoints,
    routers,
    mounts,
    diagnostics,
  };
}
