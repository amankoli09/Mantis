import path from 'node:path';
import { type FileSystem, nodeFileSystem } from './fs.js';
import { walkProjectFiles } from './file-walker.js';

export type DetectionSignal =
  | 'package.json:dependencies'
  | 'package.json:devDependencies'
  | 'source:require'
  | 'source:import'
  | 'none';

export interface DetectionResult {
  /**
   * True if Express was detected as the application framework.
   */
  detected: boolean;
  /**
   * The evidence signal that triggered detection.
   */
  signal: DetectionSignal;
  /**
   * Root-relative path to the file containing the detection signal, or null if not detected.
   */
  file: string | null;
}

const REQUIRE_EXPRESS_REGEX = /require\s*\(\s*['"]express['"]\s*\)/;
const IMPORT_EXPRESS_REGEX = /(?:from\s*['"]express['"]|import\s*['"]express['"])/;

/**
 * Detects whether an Express application exists at the specified project root.
 *
 * Check order:
 * 1. Primary: Inspects `package.json` for `express` under `dependencies` or `devDependencies`.
 * 2. Secondary: If `package.json` is absent or doesn't list express, walks source files
 *    and performs a fast text check for `require('express')` or `import ... from 'express'`.
 *
 * @param projectRoot Absolute or relative path to the root directory.
 * @param fileSystem FileSystem instance, defaults to nodeFileSystem.
 * @returns DetectionResult containing `detected`, `signal`, and `file`.
 */
export async function detectExpress(
  projectRoot: string,
  fileSystem: FileSystem = nodeFileSystem
): Promise<DetectionResult> {
  const resolvedRoot = path.resolve(projectRoot);

  // 1. Primary Check: package.json
  const pkgPath = path.join(resolvedRoot, 'package.json');
  try {
    const rawPkg = await fileSystem.readFile(pkgPath, 'utf8');
    const parsedPkg = JSON.parse(rawPkg) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    if (parsedPkg.dependencies && typeof parsedPkg.dependencies.express === 'string') {
      return {
        detected: true,
        signal: 'package.json:dependencies',
        file: 'package.json',
      };
    }

    if (parsedPkg.devDependencies && typeof parsedPkg.devDependencies.express === 'string') {
      return {
        detected: true,
        signal: 'package.json:devDependencies',
        file: 'package.json',
      };
    }
  } catch {
    // package.json missing, unreadable, or invalid JSON — proceed to secondary source check
  }

  // 2. Secondary Check: Fast text search across source files
  const { files } = await walkProjectFiles(resolvedRoot, {}, fileSystem);

  for (const relFile of files) {
    const fullPath = path.join(resolvedRoot, relFile);
    try {
      const content = await fileSystem.readFile(fullPath, 'utf8');

      if (REQUIRE_EXPRESS_REGEX.test(content)) {
        return {
          detected: true,
          signal: 'source:require',
          file: relFile,
        };
      }

      if (IMPORT_EXPRESS_REGEX.test(content)) {
        return {
          detected: true,
          signal: 'source:import',
          file: relFile,
        };
      }
    } catch {
      // If individual file read fails, continue checking others
      continue;
    }
  }

  return {
    detected: false,
    signal: 'none',
    file: null,
  };
}
