import _traverse, { type NodePath, type Binding, type TraverseOptions } from '@babel/traverse';
import type {
  File,
  Node,
  Identifier,
} from '@babel/types';
import {
  createDiagnostic,
  type AuthDefinition,
  type Diagnostic,
} from '@mantis/core';
import type { ModuleGraph, ModuleImport } from '../module-graph.js';
import type { ExtractedMiddleware, ExtractedRouter } from './types.js';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

const NON_AUTH_MIDDLEWARE_NAMES = new Set([
  'express.json',
  'express.urlencoded',
  'express.raw',
  'express.text',
  'express.static',
  'cors',
  'helmet',
  'morgan',
  'cookieParser',
  'bodyParser',
  'requestLogger',
  'logger',
  'compression',
  'responseTime',
]);

const AUTH_NAME_HEURISTIC_REGEX = /^(auth|authenticate|requireAuth|isAuthenticated|protect|verifyToken|ensureLoggedIn|jwt)$/i;

export function isAuthNameHeuristic(name: string): boolean {
  return AUTH_NAME_HEURISTIC_REGEX.test(name);
}

export function fileExportsRouter(
  targetRelFile: string,
  astCache?: Map<string, { ast: File; code: string }>
): boolean {
  if (!astCache) return false;
  const cached = astCache.get(targetRelFile);
  if (!cached) return false;
  let hasRouter = false;
  traverse(cached.ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'Router'
      ) {
        hasRouter = true;
        p.stop();
      } else if (callee.type === 'Identifier' && callee.name === 'Router') {
        hasRouter = true;
        p.stop();
      }
    },
  });
  return hasRouter;
}

export function isLikelyRouter(
  node: Node,
  scope: NodePath['scope'],
  expressRouterBindings: Map<Binding, ExtractedRouter>,
  relFile: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): boolean {
  if (node.type === 'Identifier') {
    const binding = scope.getBinding(node.name);
    if (binding && expressRouterBindings.has(binding)) {
      return true;
    }
    if (moduleGraph && astCache) {
      const nodeInfo = moduleGraph.nodes.get(relFile);
      const imp = nodeInfo?.imports.find((i: ModuleImport) => i.localName === node.name);
      if (imp?.sourcePath) {
        return fileExportsRouter(imp.sourcePath, astCache);
      }
    }
    return false;
  }

  if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
    if (moduleGraph && astCache) {
      const nodeInfo = moduleGraph.nodes.get(relFile);
      const imp = nodeInfo?.imports.find((i: ModuleImport) => i.localName === (node.object as Identifier).name);
      if (imp?.sourcePath) {
        return fileExportsRouter(imp.sourcePath, astCache);
      }
    }
    return false;
  }

  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments[0]?.type === 'StringLiteral'
  ) {
    if (moduleGraph && astCache) {
      const nodeInfo = moduleGraph.nodes.get(relFile);
      const specifier = node.arguments[0].value;
      const imp = nodeInfo?.imports.find((i: ModuleImport) => i.specifier === specifier);
      if (imp?.sourcePath) {
        return fileExportsRouter(imp.sourcePath, astCache);
      }
    }
  }

  return false;
}

export interface ResolveMiddlewareResult {
  middleware: ExtractedMiddleware;
  diagnostic?: Diagnostic;
}

/**
 * Resolves a middleware AST node (Identifier, CallExpression, MemberExpression) into an ExtractedMiddleware.
 * Resolves local functions and 1-hop imported functions across the module graph.
 */
export function resolveMiddleware(
  node: Node,
  scope: NodePath['scope'],
  filePathForProvenance: string,
  relFile: string,
  code: string,
  moduleGraph?: ModuleGraph,
  astCache?: Map<string, { ast: File; code: string }>
): ResolveMiddlewareResult {
  const line = node.loc?.start.line ?? 1;
  const column = node.loc?.start.column ?? 0;

  // 1. CallExpression: e.g. express.json(), cors(), helmet()
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    let name = '<unresolved>';

    if (callee.type === 'MemberExpression') {
      const objName = callee.object.type === 'Identifier' ? callee.object.name : '';
      const propName =
        callee.property.type === 'Identifier'
          ? callee.property.name
          : callee.property.type === 'StringLiteral'
            ? callee.property.value
            : '';
      name = objName && propName ? `${objName}.${propName}` : propName || '<unresolved>';
    } else if (callee.type === 'Identifier') {
      name = callee.name;
    }

    if (name === '<unresolved>') {
      return {
        middleware: {
          name: '<unresolved>',
          provenance: {
            kind: 'unresolved',
            filePath: filePathForProvenance,
            line,
            column,
          },
          resolved: false,
        },
        diagnostic: createDiagnostic(
          'MT-I002',
          { middlewareName: 'expression', reason: 'unresolved call expression' },
          { file: filePathForProvenance, line, column }
        ),
      };
    }

    return {
      middleware: {
        name,
        provenance: {
          kind: 'literal',
          filePath: filePathForProvenance,
          line,
          column,
        },
        resolved: true,
      },
    };
  }

  // 2. MemberExpression (not invoked): e.g. express.json
  if (node.type === 'MemberExpression') {
    const objName = node.object.type === 'Identifier' ? node.object.name : '';
    const propName =
      node.property.type === 'Identifier'
        ? node.property.name
        : node.property.type === 'StringLiteral'
          ? node.property.value
          : '';
    const name = objName && propName ? `${objName}.${propName}` : propName || '<unresolved>';

    return {
      middleware: {
        name,
        provenance: {
          kind: 'literal',
          filePath: filePathForProvenance,
          line,
          column,
        },
        resolved: true,
      },
    };
  }

  // 3. Identifier: e.g. requestLogger, sessionGuard, verifyBearerToken, dynamicMw
  if (node.type === 'Identifier') {
    const varName = node.name;
    const binding = scope.getBinding(varName);

    if (!binding) {
      // Unresolved identifier
      return {
        middleware: {
          name: '<unresolved>',
          provenance: {
            kind: 'unresolved',
            filePath: filePathForProvenance,
            line,
            column,
          },
          resolved: false,
        },
        diagnostic: createDiagnostic(
          'MT-I002',
          { middlewareName: varName, reason: 'unresolved identifier' },
          { file: filePathForProvenance, line, column }
        ),
      };
    }

    // Check if it is a local function declaration in the same file
    if (
      binding.path.isFunctionDeclaration() ||
      (binding.path.isVariableDeclarator() &&
        binding.path.node.init &&
        (binding.path.node.init.type === 'ArrowFunctionExpression' ||
          binding.path.node.init.type === 'FunctionExpression'))
    ) {
      const fnNode: Node = binding.path.isFunctionDeclaration()
        ? binding.path.node
        : binding.path.node.init!;
      const fnLine = fnNode.loc?.start.line ?? line;

      return {
        middleware: {
          name: varName,
          provenance: {
            kind: 'literal',
            filePath: filePathForProvenance,
            line,
            column,
          },
          resolved: true,
          fnNode,
          fnFilePath: filePathForProvenance,
          fnLine,
          fnCode: code,
        },
      };
    }

    // Check if it is imported from another project file (1-hop)
    if (moduleGraph && astCache) {
      const moduleNode = moduleGraph.nodes.get(relFile);
      if (moduleNode) {
        const matchingImport = moduleNode.imports.find((imp: ModuleImport) => imp.localName === varName);
        if (matchingImport && matchingImport.sourcePath) {
          const targetCached = astCache.get(matchingImport.sourcePath);
          if (targetCached) {
            const { ast: targetAst, code: targetCode } = targetCached;
            const importedName = matchingImport.importedName;

            let targetFnNode: Node | null = null;
            let targetLine: number | null = null;

            // Search target file AST for exported function
            traverse(targetAst, {
              FunctionDeclaration(p) {
                if (
                  (importedName === 'default' && p.node.id?.name === 'default') ||
                  p.node.id?.name === importedName
                ) {
                  targetFnNode = p.node;
                  targetLine = p.node.loc?.start.line ?? 1;
                }
              },
              VariableDeclarator(p) {
                if (p.node.id.type === 'Identifier' && p.node.id.name === importedName) {
                  if (
                    p.node.init &&
                    (p.node.init.type === 'ArrowFunctionExpression' ||
                      p.node.init.type === 'FunctionExpression')
                  ) {
                    targetFnNode = p.node.init;
                    targetLine = p.node.loc?.start.line ?? 1;
                  }
                }
              },
            });

            let targetProvenance = matchingImport.sourcePath;
            if (filePathForProvenance.endsWith(relFile)) {
              const rootPrefix = filePathForProvenance.slice(0, filePathForProvenance.length - relFile.length);
              targetProvenance = rootPrefix + matchingImport.sourcePath;
            }

            if (targetFnNode && targetLine !== null) {
              return {
                middleware: {
                  name: varName,
                  provenance: {
                    kind: 'literal',
                    filePath: filePathForProvenance,
                    line,
                    column,
                  },
                  resolved: true,
                  fnNode: targetFnNode,
                  fnFilePath: targetProvenance,
                  fnLine: targetLine,
                  fnCode: targetCode,
                },
              };
            }
          }
        }
      }
    }

    // Check if binding init is dynamic require or unresolvable
    if (binding.path.isVariableDeclarator()) {
      const init = binding.path.node.init;
      if (init && init.type === 'CallExpression') {
        const callee = init.callee;
        if (callee.type === 'Identifier' && callee.name === 'require') {
          // Dynamic or unresolvable require
          return {
            middleware: {
              name: '<unresolved>',
              provenance: {
                kind: 'unresolved',
                filePath: filePathForProvenance,
                line,
                column,
              },
              resolved: false,
            },
            diagnostic: createDiagnostic(
              'MT-I002',
              { middlewareName: varName, reason: 'unresolved identifier' },
              { file: filePathForProvenance, line, column }
            ),
          };
        }
      }
    }

    // Fallback: identifier without inspected body
    return {
      middleware: {
        name: varName,
        provenance: {
          kind: 'literal',
          filePath: filePathForProvenance,
          line,
          column,
        },
        resolved: true,
      },
    };
  }

  // Other expressions
  return {
    middleware: {
      name: '<unresolved>',
      provenance: {
        kind: 'unresolved',
        filePath: filePathForProvenance,
        line,
        column,
      },
      resolved: false,
    },
    diagnostic: createDiagnostic(
      'MT-I002',
      { middlewareName: 'expression', reason: 'unresolved expression' },
      { file: filePathForProvenance, line, column }
    ),
  };
}

/**
 * Inspects a resolved middleware's function AST and name to detect positive authentication evidence.
 */
export function inspectMiddlewareAuth(mw: ExtractedMiddleware): {
  type: 'bearer' | 'apiKey' | 'cookie' | 'custom' | null;
  evidence?: { filePath: string; line: number; signal: string };
} {
  const mwName = mw.name;
  if (mwName === '<unresolved>' || NON_AUTH_MIDDLEWARE_NAMES.has(mwName)) {
    return { type: null };
  }

  const fnNode = mw.fnNode;
  const fnFilePath = mw.fnFilePath ?? mw.provenance.filePath;
  const fnLine = mw.fnLine ?? mw.provenance.line;

  // 1. Inspect function body AST if available
  if (fnNode) {
    let hasBearerHeader = false;
    let hasApiKeyHeader = false;
    let hasSessionCheck = false;
    let hasJwtVerify = false;

    traverse(fnNode, {
      noScope: true,
      MemberExpression(p) {
        const obj = p.node.object;
        const prop = p.node.property;

        // Check req.headers.authorization or req.headers['authorization']
        const isHeaders =
          obj.type === 'MemberExpression' &&
          obj.property.type === 'Identifier' &&
          obj.property.name === 'headers';

        if (isHeaders) {
          const headerName =
            prop.type === 'Identifier'
              ? prop.name.toLowerCase()
              : prop.type === 'StringLiteral'
                ? prop.value.toLowerCase()
                : '';
          if (headerName === 'authorization') {
            hasBearerHeader = true;
          } else if (headerName === 'x-api-key' || headerName === 'apikey' || headerName === 'x-token') {
            hasApiKeyHeader = true;
          }
        }

        // Check req.session / req.session.user
        if (
          obj.type === 'Identifier' &&
          (prop.type === 'Identifier' ? prop.name : '') === 'session'
        ) {
          hasSessionCheck = true;
        }

        // Check jwt.verify
        if (
          obj.type === 'Identifier' &&
          (obj.name === 'jwt' || obj.name === 'jsonwebtoken') &&
          prop.type === 'Identifier' &&
          prop.name === 'verify'
        ) {
          hasJwtVerify = true;
        }
      },
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type === 'MemberExpression') {
          // req.header('authorization')
          if (callee.property.type === 'Identifier' && callee.property.name === 'header') {
            const firstArg = p.node.arguments[0];
            if (firstArg && firstArg.type === 'StringLiteral') {
              if (firstArg.value.toLowerCase() === 'authorization') {
                hasBearerHeader = true;
              } else if (firstArg.value.toLowerCase() === 'x-api-key') {
                hasApiKeyHeader = true;
              }
            }
          }
        }
      },
    });

    if (hasBearerHeader || hasJwtVerify) {
      return {
        type: 'bearer',
        evidence: {
          filePath: fnFilePath,
          line: fnLine,
          signal: hasBearerHeader ? 'header:authorization:Bearer' : 'jwt:verify',
        },
      };
    }

    if (hasApiKeyHeader) {
      return {
        type: 'apiKey',
        evidence: {
          filePath: fnFilePath,
          line: fnLine,
          signal: 'header:x-api-key',
        },
      };
    }

    if (hasSessionCheck) {
      return {
        type: 'cookie',
        evidence: {
          filePath: fnFilePath,
          line: fnLine,
          signal: 'session:user',
        },
      };
    }
  }

  // 2. Name heuristics
  if (isAuthNameHeuristic(mwName)) {
    return {
      type: 'custom',
      evidence: {
        filePath: fnFilePath,
        line: fnLine,
        signal: `name:${mwName}`,
      },
    };
  }

  return { type: null };
}

/**
 * Classifies an endpoint's authentication requirement from its applied middlewares.
 * Express middlewares run in order; route/mount-level auth specifications take precedence
 * or narrow global auth.
 * Never infers 'none'; defaults strictly to 'unknown' without positive evidence.
 */
export function classifyAuthFromMiddlewares(middlewares: ExtractedMiddleware[]): AuthDefinition {
  let detectedAuth: AuthDefinition = { type: 'unknown' };

  for (const mw of middlewares) {
    const result = inspectMiddlewareAuth(mw);
    if (result.type) {
      detectedAuth = {
        type: result.type,
        ...(result.evidence ? { evidence: result.evidence } : {}),
      };
    }
  }

  return detectedAuth;
}
