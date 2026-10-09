import path from 'node:path';
import { promises as fs } from 'node:fs';
import { detectExpress, scanProject } from '@devguard/adapter-express';
import { formatScanTerminal } from '../ui/formatters.js';

export interface ScanCliOptions {
  json?: boolean;
  out?: string;
  verbose?: boolean;
}

/**
 * Executes the `devguard scan <path>` command.
 * Exits with:
 * - 0 on successful scan
 * - 2 on detection failure or invalid path
 * - 3 on unexpected internal error
 */
export async function scanCommand(
  targetPath: string,
  options: ScanCliOptions = {},
): Promise<number> {
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
      `Error: No Express backend detected at "${targetPath}". DevGuard Phase 1 supports Node.js + Express apps.`,
    );
    return 2;
  }

  // 2. Run static scan
  const model = await scanProject(resolvedPath);

  // 3. Output results
  if (options.json) {
    const jsonOutput = JSON.stringify(model, null, 2);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), jsonOutput, 'utf-8');
      console.log(`API Model written to ${options.out}`);
    } else {
      console.log(jsonOutput);
    }
    return 0;
  }

  const formatted = formatScanTerminal(model, { verbose: options.verbose });
  if (options.out) {
    await fs.writeFile(path.resolve(options.out), formatted, 'utf-8');
    console.log(`Scan summary written to ${options.out}`);
  } else {
    console.log(formatted);
  }

  return 0;
}
