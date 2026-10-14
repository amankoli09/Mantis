import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exportOpenApi } from '@mantis/core';
import { detectExpress, scanProject } from '@mantis/adapter-express';
import { resolveSafeOutputPath } from '@mantis/runner';
import { formatScanTerminal } from '../ui/formatters.js';

export interface ScanCliOptions {
  json?: boolean;
  openapi?: boolean;
  out?: string;
  verbose?: boolean;
}

/**
 * Executes the `mantis scan <path>` command.
 * Exits with:
 * - 0 on successful scan
 * - 2 on detection failure or invalid path
 * - 3 on unexpected internal error
 */
export async function scanCommand(
  targetPath: string,
  options: ScanCliOptions = {},
): Promise<number> {
  let safeOutPath: string | undefined;
  if (options.out) {
    try {
      safeOutPath = resolveSafeOutputPath(options.out);
    } catch (err) {
      console.error(`Safety Error: ${(err as Error).message}`);
      return 2;
    }
  }

  const resolvedPath = path.resolve(targetPath);

  // 1. Check directory existence and detect Express
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      console.error(`Error: Path "${targetPath}" is not a directory.`);
      return 2;
    }
  } catch {
    console.error(`Error: Target directory "${targetPath}" does not exist.`);
    return 2;
  }

  const detection = await detectExpress(resolvedPath);
  if (!detection.detected) {
    console.error(
      `Error: No Express backend detected at "${targetPath}". Mantis Phase 1 supports Node.js + Express apps.`,
    );
    return 2;
  }

  // 2. Run static scan
  const model = await scanProject(resolvedPath);

  // 3. Output results
  if (options.openapi) {
    const openApiSpec = exportOpenApi(model);
    const jsonOutput = JSON.stringify(openApiSpec, null, 2);
    if (options.out) {
      await fs.writeFile(safeOutPath!, jsonOutput, 'utf-8');
      console.log(`OpenAPI specification written to ${options.out}`);
    } else {
      console.log(jsonOutput);
    }
    return 0;
  }

  if (options.json) {
    const jsonOutput = JSON.stringify(model, null, 2);
    if (options.out) {
      await fs.writeFile(safeOutPath!, jsonOutput, 'utf-8');
      console.log(`API Model written to ${options.out}`);
    } else {
      console.log(jsonOutput);
    }
    return 0;
  }

  const formatted = formatScanTerminal(model, { verbose: options.verbose });
  if (options.out) {
    await fs.writeFile(safeOutPath!, formatted, 'utf-8');
    console.log(`Scan summary written to ${options.out}`);
  } else {
    console.log(formatted);
  }

  return 0;
}
