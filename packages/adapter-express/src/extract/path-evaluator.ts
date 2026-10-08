import _traverse, { type Scope, type TraverseOptions } from '@babel/traverse';
import type { File, Node } from '@babel/types';
import type { ModuleGraph } from '../module-graph.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

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

export function getRawExpressionText(node: Node, code: string): string {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return code.slice(node.start, node.end);
  }
  return node.type;
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
      partialValues: combinedPartials,
    };
  }

  if (node.type === 'TemplateLiteral') {
    let isResolvable = true;
    let values: string[] = [''];
    let partialValues: string[] = [''];

    for (let i = 0; i < node.quasis.length; i++) {
      const str = node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
      values = values.map((v) => v + str);
      partialValues = partialValues.map((v) => v + str);

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
        const imp = modNode.imports.find((i) => i.localName === objName);
        if (imp && imp.sourcePath && !imp.isExternal) {
          const targetNode = moduleGraph.nodes.get(imp.sourcePath);
          if (targetNode) {
            const exp = targetNode.exports.find((e) => e.exportedName === propName);
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
                    },
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
        const imp = modNode.imports.find((i) => i.localName === node.name);
        if (imp && imp.sourcePath && !imp.isExternal) {
          const targetNode = moduleGraph.nodes.get(imp.sourcePath);
          if (targetNode) {
            const exp = targetNode.exports.find(
              (e) => e.exportedName === imp.importedName || (imp.importedName !== 'default' && e.exportedName === '*')
            );
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
                    },
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
