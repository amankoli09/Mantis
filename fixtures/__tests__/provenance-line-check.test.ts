/**
 * Provenance line checker
 *
 * For every provenance entry in every golden file, this test:
 *   1. Resolves the filePath to an absolute path from the repo root.
 *   2. Asserts the referenced file exists.
 *   3. Reads the file and counts its lines.
 *   4. Asserts provenance.line ≤ total lines in the file.
 *   5. Reads the actual line content and asserts it is non-empty.
 *   6. If a snippet is present, asserts it matches the actual line (trimmed).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

interface ProvenanceEntry {
  kind: string;
  filePath: string;
  line: number;
  column?: number;
  snippet?: string;
}

interface EndpointLike {
  id: string;
  provenance: ProvenanceEntry;
  params?: Array<{ provenance?: ProvenanceEntry }>;
  requestBody?: { provenance?: ProvenanceEntry };
  middleware?: Array<string | { name: string; provenance?: ProvenanceEntry }>;
  auth?: { evidence?: { filePath: string; line: number; signal?: string } };
}

interface GoldenModel {
  endpoints: EndpointLike[];
  diagnostics?: Array<{ file?: string; line?: number; code?: string }>;
}

function loadGolden(relativePath: string): GoldenModel {
  const absolutePath = resolve(REPO_ROOT, relativePath);
  const raw = readFileSync(absolutePath, 'utf-8');
  return JSON.parse(raw) as GoldenModel;
}

/**
 * Reads a file and returns its lines (1-indexed array: lines[0] is unused, lines[1] is line 1).
 */
function readLines(absolutePath: string): string[] {
  const content = readFileSync(absolutePath, 'utf-8');
  // Prepend an empty element so index matches 1-based line numbers.
  return ['', ...content.split('\n')];
}

/**
 * Collects all provenance entries from a golden file, with a human-readable label.
 */
function collectProvenances(
  model: GoldenModel,
  goldenPath: string,
): Array<{ label: string; prov: ProvenanceEntry }> {
  const entries: Array<{ label: string; prov: ProvenanceEntry }> = [];

  for (const endpoint of model.endpoints) {
    entries.push({
      label: `${goldenPath} → endpoint[${endpoint.id}].provenance`,
      prov: endpoint.provenance,
    });

    for (const param of endpoint.params ?? []) {
      if (param.provenance) {
        entries.push({
          label: `${goldenPath} → endpoint[${endpoint.id}].params[${param.provenance.filePath}:${param.provenance.line}]`,
          prov: param.provenance,
        });
      }
    }

    if (endpoint.requestBody?.provenance) {
      entries.push({
        label: `${goldenPath} → endpoint[${endpoint.id}].requestBody.provenance`,
        prov: endpoint.requestBody.provenance,
      });
    }

    for (const mw of endpoint.middleware ?? []) {
      if (typeof mw === 'object' && mw.provenance) {
        entries.push({
          label: `${goldenPath} → endpoint[${endpoint.id}].middleware[${mw.name}]`,
          prov: mw.provenance,
        });
      }
    }

    if (endpoint.auth?.evidence) {
      entries.push({
        label: `${goldenPath} → endpoint[${endpoint.id}].auth.evidence`,
        prov: {
          kind: 'literal',
          filePath: endpoint.auth.evidence.filePath,
          line: endpoint.auth.evidence.line,
        },
      });
    }
  }

  return entries;
}

const GOLDEN_FILES = [
  'fixtures/simple/expected.model.json',
  'fixtures/nested-routers/expected.model.json',
  'fixtures/router-single-file/expected.model.json',
  'fixtures/router-cross-file/expected.model.json',
  'fixtures/constant-propagation/expected.model.json',
  'fixtures/inference-basic/expected.model.json',
  'fixtures/auth-middleware/expected.model.json',
] as const;

describe('Provenance line integrity — all golden files', () => {
  for (const goldenPath of GOLDEN_FILES) {
    describe(goldenPath, () => {
      const model = loadGolden(goldenPath);
      const provenances = collectProvenances(model, goldenPath);

      for (const { label, prov } of provenances) {
        it(`${label} — line ${prov.line} exists and is non-empty`, () => {
          const absoluteFilePath = resolve(REPO_ROOT, prov.filePath);

          // 1. File must exist.
          expect(
            existsSync(absoluteFilePath),
            `Source file does not exist: ${absoluteFilePath}`,
          ).toBe(true);

          const lines = readLines(absoluteFilePath);
          const totalLines = lines.length - 1; // subtract the leading empty element

          // 2. Line number must be in range.
          expect(
            prov.line,
            `line ${prov.line} is out of range (file has ${totalLines} lines): ${absoluteFilePath}`,
          ).toBeGreaterThanOrEqual(1);
          expect(
            prov.line,
            `line ${prov.line} is out of range (file has ${totalLines} lines): ${absoluteFilePath}`,
          ).toBeLessThanOrEqual(totalLines);

          // 3. The actual line must not be blank.
          const actualLine = lines[prov.line] ?? '';
          expect(
            actualLine.trim().length,
            `Line ${prov.line} in ${absoluteFilePath} is empty or whitespace-only`,
          ).toBeGreaterThan(0);

          // 4. If a snippet is present, it must match the actual line (modulo leading/trailing whitespace).
          if (prov.snippet !== undefined) {
            expect(actualLine.trim()).toBe(prov.snippet.trim());
          }
        });
      }
    });
  }
});
