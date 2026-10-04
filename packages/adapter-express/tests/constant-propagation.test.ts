import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { scanProject, formatPlaceholder } from '../src/index.js';

describe('Constant Propagation & Dynamic Paths (Step 7d)', () => {
  it('resolvable forms: resolves string constant path (const BASE = "/api")', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-string-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const BASE = '/api';
        app.get(BASE, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.path === '/api');
      expect(ep).toBeDefined();
      expect(ep?.confidence).toBe('confirmed');
      expect(ep?.provenance.kind).toBe('resolved');
      expect(model.diagnostics).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolvable forms: resolves binary string concatenation path (BASE + "/v1")', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-concat-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const BASE = '/api';
        const FULL = BASE + '/v1';
        app.get(FULL, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.path === '/api/v1');
      expect(ep).toBeDefined();
      expect(ep?.confidence).toBe('confirmed');
      expect(ep?.provenance.kind).toBe('resolved');
      expect(model.diagnostics).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolvable forms: resolves template literal path with embedded constants (`${BASE}/v2`)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-template-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const BASE = '/api';
        app.get(\`\${BASE}/v2/users\`, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.path === '/api/v2/users');
      expect(ep).toBeDefined();
      expect(ep?.confidence).toBe('confirmed');
      expect(ep?.provenance.kind).toBe('resolved');
      expect(model.diagnostics).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolvable forms: resolves path array expressions (["/a", "/b"]) generating multiple endpoints', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-array-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get(['/a', '/b'], (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const epA = model.endpoints.find((e) => e.path === '/a');
      const epB = model.endpoints.find((e) => e.path === '/b');
      expect(epA).toBeDefined();
      expect(epB).toBeDefined();
      expect(epA?.confidence).toBe('confirmed');
      expect(epB?.confidence).toBe('confirmed');
      expect(model.diagnostics).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolvable forms: resolves imported constant across files (const { API_PREFIX } = require("./config"))', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-import-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'config.js'),
        `
        const API_PREFIX = '/api';
        module.exports = { API_PREFIX };
        `
      );
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const config = require('./config');
        app.get(config.API_PREFIX + '/health', (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.path === '/api/health');
      expect(ep).toBeDefined();
      expect(ep?.confidence).toBe('confirmed');
      expect(ep?.provenance.kind).toBe('resolved');
      expect(model.diagnostics).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uncertain forms: marks reassigned let variable as uncertain with DG-R003', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-let-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        let pathVar = '/initial';
        pathVar = '/changed';
        app.get(pathVar, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.path).toBe('/<pathVar>');
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      expect(model.diagnostics.some((d) => d.code === 'DG-R003')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uncertain forms: marks process.env path expression as uncertain with DG-R003', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-env-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const envPath = process.env.BASE_PATH;
        app.get(envPath, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.path).toBe('/<process.env.BASE_PATH>');
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      expect(model.diagnostics.some((d) => d.code === 'DG-R003')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uncertain forms: marks runtime function call as uncertain with DG-R003', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-func-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        function getPath() { return '/func'; }
        app.get(getPath(), (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.path).toBe('/<getPath()>');
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      expect(model.diagnostics.some((d) => d.code === 'DG-R003')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uncertain forms: marks regex path expression as uncertain with DG-R003', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-regex-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get(/.*regex.*/, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.path).toBe('/</.*regex.*/>');
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      expect(model.diagnostics.some((d) => d.code === 'DG-R003')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('partial resolution: replaces dynamic portion with placeholder and preserves resolvable prefix', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-partial-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const PREFIX = '/api/v1';
        app.get(PREFIX + '/' + getDynamicSegment(), (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.path).toBe('/api/v1/<getDynamicSegment()>');
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      expect(model.diagnostics.some((d) => d.code === 'DG-R003')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('cyclic constants: terminates safely on mutually recursive constants and marks uncertain', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-cycle-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const A = B;
        const B = A;
        app.get(A, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.path).toBe('/<A>');
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      expect(model.diagnostics.some((d) => d.code === 'DG-R003')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('array product cap: caps array product (>100 combinations) and emits DG-R003 diagnostic', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-cap-'));
    try {
      // 11 prefixes * 10 suffixes = 110 combinations > 100 cap
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        const prefixes = ['/a1', '/a2', '/a3', '/a4', '/a5', '/a6', '/a7', '/a8', '/a9', '/a10', '/a11'];
        const suffixes = ['/b1', '/b2', '/b3', '/b4', '/b5', '/b6', '/b7', '/b8', '/b9', '/b10'];
        app.get(prefixes + suffixes, (req, res) => {});
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      expect(ep?.confidenceReason).toBe('DG-R003');
      expect(ep?.provenance.kind).toBe('unresolved');
      const capDiag = model.diagnostics.find((d) => d.code === 'DG-R003' && d.message.includes('Array product cap exceeded'));
      expect(capDiag).toBeDefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('placeholder normalization: formatPlaceholder collapses whitespace and caps length at 60 chars', () => {
    // 1. Whitespace collapsing
    expect(formatPlaceholder('   someFunc(   param1,  \n\t param2   )  ')).toBe('<someFunc( param1, param2 )>');

    // 2. Exact 60 chars (no truncation)
    const exact60 = 'a'.repeat(60);
    expect(formatPlaceholder(exact60)).toBe(`<${exact60}>`);

    // 3. Truncation when exceeding 60 chars (capped at 60 chars inside <...>)
    const long70 = 'a'.repeat(70);
    const expectedTruncated = 'a'.repeat(57) + '...';
    expect(formatPlaceholder(long70)).toBe(`<${expectedTruncated}>`);
    expect(expectedTruncated).toHaveLength(60);
  });

  it('placeholder normalization in scanner: collapses multiline whitespace and caps long dynamic expression', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-cp-norm-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        `
        const express = require('express');
        const app = express();
        app.get(
          computeVeryLongDynamicRouteSegmentWithLotsOfParametersAndContext(
            argOne,
            argTwo,
            argThree
          ),
          (req, res) => {}
        );
        `
      );

      const model = await scanProject(tempDir);
      const ep = model.endpoints.find((e) => e.confidence === 'uncertain');
      expect(ep).toBeDefined();
      // Ensure path matches /<truncated...>
      expect(ep?.path.startsWith('/<')).toBe(true);
      expect(ep?.path.endsWith('>')).toBe(true);
      // Inner placeholder content (without /< and >) should be at most 60 chars
      const inner = ep!.path.slice(2, -1);
      expect(inner.length).toBeLessThanOrEqual(60);
      expect(inner.endsWith('...')).toBe(true);
      expect(inner.includes('\n')).toBe(false);
      expect(inner.includes('  ')).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
