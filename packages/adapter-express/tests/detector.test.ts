import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { detectExpress, ExpressAdapter } from '../src/index.js';

describe('Express Detection (detectExpress & ExpressAdapter)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const simpleFixture = path.join(repoRoot, 'fixtures/simple/app');
  const nestedRoutersFixture = path.join(repoRoot, 'fixtures/nested-routers/app');
  const notExpressFixture = path.join(repoRoot, 'fixtures/not-express');
  const noPkgExpressFixture = path.join(repoRoot, 'fixtures/no-package-json-express');
  const noPkgNotExpressFixture = path.join(repoRoot, 'fixtures/no-package-json-not-express');

  describe('Primary Evidence: package.json', () => {
    it('detects simple fixture via dependencies', async () => {
      const result = await detectExpress(simpleFixture);
      expect(result).toEqual({
        detected: true,
        signal: 'package.json:dependencies',
        file: 'package.json',
      });
    });

    it('detects nested-routers fixture via dependencies', async () => {
      const result = await detectExpress(nestedRoutersFixture);
      expect(result).toEqual({
        detected: true,
        signal: 'package.json:dependencies',
        file: 'package.json',
      });
    });

    it('detects express declared in devDependencies', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-devdep-'));
      try {
        await fs.writeFile(
          path.join(tempDir, 'package.json'),
          JSON.stringify({
            name: 'devdep-test',
            devDependencies: { express: '^4.18.2' },
          })
        );

        const result = await detectExpress(tempDir);
        expect(result).toEqual({
          detected: true,
          signal: 'package.json:devDependencies',
          file: 'package.json',
        });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects not-express fixture with package.json missing express', async () => {
      const result = await detectExpress(notExpressFixture);
      expect(result).toEqual({
        detected: false,
        signal: 'none',
        file: null,
      });
    });
  });

  describe('Secondary Evidence: Source Text Imports', () => {
    it('detects express via require("express") in package.json-less folder', async () => {
      const result = await detectExpress(noPkgExpressFixture);
      expect(result).toEqual({
        detected: true,
        signal: 'source:require',
        file: 'server.js',
      });
    });

    it('detects express via ESM import express in package.json-less folder', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-esm-'));
      try {
        await fs.writeFile(
          path.join(tempDir, 'index.mjs'),
          `import express from 'express';\nconst app = express();`
        );

        const result = await detectExpress(tempDir);
        expect(result).toEqual({
          detected: true,
          signal: 'source:import',
          file: 'index.mjs',
        });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects package.json-less folder without express imports', async () => {
      const result = await detectExpress(noPkgNotExpressFixture);
      expect(result).toEqual({
        detected: false,
        signal: 'none',
        file: null,
      });
    });

    it('returns detected: false for empty or non-existent directory', async () => {
      const result = await detectExpress('/path/does/not/exist/at/all');
      expect(result).toEqual({
        detected: false,
        signal: 'none',
        file: null,
      });
    });
  });

  describe('ExpressAdapter class wrapper', () => {
    const adapter = new ExpressAdapter();

    it('has correct adapter name', () => {
      expect(adapter.name).toBe('adapter-express');
    });

    it('adapter.detect() returns true for express projects', async () => {
      expect(await adapter.detect(simpleFixture)).toBe(true);
      expect(await adapter.detect(nestedRoutersFixture)).toBe(true);
      expect(await adapter.detect(noPkgExpressFixture)).toBe(true);
    });

    it('adapter.detect() returns false for non-express projects', async () => {
      expect(await adapter.detect(notExpressFixture)).toBe(false);
      expect(await adapter.detect(noPkgNotExpressFixture)).toBe(false);
      expect(await adapter.detect('/non-existent-path')).toBe(false);
    });

    it('adapter.scan() scans and returns ApiModel for express fixture', async () => {
      const model = await adapter.scan(simpleFixture);
      expect(model.endpoints).toHaveLength(6);
    });
  });
});
