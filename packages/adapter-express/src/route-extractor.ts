import _traverse, { type NodePath, type Binding, type TraverseOptions, type Scope } from '@babel/traverse';
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
  normalizePath,
  type Diagnostic,
  type Endpoint,
  type Effect,
  type HttpMethod,
} from '@devguard/core';
import type { ModuleGraph } from './module-graph.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

const SUPPORTED_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

function getEffectForMethod(method: string): Effect {
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
 * Joins a mount prefix with a route path and normalizes slashes.
 *
 * Examples:
 * - joinPaths('/api', '/users') -> '/api/users'
 * - joinPaths('/api/', '/users') -> '/api/users'
 * - joinPaths('/', '/items/:id') -> '/items/:id'
 * - joinPaths('', '/orphan') -> '/orphan'
 */
export function joinPaths(prefix: string, routePath: string): string {
  const cleanPrefix = prefix.trim();
  const cleanRoute = routePath.trim();

  if (!cleanPrefix || cleanPrefix === '/') {
    return cleanRoute.startsWith('/') ? cleanRoute : '/' + cleanRoute;
  }

  const p = (cleanPrefix.startsWith('/') ? cleanPrefix : '/' + cleanPrefix).replace(/\/+$/, '');
  const r = cleanRoute.startsWith('/') ? cleanRoute : '/' + cleanRoute;

  return `${p}${r}`.replace(/\/+/g, '/');
}

export interface ExtractRoutesResult {
  endpoints: Endpoint[];
  diagnostics: Diagnostic[];
}

export interface PendingRouterRoute {
  method: string;
  routePath: string;
  startLine: number;
  startCol?: number;
  snippet?: string;
  isDynamic: boolean;
  rawExpr?: string;
}

export interface ExtractedMount {
  prefix: string;
  line: number;
  column?: number;
  mountFilePath: string;
  sourceRouterId?: string;
  target:
    | { type: 'identifier'; name: string }
    | { type: 'member'; objectName: string; propertyName: string }
    | { type: 'require'; specifier: string };
}

export interface ExtractedRouter {
  id: string;
  relFile: string;
  filePathForProvenance: string;
  varName: string;
  declLine: number;
  declCol?: number;
  routes: PendingRouterRoute[];
  mounts: Array<{ prefix: string; line: number; mountFilePath: string }>;
}

export interface FileDeclarations {
  relFile: string;
  filePathForProvenance: string;
  directEndpoints: Endpoint[];
  routers: Map<string, ExtractedRouter>;
  mounts: ExtractedMount[];
  diagnostics: Diagnostic[];
}


export interface PathResolution {
  isResolvable: boolean;
  values: string[];
  rawExpr?: string;
  partialValues?: string[];
  capExceeded?: boolean;
}

/**
 * Normalizes dynamic expression text for placeholders:
 * 1. Trims and collapses multiple whitespace characters to a single space.
 * 2. Caps length at 60 characters (including trailing "..." if truncated, max 60 chars).
 */
export function formatPlaceholder(expr?: string): string {
  const collapsed = (expr || '').trim().replace(/\s+/g, ' ');
  const MAX_LEN = 60;
  const truncated = collapsed.length > MAX_LEN ? collapsed.slice(0, MAX_LEN - 3) + '...' : collapsed;
  return `<${truncated}>`;
}

export function resolvePathConstant(
  node: Node,
  code: string,
  scope: Scope,
  moduleGraph: ModuleGraph | undefined,
  astCache: Map<string, { ast: File; code: string }> | undefined,
  relFile: string,
  visited: Set<string>
): PathResolution {
  if (node.type === 'StringLiteral') {
    return { isResolvable: true, values: [node.value] };
  }

  if (node.type === 'ArrayExpression') {
    let allResolvable = true;
    const values: string[] = [];
    const partialValues: string[] = [];
    for (const el of node.elements) {
      if (!el) continue;
      const res = resolvePathConstant(el as Node, code, scope, moduleGraph, astCache, relFile, visited);
      if (!res.isResolvable) allResolvable = false;
      values.push(...res.values);
      if (res.partialValues?.length) partialValues.push(...res.partialValues);
      else if (!res.isResolvable && res.rawExpr) partialValues.push(formatPlaceholder(res.rawExpr));
    }
    if (allResolvable) return { isResolvable: true, values };
    return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), partialValues };
  }

  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const leftRes = resolvePathConstant(node.left, code, scope, moduleGraph, astCache, relFile, visited);
    const rightRes = resolvePathConstant(node.right, code, scope, moduleGraph, astCache, relFile, visited);

    const combine = (lefts: string[], rights: string[]): string[] | null => {
      if (lefts.length === 0 && rights.length === 0) return [];
      if (lefts.length === 0) return rights;
      if (rights.length === 0) return lefts;
      if (lefts.length * rights.length > 100) return null; // Cap exceeded
      const res: string[] = [];
      for (const l of lefts) for (const r of rights) res.push(l + r);
      return res;
    };

    if (leftRes.capExceeded || rightRes.capExceeded) {
      return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), capExceeded: true };
    }

    if (leftRes.isResolvable && rightRes.isResolvable) {
      const combined = combine(leftRes.values, rightRes.values);
      if (combined === null) {
        return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), capExceeded: true };
      }
      return { isResolvable: true, values: combined };
    }

    const leftPartials = leftRes.isResolvable ? leftRes.values : (leftRes.partialValues?.length ? leftRes.partialValues : [formatPlaceholder(leftRes.rawExpr || '')]);
    const rightPartials = rightRes.isResolvable ? rightRes.values : (rightRes.partialValues?.length ? rightRes.partialValues : [formatPlaceholder(rightRes.rawExpr || '')]);

    const combinedPartials = combine(leftPartials, rightPartials);
    if (combinedPartials === null) {
      return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), capExceeded: true };
    }

    return {
      isResolvable: false,
      values: [],
      rawExpr: getRawExpressionText(node, code),
      partialValues: combinedPartials
    };
  }

  if (node.type === 'TemplateLiteral') {
    let isResolvable = true;
    let values: string[] = [''];
    let partialValues: string[] = [''];

    for (let i = 0; i < node.quasis.length; i++) {
      const str = node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
      values = values.map(v => v + str);
      partialValues = partialValues.map(v => v + str);

      if (i < node.expressions.length) {
        const expr = node.expressions[i];
        if (expr.type === 'TSTypeAssertion' || expr.type === 'TSAsExpression') continue;
        const res = resolvePathConstant(expr as Node, code, scope, moduleGraph, astCache, relFile, visited);
        if (res.capExceeded) {
          return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), capExceeded: true };
        }
        if (!res.isResolvable) isResolvable = false;
        
        if (res.isResolvable) {
          if (values.length * res.values.length > 100) {
            return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), capExceeded: true };
          }
          const newVals: string[] = [];
          for (const v of values) for (const rv of res.values) newVals.push(v + rv);
          values = newVals;

          const newPartials: string[] = [];
          for (const v of partialValues) for (const rv of res.values) newPartials.push(v + rv);
          partialValues = newPartials;
        } else {
          values = [];
          const newPartials: string[] = [];
          const exprPartials = res.partialValues?.length ? res.partialValues : [formatPlaceholder(res.rawExpr || '')];
          if (partialValues.length * exprPartials.length > 100) {
            return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), capExceeded: true };
          }
          for (const v of partialValues) for (const ev of exprPartials) newPartials.push(v + ev);
          partialValues = newPartials;
        }
      }
    }
    if (isResolvable) return { isResolvable: true, values };
    return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code), partialValues };
  }

  if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.property.type === 'Identifier') {
    const objName = node.object.name;
    const propName = node.property.name;

    if (moduleGraph && astCache) {
      const modNode = moduleGraph.nodes.get(relFile);
      if (modNode) {
        const imp = modNode.imports.find(i => i.localName === objName);
        if (imp && imp.sourcePath && !imp.isExternal) {
          const targetNode = moduleGraph.nodes.get(imp.sourcePath);
          if (targetNode) {
            const exp = targetNode.exports.find(e => e.exportedName === propName);
            if (exp) {
              const visitKey = `${imp.sourcePath}:export:${exp.exportedName}`;
              if (!visited.has(visitKey)) {
                visited.add(visitKey);
                const targetEntry = astCache.get(imp.sourcePath);
                if (targetEntry) {
                  let targetInit: Node | undefined;
                  let targetScope: Scope | undefined;

                  traverse(targetEntry.ast, {
                    enter(path) {
                      if (path.node.loc?.start.line === exp.line) {
                        if (exp.localName) {
                          const b = path.scope.getBinding(exp.localName);
                          if (b && b.kind === 'const' && b.constant && b.path.node.type === 'VariableDeclarator') {
                            targetInit = b.path.node.init ?? undefined;
                            targetScope = b.path.scope;
                          }
                        }
                        if (!targetInit && path.node.type === 'ObjectProperty' && path.node.value) {
                          targetInit = path.node.value as Node;
                          targetScope = path.scope;
                        }
                        if (!targetInit && path.node.type === 'AssignmentExpression') {
                          targetInit = path.node.right;
                          targetScope = path.scope;
                        }
                        if (targetInit) {
                          path.stop();
                        }
                      }
                    }
                  });

                  if (targetInit && targetScope) {
                    const res = resolvePathConstant(targetInit, targetEntry.code, targetScope, moduleGraph, astCache, imp.sourcePath, visited);
                    visited.delete(visitKey);
                    return res;
                  }
                }
                visited.delete(visitKey);
              }
            }
          }
        }
      }
    }
  }

  if (node.type === 'Identifier') {
    const binding = scope.getBinding(node.name);
    if (binding && binding.kind === 'const' && binding.constant && binding.path.node.type === 'VariableDeclarator') {
      const init = binding.path.node.init;
      if (init) {
        const visitKey = `${relFile}:${node.name}`;
        if (!visited.has(visitKey)) {
          visited.add(visitKey);
          const res = resolvePathConstant(init, code, binding.path.scope, moduleGraph, astCache, relFile, visited);
          visited.delete(visitKey);
          return res;
        }
      }
    }

    if (moduleGraph && astCache) {
      const modNode = moduleGraph.nodes.get(relFile);
      if (modNode) {
        const imp = modNode.imports.find(i => i.localName === node.name);
        if (imp && imp.sourcePath && !imp.isExternal) {
          const targetNode = moduleGraph.nodes.get(imp.sourcePath);
          if (targetNode) {
            const exp = targetNode.exports.find(e => e.exportedName === imp.importedName || (imp.importedName !== 'default' && e.exportedName === '*'));
            if (exp) {
              const visitKey = `${imp.sourcePath}:export:${exp.exportedName}`;
              if (!visited.has(visitKey)) {
                visited.add(visitKey);
                const targetEntry = astCache.get(imp.sourcePath);
                if (targetEntry) {
                  let targetInit: Node | undefined;
                  let targetScope: Scope | undefined;
                  
                  traverse(targetEntry.ast, {
                    enter(path) {
                      if (path.node.loc?.start.line === exp.line) {
                         if (exp.localName) {
                            const b = path.scope.getBinding(exp.localName);
                            if (b && b.kind === 'const' && b.constant && b.path.node.type === 'VariableDeclarator') {
                               targetInit = b.path.node.init ?? undefined;
                               targetScope = b.path.scope;
                            }
                         }
                         if (!targetInit && path.node.type === 'AssignmentExpression') {
                            targetInit = path.node.right;
                            targetScope = path.scope;
                         }
                         if (!targetInit && path.node.type === 'ExportDefaultDeclaration') {
                            targetInit = path.node.declaration as Node;
                            targetScope = path.scope;
                         }
                         if (targetInit) {
                            path.stop();
                         }
                      }
                    }
                  });

                  if (targetInit && targetScope) {
                     const res = resolvePathConstant(targetInit, targetEntry.code, targetScope, moduleGraph, astCache, imp.sourcePath, visited);
                     visited.delete(visitKey);
                     return res;
                  }
                }
                visited.delete(visitKey);
              }
            }
          }
        }
      }
    }
  }

  return { isResolvable: false, values: [], rawExpr: getRawExpressionText(node, code) };
}

function getRawExpressionText(node: Node, code: string): string {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return code.slice(node.start, node.end);
  }
  return node.type;
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
           const isPathExpression = firstArg.type === 'StringLiteral' || firstArg.type === 'TemplateLiteral' || firstArg.type === 'BinaryExpression' || firstArg.type === 'ArrayExpression';
           
           if (res.isResolvable || isPathExpression || (firstArg.type === 'Identifier' && (res.isResolvable || res.rawExpr === firstArg.name && res.partialValues?.length))) {
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
           if (firstArg.type === 'StringLiteral' || (firstArg.type === 'ArrayExpression' && (firstArg as { elements: Array<{ type: string } | null> }).elements.every(e => e && e.type === 'StringLiteral'))) {
               isLiteralKind = true;
           }
        }
      } else {
        res = { isResolvable: isLiteralPath, values: isLiteralPath ? [routePath] : [], rawExpr, partialValues: isLiteralPath ? undefined : [formatPlaceholder(rawExpr)] };
        isLiteralKind = isLiteralPath;
      }

      if (!effectiveAppBinding && !effectiveRouterRecord) return;

      const startLine = memberExpr.property.loc?.start.line ?? node.loc?.start.line ?? 1;
      const startCol = memberExpr.property.loc?.start.column ?? node.loc?.start.column;
      const snippet = codeLines[startLine - 1]?.trim();

      if (res) {
        const paths = res.isResolvable ? res.values : (res.partialValues?.length ? res.partialValues : [formatPlaceholder(res.rawExpr || 'expression')]);

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
                description: `User identifier extracted from path segment :${match[1]}.`,
                provenance: {
                  kind: 'literal' as const,
                  filePath: filePathForProvenance,
                  line: startLine,
                },
              }));

              directEndpoints.push({
                id: generateEndpointId(methodUpper, p),
                method: methodUpper,
                path: p,
                auth: { type: 'unknown' },
                effect,
                params,
                responses: [],
                middleware: [],
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

interface MountLocationInfo {
  file: string;
  line: number;
  column?: number;
  prefix: string;
}

/**
 * Resolves an exported symbol from targetFile to its underlying ExtractedRouter,
 * following re-exports across file boundaries with cycle protection.
 */
function resolveExportedRouter(
  targetFile: string,
  exportedName: string,
  moduleGraph: ModuleGraph,
  routersByFile: Map<string, Map<string, ExtractedRouter>>,
  diagnostics: Diagnostic[],
  visited: Set<string>,
  mountLocation: MountLocationInfo
): ExtractedRouter | null {
  const visitKey = `${targetFile}:${exportedName}`;
  if (visited.has(visitKey)) {
    // Cycle detected!
    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mountLocation.prefix, routerIdentifier: `<cyclic: ${targetFile}:${exportedName}>` },
        { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
      )
    );
    return null;
  }
  visited.add(visitKey);

  const node = moduleGraph.nodes.get(targetFile);
  if (!node) {
    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mountLocation.prefix, routerIdentifier: targetFile },
        { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
      )
    );
    return null;
  }

  // Find matching export in targetFile
  const exp = node.exports.find(
    (e) => e.exportedName === exportedName || (exportedName !== 'default' && e.exportedName === '*')
  );

  if (!exp) {
    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mountLocation.prefix, routerIdentifier: `${targetFile}:${exportedName}` },
        { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
      )
    );
    return null;
  }

  // Case A: exp has a localName (e.g. module.exports = router, export default router, exports.foo = router)
  if (exp.localName) {
    // 1. Is it a router declared directly in targetFile?
    const router = routersByFile.get(targetFile)?.get(exp.localName);
    if (router) {
      return router;
    }

    // 2. Is it a re-export of an import in targetFile? (e.g. const admin = require('./admin'); module.exports = admin;)
    const imp = node.imports.find((i) => i.localName === exp.localName);
    if (imp) {
      if (imp.isExternal || !imp.sourcePath) {
        diagnostics.push(
          createDiagnostic(
            'DG-R002',
            { mountPath: mountLocation.prefix, routerIdentifier: imp.specifier },
            { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
          )
        );
        return null;
      }
      return resolveExportedRouter(
        imp.sourcePath,
        imp.importedName === '*' ? exportedName : imp.importedName,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        mountLocation
      );
    }
  }

  // Case B: exp.localName is null (e.g. module.exports = require('./admin'))
  // Find import in targetFile matching exp.line
  const lineImp = node.imports.find((i) => i.line === exp.line);
  if (lineImp) {
    if (lineImp.isExternal || !lineImp.sourcePath) {
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: mountLocation.prefix, routerIdentifier: lineImp.specifier },
          { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
        )
      );
      return null;
    }
    return resolveExportedRouter(
      lineImp.sourcePath,
      lineImp.importedName === '*' ? exportedName : lineImp.importedName,
      moduleGraph,
      routersByFile,
      diagnostics,
      visited,
      mountLocation
    );
  }

  // Export found, but target is not an Express router (e.g. a plain middleware function or constant)
  // Non-routers don't emit DG-R002 unless explicitly unresolvable
  return null;
}

/**
 * Resolves a mount candidate to an ExtractedRouter instance.
 */
function resolveMountToRouter(
  mount: ExtractedMount,
  moduleGraph: ModuleGraph,
  routersByFile: Map<string, Map<string, ExtractedRouter>>,
  diagnostics: Diagnostic[],
  visited: Set<string>,
  mountFileForProvenance: string
): ExtractedRouter | null {
  const mountFilePath = mount.mountFilePath;
  const target = mount.target;

  // 1. Target is a local identifier in the same file or imported identifier
  if (target.type === 'identifier') {
    // Check if target is a local router in the same file
    const localRouter = routersByFile.get(mountFilePath)?.get(target.name);
    if (localRouter) {
      return localRouter;
    }

    // Check if target is an imported binding in mountFilePath
    const node = moduleGraph.nodes.get(mountFilePath);
    const imp = node?.imports.find((i) => i.localName === target.name);
    if (imp) {
      if (imp.isExternal || !imp.sourcePath) {
        diagnostics.push(
          createDiagnostic(
            'DG-R002',
            { mountPath: mount.prefix, routerIdentifier: target.name },
            { file: mountFileForProvenance, line: mount.line, column: mount.column }
          )
        );
        return null;
      }

      return resolveExportedRouter(
        imp.sourcePath,
        imp.importedName,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        { file: mountFileForProvenance, line: mount.line, column: mount.column, prefix: mount.prefix }
      );
    }

    // Target is not a recognized router or import
    // If mount prefix is not root, it might be an unresolvable mount
    if (mount.prefix !== '/') {
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: mount.prefix, routerIdentifier: target.name },
          { file: mountFileForProvenance, line: mount.line, column: mount.column }
        )
      );
    }
    return null;
  }

  // 2. Target is member expression on imported namespace/module (e.g. ordersMod.ordersRouter)
  if (target.type === 'member') {
    const node = moduleGraph.nodes.get(mountFilePath);
    const imp = node?.imports.find((i) => i.localName === target.objectName);
    if (imp) {
      if (imp.isExternal || !imp.sourcePath) {
        diagnostics.push(
          createDiagnostic(
            'DG-R002',
            { mountPath: mount.prefix, routerIdentifier: `${target.objectName}.${target.propertyName}` },
            { file: mountFileForProvenance, line: mount.line, column: mount.column }
          )
        );
        return null;
      }

      return resolveExportedRouter(
        imp.sourcePath,
        target.propertyName,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        { file: mountFileForProvenance, line: mount.line, column: mount.column, prefix: mount.prefix }
      );
    }

    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mount.prefix, routerIdentifier: `${target.objectName}.${target.propertyName}` },
        { file: mountFileForProvenance, line: mount.line, column: mount.column }
      )
    );
    return null;
  }

  // 3. Target is direct require call: require('./admin')
  if (target.type === 'require') {
    const node = moduleGraph.nodes.get(mountFilePath);
    const imp = node?.imports.find((i) => i.specifier === target.specifier && i.line === mount.line);
    if (imp && imp.sourcePath) {
      return resolveExportedRouter(
        imp.sourcePath,
        'default',
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        { file: mountFileForProvenance, line: mount.line, column: mount.column, prefix: mount.prefix }
      );
    }

    diagnostics.push(
      createDiagnostic(
        'DG-R002',
        { mountPath: mount.prefix, routerIdentifier: `require('${target.specifier}')` },
        { file: mountFileForProvenance, line: mount.line, column: mount.column }
      )
    );
    return null;
  }

  return null;
}

/**
 * Resolves routes across multiple files by attaching mounts to routers and
 * generating fully qualified endpoint objects.
 */
export function resolveCrossFileRoutes(
  fileDeclarations: Map<string, FileDeclarations>,
  moduleGraph: ModuleGraph
): ExtractRoutesResult {
  const endpoints: Endpoint[] = [];
  const diagnostics: Diagnostic[] = [];

  // 1. Collect direct app endpoints from all files
  for (const decl of fileDeclarations.values()) {
    endpoints.push(...decl.directEndpoints);
    diagnostics.push(...decl.diagnostics);
  }

  // 2. Group routers by relFile and global map
  const routersByFile = new Map<string, Map<string, ExtractedRouter>>();
  const allRouters = new Map<string, ExtractedRouter>();
  for (const [relFile, decl] of fileDeclarations) {
    routersByFile.set(relFile, decl.routers);
    for (const router of decl.routers.values()) {
      allRouters.set(router.id, router);
    }
  }

  // 3. Resolve each mount to its target router
  interface ResolvedMount {
    prefix: string;
    targetRouter: ExtractedRouter;
    line: number;
    column?: number;
    mountFilePath: string;
  }
  
  const appMounts: ResolvedMount[] = [];
  const routerMounts = new Map<string, ResolvedMount[]>();

  for (const [, decl] of fileDeclarations) {
    for (const mount of decl.mounts) {
      const visited = new Set<string>();
      const targetRouter = resolveMountToRouter(
        mount,
        moduleGraph,
        routersByFile,
        diagnostics,
        visited,
        decl.filePathForProvenance
      );
      
      if (targetRouter) {
        const resolved: ResolvedMount = {
          prefix: mount.prefix,
          targetRouter,
          line: mount.line,
          column: mount.column,
          mountFilePath: decl.filePathForProvenance,
        };
        
        if (mount.sourceRouterId) {
          if (!routerMounts.has(mount.sourceRouterId)) {
            routerMounts.set(mount.sourceRouterId, []);
          }
          routerMounts.get(mount.sourceRouterId)!.push(resolved);
        } else {
          appMounts.push(resolved);
        }
      }
    }
  }

  // 4. DFS from app mounts to generate full prefixes for each router
  const resolvedPrefixes = new Map<string, string[]>();
  
  function dfs(
    currentRouter: ExtractedRouter, 
    currentPrefix: string, 
    visitedPath: Set<string>, 
    mountLine: number, 
    mountCol: number | undefined, 
    mountFile: string
  ) {
    if (visitedPath.has(currentRouter.id)) {
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: currentPrefix, routerIdentifier: `<cyclic: ${currentRouter.id}>` },
          { file: mountFile, line: mountLine, column: mountCol }
        )
      );
      return;
    }

    if (!resolvedPrefixes.has(currentRouter.id)) {
      resolvedPrefixes.set(currentRouter.id, []);
    }
    resolvedPrefixes.get(currentRouter.id)!.push(currentPrefix);

    const nextVisited = new Set(visitedPath);
    nextVisited.add(currentRouter.id);

    const children = routerMounts.get(currentRouter.id) || [];
    for (const childMount of children) {
      const nextPrefix = joinPaths(currentPrefix, childMount.prefix);
      dfs(childMount.targetRouter, nextPrefix, nextVisited, childMount.line, childMount.column, childMount.mountFilePath);
    }
  }

  for (const am of appMounts) {
    dfs(am.targetRouter, am.prefix, new Set(), am.line, am.column, am.mountFilePath);
  }

  // 5. Generate endpoints for all routers
  for (const router of allRouters.values()) {
    const prefixes = resolvedPrefixes.get(router.id);
    
    if (!prefixes || prefixes.length === 0) {
      // Unmounted router: emit DG-R002 and mark all its routes as uncertain
      diagnostics.push(
        createDiagnostic(
          'DG-R002',
          { mountPath: '<unmounted>', routerIdentifier: router.varName },
          { file: router.filePathForProvenance, line: router.declLine, column: router.declCol }
        )
      );

      for (const route of router.routes) {
        const methodUpper = route.method.toUpperCase() as HttpMethod;
        const effect = getEffectForMethod(route.method);
        const finalPath = route.isDynamic
          ? (route.routePath
              ? (route.routePath.startsWith('/') ? route.routePath : '/' + route.routePath)
              : '/' + formatPlaceholder(route.rawExpr))
          : normalizePath(route.routePath);

        endpoints.push({
          id: generateEndpointId(methodUpper, finalPath),
          method: methodUpper,
          path: finalPath,
          auth: { type: 'unknown' },
          effect,
          params: [],
          responses: [],
          middleware: [],
          provenance: {
            kind: 'unresolved',
            filePath: router.filePathForProvenance,
            line: route.startLine,
            ...(route.startCol !== undefined ? { column: route.startCol } : {}),
            ...(route.snippet ? { snippet: route.snippet } : {}),
          },
          confidence: 'uncertain',
          confidenceReason: 'DG-R002',
        });
      }
    } else {
      // Mounted router: emit resolved endpoints for each mount prefix
      for (const prefix of prefixes) {
        for (const route of router.routes) {
          const methodUpper = route.method.toUpperCase() as HttpMethod;
          const effect = getEffectForMethod(route.method);

          if (route.isDynamic) {
            diagnostics.push(
              createDiagnostic(
                'DG-R003',
                { rawExpression: route.rawExpr! },
                { file: router.filePathForProvenance, line: route.startLine, column: route.startCol }
              )
            );

            const placeholderPath = joinPaths(prefix, route.routePath);
            endpoints.push({
              id: generateEndpointId(methodUpper, placeholderPath),
              method: methodUpper,
              path: placeholderPath,
              auth: { type: 'unknown' },
              effect,
              params: [],
              responses: [],
              middleware: [],
              provenance: {
                kind: 'unresolved',
                filePath: router.filePathForProvenance,
                line: route.startLine,
                ...(route.startCol !== undefined ? { column: route.startCol } : {}),
                ...(route.snippet ? { snippet: route.snippet } : {}),
              },
              confidence: 'uncertain',
              confidenceReason: 'DG-R003',
            });
          } else {
            const finalPath = joinPaths(prefix, route.routePath);
            const paramMatches = [...finalPath.matchAll(/:([a-zA-Z0-9_]+)/g)];
            const params = paramMatches.map((match) => ({
              name: match[1] ?? '',
              in: 'path' as const,
              required: true,
              description: `User identifier extracted from path segment :${match[1]}.`,
              provenance: {
                kind: 'literal' as const,
                filePath: router.filePathForProvenance,
                line: route.startLine,
              },
            }));

            endpoints.push({
              id: generateEndpointId(methodUpper, finalPath),
              method: methodUpper,
              path: finalPath,
              auth: { type: 'unknown' },
              effect,
              params,
              responses: [],
              middleware: [],
              provenance: {
                kind: 'resolved',
                filePath: router.filePathForProvenance,
                line: route.startLine,
                ...(route.startCol !== undefined ? { column: route.startCol } : {}),
                ...(route.snippet ? { snippet: route.snippet } : {}),
              },
              confidence: 'confirmed',
              confidenceReason: null,
            });
          }
        }
      }
    }
  }

  return {
    endpoints,
    diagnostics,
  };
}

/**
 * Extracts Express routes from a single file's AST using scope-aware identifier binding.
 * Retained for backwards compatibility with single-file callers.
 */
export function extractDirectRoutes(
  ast: File,
  filePath: string,
  code: string
): ExtractRoutesResult {
  const fileDecl = extractFileDeclarations(ast, filePath, filePath, code);
  const fileDeclarations = new Map<string, FileDeclarations>([[filePath, fileDecl]]);
  const emptyGraph: ModuleGraph = {
    nodes: new Map(),
    diagnostics: [],
  };
  return resolveCrossFileRoutes(fileDeclarations, emptyGraph);
}
