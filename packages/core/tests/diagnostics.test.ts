import { describe, it, expect } from 'vitest';
import { createDiagnostic, DIAGNOSTICS_REGISTRY, DiagnosticCodeSchema } from '../src/index.js';

describe('Diagnostics Registry & Factory', () => {
  it('contains the registered diagnostic codes', () => {
    const codes = DiagnosticCodeSchema.options;
    expect(codes).toEqual(['DG-P001', 'DG-R001', 'DG-R002', 'DG-R003', 'DG-R004', 'DG-I001', 'DG-I002']);
    expect(Object.keys(DIAGNOSTICS_REGISTRY)).toEqual(['DG-P001', 'DG-R001', 'DG-R002', 'DG-R003', 'DG-R004', 'DG-I001', 'DG-I002']);
  });

  it('creates DG-P001 parse error diagnostic with default severity', () => {
    const diag = createDiagnostic('DG-P001', {
      file: 'server.js',
      reason: 'Unexpected token (14:2)',
    });

    expect(diag.code).toBe('DG-P001');
    expect(diag.severity).toBe('error');
    expect(diag.file).toBe('server.js');
    expect(diag.message).toBe('Failed to parse file "server.js": Unexpected token (14:2)');
  });

  it('creates DG-R001 unresolved import diagnostic with provenance and file/line', () => {
    const diag = createDiagnostic(
      'DG-R001',
      {
        importPath: './routes/users',
        sourceFile: 'app.ts',
      },
      {
        provenance: { kind: 'literal', filePath: 'app.ts', line: 4, column: 1 },
      },
    );

    expect(diag.code).toBe('DG-R001');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('app.ts');
    expect(diag.line).toBe(4);
    expect(diag.message).toBe('Could not resolve import "./routes/users" from "app.ts"');
    expect(diag.provenance?.filePath).toBe('app.ts');
  });

  it('creates DG-R002 unresolved router mount diagnostic', () => {
    const diag = createDiagnostic(
      'DG-R002',
      {
        mountPath: '/api/v2',
        routerIdentifier: 'v2Router',
      },
      {
        file: 'src/app.js',
        line: 18,
      },
    );

    expect(diag.code).toBe('DG-R002');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('src/app.js');
    expect(diag.line).toBe(18);
    expect(diag.message).toBe(
      'Could not resolve router mounted at "/api/v2" for identifier "v2Router"',
    );
  });

  it('creates DG-R003 dynamic path diagnostic and allows severity override', () => {
    const diag = createDiagnostic(
      'DG-R003',
      {
        rawExpression: 'prefix + "/items"',
      },
      {
        severity: 'warning',
        file: 'routes/dynamic.js',
        line: 15,
      },
    );

    expect(diag.code).toBe('DG-R003');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('routes/dynamic.js');
    expect(diag.line).toBe(15);
    expect(diag.message).toBe('Route path uses dynamic runtime expression: prefix + "/items"');
  });

  it('creates DG-R004 unmounted router diagnostic', () => {
    const diag = createDiagnostic(
      'DG-R004',
      {
        routerIdentifier: 'orphanRouter',
      },
      {
        file: 'src/app.js',
        line: 26,
      },
    );

    expect(diag.code).toBe('DG-R004');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('src/app.js');
    expect(diag.line).toBe(26);
    expect(diag.message).toBe('Router "orphanRouter" is declared but never mounted to the application');
  });

  it('creates DG-I001 unresolved handler diagnostic with handlerName', () => {
    const diag = createDiagnostic(
      'DG-I001',
      {
        handlerName: 'customHandler',
        reason: 'external package',
      },
      {
        file: 'routes/users.js',
        line: 12,
      },
    );

    expect(diag.code).toBe('DG-I001');
    expect(diag.severity).toBe('info');
    expect(diag.file).toBe('routes/users.js');
    expect(diag.line).toBe(12);
    expect(diag.message).toBe('Route handler could not be statically resolved: customHandler (external package)');
  });

  it('creates DG-I002 unresolved middleware diagnostic with middlewareName', () => {
    const diag = createDiagnostic(
      'DG-I002',
      {
        middlewareName: 'dynamicMw',
        reason: 'dynamic require',
      },
      {
        file: 'src/app.js',
        line: 25,
      },
    );

    expect(diag.code).toBe('DG-I002');
    expect(diag.severity).toBe('info');
    expect(diag.file).toBe('src/app.js');
    expect(diag.line).toBe(25);
    expect(diag.message).toBe('Middleware could not be statically resolved: dynamicMw (dynamic require)');
  });
});
