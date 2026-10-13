import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { walkProjectFiles } from '../src/index.js';

describe('File Walker (walkProjectFiles)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  it('collects files from simple fixture correctly', async () => {
    const root = path.join(repoRoot, 'fixtures/simple/app');
    const result = await walkProjectFiles(root);

    expect(result.files).toEqual(['app.js']);
    expect(result.skippedHugeFiles).toEqual([]);
  });

  it('collects and deterministically sorts files from nested-routers fixture', async () => {
    const root = path.join(repoRoot, 'fixtures/nested-routers/app');
    const result = await walkProjectFiles(root);

    expect(result.files).toEqual([
      'app.js',
      'routes/admin.js',
      'routes/products.js',
      'routes/users.js',
    ]);
    expect(result.skippedHugeFiles).toEqual([]);
  });

  it('ignores standard ignored directories (node_modules, dist, build, coverage, .git)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-ignore-test-'));
    try {
      // Normal source files
      await fs.mkdir(path.join(tempDir, 'src/routes'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'src/index.js'), '// entry');
      await fs.writeFile(path.join(tempDir, 'src/routes/api.cjs'), '// cjs route');
      await fs.writeFile(path.join(tempDir, 'src/routes/util.mjs'), '// mjs util');

      // Ignored folders with .js files
      for (const ignored of ['node_modules', 'dist', 'build', 'coverage', '.git']) {
        await fs.mkdir(path.join(tempDir, ignored), { recursive: true });
        await fs.writeFile(path.join(tempDir, ignored, 'bundle.js'), '// ignored');
      }

      // Non-js files in src
      await fs.writeFile(path.join(tempDir, 'src/README.md'), '# ignored doc');
      await fs.writeFile(path.join(tempDir, 'src/styles.css'), '/* ignored css */');

      const result = await walkProjectFiles(tempDir);

      expect(result.files).toEqual([
        'src/index.js',
        'src/routes/api.cjs',
        'src/routes/util.mjs',
      ]);
      expect(result.skippedHugeFiles).toEqual([]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('safely skips symlinks without entering infinite recursion loops', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-symlink-test-'));
    try {
      await fs.mkdir(path.join(tempDir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'sub/file.js'), '// real file');

      // Create a circular directory symlink pointing back to root
      try {
        await fs.symlink(tempDir, path.join(tempDir, 'sub/circular_link'), 'dir');
        await fs.symlink(path.join(tempDir, 'sub/file.js'), path.join(tempDir, 'sub/symlink.js'), 'file');
      } catch {
        // Some environments (e.g. Windows without admin privileges) might restrict symlink creation
      }

      const result = await walkProjectFiles(tempDir);

      // Should contain only real files, no infinite loop or crash
      expect(result.files).toEqual(['sub/file.js']);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('skips files exceeding maxFileSizeBytes and reports them', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-huge-file-test-'));
    try {
      await fs.writeFile(path.join(tempDir, 'small.js'), 'console.log("small");');

      // Create a 2KB file and set threshold to 1KB (1024 bytes)
      const hugeContent = 'a'.repeat(2048);
      await fs.writeFile(path.join(tempDir, 'huge.js'), hugeContent);

      const result = await walkProjectFiles(tempDir, { maxFileSizeBytes: 1024 });

      expect(result.files).toEqual(['small.js']);
      expect(result.skippedHugeFiles).toEqual(['huge.js']);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty result for non-existent path', async () => {
    const result = await walkProjectFiles('/non/existent/path/xyz');
    expect(result).toEqual({
      files: [],
      skippedHugeFiles: [],
    });
  });

  it('returns empty result when projectRoot points to a file instead of directory', async () => {
    const filePath = path.join(repoRoot, 'package.json');
    const result = await walkProjectFiles(filePath);
    expect(result).toEqual({
      files: [],
      skippedHugeFiles: [],
    });
  });
});
