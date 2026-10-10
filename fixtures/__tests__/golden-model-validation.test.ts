import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateModel } from '../../packages/core/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolves the path to a golden file relative to the repo root.
 * __dirname = fixtures/__tests__  →  REPO_ROOT = ../..
 */
const REPO_ROOT = resolve(__dirname, '..', '..');

function loadGolden(relativePath: string): unknown {
  const absolutePath = resolve(REPO_ROOT, relativePath);
  const raw = readFileSync(absolutePath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

const GOLDEN_FILES = [
  'fixtures/simple/expected.model.json',
  'fixtures/nested-routers/expected.model.json',
  'fixtures/router-single-file/expected.model.json',
  'fixtures/router-cross-file/expected.model.json',
  'fixtures/constant-propagation/expected.model.json',
  'fixtures/inference-basic/expected.model.json',
  'fixtures/auth-middleware/expected.model.json',
  'fixtures/route-all/expected.model.json',
  'fixtures/router-root-mount/expected.model.json',
  'fixtures/route-factory/expected.model.json',
] as const;

describe('Golden model files — schema validation', () => {
  for (const goldenPath of GOLDEN_FILES) {
    it(`${goldenPath} passes validateModel()`, () => {
      const data = loadGolden(goldenPath);
      const result = validateModel(data);

      if (!result.success) {
        // Emit detailed errors for easy debugging.
        const errorLines = result.errors
          .map((e) => `  [${e.path}] ${e.message}`)
          .join('\n');
        throw new Error(
          `validateModel() failed for "${goldenPath}":\n${errorLines}`,
        );
      }

      expect(result.success).toBe(true);
    });
  }
});
