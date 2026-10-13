import { describe, it, expect } from 'vitest';
import { createDiagnostic, DIAGNOSTICS_REGISTRY, DiagnosticCodeSchema } from '../src/index.js';

describe('Diagnostics Registry & Factory', () => {
  it('contains the registered diagnostic codes', () => {
    const codes = DiagnosticCodeSchema.options;
    expect(codes).toEqual(['MT-P001', 'MT-R001', 'MT-R002', 'MT-R003', 'MT-R004', 'MT-I001', 'MT-I002']);
    expect(Object.keys(DIAGNOSTICS_REGISTRY)).toEqual(['MT-P001', 'MT-R001', 'MT-R002', 'MT-R003', 'MT-R004', 'MT-I001', 'MT-I002']);
  });

  it('creates MT-P001 parse error diagnostic with default severity', () => {
    const diag = createDiagnostic('MT-P001', {
      file: 'server.js',
      reason: 'Unexpected token (14:2)',
    });

    expect(diag.code).toBe('MT-P001');
    expect(diag.severity).toBe('error');
    expect(diag.file).toBe('server.js');
    expect(diag.message).toBe('Failed to parse file "server.js": Unexpected token (14:2)');
  });

  it('creates MT-R001 unresolved import diagnostic with provenance and file/line', () => {
    const diag = createDiagnostic(
      'MT-R001',
      {
        importPath: './routes/users',
        sourceFile: 'app.ts',
      },
      {
        provenance: { kind: 'literal', filePath: 'app.ts', line: 4, column: 1 },
      },
    );

    expect(diag.code).toBe('MT-R001');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('app.ts');
    expect(diag.line).toBe(4);
    expect(diag.message).toBe('Could not resolve import "./routes/users" from "app.ts"');
    expect(diag.provenance?.filePath).toBe('app.ts');
  });

  it('creates MT-R002 unresolved router mount diagnostic', () => {
    const diag = createDiagnostic(
      'MT-R002',
      {
        mountPath: '/api/v2',
        routerIdentifier: 'v2Router',
      },
      {
        file: 'src/app.js',
        line: 18,
      },
    );

    expect(diag.code).toBe('MT-R002');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('src/app.js');
    expect(diag.line).toBe(18);
    expect(diag.message).toBe(
      'Could not resolve router mounted at "/api/v2" for identifier "v2Router"',
    );
  });

  it('creates MT-R003 dynamic path diagnostic and allows severity override', () => {
    const diag = createDiagnostic(
      'MT-R003',
      {
        rawExpression: 'prefix + "/items"',
      },
      {
        severity: 'warning',
        file: 'routes/dynamic.js',
        line: 15,
      },
    );

    expect(diag.code).toBe('MT-R003');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('routes/dynamic.js');
    expect(diag.line).toBe(15);
    expect(diag.message).toBe('Route path uses dynamic runtime expression: prefix + "/items"');
  });

  it('creates MT-R004 unmounted router diagnostic', () => {
    const diag = createDiagnostic(
      'MT-R004',
      {
        routerIdentifier: 'orphanRouter',
      },
      {
        file: 'src/app.js',
        line: 26,
      },
    );

    expect(diag.code).toBe('MT-R004');
    expect(diag.severity).toBe('warning');
    expect(diag.file).toBe('src/app.js');
    expect(diag.line).toBe(26);
    expect(diag.message).toBe('Router "orphanRouter" is declared but never mounted to the application');
  });

  it('creates MT-I001 unresolved handler diagnostic with handlerName', () => {
    const diag = createDiagnostic(
      'MT-I001',
      {
        handlerName: 'customHandler',
        reason: 'external package',
      },
      {
        file: 'routes/users.js',
        line: 12,
      },
    );

    expect(diag.code).toBe('MT-I001');
    expect(diag.severity).toBe('info');
    expect(diag.file).toBe('routes/users.js');
    expect(diag.line).toBe(12);
    expect(diag.message).toBe('Route handler could not be statically resolved: customHandler (external package)');
  });

  it('creates MT-I002 unresolved middleware diagnostic with middlewareName', () => {
    const diag = createDiagnostic(
      'MT-I002',
      {
        middlewareName: 'dynamicMw',
        reason: 'dynamic require',
      },
      {
        file: 'src/app.js',
        line: 25,
      },
    );

    expect(diag.code).toBe('MT-I002');
    expect(diag.severity).toBe('info');
    expect(diag.file).toBe('src/app.js');
    expect(diag.line).toBe(25);
    expect(diag.message).toBe('Middleware could not be statically resolved: dynamicMw (dynamic require)');
  });
});
