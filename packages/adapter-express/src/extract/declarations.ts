import _traverse, { type NodePath, type Binding, type TraverseOptions } from '@babel/traverse';
import type {
  File,
  Node,
  MemberExpression,
  ImportDeclaration,
  VariableDeclarator,
  CallExpression,
  ExportDefaultDeclaration,
  AssignmentExpression,
  Function as FunctionNode,
} from '@babel/types';
import {
  createDiagnostic,
  generateEndpointId,
  type Diagnostic,
  type Endpoint,
  type Effect,
  type EffectEvidence,
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
import { inferEffectFromHandler } from './effect-inference.js';
import type {
  ExtractedRouter,
  ExtractedMount,
  FileDeclarations,
  ExtractedMiddleware,
  MiddlewareUsage,
} from './types.js';
import {
  isLikelyRouter,
  resolveMiddleware,
  classifyAuthFromMiddlewares,
} from './middleware-inference.js';

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
  const appUses: MiddlewareUsage[] = [];

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


  const callExpressionRouters = new Map<CallExpression, ExtractedRouter>();

  function isRouterCall(
    callExpr: CallExpression,
    scope: NodePath['scope']
  ): boolean {
    if (
      callExpr.callee.type === 'MemberExpression' &&
      callExpr.callee.property.type === 'Identifier' &&
      callExpr.callee.property.name === 'Router'
    ) {
      if (callExpr.callee.object.type === 'Identifier') {
        const objBinding = scope.getBinding(callExpr.callee.object.name);
        if (objBinding && expressFactoryBindings.has(objBinding)) {
          return true;
        }
      } else if (
        callExpr.callee.object.type === 'CallExpression' &&
        callExpr.callee.object.callee.type === 'Identifier' &&
        callExpr.callee.object.callee.name === 'require' &&
        callExpr.callee.object.arguments.length > 0 &&
        callExpr.callee.object.arguments[0]?.type === 'StringLiteral' &&
        callExpr.callee.object.arguments[0].value === 'express'
      ) {
        return true;
      }
    }
    if (callExpr.callee.type === 'Identifier') {
      const routerBinding = scope.getBinding(callExpr.callee.name);
      if (routerBinding && expressRouterFactoryBindings.has(routerBinding)) {
        return true;
      }
      if (callExpr.callee.name === 'Router') {
        return true;
      }
    }
    return false;
  }

  function getChainedRouterRoot(
    expr: Node,
    scope: NodePath['scope']
  ): { rootRouterCall: CallExpression; chainedCalls: CallExpression[] } | null {
    if (expr.type !== 'CallExpression') return null;

    const chainedCalls: CallExpression[] = [];
    let curr: CallExpression = expr;

    while (true) {
      if (isRouterCall(curr, scope)) {
        return { rootRouterCall: curr, chainedCalls };
      }
      if (
        curr.callee.type === 'MemberExpression' &&
        curr.callee.object.type === 'CallExpression'
      ) {
        chainedCalls.unshift(curr);
        curr = curr.callee.object;
      } else {
        break;
      }
    }

    return null;
  }

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

      // 2. Check: Router instantiation (including chained calls like Router().use(...))
      const res = getChainedRouterRoot(init, pathNode.scope);
      if (res) {
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
            uses: [],
          };
          expressRouterBindings.set(routerBinding, routerRecord);
          routers.set(varName, routerRecord);
          callExpressionRouters.set(init, routerRecord);
          for (const c of res.chainedCalls) {
            callExpressionRouters.set(c, routerRecord);
          }
        }
      }
    },

    ExportDefaultDeclaration(pathNode: NodePath<ExportDefaultDeclaration>) {
      const decl = pathNode.node.declaration;
      const res = getChainedRouterRoot(decl, pathNode.scope);
      if (res) {
        const varName = 'default';
        const routerRecord: ExtractedRouter = {
          id: `${relFile}:${varName}`,
          relFile,
          filePathForProvenance,
          varName,
          declLine: pathNode.node.loc?.start.line ?? 1,
          declCol: pathNode.node.loc?.start.column,
          routes: [],
          mounts: [],
          uses: [],
        };
        routers.set(varName, routerRecord);
        callExpressionRouters.set(decl as CallExpression, routerRecord);
        for (const c of res.chainedCalls) {
          callExpressionRouters.set(c, routerRecord);
        }
      }
    },

    AssignmentExpression(pathNode: NodePath<AssignmentExpression>) {
      const left = pathNode.node.left;
      const right = pathNode.node.right;
      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        left.object.name === 'module' &&
        left.property.type === 'Identifier' &&
        left.property.name === 'exports'
      ) {
        const res = getChainedRouterRoot(right, pathNode.scope);
        if (res) {
          const varName = 'default';
          const routerRecord: ExtractedRouter = {
            id: `${relFile}:${varName}`,
            relFile,
            filePathForProvenance,
            varName,
            declLine: pathNode.node.loc?.start.line ?? 1,
            declCol: pathNode.node.loc?.start.column,
            routes: [],
            mounts: [],
            uses: [],
          };
          routers.set(varName, routerRecord);
          callExpressionRouters.set(right as CallExpression, routerRecord);
          for (const c of res.chainedCalls) {
            callExpressionRouters.set(c, routerRecord);
          }
        }
      }
    },

    Function(pathNode: NodePath<FunctionNode>) {
      for (const param of pathNode.node.params) {
        if (param.type === 'Identifier') {
          if (param.name === 'app') {
            const binding = pathNode.scope.getBinding('app');
            if (binding) {
              expressAppBindings.add(binding);
            }
          } else if (param.name === 'router') {
            const binding = pathNode.scope.getBinding('router');
            if (binding && !expressRouterBindings.has(binding)) {
              const varName = 'router';
              const routerRecord: ExtractedRouter = {
                id: `${relFile}:${varName}`,
                relFile,
                filePathForProvenance,
                varName,
                declLine: param.loc?.start.line ?? 1,
                declCol: param.loc?.start.column,
                routes: [],
                mounts: [],
                uses: [],
              };
              expressRouterBindings.set(binding, routerRecord);
              routers.set(varName, routerRecord);
            }
          }
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
      } else if (memberExpr.object.type === 'CallExpression') {
        if (callExpressionRouters.has(memberExpr.object)) {
          routerRecord = callExpressionRouters.get(memberExpr.object)!;
        }
      }
      if (!routerRecord && callExpressionRouters.has(node)) {
        routerRecord = callExpressionRouters.get(node)!;
      }

      // 1. Check for app.use('/prefix', ...) or router.use(...) mounts & middlewares
      if ((appBinding || routerRecord) && methodName === 'use' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        let candidateArgs = node.arguments;

        let prefixes = ['/'];

        let hasPathPrefix = false;
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
            hasPathPrefix = true;
            if (res.isResolvable) {
              prefixes = res.values;
            } else {
              prefixes = res.partialValues?.length ? res.partialValues : [formatPlaceholder(res.rawExpr || 'expression')];
            }
            candidateArgs = node.arguments.slice(1);
          }
        }

        // Check if candidateArgs contains a router argument
        let routerArgIndex = -1;
        for (let i = candidateArgs.length - 1; i >= 0; i--) {
          const arg = candidateArgs[i];
          if (arg && isLikelyRouter(arg as Node, pathNode.scope, expressRouterBindings, relFile, moduleGraph, astCache)) {
            routerArgIndex = i;
            break;
          }
        }

        if (routerArgIndex === -1 && hasPathPrefix && candidateArgs.length > 0) {
          routerArgIndex = candidateArgs.length - 1;
        }

        if (routerArgIndex >= 0) {
          // Mount-level middleware arguments before the router
          const mountMwArgs = candidateArgs.slice(0, routerArgIndex);
          const mountMiddlewares: ExtractedMiddleware[] = [];
          for (const mwArg of mountMwArgs) {
            const res = resolveMiddleware(mwArg as Node, pathNode.scope, filePathForProvenance, relFile, code, moduleGraph, astCache);
            mountMiddlewares.push(res.middleware);
            if (res.diagnostic) {
              diagnostics.push(res.diagnostic);
            }
          }

          const routerArg = candidateArgs[routerArgIndex]!;
          const line = routerArg.loc?.start.line ?? node.loc?.start.line ?? 1;
          const column = routerArg.loc?.start.column ?? node.loc?.start.column;
          const sourceRouterId = routerRecord ? routerRecord.id : undefined;

          for (const prefix of prefixes) {
            if (routerArg.type === 'Identifier') {
              mounts.push({
                prefix,
                line,
                column,
                mountFilePath: relFile,
                sourceRouterId,
                target: { type: 'identifier', name: routerArg.name },
                mountMiddlewares: mountMiddlewares.length > 0 ? mountMiddlewares : undefined,
              });
            } else if (routerArg.type === 'MemberExpression' && routerArg.object.type === 'Identifier') {
              const propName =
                routerArg.property.type === 'Identifier'
                  ? routerArg.property.name
                  : routerArg.property.type === 'StringLiteral'
                    ? routerArg.property.value
                    : null;
              if (propName) {
                mounts.push({
                  prefix,
                  line,
                  column,
                  mountFilePath: relFile,
                  sourceRouterId,
                  target: { type: 'member', objectName: routerArg.object.name, propertyName: propName },
                  mountMiddlewares: mountMiddlewares.length > 0 ? mountMiddlewares : undefined,
                });
              }
            } else if (
              routerArg.type === 'CallExpression' &&
              routerArg.callee.type === 'Identifier' &&
              routerArg.callee.name === 'require' &&
              routerArg.arguments.length > 0 &&
              routerArg.arguments[0]?.type === 'StringLiteral'
            ) {
              mounts.push({
                prefix,
                line,
                column,
                mountFilePath: relFile,
                sourceRouterId,
                target: { type: 'require', specifier: routerArg.arguments[0].value },
                mountMiddlewares: mountMiddlewares.length > 0 ? mountMiddlewares : undefined,
              });
            }
          }
        } else {
          // No router in candidateArgs: all arguments are middleware!
          for (const arg of candidateArgs) {
            const line = arg.loc?.start.line ?? node.loc?.start.line ?? 1;
            const column = arg.loc?.start.column ?? node.loc?.start.column;
            const res = resolveMiddleware(arg as Node, pathNode.scope, filePathForProvenance, relFile, code, moduleGraph, astCache);
            if (res.diagnostic) {
              diagnostics.push(res.diagnostic);
            }
            const mwUsage: MiddlewareUsage = {
              line,
              column,
              middleware: res.middleware,
            };
            if (appBinding) {
              appUses.push(mwUsage);
            }
            if (routerRecord) {
              if (!routerRecord.uses) routerRecord.uses = [];
              routerRecord.uses.push(mwUsage);
            }
          }
        }
        return;
      }

      // 2. Check for HTTP method calls: get, post, put, delete, all, etc.
      if (!SUPPORTED_HTTP_METHODS.has(methodName) && methodName !== 'all') return;

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
          if (SUPPORTED_HTTP_METHODS.has(propName) || propName === 'all') {
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
      const routeMiddlewares: ExtractedMiddleware[] = [];

      if (handlerArgs.length > 0) {
        const lastArg = handlerArgs[handlerArgs.length - 1];
        if (lastArg?.type === 'ArrayExpression') {
          // If the last argument is an array: e.g. [mwA, mwB, handler]
          const elements = lastArg.elements.filter((e): e is Exclude<typeof e, null> => e !== null);
          if (elements.length > 0) {
            candidate = elements[elements.length - 1] as Node | undefined;
            // Elements before the last element in array are middlewares
            for (let i = 0; i < elements.length - 1; i++) {
              const res = resolveMiddleware(elements[i] as Node, pathNode.scope, filePathForProvenance, relFile, code, moduleGraph, astCache);
              routeMiddlewares.push(res.middleware);
              if (res.diagnostic) diagnostics.push(res.diagnostic);
            }
          }
          // Arguments before the array are also middlewares
          for (let i = 0; i < handlerArgs.length - 1; i++) {
            const res = resolveMiddleware(handlerArgs[i] as Node, pathNode.scope, filePathForProvenance, relFile, code, moduleGraph, astCache);
            routeMiddlewares.push(res.middleware);
            if (res.diagnostic) diagnostics.push(res.diagnostic);
          }
        } else {
          candidate = lastArg as Node;
          // All arguments before the last argument are route-level middlewares
          for (let i = 0; i < handlerArgs.length - 1; i++) {
            const res = resolveMiddleware(handlerArgs[i] as Node, pathNode.scope, filePathForProvenance, relFile, code, moduleGraph, astCache);
            routeMiddlewares.push(res.middleware);
            if (res.diagnostic) diagnostics.push(res.diagnostic);
          }
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

        const targetMethods =
          methodName === 'all'
            ? ['get', 'post', 'put', 'patch', 'delete']
            : [methodName];

        for (const p of paths) {
          for (const currentMethod of targetMethods) {
            const baselineEffect = getEffectForMethod(currentMethod);
            let routeEffect = baselineEffect;
            let routeEffectEvidence: EffectEvidence | undefined;

            if (
              handlerResult.resolved &&
              handlerResult.fnNode &&
              handlerResult.fnAst &&
              handlerResult.handlerFilePathForProvenance
            ) {
              const inference = inferEffectFromHandler(
                handlerResult.fnNode,
                handlerResult.fnAst,
                handlerResult.handlerFilePathForProvenance,
                baselineEffect
              );
              routeEffect = inference.effect;
              routeEffectEvidence = inference.effectEvidence;
            }

            // Direct app route
            if (effectiveAppBinding) {
              const methodUpper = currentMethod.toUpperCase() as HttpMethod;

              const activeAppMiddlewares = appUses
                .filter((u) => u.line < startLine)
                .map((u) => u.middleware);
              const allMiddlewares = [...activeAppMiddlewares, ...routeMiddlewares];
              const endpointMiddleware = allMiddlewares.map((m) => ({
                name: m.name,
                provenance: m.provenance,
              }));
              const endpointAuth = classifyAuthFromMiddlewares(allMiddlewares);

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
                  auth: endpointAuth,
                  effect: routeEffect,
                  ...(routeEffectEvidence ? { effectEvidence: routeEffectEvidence } : {}),
                  params: mergedParams,
                  responses: [],
                  middleware: endpointMiddleware,
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
                  auth: endpointAuth,
                  effect: routeEffect,
                  ...(routeEffectEvidence ? { effectEvidence: routeEffectEvidence } : {}),
                  params: [],
                  responses: [],
                  middleware: endpointMiddleware,
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
                method: currentMethod,
                routePath: p,
                startLine,
                startCol,
                snippet,
                isDynamic: !res.isResolvable,
                rawExpr: diagExpr,
                inferredParams,
                routeMiddlewares: routeMiddlewares.length > 0 ? routeMiddlewares : undefined,
                effect: routeEffect,
                effectEvidence: routeEffectEvidence,
              });
            }
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
    appUses,
  };
}
