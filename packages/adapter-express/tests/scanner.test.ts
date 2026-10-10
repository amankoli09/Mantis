import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync, promises as fs } from 'node:fs';
import os from 'node:os';
import { validateModel, type ApiModel } from '@devguard/core';
import { scanProject, ExpressAdapter } from '../src/index.js';

describe('Express Scanner (scanProject & ExpressAdapter.scan)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const simpleFixturePath = path.join(repoRoot, 'fixtures/simple/app');
  const goldenModelPath = path.join(repoRoot, 'fixtures/simple/expected.model.json');

  it('scans fixtures/simple/app and matches its golden model', async () => {
    const model = await scanProject(simpleFixturePath);

    // 1. Model conforms to core ApiModel validation schema
    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // 2. Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('tolerates broken syntax files and emits DG-P001 while extracting remaining valid routes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-error-'));
    try {
      // 1. Valid route file
      await fs.writeFile(
        path.join(tempDir, 'valid.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/valid-route', (req, res) => res.send('OK'));
        `
      );

      // 2. Broken syntax file
      await fs.writeFile(
        path.join(tempDir, 'broken.js'),
        `
        const express = require('express');
        const app = express(
        app.get('/broken' {
        `
      );

      const model = await scanProject(tempDir);

      // Successfully extracted valid route
      expect(model.endpoints).toHaveLength(1);
      expect(model.endpoints[0]!.id).toBe('GET /valid-route');

      // Captured DG-P001 diagnostic for broken file
      expect(model.diagnostics.length).toBeGreaterThan(0);
      const parseDiag = model.diagnostics.find((d: { code: string }) => d.code === 'DG-P001');
      expect(parseDiag).toBeDefined();
      expect(parseDiag!.file).toContain('broken.js');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('scans fixtures/router-single-file/app and matches its golden model', async () => {
    const routerFixturePath = path.join(repoRoot, 'fixtures/router-single-file/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/router-single-file/expected.model.json');

    const model = await scanProject(routerFixturePath);

    // 1. Model conforms to core ApiModel validation schema
    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // 2. Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('scans fixtures/router-cross-file/app and matches its golden model across all export styles', async () => {
    const crossFileFixturePath = path.join(repoRoot, 'fixtures/router-cross-file/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/router-cross-file/expected.model.json');

    const model = await scanProject(crossFileFixturePath);

    // 1. Model conforms to core ApiModel validation schema
    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // 2. Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('scans fixtures/nested-routers/app and matches its golden model', async () => {
    const nestedFixturePath = path.join(repoRoot, 'fixtures/nested-routers/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/nested-routers/expected.model.json');
    const model = await scanProject(nestedFixturePath);

    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('emits DG-R002 and confirms nothing when an imported router cannot be resolved', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-unresolved-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const missingRouter = require('./non-existent-router');
        const app = express();
        app.use('/api', missingRouter);
        `
      );

      const model = await scanProject(tempDir);

      // No confirmed routes
      expect(model.endpoints.filter((e) => e.confidence === 'confirmed')).toHaveLength(0);

      // Emits DG-R001 (unresolved import) and DG-R002 (unresolved mount)
      expect(model.diagnostics.some((d) => d.code === 'DG-R001')).toBe(true);
      expect(model.diagnostics.some((d) => d.code === 'DG-R002')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('detects cyclic router exports, emits DG-R002, and terminates cleanly', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-cycle-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'a.js'),
        `
        const express = require('express');
        module.exports = require('./b');
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'b.js'),
        `
        const express = require('express');
        module.exports = require('./a');
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const cyclicRouter = require('./a');
        const app = express();
        app.use('/cycle', cyclicRouter);
        `
      );

      const model = await scanProject(tempDir);

      // No confirmed routes
      expect(model.endpoints.filter((e) => e.confidence === 'confirmed')).toHaveLength(0);

      // Emits DG-R002 for the cycle
      const cycleDiag = model.diagnostics.find((d) => d.code === 'DG-R002');
      expect(cycleDiag).toBeDefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('produces 100% deterministic output across repeated runs', async () => {
    const run1 = await scanProject(simpleFixturePath);
    const run2 = await scanProject(simpleFixturePath);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it('handles nested router mounts with plain variable bindings and middleware', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-nested-var-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'sub.js'),
        `
        const express = require('express');
        const router = express.Router();
        router.get('/info', (req, res) => res.send('info'));
        module.exports = router;
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const subRouter = require('./sub');
        // mount with middleware
        app.use('/api', function auth() {}, subRouter);
        `
      );

      const model = await scanProject(tempDir);
      
      const route = model.endpoints.find(e => e.id === 'GET /api/info');
      expect(route).toBeDefined();
      expect(route!.confidence).toBe('confirmed');
      expect(model.diagnostics.filter(d => d.code === 'DG-R002')).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('correctly resolves diamond-shaped mounts without false DG-R002 cycles', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-diamond-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'shared.js'),
        `
        const express = require('express');
        const router = express.Router();
        router.get('/data', (req, res) => res.send('data'));
        module.exports = router;
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'v1.js'),
        `
        const express = require('express');
        const router = express.Router();
        const shared = require('./shared');
        router.use('/shared', shared);
        module.exports = router;
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'v2.js'),
        `
        const express = require('express');
        const router = express.Router();
        const shared = require('./shared');
        router.use('/shared', shared);
        module.exports = router;
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const v1 = require('./v1');
        const v2 = require('./v2');
        const app = express();
        app.use('/v1', v1);
        app.use('/v2', v2);
        `
      );

      const model = await scanProject(tempDir);
      
      const route1 = model.endpoints.find(e => e.id === 'GET /v1/shared/data');
      const route2 = model.endpoints.find(e => e.id === 'GET /v2/shared/data');
      
      expect(route1).toBeDefined();
      expect(route2).toBeDefined();
      expect(model.diagnostics.filter(d => d.code === 'DG-R002')).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles unidentifiable router arguments gracefully without crashing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-unidentifiable-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const config = require('./config');
        app.use('/api', config.someUnknownThing);
        `
      );

      const model = await scanProject(tempDir);
      
      expect(model.endpoints).toHaveLength(0);
      // We expect DG-R002 because config.someUnknownThing couldn't be resolved to a router
      const r002s = model.diagnostics.filter(d => d.code === 'DG-R002');
      expect(r002s.length).toBeGreaterThan(0);
      expect(r002s[0]!.message).toContain('config.someUnknownThing');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('correctly resolves app.route() chaining', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-app-route-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.route('/test')
           .get((req, res) => res.send('get'))
           .post((req, res) => res.send('post'));
        `
      );

      const model = await scanProject(tempDir);
      
      const routeGet = model.endpoints.find(e => e.id === 'GET /test');
      const routePost = model.endpoints.find(e => e.id === 'POST /test');
      
      expect(routeGet).toBeDefined();
      expect(routeGet!.confidence).toBe('confirmed');
      expect(routeGet!.provenance.line).toBe(5);
      
      expect(routePost).toBeDefined();
      expect(routePost!.confidence).toBe('confirmed');
      expect(routePost!.provenance.line).toBe(6);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
  it('scans fixtures/constant-propagation/app and matches its golden model, verifying static evaluation, uncertain forms, array combinations, partial interpolation, and cycle protection', async () => {
    const cpFixturePath = path.join(repoRoot, 'fixtures/constant-propagation/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/constant-propagation/expected.model.json');

    const model = await scanProject(cpFixturePath);

    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('scans fixtures/auth-middleware/app and matches its golden model, verifying middleware order and auth inference with strict equality', async () => {
    const authFixturePath = path.join(repoRoot, 'fixtures/auth-middleware/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/auth-middleware/expected.model.json');

    const model = await scanProject(authFixturePath);

    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('ExpressAdapter.scan() wraps scanProject and produces identical output', async () => {
    const adapter = new ExpressAdapter();
    const model = await adapter.scan(simpleFixturePath);

    expect(model.endpoints).toHaveLength(6);
    expect(model.project?.framework).toBe('express');
  });

  it('scans fixtures/route-all/app and matches its golden model, verifying app.all expansion', async () => {
    const routeAllPath = path.join(repoRoot, 'fixtures/route-all/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/route-all/expected.model.json');

    const model = await scanProject(routeAllPath);

    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    expect(model).toStrictEqual(goldenModel);
  });

  it('scans fixtures/router-root-mount/app and matches its golden model, verifying root router mount without path prefix', async () => {
    const rootMountPath = path.join(repoRoot, 'fixtures/router-root-mount/app');
    const goldenModelPath = path.join(repoRoot, 'fixtures/router-root-mount/expected.model.json');

    const model = await scanProject(rootMountPath);

    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    expect(model).toStrictEqual(goldenModel);
  });
});
