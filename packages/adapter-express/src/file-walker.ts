import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface WalkOptions {
  /**
   * Directory names to ignore. Defaults to ['node_modules', 'dist', 'build', 'coverage', '.git'].
   */
  ignoreDirs?: string[];
  /**
   * Maximum allowed file size in bytes before skipping. Defaults to 1 MB (1,048,576 bytes).
   */
  maxFileSizeBytes?: number;
  /**
   * Allowed file extensions. Defaults to ['.js', '.cjs', '.mjs'].
   */
  extensions?: string[];
}

export interface WalkResult {
  /**
   * Sorted list of relative file paths using forward slashes (e.g. 'src/routes/users.js').
   */
  files: string[];
  /**
   * List of relative file paths that exceeded maxFileSizeBytes and were skipped.
   */
  skippedHugeFiles: string[];
}

const DEFAULT_IGNORE_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.git'];
const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'];

/**
 * Deterministically compares two strings using unicode code-point ordering.
 */
function compareCodePoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Recursively traverses a project root directory to collect source files matching given extensions.
 *
 * Guarantees:
 * - Deterministic output order (code-point sorted).
 * - Root-relative paths using forward slashes (`/`).
 * - Skips ignored directories and symlinks (never follows symlinks to prevent circular references).
 * - Skips and reports files exceeding `maxFileSizeBytes`.
 */
export async function walkProjectFiles(
  projectRoot: string,
  options: WalkOptions = {}
): Promise<WalkResult> {
  const ignoreDirs = new Set(options.ignoreDirs ?? DEFAULT_IGNORE_DIRS);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const extensions = new Set((options.extensions ?? DEFAULT_EXTENSIONS).map((ext) => ext.toLowerCase()));

  const resolvedRoot = path.resolve(projectRoot);
  const files: string[] = [];
  const skippedHugeFiles: string[] = [];

  try {
    const rootStat = await fs.stat(resolvedRoot);
    if (!rootStat.isDirectory()) {
      return { files: [], skippedHugeFiles: [] };
    }
  } catch {
    return { files: [], skippedHugeFiles: [] };
  }

  async function traverse(currentDir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort dirents first to maintain consistent traversal
    entries.sort((a, b) => compareCodePoints(a.name, b.name));

    for (const entry of entries) {
      const entryName = entry.name;
      const fullPath = path.join(currentDir, entryName);

      // Never follow symlinks (prevent circular directory loops & escapes)
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entryName)) {
          continue;
        }
        await traverse(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entryName).toLowerCase();
        if (!extensions.has(ext)) {
          continue;
        }

        const relativePath = path.relative(resolvedRoot, fullPath).split(path.sep).join('/');

        try {
          const fileStat = await fs.stat(fullPath);
          if (fileStat.size > maxFileSizeBytes) {
            skippedHugeFiles.push(relativePath);
          } else {
            files.push(relativePath);
          }
        } catch {
          // If stat fails for any reason, safely skip file
          continue;
        }
      }
    }
  }

  await traverse(resolvedRoot);

  files.sort(compareCodePoints);
  skippedHugeFiles.sort(compareCodePoints);

  return {
    files,
    skippedHugeFiles,
  };
}
