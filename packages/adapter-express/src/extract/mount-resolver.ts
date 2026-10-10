import {
  createDiagnostic,
  generateEndpointId,
  normalizePath,
  type Diagnostic,
  type Endpoint,
  type HttpMethod,
  type MountEntry,
} from '@devguard/core';
import type { ModuleGraph } from '../module-graph.js';
import {
  joinPaths,
  formatPlaceholder,
} from './path-evaluator.js';
import { mergeAndSortParams } from './param-inference.js';
import { getEffectForMethod } from './declarations.js';
import type {
  ExtractedRouter,
  ExtractedMount,
  FileDeclarations,
  ExtractRoutesResult,
  ExtractedMiddleware,
} from './types.js';
import { classifyAuthFromMiddlewares } from './middleware-inference.js';

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

  // 1. Check direct matching export in targetFile
  const directExp = node.exports.find((e) => e.exportedName === exportedName);
  if (directExp) {
    // Case A: directExp has a localName
    if (directExp.localName) {
      const router = routersByFile.get(targetFile)?.get(directExp.localName);
      if (router) {
        return router;
      }

      const imp = node.imports.find((i) => i.localName === directExp.localName);
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
      if (exportedName === 'default') {
        const defaultRouter = routersByFile.get(targetFile)?.get('default');
        if (defaultRouter) {
          return defaultRouter;
        }
      }
    } else {
      // Case B: directExp.localName is null
      if (exportedName === 'default') {
        const defaultRouter = routersByFile.get(targetFile)?.get('default');
        if (defaultRouter) {
          return defaultRouter;
        }
      }

      const lineImp = node.imports.find((i) => i.line === directExp.line);
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
    }
  }

  // 2. If no direct export, check wildcard re-exports (export * from './...')
  if (exportedName !== 'default') {
    const starExports = node.exports.filter((e) => e.exportedName === '*');
    for (const starExp of starExports) {
      const starImp = node.imports.find((i) => i.line === starExp.line || i.localName === '*');
      if (starImp?.sourcePath && !starImp.isExternal) {
        const dummyDiag: Diagnostic[] = [];
        const candidate = resolveExportedRouter(
          starImp.sourcePath,
          exportedName,
          moduleGraph,
          routersByFile,
          dummyDiag,
          new Set(visited),
          mountLocation
        );
        if (candidate) {
          return candidate;
        }
      }
    }
  }

  diagnostics.push(
    createDiagnostic(
      'DG-R002',
      { mountPath: mountLocation.prefix, routerIdentifier: `${targetFile}:${exportedName}` },
      { file: mountLocation.file, line: mountLocation.line, column: mountLocation.column }
    )
  );
  return null;

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
    mountRelFile: string;
    mountMiddlewares?: ExtractedMiddleware[];
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
          mountRelFile: decl.relFile,
          mountMiddlewares: mount.mountMiddlewares,
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

  // 4. DFS from app mounts to generate full prefixes, mount chains, and accumulated middlewares for each router
  interface RouterMountInfo {
    prefix: string;
    mountChain: MountEntry[];
    accumulatedMiddlewares: ExtractedMiddleware[];
  }
  const resolvedRouterMounts = new Map<string, RouterMountInfo[]>();

  function dfs(
    currentRouter: ExtractedRouter,
    currentPrefix: string,
    currentChain: MountEntry[],
    currentMiddlewares: ExtractedMiddleware[],
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

    if (!resolvedRouterMounts.has(currentRouter.id)) {
      resolvedRouterMounts.set(currentRouter.id, []);
    }
    resolvedRouterMounts.get(currentRouter.id)!.push({
      prefix: currentPrefix,
      mountChain: currentChain,
      accumulatedMiddlewares: currentMiddlewares,
    });

    const nextVisited = new Set(visitedPath);
    nextVisited.add(currentRouter.id);

    const children = routerMounts.get(currentRouter.id) || [];
    for (const childMount of children) {
      const nextPrefix = joinPaths(currentPrefix, childMount.prefix);
      const nextChain: MountEntry[] = [
        ...currentChain,
        { filePath: childMount.mountFilePath, line: childMount.line },
      ];
      const nextMiddlewares = [
        ...currentMiddlewares,
        ...(childMount.mountMiddlewares ?? []),
      ];
      dfs(
        childMount.targetRouter,
        nextPrefix,
        nextChain,
        nextMiddlewares,
        nextVisited,
        childMount.line,
        childMount.column,
        childMount.mountFilePath
      );
    }
  }

  for (const am of appMounts) {
    const parentDecl = fileDeclarations.get(am.mountRelFile);
    const parentUses = (parentDecl?.appUses ?? [])
      .filter((u) => u.line < am.line)
      .map((u) => u.middleware);
    const initialMiddlewares = [
      ...parentUses,
      ...(am.mountMiddlewares ?? []),
    ];

    dfs(
      am.targetRouter,
      am.prefix,
      [{ filePath: am.mountFilePath, line: am.line }],
      initialMiddlewares,
      new Set(),
      am.line,
      am.column,
      am.mountFilePath
    );
  }

  // 5. Generate endpoints for all routers
  for (const router of allRouters.values()) {
    const mountInfos = resolvedRouterMounts.get(router.id);

    if (!mountInfos || mountInfos.length === 0) {
      // Unmounted router: emit DG-R004 and mark all its routes as uncertain
      diagnostics.push(
        createDiagnostic(
          'DG-R004',
          { routerIdentifier: router.varName },
          { file: router.filePathForProvenance, line: router.declLine, column: router.declCol }
        )
      );

      for (const route of router.routes) {
        const methodUpper = route.method.toUpperCase() as HttpMethod;
        const effect = route.effect ?? getEffectForMethod(route.method);
        const finalPath = route.isDynamic
          ? route.routePath
            ? route.routePath.startsWith('/')
              ? route.routePath
              : '/' + route.routePath
            : '/' + formatPlaceholder(route.rawExpr)
          : normalizePath(route.routePath);

        const routerUsesBefore = (router.uses ?? [])
          .filter((u) => u.line < route.startLine)
          .map((u) => u.middleware);
        const allMiddlewares = [
          ...routerUsesBefore,
          ...(route.routeMiddlewares ?? []),
        ];
        const endpointMiddleware = allMiddlewares.map((m) => ({
          name: m.name,
          provenance: m.provenance,
        }));
        const endpointAuth = classifyAuthFromMiddlewares(allMiddlewares);

        endpoints.push({
          id: generateEndpointId(methodUpper, finalPath),
          method: methodUpper,
          path: finalPath,
          auth: endpointAuth,
          effect,
          ...(route.effectEvidence ? { effectEvidence: route.effectEvidence } : {}),
          params: [],
          ...(route.requestBody ? { requestBody: route.requestBody } : {}),
          responses: [],
          middleware: endpointMiddleware,
          mountChain: [],
          provenance: {
            kind: 'unresolved',
            filePath: router.filePathForProvenance,
            line: route.startLine,
            ...(route.startCol !== undefined ? { column: route.startCol } : {}),
            ...(route.snippet ? { snippet: route.snippet } : {}),
          },
          confidence: 'uncertain',
          confidenceReason: 'DG-R004',
        });
      }
    } else {
      // Mounted router: emit resolved endpoints for each mount prefix and mount chain
      for (const info of mountInfos) {
        for (const route of router.routes) {
          const methodUpper = route.method.toUpperCase() as HttpMethod;
          const effect = route.effect ?? getEffectForMethod(route.method);

          const routerUsesBefore = (router.uses ?? [])
            .filter((u) => u.line < route.startLine)
            .map((u) => u.middleware);
          const allMiddlewares = [
            ...info.accumulatedMiddlewares,
            ...routerUsesBefore,
            ...(route.routeMiddlewares ?? []),
          ];
          const endpointMiddleware = allMiddlewares.map((m) => ({
            name: m.name,
            provenance: m.provenance,
          }));
          const endpointAuth = classifyAuthFromMiddlewares(allMiddlewares);

          if (route.isDynamic) {
            diagnostics.push(
              createDiagnostic(
                'DG-R003',
                { rawExpression: route.rawExpr! },
                { file: router.filePathForProvenance, line: route.startLine, column: route.startCol }
              )
            );

            const placeholderPath = joinPaths(info.prefix, route.routePath);
            endpoints.push({
              id: generateEndpointId(methodUpper, placeholderPath),
              method: methodUpper,
              path: placeholderPath,
              auth: endpointAuth,
              effect,
              ...(route.effectEvidence ? { effectEvidence: route.effectEvidence } : {}),
              params: [],
              ...(route.requestBody ? { requestBody: route.requestBody } : {}),
              responses: [],
              middleware: endpointMiddleware,
              mountChain: info.mountChain,
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
            const finalPath = joinPaths(info.prefix, route.routePath);
            const paramMatches = [...finalPath.matchAll(/:([a-zA-Z0-9_]+)/g)];
            const pathParams = paramMatches.map((match) => ({
              name: match[1] ?? '',
              in: 'path' as const,
              required: true,
              type: 'string',
              description: `User identifier extracted from path segment :${match[1]}.`,
              provenance: {
                kind: 'literal' as const,
                filePath: router.filePathForProvenance,
                line: route.startLine,
              },
            }));

            const mergedParams = mergeAndSortParams(pathParams, route.inferredParams ?? []);

            endpoints.push({
              id: generateEndpointId(methodUpper, finalPath),
              method: methodUpper,
              path: finalPath,
              auth: endpointAuth,
              effect,
              ...(route.effectEvidence ? { effectEvidence: route.effectEvidence } : {}),
              params: mergedParams,
              ...(route.requestBody ? { requestBody: route.requestBody } : {}),
              responses: [],
              middleware: endpointMiddleware,
              mountChain: info.mountChain,
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
