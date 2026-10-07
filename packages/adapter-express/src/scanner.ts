import { promises as fs } from 'node:fs';
import type { File } from '@babel/types';
import path from 'node:path';
import {
  compareStrings,
  sortEndpoints,
  validateModel,
  type ApiModel,
  type Diagnostic,
} from '@devguard/core';
import { walkProjectFiles } from './file-walker.js';
import { parseFile } from './parser.js';
import { buildModuleGraph } from './module-graph.js';
import {
  extractFileDeclarations,
  resolveCrossFileRoutes,
  type FileDeclarations,
} from './route-extractor.js';

export interface ScanOptions {
  projectName?: string;
}

/**
 * Scans an Express project directory by discovering JavaScript files, parsing ASTs,
 * resolving module dependencies, and extracting direct and mounted routes across files.
 */
export async function scanProject(projectRoot: string, options: ScanOptions = {}): Promise<ApiModel> {
  const resolvedRoot = path.resolve(projectRoot);

  // 1. Determine project name
  let projectName = options.projectName;
  if (!projectName) {
    try {
      const rawPkg = await fs.readFile(path.join(resolvedRoot, 'package.json'), 'utf8');
      const pkg = JSON.parse(rawPkg) as { name?: string };
      if (pkg.name) {
        projectName = pkg.name;
      }
    } catch {
      // package.json missing or invalid, fallback to directory name
    }
  }
  if (!projectName) {
    projectName = path.basename(resolvedRoot);
  }

  // 2. Walk project files deterministically
  const { files } = await walkProjectFiles(resolvedRoot);

  const diagnostics: Diagnostic[] = [];

  // Compute root-relative path for project display and provenance
  const relativeRoot = path.relative(process.cwd(), resolvedRoot).split(path.sep).join('/') || '.';

  // 3. Build Module Graph across all project files
  const moduleGraph = await buildModuleGraph(resolvedRoot, files);
  for (const diag of moduleGraph.diagnostics) {
    const formattedDiag = { ...diag };
    if (relativeRoot && relativeRoot !== '.' && formattedDiag.file && !formattedDiag.file.startsWith(relativeRoot)) {
      formattedDiag.file = path.join(relativeRoot, formattedDiag.file).split(path.sep).join('/');
    }
    diagnostics.push(formattedDiag);
  }

  // 4. Parse each file and collect ASTs
  const astCache = new Map<string, { ast: File; code: string }>();
  for (const relFile of files) {
    const fullPath = path.join(resolvedRoot, relFile);
    let code: string;
    try {
      code = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    const filePathForProvenance =
      relativeRoot && relativeRoot !== '.'
        ? path.join(relativeRoot, relFile).split(path.sep).join('/')
        : relFile;

    const parseResult = parseFile(code, filePathForProvenance);
    if (parseResult.diagnostics.length > 0) {
      diagnostics.push(...parseResult.diagnostics);
    }

    if (parseResult.ast) {
      astCache.set(relFile, { ast: parseResult.ast, code });
    }
  }

  // 5. Extract declarations using moduleGraph and astCache
  const fileDeclarations = new Map<string, FileDeclarations>();
  for (const [relFile, { ast, code }] of astCache) {
    const filePathForProvenance =
      relativeRoot && relativeRoot !== '.'
        ? path.join(relativeRoot, relFile).split(path.sep).join('/')
        : relFile;
        
    const fileDecl = extractFileDeclarations(
      ast,
      relFile,
      filePathForProvenance,
      code,
      moduleGraph,
      astCache
    );
    fileDeclarations.set(relFile, fileDecl);
  }

  // 6. Cross-file resolution of routers and mounts
  const { endpoints, diagnostics: routeDiagnostics } = resolveCrossFileRoutes(
    fileDeclarations,
    moduleGraph
  );
  diagnostics.push(...routeDiagnostics);

  // 6. Sort endpoints deterministically
  const sortedEndpoints = sortEndpoints(endpoints);

  // 7. Sort diagnostics deterministically
  diagnostics.sort((a, b) => {
    const fileCmp = compareStrings(a.file ?? '', b.file ?? '');
    if (fileCmp !== 0) return fileCmp;
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    return compareStrings(a.code, b.code);
  });

  // 8. Construct final ApiModel
  const model: ApiModel = {
    modelVersion: '1.1.0',
    project: {
      name: projectName,
      framework: 'express',
      language: 'javascript',
      root: relativeRoot,
    },
    endpoints: sortedEndpoints,
    diagnostics,
  };

  // 9. Validate model against core schema
  const validationResult = validateModel(model);
  if (!validationResult.success) {
    throw new Error(
      `Generated ApiModel failed schema validation:\n${validationResult.errors.map((e: { path: string; message: string }) => `  - ${e.path}: ${e.message}`).join('\n')}`
    );
  }

  return model;
}
