import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync, promises as fs } from 'node:fs';
import os from 'node:os';
import { validateModel, type ApiModel } from '@mantis/core';
import { scanProject } from '../src/index.js';

describe('Parameter & Body-Field Inference (Step 8a)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const fixturePath = path.join(repoRoot, 'fixtures/inference-basic/app');
  const goldenModelPath = path.join(repoRoot, 'fixtures/inference-basic/expected.model.json');

  it('scans fixtures/inference-basic/app and matches its golden model across all 10 routes and diagnostics', async () => {
    const model = await scanProject(fixturePath);

    // 1. Model conforms to core ApiModel validation schema
    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // 2. Strict deep equality against complete golden model
    expect(model).toStrictEqual(goldenModel);
  });

  it('destructuring with rename extracts original request property key, not the local variable name', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-rename-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.post('/test', (req, res) => {
          const { originalKey: renamedVar } = req.body;
          res.json({ renamedVar });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(1);
      expect(ep.params[0]!.name).toBe('originalKey');
      expect(ep.params[0]!.in).toBe('body');
      expect(ep.params[0]!.required).toBe('unknown');
      expect(ep.params[0]!.type).toBe('unknown');
      expect(ep.params[0]!.provenance?.kind).toBe('inferred');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('binds request by parameter binding regardless of name (request, r, customReq)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-binding-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/custom', (customReq, res) => {
          const filter = customReq.query.filter;
          res.json({ filter });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(1);
      expect(ep.params[0]!.name).toBe('filter');
      expect(ep.params[0]!.in).toBe('query');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles bracket access with string literals and skips computed keys', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-bracket-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const computedKey = 'dyn';
        app.post('/test', (req, res) => {
          const valid = req['body']['validKey'];
          const skipped = req.body[computedKey];
          res.json({ valid, skipped });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      // Only validKey is inferred; computedKey is skipped
      expect(ep.params).toHaveLength(1);
      expect(ep.params[0]!.name).toBe('validKey');
      expect(ep.params[0]!.in).toBe('body');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('whole-object passing does not guess fields and leaves body params empty', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-whole-object-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        function process(data) { return data; }
        app.post('/save', (req, res) => {
          process(req.body);
          res.send('ok');
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toEqual([]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles parameter object pattern destructuring', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-param-destruct-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/pattern', ({ query: { page, limit } }, res) => {
          res.json({ page, limit });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(2);
      expect(ep.params[0]!.name).toBe('limit');
      expect(ep.params[0]!.in).toBe('query');
      expect(ep.params[1]!.name).toBe('page');
      expect(ep.params[1]!.in).toBe('query');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('emits MT-I001 diagnostic when route handler is unresolvable', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-unresolved-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/unresolved', createHandler('arg'));
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      expect(model.endpoints[0]!.params).toEqual([]);
      expect(model.diagnostics.some((d) => d.code === 'MT-I001' && d.message.includes("createHandler('arg')"))).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sorts parameters deterministically: path -> query -> header -> body then name', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-sort-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.post('/items/:bId/:aId', (req, res) => {
          const zBody = req.body.zBody;
          const aBody = req.body.aBody;
          const zQuery = req.query.zQuery;
          const aQuery = req.query.aQuery;
          res.json({ zBody, aBody, zQuery, aQuery });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params.map((p) => `${p.in}:${p.name}`)).toEqual([
        'path:aId',
        'path:bId',
        'query:aQuery',
        'query:zQuery',
        'body:aBody',
        'body:zBody',
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('extracts req.query.x and req.params.x correctly', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-query-param-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/users/:userId', (req, res) => {
          const uId = req.params.userId;
          const filter = req.query.filter;
          const sort = req.query.sort;
          res.json({ uId, filter, sort });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(3);
      expect(ep.params[0]!.name).toBe('userId');
      expect(ep.params[0]!.in).toBe('path');
      expect(ep.params[0]!.required).toBe(true);
      expect(ep.params[1]!.name).toBe('filter');
      expect(ep.params[1]!.in).toBe('query');
      expect(ep.params[1]!.required).toBe('unknown');
      expect(ep.params[2]!.name).toBe('sort');
      expect(ep.params[2]!.in).toBe('query');
      expect(ep.params[2]!.required).toBe('unknown');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves one-hop imported controller function from another file', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-controller-'));
    try {
      await fs.mkdir(path.join(tempDir, 'controllers'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'controllers', 'orders.js'),
        `
        function listOrders(req, res) {
          const status = req.query.status;
          res.json({ status });
        }
        module.exports = { listOrders };
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const { listOrders } = require('./controllers/orders');
        const app = express();
        app.get('/orders', listOrders);
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(1);
      expect(ep.params[0]!.name).toBe('status');
      expect(ep.params[0]!.in).toBe('query');
      expect(ep.params[0]!.provenance?.filePath).toContain('controllers/orders.js');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves handler array picking the last function element', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-handler-array-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const m1 = (req, res, next) => next();
        const m2 = (req, res, next) => next();
        app.post('/submit', [m1, m2, (req, res) => {
          const token = req.body.token;
          res.json({ token });
        }]);
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(1);
      expect(ep.params[0]!.name).toBe('token');
      expect(ep.params[0]!.in).toBe('body');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('ignores shadowed req parameter in nested callbacks', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-shadow-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/shadow', (req, res) => {
          const q = req.query.activeQuery;
          const list = [1, 2].map((req) => req.shadowProp);
          res.json({ q, list });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      // activeQuery is inferred; shadowProp from the inner map callback parameter is ignored
      expect(ep.params).toHaveLength(1);
      expect(ep.params[0]!.name).toBe('activeQuery');
      expect(ep.params[0]!.in).toBe('query');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('detects header parameters from req.headers', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-inference-headers-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/protected', (req, res) => {
          const auth = req.headers['authorization'];
          const apiKey = req.headers.apiKey;
          res.json({ auth, apiKey });
        });
        `
      );

      const model = await scanProject(tempDir);
      expect(model.endpoints).toHaveLength(1);
      const ep = model.endpoints[0]!;
      expect(ep.params).toHaveLength(2);
      expect(ep.params.map(p => `${p.in}:${p.name}`)).toEqual([
        'header:apiKey',
        'header:authorization',
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
