import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../src/fs.js';
import { scanProject } from '../src/scanner.js';
import { detectExpress } from '../src/detector.js';

describe('FileSystem Abstraction & MemoryFileSystem', () => {
  it('walks and reads virtual files from MemoryFileSystem', async () => {
    const memFs = new MemoryFileSystem({
      '/project/package.json': JSON.stringify({
        name: 'virtual-express-app',
        dependencies: { express: '^4.18.2' },
      }),
      '/project/src/index.js': `
        const express = require('express');
        const app = express();
        app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));
        app.post('/api/echo', (req, res) => res.json(req.body));
      `,
    });

    const detection = await detectExpress('/project', memFs);
    expect(detection.detected).toBe(true);
    expect(detection.signal).toBe('package.json:dependencies');

    const model = await scanProject('/project', {}, memFs);
    expect(model.project?.name).toBe('virtual-express-app');
    expect(model.endpoints).toHaveLength(2);
    expect(model.endpoints.map((e) => e.id)).toEqual(['POST /api/echo', 'GET /api/ping']);
  });

  it('supports in-memory readdir, stat, and file existence checking', async () => {
    const memFs = new MemoryFileSystem({
      '/app/routes/users.js': 'module.exports = {};',
      '/app/routes/posts.js': 'module.exports = {};',
      '/app/app.js': 'console.log("hello");',
    });

    expect(memFs.existsSync('/app/routes/users.js')).toBe(true);
    expect(memFs.existsSync('/app/routes/unknown.js')).toBe(false);
    expect(memFs.existsSync('/app/routes')).toBe(true);

    const dirEntries = await memFs.readdir('/app/routes');
    expect(dirEntries.sort()).toEqual(['posts.js', 'users.js']);

    const statFile = await memFs.stat('/app/routes/users.js');
    expect(statFile.isFile()).toBe(true);
    expect(statFile.isDirectory()).toBe(false);

    const statDir = await memFs.stat('/app/routes');
    expect(statDir.isDirectory()).toBe(true);
    expect(statDir.isFile()).toBe(false);
  });
});
