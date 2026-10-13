# ADR 0002: API Model Schema Version 1.2.0

## Context

Step 8b introduces static detection of middleware and authentication requirements per endpoint. In Express, middleware execution order depends on registration sequence across application-level uses (`app.use`), mount-level arguments (`app.use('/prefix', mw, router)`), router-level uses (`router.use`), and route-level arguments (`app.get('/path', mw, handler)`).

In previous schema versions (`v1.0.0` and `v1.1.0`):
1. `Endpoint.middleware` was a flat array of strings (`string[]`), losing source provenance (the source file, line number, and column where the middleware was registered).
2. `Endpoint.auth` had no `evidence` field recording the file, line, and signal proving why an endpoint is classified as `bearer`, `apiKey`, `cookie`, or `custom`.
3. Unresolvable middleware expressions had no dedicated diagnostic code.
4. `ApiModel.modelVersion` accepted only `'1.0.0'` or `'1.1.0'`.

## Decision

Bump `modelVersion` to `'1.2.0'` with a backward-compatible schema upgrade:

1. **`modelVersion`**: Accept `'1.0.0'`, `'1.1.0'`, or `'1.2.0'`, emitting `'1.2.0'` by default.
2. **`Endpoint.middleware`**: Support structured entries `Array<{ name: string; provenance?: Provenance }>` while continuing to accept legacy string arrays (`string[]`).
3. **`Endpoint.auth.evidence`**: Add optional `evidence` field: `{ filePath: string; line: number; signal: string }`.
4. **Diagnostics**: Register `MT-I002` (`severity: 'info'`): Middleware could not be statically resolved.

## Consequences

- **Backward Compatibility**: Existing fixtures and models with string middleware or no `auth.evidence` remain valid under `validateModel()`.
- **Downstream Consumers**: Security scanners and test runners can determine exactly which middleware protects a route, in what order, and with what proof.
- **Traceability**: All auth classifications link directly to the source code line and concrete signal.
