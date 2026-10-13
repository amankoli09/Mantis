import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import _traverse, { type NodePath, type TraverseOptions } from '@babel/traverse';
import type {
  File,
  Node,
  VariableDeclarator,
  CallExpression,
  AssignmentExpression,
  ImportDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ExportAllDeclaration,
} from '@babel/types';
import {
  createDiagnostic,
  compareStrings,
  type Diagnostic,
} from '@mantis/core';
import { type FileSystem, nodeFileSystem } from './fs.js';
import { walkProjectFiles } from './file-walker.js';
import { parseFile } from './parser.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

export interface ModuleImport {
  localName: string;
  importedName: string | 'default' | '*';
  specifier: string;
  sourcePath: string | null;
  isExternal: boolean;
  line: number;
}

export interface ModuleExport {
  exportedName: string | 'default';
  localName: string | null;
  line: number;
}

export interface ModuleNode {
  filePath: string;
  imports: ModuleImport[];
  exports: ModuleExport[];
}

export interface ModuleGraph {
  nodes: Map<string, ModuleNode>;
  diagnostics: Diagnostic[];
}

const JS_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'] as const;

/**
 * Normalizes a file path to use POSIX-style forward slashes.
 */
function normalizeSlashes(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Checks if a candidate path is an existing regular file.
 */
function isFileCandidate(absPath: string, fileSet?: Set<string>, projectRoot?: string): boolean {
  if (fileSet && projectRoot) {
    const rel = normalizeSlashes(path.relative(projectRoot, absPath));
    if (fileSet.has(rel)) {
      return true;
    }
  }

  try {
    if (existsSync(absPath)) {
      const stat = statSync(absPath);
      return stat.isFile();
    }
  } catch {
    // Ignore FS errors
  }
  return false;
}

export interface ResolveSpecifierResult {
  isExternal: boolean;
  sourcePath: string | null;
}

/**
 * Resolves an import/require module specifier relative to the importing file.
 *
 * Rules:
 * - Bare specifiers (e.g. 'express', 'node:path') are external (not followed).
 * - Relative specifiers ('./...', '../...') are resolved within the project root.
 * - Probing order: exact path -> extension guessing (.js, .cjs, .mjs) -> directory index (index.js, index.cjs, index.mjs).
 * - Never resolves outside the project root.
 */
export function resolveSpecifier(
  specifier: string,
  importerFilePath: string,
  projectRoot: string,
  fileSet?: Set<string>
): ResolveSpecifierResult {
  const isBareSpecifier = !specifier.startsWith('.') && !specifier.startsWith('/');
  if (isBareSpecifier) {
    return { isExternal: true, sourcePath: null };
  }

  const absImporterDir = path.dirname(path.resolve(projectRoot, importerFilePath));
  const absCandidateBase = specifier.startsWith('/')
    ? path.resolve(projectRoot, '.' + specifier)
    : path.resolve(absImporterDir, specifier);

  const absProjectRoot = path.resolve(projectRoot);

  // Security & boundary check: candidate must be within project root
  const relFromRoot = path.relative(absProjectRoot, absCandidateBase);
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    return { isExternal: false, sourcePath: null };
  }

  // 1. Direct file check
  if (isFileCandidate(absCandidateBase, fileSet, absProjectRoot)) {
    return {
      isExternal: false,
      sourcePath: normalizeSlashes(path.relative(absProjectRoot, absCandidateBase)),
    };
  }

  // 2. Extension guessing: cand.js, cand.cjs, cand.mjs
  for (const ext of JS_EXTENSIONS) {
    const candidateWithExt = `${absCandidateBase}${ext}`;
    if (isFileCandidate(candidateWithExt, fileSet, absProjectRoot)) {
      return {
        isExternal: false,
        sourcePath: normalizeSlashes(path.relative(absProjectRoot, candidateWithExt)),
      };
    }
  }

  // 3. Directory index resolution: cand/index.js, cand/index.cjs, cand/index.mjs
  for (const ext of JS_EXTENSIONS) {
    const candidateIndex = path.join(absCandidateBase, `index${ext}`);
    if (isFileCandidate(candidateIndex, fileSet, absProjectRoot)) {
      return {
        isExternal: false,
        sourcePath: normalizeSlashes(path.relative(absProjectRoot, candidateIndex)),
      };
    }
  }

  return { isExternal: false, sourcePath: null };
}

/**
 * Extracts import and export declarations from a single file's AST.
 */
export function extractModuleInfo(
  ast: File,
  filePath: string,
  projectRoot: string,
  fileSet?: Set<string>
): { imports: ModuleImport[]; exports: ModuleExport[]; diagnostics: Diagnostic[] } {
  const imports: ModuleImport[] = [];
  const exports: ModuleExport[] = [];
  const diagnostics: Diagnostic[] = [];

  // Set of require CallExpression nodes already handled in VariableDeclarator
  const handledRequireCalls = new Set<Node>();

  // 1. Traverse Imports & Requires
  traverse(ast, {
    // ESM Imports: import x from './a', import { y } from './a', import * as x from './a'
    ImportDeclaration(pathNode: NodePath<ImportDeclaration>) {
      const specifier = pathNode.node.source.value;
      const line = pathNode.node.loc?.start.line ?? 1;
      const column = pathNode.node.loc?.start.column ?? 0;

      const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);

      if (!isExternal && sourcePath === null) {
        diagnostics.push(
          createDiagnostic(
            'MT-R001',
            { importPath: specifier, sourceFile: filePath },
            { file: filePath, line, column }
          )
        );
      }

      if (pathNode.node.specifiers.length === 0) {
        // Side-effect import: import './a'
        imports.push({
          localName: '',
          importedName: '*',
          specifier,
          sourcePath,
          isExternal,
          line,
        });
        return;
      }

      for (const spec of pathNode.node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') {
          imports.push({
            localName: spec.local.name,
            importedName: 'default',
            specifier,
            sourcePath,
            isExternal,
            line: spec.loc?.start.line ?? line,
          });
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          imports.push({
            localName: spec.local.name,
            importedName: '*',
            specifier,
            sourcePath,
            isExternal,
            line: spec.loc?.start.line ?? line,
          });
        } else if (spec.type === 'ImportSpecifier') {
          const importedName =
            spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
          imports.push({
            localName: spec.local.name,
            importedName,
            specifier,
            sourcePath,
            isExternal,
            line: spec.loc?.start.line ?? line,
          });
        }
      }
    },

    // CJS Declarations: const x = require('./a'), const { y } = require('./a')
    VariableDeclarator(pathNode: NodePath<VariableDeclarator>) {
      const init = pathNode.node.init;
      if (!init) return;

      let requireCall: CallExpression | null = null;
      let directMemberProperty: string | null = null;

      if (
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require'
      ) {
        requireCall = init;
      } else if (
        init.type === 'MemberExpression' &&
        init.object.type === 'CallExpression' &&
        init.object.callee.type === 'Identifier' &&
        init.object.callee.name === 'require'
      ) {
        requireCall = init.object;
        if (init.property.type === 'Identifier') {
          directMemberProperty = init.property.name;
        } else if (init.property.type === 'StringLiteral') {
          directMemberProperty = init.property.value;
        }
      }

      if (!requireCall) return;
      handledRequireCalls.add(requireCall);

      const line = pathNode.node.loc?.start.line ?? 1;
      const column = pathNode.node.loc?.start.column ?? 0;
      const firstArg = requireCall.arguments[0];

      if (!firstArg || firstArg.type !== 'StringLiteral') {
        // Dynamic require(variable)
        diagnostics.push(
          createDiagnostic(
            'MT-R001',
            { importPath: '<dynamic>', sourceFile: filePath },
            { file: filePath, line, column }
          )
        );

        if (pathNode.node.id.type === 'Identifier') {
          imports.push({
            localName: pathNode.node.id.name,
            importedName: directMemberProperty ?? 'default',
            specifier: '<dynamic>',
            sourcePath: null,
            isExternal: false,
            line,
          });
        }
        return;
      }

      const specifier = firstArg.value;
      const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);

      if (!isExternal && sourcePath === null) {
        diagnostics.push(
          createDiagnostic(
            'MT-R001',
            { importPath: specifier, sourceFile: filePath },
            { file: filePath, line, column }
          )
        );
      }

      if (pathNode.node.id.type === 'Identifier') {
        imports.push({
          localName: pathNode.node.id.name,
          importedName: directMemberProperty ?? 'default',
          specifier,
          sourcePath,
          isExternal,
          line,
        });
      } else if (pathNode.node.id.type === 'ObjectPattern') {
        for (const prop of pathNode.node.id.properties) {
          if (prop.type === 'ObjectProperty') {
            const propLine = prop.loc?.start.line ?? line;
            const importedName =
              prop.key.type === 'Identifier'
                ? prop.key.name
                : prop.key.type === 'StringLiteral'
                  ? prop.key.value
                  : '<computed>';
            const localName =
              prop.value.type === 'Identifier' ? prop.value.name : importedName;

            imports.push({
              localName,
              importedName,
              specifier,
              sourcePath,
              isExternal,
              line: propLine,
            });
          }
        }
      }
    },

    // Catch-all for standalone / unhandled require() calls
    CallExpression(pathNode: NodePath<CallExpression>) {
      const node = pathNode.node;
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
      if (handledRequireCalls.has(node)) return;

      const line = node.loc?.start.line ?? 1;
      const column = node.loc?.start.column ?? 0;
      const firstArg = node.arguments[0];

      if (!firstArg || firstArg.type !== 'StringLiteral') {
        diagnostics.push(
          createDiagnostic(
            'MT-R001',
            { importPath: '<dynamic>', sourceFile: filePath },
            { file: filePath, line, column }
          )
        );
        return;
      }

      const specifier = firstArg.value;
      const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);

      if (!isExternal && sourcePath === null) {
        diagnostics.push(
          createDiagnostic(
            'MT-R001',
            { importPath: specifier, sourceFile: filePath },
            { file: filePath, line, column }
          )
        );
      }

      imports.push({
        localName: '',
        importedName: 'default',
        specifier,
        sourcePath,
        isExternal,
        line,
      });
    },
  });

  // 2. Traverse Exports
  traverse(ast, {
    // ESM: export default x
    ExportDefaultDeclaration(pathNode: NodePath<ExportDefaultDeclaration>) {
      const decl = pathNode.node.declaration;
      const line = pathNode.node.loc?.start.line ?? 1;
      let localName: string | null = null;

      if (decl.type === 'Identifier') {
        localName = decl.name;
      } else if (
        (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') &&
        decl.id
      ) {
        localName = decl.id.name;
      }

      exports.push({
        exportedName: 'default',
        localName,
        line,
      });
    },

    // ESM: export { a, b }, export { a } from './b', export const a = 1, export function f() {}
    ExportNamedDeclaration(pathNode: NodePath<ExportNamedDeclaration>) {
      const line = pathNode.node.loc?.start.line ?? 1;
      const column = pathNode.node.loc?.start.column ?? 0;
      const node = pathNode.node;

      // export { a, b as customB } from './mod'
      if (node.source && node.source.type === 'StringLiteral') {
        const specifier = node.source.value;
        const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);

        if (!isExternal && sourcePath === null) {
          diagnostics.push(
            createDiagnostic(
              'MT-R001',
              { importPath: specifier, sourceFile: filePath },
              { file: filePath, line, column }
            )
          );
        }

        if (node.specifiers && node.specifiers.length > 0) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ExportSpecifier') {
              const exportedName =
                spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value;
              const sourceImportedName = spec.local.name;
              const bindingName = `__reexport_${exportedName}`;

              // Record corresponding import and export for re-export
              imports.push({
                localName: bindingName,
                importedName: sourceImportedName,
                specifier,
                sourcePath,
                isExternal,
                line: spec.loc?.start.line ?? line,
              });

              exports.push({
                exportedName,
                localName: bindingName,
                line: spec.loc?.start.line ?? line,
              });
            }
          }
        }
        return;
      }

      // export { a, b as customB }
      if (node.specifiers && node.specifiers.length > 0) {
        for (const spec of node.specifiers) {
          if (spec.type === 'ExportSpecifier') {
            const exportedName =
              spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value;
            const localName = spec.local.name;
            exports.push({
              exportedName,
              localName,
              line: spec.loc?.start.line ?? line,
            });
          }
        }
      }

      // export const a = 1, export function foo() {}
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            const declLine = d.loc?.start.line ?? line;
            if (d.id.type === 'Identifier') {
              exports.push({
                exportedName: d.id.name,
                localName: d.id.name,
                line: declLine,
              });
            } else if (d.id.type === 'ObjectPattern') {
              for (const prop of d.id.properties) {
                if (prop.type === 'ObjectProperty') {
                  const propName =
                    prop.key.type === 'Identifier'
                      ? prop.key.name
                      : prop.key.type === 'StringLiteral'
                        ? prop.key.value
                        : '<computed>';
                  const localPropName =
                    prop.value.type === 'Identifier' ? prop.value.name : propName;
                  exports.push({
                    exportedName: propName,
                    localName: localPropName,
                    line: prop.loc?.start.line ?? declLine,
                  });
                }
              }
            }
          }
        } else if (
          (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') &&
          decl.id
        ) {
          exports.push({
            exportedName: decl.id.name,
            localName: decl.id.name,
            line: decl.loc?.start.line ?? line,
          });
        }
      }
    },

    // ESM: export * from './b'
    ExportAllDeclaration(pathNode: NodePath<ExportAllDeclaration>) {
      const node = pathNode.node;
      const line = node.loc?.start.line ?? 1;
      const column = node.loc?.start.column ?? 0;
      const specifier = node.source.value;

      const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);

      if (!isExternal && sourcePath === null) {
        diagnostics.push(
          createDiagnostic(
            'MT-R001',
            { importPath: specifier, sourceFile: filePath },
            { file: filePath, line, column }
          )
        );
      }

      imports.push({
        localName: '*',
        importedName: '*',
        specifier,
        sourcePath,
        isExternal,
        line,
      });

      exports.push({
        exportedName: '*',
        localName: '*',
        line,
      });
    },

    // CJS: module.exports = x, module.exports = require('./router'), module.exports = { a, b }, exports.a = x
    AssignmentExpression(pathNode: NodePath<AssignmentExpression>) {
      const { left, right } = pathNode.node;
      const line = pathNode.node.loc?.start.line ?? 1;
      const column = pathNode.node.loc?.start.column ?? 0;

      // module.exports = ...
      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        left.object.name === 'module' &&
        left.property.type === 'Identifier' &&
        left.property.name === 'exports'
      ) {
        if (right.type === 'Identifier') {
          exports.push({
            exportedName: 'default',
            localName: right.name,
            line,
          });
        } else if (
          right.type === 'CallExpression' &&
          right.callee.type === 'Identifier' &&
          right.callee.name === 'require'
        ) {
          // module.exports = require('./router')
          handledRequireCalls.add(right);
          const firstArg = right.arguments[0];
          if (firstArg && firstArg.type === 'StringLiteral') {
            const specifier = firstArg.value;
            const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);
            if (!isExternal && sourcePath === null) {
              diagnostics.push(
                createDiagnostic(
                  'MT-R001',
                  { importPath: specifier, sourceFile: filePath },
                  { file: filePath, line, column }
                )
              );
            }
            imports.push({
              localName: '',
              importedName: 'default',
              specifier,
              sourcePath,
              isExternal,
              line,
            });
            exports.push({
              exportedName: 'default',
              localName: null,
              line,
            });
          }
        } else if (right.type === 'ObjectExpression') {
          for (const prop of right.properties) {
            if (prop.type === 'ObjectProperty') {
              const propLine = prop.loc?.start.line ?? line;
              const propName =
                prop.key.type === 'Identifier'
                  ? prop.key.name
                  : prop.key.type === 'StringLiteral'
                    ? prop.key.value
                    : '<computed>';
              if (
                prop.value.type === 'CallExpression' &&
                prop.value.callee.type === 'Identifier' &&
                prop.value.callee.name === 'require' &&
                prop.value.arguments[0]?.type === 'StringLiteral'
              ) {
                const specifier = prop.value.arguments[0].value;
                const { isExternal, sourcePath } = resolveSpecifier(specifier, filePath, projectRoot, fileSet);
                const bindingName = `__reexport_${propName}`;
                imports.push({
                  localName: bindingName,
                  importedName: 'default',
                  specifier,
                  sourcePath,
                  isExternal,
                  line: propLine,
                });
                exports.push({
                  exportedName: propName,
                  localName: bindingName,
                  line: propLine,
                });
              } else {
                const localName = prop.value.type === 'Identifier' ? prop.value.name : null;
                exports.push({
                  exportedName: propName,
                  localName,
                  line: propLine,
                });
              }
            }
          }
        } else if (
          (right.type === 'FunctionExpression' || right.type === 'ClassExpression') &&
          right.id
        ) {
          exports.push({
            exportedName: 'default',
            localName: right.id.name,
            line,
          });
        } else {
          exports.push({
            exportedName: 'default',
            localName: null,
            line,
          });
        }
        return;
      }

      // exports.a = x or module.exports.a = x
      let isNamedExport = false;
      let exportedName = '';

      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        left.object.name === 'exports'
      ) {
        isNamedExport = true;
        if (left.property.type === 'Identifier') {
          exportedName = left.property.name;
        } else if (left.property.type === 'StringLiteral') {
          exportedName = left.property.value;
        }
      } else if (
        left.type === 'MemberExpression' &&
        left.object.type === 'MemberExpression' &&
        left.object.object.type === 'Identifier' &&
        left.object.object.name === 'module' &&
        left.object.property.type === 'Identifier' &&
        left.object.property.name === 'exports'
      ) {
        isNamedExport = true;
        if (left.property.type === 'Identifier') {
          exportedName = left.property.name;
        } else if (left.property.type === 'StringLiteral') {
          exportedName = left.property.value;
        }
      }

      if (isNamedExport && exportedName) {
        const localName = right.type === 'Identifier' ? right.name : null;
        exports.push({
          exportedName,
          localName,
          line,
        });
      }
    },
  });

  // Sort imports and exports deterministically
  imports.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    const localCmp = compareStrings(a.localName, b.localName);
    if (localCmp !== 0) return localCmp;
    return compareStrings(a.specifier, b.specifier);
  });

  exports.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return compareStrings(a.exportedName, b.exportedName);
  });

  diagnostics.sort((a, b) => {
    const fileCmp = compareStrings(a.file ?? '', b.file ?? '');
    if (fileCmp !== 0) return fileCmp;
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    return compareStrings(a.code, b.code);
  });

  return { imports, exports, diagnostics };
}

/**
 * Builds the complete module dependency graph for a project.
 *
 * Scans all discovered JavaScript files, resolving imports/exports with deterministic ordering.
 */
export async function buildModuleGraph(
  projectRoot: string,
  providedFiles?: string[],
  fileSystem: FileSystem = nodeFileSystem
): Promise<ModuleGraph> {
  const resolvedRoot = path.resolve(projectRoot);

  const fileList = providedFiles ?? (await walkProjectFiles(resolvedRoot, {}, fileSystem)).files;
  const sortedFiles = [...fileList].map(normalizeSlashes).sort(compareStrings);
  const fileSet = new Set(sortedFiles);

  const nodes = new Map<string, ModuleNode>();
  const diagnostics: Diagnostic[] = [];

  for (const relFile of sortedFiles) {
    const fullPath = path.join(resolvedRoot, relFile);
    let code: string;
    try {
      code = await fileSystem.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    const parseResult = parseFile(code, relFile);
    if (parseResult.diagnostics.length > 0) {
      diagnostics.push(...parseResult.diagnostics);
    }

    if (parseResult.ast) {
      const moduleInfo = extractModuleInfo(parseResult.ast, relFile, resolvedRoot, fileSet);
      nodes.set(relFile, {
        filePath: relFile,
        imports: moduleInfo.imports,
        exports: moduleInfo.exports,
      });
      diagnostics.push(...moduleInfo.diagnostics);
    } else {
      nodes.set(relFile, {
        filePath: relFile,
        imports: [],
        exports: [],
      });
    }
  }

  // Sort diagnostics deterministically
  diagnostics.sort((a, b) => {
    const fileCmp = compareStrings(a.file ?? '', b.file ?? '');
    if (fileCmp !== 0) return fileCmp;
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    return compareStrings(a.code, b.code);
  });

  return { nodes, diagnostics };
}
