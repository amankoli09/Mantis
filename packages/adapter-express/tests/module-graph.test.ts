import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import {
  buildModuleGraph,
  resolveSpecifier,
  extractModuleInfo,
} from '../src/index.js';
import { parseFile } from '../src/parser.js';

describe('Module Graph (packages/adapter-express)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const nestedRoutersRoot = path.join(repoRoot, 'fixtures/nested-routers/app');

  it('links app.js to routes/users.js and routes/products.js with correct bindings in fixtures/nested-routers', async () => {
    const graph = await buildModuleGraph(nestedRoutersRoot);

    expect(graph.diagnostics).toEqual([]);
    expect(graph.nodes.has('app.js')).toBe(true);
    expect(graph.nodes.has('routes/users.js')).toBe(true);
    expect(graph.nodes.has('routes/products.js')).toBe(true);

    const appNode = graph.nodes.get('app.js')!;
    expect(appNode.imports).toHaveLength(3);

    // 1. const express = require('express')
    const expressImport = appNode.imports.find((i) => i.localName === 'express');
    expect(expressImport).toBeDefined();
    expect(expressImport!.isExternal).toBe(true);
    expect(expressImport!.sourcePath).toBeNull();
    expect(expressImport!.importedName).toBe('default');

    // 2. const usersRouter = require('./routes/users')
    const usersImport = appNode.imports.find((i) => i.localName === 'usersRouter');
    expect(usersImport).toBeDefined();
    expect(usersImport!.isExternal).toBe(false);
    expect(usersImport!.sourcePath).toBe('routes/users.js');
    expect(usersImport!.importedName).toBe('default');
    expect(usersImport!.specifier).toBe('./routes/users');
    expect(usersImport!.line).toBe(4);

    // 3. const productsRouter = require('./routes/products')
    const productsImport = appNode.imports.find((i) => i.localName === 'productsRouter');
    expect(productsImport).toBeDefined();
    expect(productsImport!.isExternal).toBe(false);
    expect(productsImport!.sourcePath).toBe('routes/products.js');
    expect(productsImport!.importedName).toBe('default');
    expect(productsImport!.specifier).toBe('./routes/products');
    expect(productsImport!.line).toBe(5);

    // Verify app.js export: module.exports = app;
    expect(appNode.exports).toHaveLength(1);
    expect(appNode.exports[0]).toEqual({
      exportedName: 'default',
      localName: 'app',
      line: 15,
    });

    // Verify routes/users.js export: module.exports = router;
    const usersNode = graph.nodes.get('routes/users.js')!;
    expect(usersNode.exports).toHaveLength(1);
    expect(usersNode.exports[0]).toEqual({
      exportedName: 'default',
      localName: 'router',
      line: 27,
    });

    // Verify routes/products.js export: module.exports = router;
    const productsNode = graph.nodes.get('routes/products.js')!;
    expect(productsNode.exports).toHaveLength(1);
    expect(productsNode.exports[0]).toEqual({
      exportedName: 'default',
      localName: 'router',
      line: 21,
    });
  });

  it('resolves directory index files (.js, .cjs, .mjs)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-index-test-'));
    try {
      await fs.mkdir(path.join(tempDir, 'controllers'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'controllers/index.js'),
        'module.exports = { userCtrl: () => {} };'
      );
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        "const { userCtrl } = require('./controllers');\nmodule.exports = userCtrl;"
      );

      const graph = await buildModuleGraph(tempDir);
      expect(graph.diagnostics).toEqual([]);

      const appNode = graph.nodes.get('app.js')!;
      expect(appNode.imports).toHaveLength(1);
      expect(appNode.imports[0]!.localName).toBe('userCtrl');
      expect(appNode.imports[0]!.importedName).toBe('userCtrl');
      expect(appNode.imports[0]!.sourcePath).toBe('controllers/index.js');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves extension guessing (.js, .cjs, .mjs)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-ext-test-'));
    try {
      await fs.writeFile(path.join(tempDir, 'helper.cjs'), 'exports.help = () => true;');
      await fs.writeFile(
        path.join(tempDir, 'main.js'),
        "const { help } = require('./helper');\nmodule.exports = help;"
      );

      const graph = await buildModuleGraph(tempDir);
      expect(graph.diagnostics).toEqual([]);

      const mainNode = graph.nodes.get('main.js')!;
      expect(mainNode.imports[0]!.sourcePath).toBe('helper.cjs');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('marks bare specifiers as external and does not follow them', async () => {
    const res = resolveSpecifier('express', 'app.js', '/fake/root');
    expect(res.isExternal).toBe(true);
    expect(res.sourcePath).toBeNull();

    const res2 = resolveSpecifier('node:path', 'app.js', '/fake/root');
    expect(res2.isExternal).toBe(true);
    expect(res2.sourcePath).toBeNull();
  });

  it('emits MT-R001 diagnostic for missing relative file without crashing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-missing-test-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        "const missing = require('./non-existent-route');\nmodule.exports = missing;"
      );

      const graph = await buildModuleGraph(tempDir);
      expect(graph.diagnostics).toHaveLength(1);

      const diag = graph.diagnostics[0]!;
      expect(diag.code).toBe('MT-R001');
      expect(diag.severity).toBe('warning');
      expect(diag.file).toBe('app.js');
      expect(diag.line).toBe(1);
      expect(diag.message).toContain('Could not resolve import "./non-existent-route" from "app.js"');

      const appNode = graph.nodes.get('app.js')!;
      expect(appNode.imports).toHaveLength(1);
      expect(appNode.imports[0]!.sourcePath).toBeNull();
      expect(appNode.imports[0]!.isExternal).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('emits MT-R001 diagnostic for require(variable) calls without crashing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-dynamic-req-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'app.js'),
        "const dynamicPath = './routes/' + name;\nconst r = require(dynamicPath);\nmodule.exports = r;"
      );

      const graph = await buildModuleGraph(tempDir);
      expect(graph.diagnostics).toHaveLength(1);

      const diag = graph.diagnostics[0]!;
      expect(diag.code).toBe('MT-R001');
      expect(diag.file).toBe('app.js');
      expect(diag.line).toBe(2);

      const appNode = graph.nodes.get('app.js')!;
      expect(appNode.imports).toHaveLength(1);
      expect(appNode.imports[0]!.specifier).toBe('<dynamic>');
      expect(appNode.imports[0]!.sourcePath).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles cyclic dependencies cleanly and terminates without infinite loops', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-cycle-test-'));
    try {
      // a.js requires b.js
      await fs.writeFile(
        path.join(tempDir, 'a.js'),
        "const b = require('./b');\nmodule.exports = { name: 'a', b };"
      );
      // b.js requires a.js
      await fs.writeFile(
        path.join(tempDir, 'b.js'),
        "const a = require('./a');\nmodule.exports = { name: 'b', a };"
      );

      const graph = await buildModuleGraph(tempDir);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.nodes.size).toBe(2);

      const nodeA = graph.nodes.get('a.js')!;
      const nodeB = graph.nodes.get('b.js')!;

      expect(nodeA.imports[0]!.sourcePath).toBe('b.js');
      expect(nodeB.imports[0]!.sourcePath).toBe('a.js');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles comprehensive ESM and CJS import and export patterns', () => {
    const code = `
      import defaultImport from './modA';
      import { named1, named2 as alias2 } from './modB';
      import * as namespaceImport from './modC';
      
      const cjsDefault = require('./modD');
      const { cjsNamed1, cjsNamed2: cjsAlias2 } = require('./modE');
      
      export default function main() {}
      export { named1, alias2 as exportedAlias };
      export const exportedConst1 = 1, exportedConst2 = 2;
      
      module.exports = {
        propA: 10,
        propB: alias2,
      };
      exports.extra = 'hello';
    `;

    const parsed = parseFile(code, 'comprehensive.js');
    expect(parsed.ast).toBeDefined();

    const info = extractModuleInfo(parsed.ast!, 'comprehensive.js', '/fake/root');

    // Imports check
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'defaultImport', importedName: 'default', specifier: './modA' })
    );
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'named1', importedName: 'named1', specifier: './modB' })
    );
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'alias2', importedName: 'named2', specifier: './modB' })
    );
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'namespaceImport', importedName: '*', specifier: './modC' })
    );
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'cjsDefault', importedName: 'default', specifier: './modD' })
    );
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'cjsNamed1', importedName: 'cjsNamed1', specifier: './modE' })
    );
    expect(info.imports).toContainEqual(
      expect.objectContaining({ localName: 'cjsAlias2', importedName: 'cjsNamed2', specifier: './modE' })
    );

    // Exports check
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'default', localName: 'main' })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'named1', localName: 'named1' })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'exportedAlias', localName: 'alias2' })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'exportedConst1', localName: 'exportedConst1' })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'exportedConst2', localName: 'exportedConst2' })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'propA', localName: null })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'propB', localName: 'alias2' })
    );
    expect(info.exports).toContainEqual(
      expect.objectContaining({ exportedName: 'extra', localName: null })
    );
  });

  it('handles re-export patterns: module.exports = require() and export from', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-reexport-test-'));
    try {
      await fs.writeFile(
        path.join(tempDir, 'actual-router.js'),
        'module.exports = { route: true };'
      );
      // routes/index.js re-exports actual-router.js via module.exports = require(...)
      await fs.writeFile(
        path.join(tempDir, 'routes-index.js'),
        "module.exports = require('./actual-router');"
      );
      // esm-reexport.js re-exports via export { a } from './b' and export * from './b'
      await fs.writeFile(
        path.join(tempDir, 'esm-reexport.js'),
        "export { route as myRoute } from './actual-router';\nexport * from './actual-router';"
      );

      const graph = await buildModuleGraph(tempDir);
      expect(graph.diagnostics).toEqual([]);

      const cjsReexportNode = graph.nodes.get('routes-index.js')!;
      expect(cjsReexportNode.imports).toContainEqual(
        expect.objectContaining({
          importedName: 'default',
          specifier: './actual-router',
          sourcePath: 'actual-router.js',
        })
      );
      expect(cjsReexportNode.exports).toContainEqual(
        expect.objectContaining({
          exportedName: 'default',
          localName: null,
        })
      );

      const esmReexportNode = graph.nodes.get('esm-reexport.js')!;
      expect(esmReexportNode.imports).toContainEqual(
        expect.objectContaining({
          importedName: 'route',
          specifier: './actual-router',
          sourcePath: 'actual-router.js',
        })
      );
      expect(esmReexportNode.exports).toContainEqual(
        expect.objectContaining({
          exportedName: 'myRoute',
        })
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('strictly prevents resolving paths escaping outside the project root', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantis-escape-test-'));
    const subDir = path.join(tempDir, 'project');
    const outsideFile = path.join(tempDir, 'outside-secret.js');

    try {
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(outsideFile, 'module.exports = "secret";');
      await fs.writeFile(
        path.join(subDir, 'app.js'),
        "const secret = require('../outside-secret');\nmodule.exports = secret;"
      );

      const graph = await buildModuleGraph(subDir);
      // Must not resolve outside file and must emit MT-R001
      expect(graph.diagnostics).toHaveLength(1);
      expect(graph.diagnostics[0]!.code).toBe('MT-R001');
      expect(graph.diagnostics[0]!.file).toBe('app.js');

      const appNode = graph.nodes.get('app.js')!;
      expect(appNode.imports[0]!.sourcePath).toBeNull();
      expect(appNode.imports[0]!.isExternal).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('produces deterministic output across repeated graph builds', async () => {
    const run1 = await buildModuleGraph(nestedRoutersRoot);
    const run2 = await buildModuleGraph(nestedRoutersRoot);

    const serialize = (g: typeof run1) =>
      JSON.stringify({
        nodes: Array.from(g.nodes.entries()),
        diagnostics: g.diagnostics,
      });

    expect(serialize(run1)).toBe(serialize(run2));
  });
});
