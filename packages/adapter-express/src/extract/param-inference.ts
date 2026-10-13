import _traverse, { type Binding, type TraverseOptions } from '@babel/traverse';
import type { File, Node } from '@babel/types';
import type { ParamDefinition } from '@mantis/core';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

interface RawAccess {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  line: number;
  column?: number;
  snippet?: string;
}

export function inferParamsFromHandler(
  fnNode: Node,
  fnAst: File,
  handlerFilePathForProvenance: string,
  handlerCode: string
): ParamDefinition[] {
  const fnParams =
    fnNode.type === 'FunctionDeclaration' ||
    fnNode.type === 'FunctionExpression' ||
    fnNode.type === 'ArrowFunctionExpression'
      ? fnNode.params
      : [];

  if (fnParams.length === 0) {
    return [];
  }

  const codeLines = handlerCode.split('\n');
  const getSnippet = (line: number): string | undefined => codeLines[line - 1]?.trim();

  const accesses: RawAccess[] = [];
  const firstParam = fnParams[0];
  if (!firstParam) return [];

  traverse(fnAst, {
    Function(fnPath) {
      if (fnPath.node !== fnNode) return;

      const aliasMap = new Map<Binding, 'path' | 'query' | 'header' | 'body'>();

      // Check if firstParam is an ObjectPattern directly
      if (firstParam.type === 'ObjectPattern') {
        for (const prop of firstParam.properties) {
          if (prop.type === 'ObjectProperty' && !prop.computed) {
            const locName = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'StringLiteral' ? prop.key.value : null);
            let loc: 'path' | 'query' | 'header' | 'body' | null = null;
            if (locName === 'params') loc = 'path';
            else if (locName === 'query') loc = 'query';
            else if (locName === 'body') loc = 'body';
            else if (locName === 'headers') loc = 'header';

            if (loc) {
              if (prop.value.type === 'Identifier') {
                const b = fnPath.scope.getBinding(prop.value.name);
                if (b) aliasMap.set(b, loc);
              } else if (prop.value.type === 'ObjectPattern') {
                for (const sub of prop.value.properties) {
                  if (sub.type === 'ObjectProperty' && !sub.computed) {
                    const name = sub.key.type === 'Identifier' ? sub.key.name : (sub.key.type === 'StringLiteral' ? sub.key.value : null);
                    if (name) {
                      const line = sub.loc?.start.line ?? fnNode.loc?.start.line ?? 1;
                      accesses.push({
                        name,
                        in: loc,
                        line,
                        column: sub.loc?.start.column,
                        snippet: getSnippet(line),
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }

      const reqParamBindingNode = firstParam.type === 'Identifier' ? firstParam : null;

      fnPath.traverse({
        VariableDeclarator(vPath) {
          const init = vPath.node.init;
          if (!init) return;

          // 1. const body = req.body; or const { a, b: c } = req.body;
          if (init.type === 'MemberExpression') {
            let innerProp: string | null = null;
            let isReq = false;

            if (init.object.type === 'Identifier' && reqParamBindingNode) {
              const b = vPath.scope.getBinding(init.object.name);
              if (b?.identifier === reqParamBindingNode) {
                isReq = true;
              }
            }

            if (isReq) {
              if (!init.computed && init.property.type === 'Identifier') {
                innerProp = init.property.name;
              } else if (init.computed && init.property.type === 'StringLiteral') {
                innerProp = init.property.value;
              }

              let loc: 'path' | 'query' | 'header' | 'body' | null = null;
              if (innerProp === 'params') loc = 'path';
              else if (innerProp === 'query') loc = 'query';
              else if (innerProp === 'body') loc = 'body';
              else if (innerProp === 'headers') loc = 'header';

              if (loc) {
                if (vPath.node.id.type === 'Identifier') {
                  const b = vPath.scope.getBinding(vPath.node.id.name);
                  if (b) aliasMap.set(b, loc);
                } else if (vPath.node.id.type === 'ObjectPattern') {
                  for (const prop of vPath.node.id.properties) {
                    if (prop.type === 'ObjectProperty' && !prop.computed) {
                      const name = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'StringLiteral' ? prop.key.value : null);
                      if (name) {
                        const line = prop.loc?.start.line ?? vPath.node.loc?.start.line ?? 1;
                        accesses.push({
                          name,
                          in: loc,
                          line,
                          column: prop.loc?.start.column,
                          snippet: getSnippet(line),
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          // 2. const { body, query } = req; or const { body: { author } } = req;
          if (init.type === 'Identifier' && reqParamBindingNode) {
            const b = vPath.scope.getBinding(init.name);
            if (b?.identifier === reqParamBindingNode && vPath.node.id.type === 'ObjectPattern') {
              for (const prop of vPath.node.id.properties) {
                if (prop.type === 'ObjectProperty' && !prop.computed) {
                  const locPropName = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'StringLiteral' ? prop.key.value : null);
                  let loc: 'path' | 'query' | 'header' | 'body' | null = null;
                  if (locPropName === 'params') loc = 'path';
                  else if (locPropName === 'query') loc = 'query';
                  else if (locPropName === 'body') loc = 'body';
                  else if (locPropName === 'headers') loc = 'header';

                  if (loc) {
                    if (prop.value.type === 'Identifier') {
                      const aliasB = vPath.scope.getBinding(prop.value.name);
                      if (aliasB) aliasMap.set(aliasB, loc);
                    } else if (prop.value.type === 'ObjectPattern') {
                      for (const sub of prop.value.properties) {
                        if (sub.type === 'ObjectProperty' && !sub.computed) {
                          const name = sub.key.type === 'Identifier' ? sub.key.name : (sub.key.type === 'StringLiteral' ? sub.key.value : null);
                          if (name) {
                            const line = sub.loc?.start.line ?? vPath.node.loc?.start.line ?? 1;
                            accesses.push({
                              name,
                              in: loc,
                              line,
                              column: sub.loc?.start.column,
                              snippet: getSnippet(line),
                            });
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          // 3. const { title } = body; where body is an alias in aliasMap
          if (init.type === 'Identifier') {
            const b = vPath.scope.getBinding(init.name);
            if (b && aliasMap.has(b) && vPath.node.id.type === 'ObjectPattern') {
              const loc = aliasMap.get(b)!;
              for (const prop of vPath.node.id.properties) {
                if (prop.type === 'ObjectProperty' && !prop.computed) {
                  const name = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'StringLiteral' ? prop.key.value : null);
                  if (name) {
                    const line = prop.loc?.start.line ?? vPath.node.loc?.start.line ?? 1;
                    accesses.push({
                      name,
                      in: loc,
                      line,
                      column: prop.loc?.start.column,
                      snippet: getSnippet(line),
                    });
                  }
                }
              }
            }
          }
        },

        MemberExpression(mPath) {
          const outer = mPath.node;

          // Form A: Direct member access on req: req.query.search or req['query']['search']
          if (outer.object.type === 'MemberExpression') {
            const inner = outer.object;
            let isReq = false;
            if (inner.object.type === 'Identifier' && reqParamBindingNode) {
              const b = mPath.scope.getBinding(inner.object.name);
              if (b?.identifier === reqParamBindingNode) {
                isReq = true;
              }
            }

            if (isReq) {
              const innerProp =
                !inner.computed && inner.property.type === 'Identifier'
                  ? inner.property.name
                  : inner.computed && inner.property.type === 'StringLiteral'
                    ? inner.property.value
                    : null;

              let loc: 'path' | 'query' | 'header' | 'body' | null = null;
              if (innerProp === 'params') loc = 'path';
              else if (innerProp === 'query') loc = 'query';
              else if (innerProp === 'body') loc = 'body';
              else if (innerProp === 'headers') loc = 'header';

              if (loc) {
                const name =
                  !outer.computed && outer.property.type === 'Identifier'
                    ? outer.property.name
                    : outer.computed && outer.property.type === 'StringLiteral'
                      ? outer.property.value
                      : null;

                if (name) {
                  const line = outer.loc?.start.line ?? 1;
                  accesses.push({
                    name,
                    in: loc,
                    line,
                    column: outer.loc?.start.column,
                    snippet: getSnippet(line),
                  });
                }
              }
            }
          }

          // Form B: Member access on an alias: body.email or body['email']
          if (outer.object.type === 'Identifier') {
            const b = mPath.scope.getBinding(outer.object.name);
            if (b && aliasMap.has(b)) {
              const loc = aliasMap.get(b)!;
              const name =
                !outer.computed && outer.property.type === 'Identifier'
                  ? outer.property.name
                  : outer.computed && outer.property.type === 'StringLiteral'
                    ? outer.property.value
                    : null;

              if (name) {
                const line = outer.loc?.start.line ?? 1;
                accesses.push({
                  name,
                  in: loc,
                  line,
                  column: outer.loc?.start.column,
                  snippet: getSnippet(line),
                });
              }
            }
          }
        },
      });
    },
  });

  // Sort by line, then column to preserve first access
  accesses.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

  // Deduplicate by location and name
  const seen = new Set<string>();
  const deduped: RawAccess[] = [];
  for (const acc of accesses) {
    const key = `${acc.in}:${acc.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(acc);
    }
  }

  return deduped.map((acc) => ({
    name: acc.name,
    in: acc.in,
    required: 'unknown' as const,
    type: 'unknown',
    provenance: {
      kind: 'inferred' as const,
      filePath: handlerFilePathForProvenance,
      line: acc.line,
      ...(acc.snippet ? { snippet: acc.snippet } : {}),
    },
  }));
}

export function mergeAndSortParams(
  routePathParams: ParamDefinition[],
  inferredParams: ParamDefinition[]
): ParamDefinition[] {
  const LOCATION_ORDER: Record<string, number> = {
    path: 1,
    query: 2,
    header: 3,
    body: 4,
    cookie: 5,
    unknown: 6,
  };

  const existingPathParams = new Set(routePathParams.map((p) => p.name));
  const result: ParamDefinition[] = [...routePathParams];

  for (const inf of inferredParams) {
    if (inf.in === 'path' && existingPathParams.has(inf.name)) {
      continue;
    }
    result.push(inf);
  }

  result.sort((a, b) => {
    const orderA = LOCATION_ORDER[a.in] ?? 99;
    const orderB = LOCATION_ORDER[b.in] ?? 99;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}
