import type { File } from '@babel/types';
import type { ModuleGraph } from '../module-graph.js';
import { extractFileDeclarations } from './declarations.js';
import { resolveCrossFileRoutes } from './mount-resolver.js';
import type { ExtractRoutesResult, FileDeclarations } from './types.js';

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

export * from './types.js';
export * from './path-evaluator.js';
export * from './handler-resolver.js';
export * from './param-inference.js';
export * from './declarations.js';
export * from './mount-resolver.js';
