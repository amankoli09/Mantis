import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/index.js';

describe('AST Parser (parseFile)', () => {
  it('parses valid CommonJS code without diagnostics', () => {
    const code = `
      const express = require('express');
      const app = express();
      app.get('/health', (req, res) => res.send('OK'));
    `;
    const result = parseFile(code, 'app.js');

    expect(result.ast).not.toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it('parses valid ESM code without diagnostics', () => {
    const code = `
      import express from 'express';
      const app = express();
      app.post('/items', (req, res) => res.json({ ok: true }));
      export default app;
    `;
    const result = parseFile(code, 'app.mjs');

    expect(result.ast).not.toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it('tolerates syntax errors, never throws, and emits MT-P001 diagnostic', () => {
    const badCode = `
      const express = require('express')
      const app = express(
      // Missing closing parenthesis & broken syntax
      app.get('/broken' {
    `;

    const result = parseFile(badCode, 'broken.js');

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const diag = result.diagnostics[0]!;
    expect(diag.code).toBe('MT-P001');
    expect(diag.severity).toBe('error');
    expect(diag.file).toBe('broken.js');
    expect(diag.line).toBeGreaterThanOrEqual(1);
    expect(diag.message).toContain('Failed to parse file "broken.js"');
  });
});
