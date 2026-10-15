# Changelog

All notable changes to Mantis will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-14

### Added

- **API Model Schema (`v1.2.0`)**: Standardized, framework-agnostic AST model capturing endpoints, HTTP methods, normalized routes, parameters, whole-payload request bodies, authentication evidence, handler mutation effects, and provenance with exact file and line numbers.
- **Express Static Analysis Adapter (`@mantis/adapter-express`)**:
  - Deterministic AST extraction using `@babel/parser` and `@babel/traverse`.
  - Direct routes (`app.get`, `app.post`, `app.put`, `app.delete`, `app.patch`, `app.all()`, etc.).
  - Router hierarchies (`express.Router()`, `app.use()`, `router.use()`, nested subrouters).
  - Multi-file module graph resolution for CommonJS (`require`) and ESM (`import`) across JavaScript and TypeScript.
  - Route chaining (`app.route()`, `router.route()`), root mounts, and exported route factories.
  - Path constant propagation, string concatenation, and dynamic placeholder normalization (`<EXPRESSION>`) with capped length and collapsed whitespace.
  - Parameter extraction from `req.params`, `req.query`, `req.headers`, and `req.body`.
  - Middleware order tracking and authentication inference (`bearer`, `apiKey`, `cookie`, `custom`).
  - AST mutation effect inference (Mongoose, Prisma, Sequelize, Knex, pg, fs, fetch/axios) adhering to the Monotonic Risk Rule (`read` < `write` < `destructive`).
  - Zod validation extraction for route handlers and `validate()` middleware with JSON Schema constraint mapping.
- **Safety-First Test Runner (`@mantis/runner`)**:
  - Safe mode by default: restricts execution strictly to `read` mutation effects.
  - Host Guard: strictly permits only local loopbacks (`localhost`, `127.0.0.1`, `[::1]`) by default, with DNS resolution verification against DNS rebinding, bind-all address rejection (`0.0.0.0`, `::`), and remote URL opt-in (`allowRemote: true`).
  - Rejection of obfuscated IP representations, non-HTTP/HTTPS protocols, and embedded credentials.
  - Direct connection dispatcher bypassing ambient `HTTP_PROXY` and `HTTPS_PROXY` environment variables.
  - Hardened limits: request timeout (`limits.timeoutMs`), response byte streaming caps (`limits.maxResponseBytes`), concurrency gating, and non-fatal network failure handling.
  - Credential redaction: automatic stripping and replacement of authorization headers, query secrets, and response body tokens with `[REDACTED]`.
  - Directory traversal prevention for report output paths (`--out`).
  - AST-only static analysis with zero runtime evaluation of target application code.
- **Test Engine & Response Oracles (`@mantis/core`)**:
  - Boundary value and type mutation input generators for schema-defined and inferred parameters.
  - Pure response oracles:
    - `no-5xx-on-bad-input`: Flags unhandled server crashes on malformed/invalid inputs.
    - `server-error-on-valid-input`: Flags 5xx crashes on baseline requests (with conservative `low` confidence).
    - `no-stack-trace-leak`: Detects framework error dumps, call stacks, and internal file paths.
    - `no-sensitive-fields`: Recursively scans JSON payloads for leaked credentials or hashes (with smart auth-route token exemptions and non-secret exclusions).
    - `auth-enforced`: Flags endpoints with verified auth requirements that permit unauthenticated access (exempting optional auth).
  - Cross-analysis oracles:
    - `route-in-code-404-live`: Flags modeled routes that return 404 at runtime.
    - `live-route-not-in-code`: Flags undocumented endpoints reachable at runtime via probe paths.
    - `consistency/status-code-deviation`: Detects outlier error codes across sibling endpoints.
    - `consistency/error-response-shape`: Flags inconsistent error payload JSON structures.
  - Deterministic confidence calibration (`low`, `medium`, `high`) and `--min-confidence` threshold filtering.
- **Unified Command-Line Interface (`@mantis/cli`)**:
  - `mantis init`: Generates atomic, starter `mantis.config.json` with safe defaults.
  - `mantis scan <path>`: Statically analyzes Express codebases with `--json`, `--openapi`, and `--verbose` options.
  - `mantis test [path]`: Executes safe runtime tests with `--dry-run`, `--allow-write`, `--allow-destructive`, `--allow-remote`, `--fail-on`, and `--min-confidence`.
  - `mantis report [session]`: Offline session replay using pure oracles with zero network traffic.
  - `mantis diff <fileA> <fileB>`: Compares ApiModels or test Reports to detect introduced/removed endpoints or findings.
  - Terminal formatters with ANSI color toggle, progress summaries, and standalone HTML reports (`--html`).
- **Empirical Validation & Benchmarks**:
  - Benchmarked against 5 open-source Express repositories (`node-todo`, `express-mongoose-es6-rest-api`, `express-rest-es2017-boilerplate`, `node-express-boilerplate`, `realworld`).
  - Documented ground truth, precision, recall, and known architectural limitations.
