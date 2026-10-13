import { parse, type ParseResult } from '@babel/parser';
import type { File } from '@babel/types';
import { createDiagnostic, type Diagnostic } from '@mantis/core';

export interface ParseFileResult {
  ast: ParseResult<File> | null;
  diagnostics: Diagnostic[];
}

/**
 * Parses JavaScript / TypeScript source code into a Babel AST.
 * Handles both CommonJS and ESM via `sourceType: 'unambiguous'`.
 *
 * Guarantees:
 * - Tolerates syntax errors with `errorRecovery: true`.
 * - Never throws on syntax errors; emits a `MT-P001` diagnostic instead.
 */
export function parseFile(code: string, filePath: string): ParseFileResult {
  try {
    const ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    const diagnostics: Diagnostic[] = [];

    if (ast.errors && ast.errors.length > 0) {
      for (const err of ast.errors) {
        diagnostics.push(
          createDiagnostic(
            'MT-P001',
            { file: filePath, reason: err.message },
            {
              file: filePath,
              line: err.loc?.line,
              column: err.loc?.column,
            }
          )
        );
      }
    }

    return { ast, diagnostics };
  } catch (err: unknown) {
    const error = err as { message?: string; loc?: { line?: number; column?: number } };
    const line = error.loc?.line ?? 1;
    const column = error.loc?.column ?? 0;
    const reason = error.message ?? String(err);

    return {
      ast: null,
      diagnostics: [
        createDiagnostic(
          'MT-P001',
          { file: filePath, reason },
          {
            file: filePath,
            line,
            column,
          }
        ),
      ],
    };
  }
}
