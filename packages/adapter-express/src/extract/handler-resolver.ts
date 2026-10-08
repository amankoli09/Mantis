import _traverse, { type Scope, type TraverseOptions } from '@babel/traverse';
import type { File, Node } from '@babel/types';
import type { ModuleGraph } from '../module-graph.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

export interface ResolvedHandler {
  resolved: boolean;
  fnNode?: Node;
  fnAst?: File;
  handlerFile?: string;
  handlerFilePathForProvenance?: string;
  handlerCode?: string;
  handlerExprString?: string;
  line?: number;
  column?: number;
}

export function findHandler(
  candidate: Node | undefined,
  scope: Scope,
  ast: File,
  relFile: string,
  filePathForProvenance: string,
  code: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): ResolvedHandler {
  if (!candidate) {
    return { resolved: false, handlerExprString: '<none>' };
  }

  // 1. Inline function expression / arrow function expression
  if (candidate.type === 'FunctionExpression' || candidate.type === 'ArrowFunctionExpression') {
    return {
      resolved: true,
      fnNode: candidate,
      fnAst: ast,
      handlerFile: relFile,
      handlerFilePathForProvenance: filePathForProvenance,
      handlerCode: code,
    };
  }

  // 2. Identifier: local function or imported identifier
  if (candidate.type === 'Identifier') {
    const idName = candidate.name;

    // Check local binding in scope
    const binding = scope.getBinding(idName);
    if (binding) {
      if (binding.path.node.type === 'FunctionDeclaration') {
        return {
          resolved: true,
          fnNode: binding.path.node,
          fnAst: ast,
          handlerFile: relFile,
          handlerFilePathForProvenance: filePathForProvenance,
          handlerCode: code,
        };
      }
      if (binding.path.node.type === 'VariableDeclarator' && binding.path.node.init) {
        const init = binding.path.node.init;
        if (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression') {
          return {
            resolved: true,
            fnNode: init,
            fnAst: ast,
            handlerFile: relFile,
            handlerFilePathForProvenance: filePathForProvenance,
            handlerCode: code,
          };
        }
      }
    }

    // Check 1-hop import via moduleGraph and astCache
    if (moduleGraph && astCache) {
      const modNode = moduleGraph.nodes.get(relFile);
      if (modNode) {
        const imp = modNode.imports.find((i) => i.localName === idName);
        if (imp && imp.sourcePath && !imp.isExternal) {
          const targetEntry = astCache.get(imp.sourcePath);
          if (targetEntry) {
            let targetProvenance = imp.sourcePath;
            if (filePathForProvenance.endsWith(relFile)) {
              const rootPrefix = filePathForProvenance.slice(0, filePathForProvenance.length - relFile.length);
              targetProvenance = rootPrefix + imp.sourcePath;
            }

            let foundFn: Node | undefined;
            traverse(targetEntry.ast, {
              enter(p) {
                if (foundFn) return;

                // ESM: Named export
                if (p.node.type === 'ExportNamedDeclaration') {
                  if (p.node.declaration) {
                    if (
                      p.node.declaration.type === 'FunctionDeclaration' &&
                      p.node.declaration.id?.name === imp.importedName
                    ) {
                      foundFn = p.node.declaration;
                      p.stop();
                      return;
                    }
                    if (p.node.declaration.type === 'VariableDeclaration') {
                      for (const decl of p.node.declaration.declarations) {
                        if (
                          decl.id.type === 'Identifier' &&
                          decl.id.name === imp.importedName &&
                          decl.init &&
                          (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')
                        ) {
                          foundFn = decl.init;
                          p.stop();
                          return;
                        }
                      }
                    }
                  }
                  if (p.node.specifiers) {
                    for (const spec of p.node.specifiers) {
                      if (spec.type === 'ExportSpecifier') {
                        const exportedName = spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value;
                        if (exportedName === imp.importedName) {
                          const localBinding = p.scope.getBinding(spec.local.name);
                          if (localBinding) {
                            if (localBinding.path.node.type === 'FunctionDeclaration') {
                              foundFn = localBinding.path.node;
                              p.stop();
                              return;
                            }
                            if (
                              localBinding.path.node.type === 'VariableDeclarator' &&
                              localBinding.path.node.init &&
                              (localBinding.path.node.init.type === 'FunctionExpression' || localBinding.path.node.init.type === 'ArrowFunctionExpression')
                            ) {
                              foundFn = localBinding.path.node.init;
                              p.stop();
                              return;
                            }
                          }
                        }
                      }
                    }
                  }
                }

                // ESM: Default export
                if (imp.importedName === 'default' && p.node.type === 'ExportDefaultDeclaration') {
                  const decl = p.node.declaration;
                  if (decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression' || decl.type === 'ArrowFunctionExpression') {
                    foundFn = decl;
                    p.stop();
                    return;
                  }
                  if (decl.type === 'Identifier') {
                    const b = p.scope.getBinding(decl.name);
                    if (b?.path.node.type === 'FunctionDeclaration') {
                      foundFn = b.path.node;
                      p.stop();
                      return;
                    }
                    if (
                      b?.path.node.type === 'VariableDeclarator' &&
                      b.path.node.init &&
                      (b.path.node.init.type === 'FunctionExpression' || b.path.node.init.type === 'ArrowFunctionExpression')
                    ) {
                      foundFn = b.path.node.init;
                      p.stop();
                      return;
                    }
                  }
                }

                // CJS: Assignment expressions
                if (p.node.type === 'AssignmentExpression') {
                  const left = p.node.left;
                  if (left.type === 'MemberExpression') {
                    if (
                      left.object.type === 'Identifier' &&
                      left.object.name === 'exports' &&
                      left.property.type === 'Identifier' &&
                      left.property.name === imp.importedName
                    ) {
                      if (p.node.right.type === 'FunctionExpression' || p.node.right.type === 'ArrowFunctionExpression') {
                        foundFn = p.node.right;
                        p.stop();
                        return;
                      }
                    }
                    if (
                      left.object.type === 'Identifier' &&
                      left.object.name === 'module' &&
                      left.property.type === 'Identifier' &&
                      left.property.name === 'exports'
                    ) {
                      if (
                        imp.importedName === 'default' &&
                        (p.node.right.type === 'FunctionExpression' || p.node.right.type === 'ArrowFunctionExpression')
                      ) {
                        foundFn = p.node.right;
                        p.stop();
                        return;
                      }
                      if (p.node.right.type === 'ObjectExpression') {
                        for (const prop of p.node.right.properties) {
                          if (prop.type === 'ObjectProperty') {
                            const propName = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'StringLiteral' ? prop.key.value : null);
                            if (propName === imp.importedName) {
                              if (prop.value.type === 'FunctionExpression' || prop.value.type === 'ArrowFunctionExpression') {
                                foundFn = prop.value;
                                p.stop();
                                return;
                              }
                              if (prop.value.type === 'Identifier') {
                                const b = p.scope.getBinding(prop.value.name);
                                if (b?.path.node.type === 'FunctionDeclaration') {
                                  foundFn = b.path.node;
                                  p.stop();
                                  return;
                                }
                                if (
                                  b?.path.node.type === 'VariableDeclarator' &&
                                  b.path.node.init &&
                                  (b.path.node.init.type === 'FunctionExpression' || b.path.node.init.type === 'ArrowFunctionExpression')
                                ) {
                                  foundFn = b.path.node.init;
                                  p.stop();
                                  return;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
            });

            if (foundFn) {
              return {
                resolved: true,
                fnNode: foundFn,
                fnAst: targetEntry.ast,
                handlerFile: imp.sourcePath,
                handlerFilePathForProvenance: targetProvenance,
                handlerCode: targetEntry.code,
              };
            }
          }
        }
      }
    }
  }

  // Anything else is unresolvable
  const handlerExprString =
    typeof candidate.start === 'number' && typeof candidate.end === 'number'
      ? code.slice(candidate.start, candidate.end)
      : candidate.type === 'Identifier'
        ? candidate.name
        : 'handler';

  return {
    resolved: false,
    handlerExprString,
    line: candidate.loc?.start.line,
    column: candidate.loc?.start.column,
  };
}
