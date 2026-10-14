# Mantis Status Report

_Status as of October 8, 2026._

---

## 1. Project Goal

Mantis is an automated, framework-agnostic static analysis security and testing tool for backend REST APIs.
It statically inspects backend source code (without running or executing application code) to reconstruct an exhaustive, deterministic API Model capturing all HTTP routes, parameters, authentication requirements, and mutation effects.
Phase 1 focuses on Node.js/Express backends, parsing JavaScript ASTs to extract direct routes, subrouters, cross-file mounts, constant propagation, and request body/parameter accesses.

---

## 2. Steps Completed

| Step        | Scope                                                                                                                       |  Status  | Commit / Reference                 |
| :---------- | :-------------------------------------------------------------------------------------------------------------------------- | :------: | :--------------------------------- |
| **Step 1**  | Monorepo setup, tooling (pnpm, tsup, vitest, eslint, typescript), directory layout                                          | **Done** | `223c316`                          |
| **Step 2**  | API Model specification & Zod schemas (`@mantis/core`)                                                                    | **Done** | `dd9559c`                          |
| **Step 3**  | Fixture creation: simple single-file Express app                                                                            | **Done** | `b01ee3e`                          |
| **Step 4**  | AST parsing pipeline, deterministic file walker, and Express detector                                                       | **Done** | `8ebfdb4`                          |
| **Step 5**  | Direct route extraction (`app.get`, `app.post`, etc.)                                                                       | **Done** | `4b71946`                          |
| **Step 6**  | Router-level routes & local mounts (`express.Router()`, `app.use()`, `router.use()`)                                        | **Done** | `687dfba`                          |
| **Step 7a** | Cross-file imports & module graph resolution (`require`, `import`)                                                          | **Done** | `029705a`                          |
| **Step 7b** | Nested routers, deep mounts (`app.use -> router.use -> subrouter`), and route chaining (`app.route()`)                      | **Done** | `2ec27ff`                          |
| **Step 7c** | Constant propagation (literal strings, templates, binary `+`, path arrays, cyclic guard)                                    | **Done** | `2ca4f41`                          |
| **Step 7d** | Uncertain expressions, placeholder normalization (`<EXPRESSION>`), line-level provenance checks                             | **Done** | `3cf5f84`                          |
| **Step 8a** | Parameter & body-field inference (`req.params`, `req.query`, `req.body`), `MT-I001` unresolvable handler                    | **Done** | PR #4 (`4c71850`)                  |
| **Step 8b** | Middleware chain order & authentication detection (`bearer`, `apiKey`, `cookie`, `custom`), `MT-I002` unresolved middleware | **Done** | PR #6 (`8c03227`)                  |
| **Step 8c** | Effect refinement from handler bodies (Prisma, Mongoose, Sequelize, Knex, pg, fs, fetch, monotonic risk rule)              | **Done** | Issue #11                          |
| **Step 8d** | Zod validation extraction (handler `parse`/`safeParse`, `validate(schema)` middleware, field constraints, resolved provenance, targeted test generators) | **Done** | Issue #12                          |
| **Step 9**  | Config file, safe HTTP runner, host guard, limits, secret redaction, session recording (`@mantis/runner`)                 | **Done** | PR #15 (`c9d0603`)                 |
| **Step 10** | Test planner, input generators, response oracles, planted-bugs fixture, Report schema (`@mantis/core`)                    | **Done** | PR #8 (`feat-test-engine-step-10`) |
| **Step 11** | Cross-analysis static vs runtime (404 in code, live unmodeled routes, error consistency, auth-enforced oracle)               | **Done** | Issue #13                          |
| **Step 12** | CLI `mantis scan`, `test`, `report`, and `init` commands with terminal formatting & JSON output (`@mantis/cli`)         | **Done** | PR #9 (`feat-cli-step-12`)         |
| **Step 13** | Benchmark on real open-source Express repos, precision/recall evaluation, top failure fixes (`benchmarks/`) | **Done** | PR #10 (`10-issue-7-benchmark-on-real-open-source-express-repos-step-13`) |
| **Phase 1.5** | OpenAPI 3.0 export (`--openapi`), GitHub Action & CI recipes, Diff mode (`mantis diff`), HTML test reports (`--html`), FileSystem abstraction, `MT-R004` split, ADRs 0001-0006 | **Done** | Issue #14 |
| **Phase 1 Exit Check** | CLI binary execution fix (shebang dedup, root `pnpm mantis` script, built dist tests) | **Done** | Exit Check Day 1 |
| **M1-02** | Rebranding to Mantis (packages, CLI binary, config, diagnostics `MT-`, schemas, docs, CI check) | **Done** | Issue #24 |
| **M1-03** | Real-world open-source Express benchmark validation (5 repos, ground truth, precision/recall) | **Done** | Issue #25 |
| **M1-04** | Safety red-team hardening (threat model, localhost validation, DNS pin, traversal, secrets check) | **Done** | Issue #26 |
| **M1-05** | False-positive review & oracle tuning (`--min-confidence`, `confidenceReason`, canned unit tests) | **Done** | Issue #27 |

---

## 3. Repository Structure

```
Mantis/
├── packages/
│   ├── core/                  # Core API Model definitions, Zod validation schemas, diagnostics registry
│   │   ├── src/schema/        # model.ts, endpoint.ts, params.ts, diagnostics.ts, provenance.ts
│   │   └── src/utils/         # sort.ts, validator.ts, helpers.ts
│   ├── adapter-express/       # Express AST analyzer and static route extractor
│   │   ├── src/detector.ts    # Detects Express project framework and entrypoints
│   │   ├── src/file-walker.ts # Deterministic file traversal excluding node_modules/git
│   │   ├── src/parser.ts      # Babel AST parser with tolerant error recovery (MT-P001)
│   │   ├── src/module-graph.ts# Multi-file dependency graph and export resolver
│   │   ├── src/extract/       # Focused route extraction engine
│   │   │   ├── types.ts           # Shared domain interfaces (PendingRouterRoute, ExtractedMount, etc.)
│   │   │   ├── path-evaluator.ts  # Constant evaluation, template literals, placeholder formatting
│   │   │   ├── handler-resolver.ts# Inline, local, and 1-hop imported controller function resolution
│   │   │   ├── param-inference.ts # Parameter & body field AST inference (req.params/query/body)
│   │   │   ├── declarations.ts    # Per-file AST extraction of apps, routers, routes, and mounts
│   │   │   ├── mount-resolver.ts  # Cross-file mount resolution, DFS traversal, mountChain
│   │   │   └── route-extractor.ts # Thin orchestrator wiring declarations and mount resolver
│   │   ├── src/route-extractor.ts # Backward compatibility shim re-exporting extract/route-extractor.js
│   │   └── src/scanner.ts     # Main orchestrator (ExpressAdapter.scan / scanProject)
│   ├── runner/                # Phase 2 test runner (scaffolded)
│   └── cli/                   # Phase 3 command-line interface (scaffolded)
├── fixtures/                  # Real Express test applications and expected golden models
│   ├── simple/                # Single-file Express app with direct HTTP routes
│   ├── router-single-file/    # Local express.Router() instances and unmounted orphan router
│   ├── router-cross-file/     # Multi-file router exports (default, named, re-exports)
│   ├── nested-routers/        # Multi-level nested routers, router chaining, runtime dynamic path
│   ├── constant-propagation/  # String constants, template literals, array mounts, cyclic variables
│   └── inference-basic/       # Handler parameter & body field extraction, destructuring, renames
└── docs/                      # Architectural documentation, decisions, learning logs, and diagnostics
```

---

## 4. How a Scan Works End-to-End

When `ExpressAdapter.scan(projectRoot)` (or `scanProject(projectRoot)`) executes:

1. **Project Identification (`scanner.ts`)**: Resolves project name from `package.json` (or root directory name) and establishes relative paths.
2. **Deterministic File Walk (`file-walker.ts`)**: Discovers all `.js`, `.cjs`, `.mjs`, `.ts` files, skipping `node_modules`, hidden files, and build directories.
3. **Module Graph Construction (`module-graph.ts`)**: Resolves imports and requires across project files, indexing CommonJS and ESM export bindings. Emits `MT-R001` if an import target cannot be located.
4. **AST Parsing (`parser.ts`)**: Parses each discovered file using Babel parser. If syntax errors occur, captures a `MT-P001` diagnostic and continues scanning.
5. **Local Declarations Extraction (`extract/declarations.ts`)**: Extracts routes, router instances, and local mounts for each file. Evaluates paths via `extract/path-evaluator.ts`. If paths contain runtime expressions, formats `<EXPRESSION>` placeholders and emits `MT-R003`.
6. **Handler Parameter Inference (`extract/param-inference.ts` via `extract/handler-resolver.ts`)**: Locates the route handler (inline function, local function, single-hop imported identifier, or array of middleware). Identifies the request parameter binding (regardless of parameter name) and extracts `req.params.x`, `req.query.x`, `req.body.x`, bracket accesses, and destructuring with renames. If unresolvable, emits `MT-I001`.
7. **Cross-File Route Resolution (`extract/mount-resolver.ts`)**: Traverses the mount hierarchy using depth-first search, tracking `mountChain` (file and line of each mount step) from application root down to subrouters. Emits `MT-R002` for unresolved or cyclic mounts.
8. **Sorting and Validation (`scanner.ts`)**: Sorts endpoints deterministically by HTTP method and normalized path, sorts diagnostics, validates against `validateModel()` in `@mantis/core`, and returns the final `ApiModel`.

---

## 5. Scanner Capabilities & Deliberate Exclusions

### What the scanner detects today:

- Direct routes on Express applications (`app.get`, `app.post`, `app.put`, `app.delete`, etc.).
- Router definitions (`express.Router()`) and mounts (`app.use('/prefix', router)`, `router.use()`).
- Nested multi-level router mounts (`app.use -> router.use -> subrouter`).
- Route chaining (`router.route('/path').get(...).post(...)`).
- Multi-file exports (CommonJS `module.exports = router`, `exports.r = router`, ESM default/named exports, and re-exports).
- Constant propagation for string literals, binary concatenation (`+`), template literals (with static expressions), and path arrays (`app.get(['/a', '/b'], ...)`).
- Cyclic import and mount loop detection without infinite recursion.
- Dynamic paths replaced with normalized `<EXPRESSION>` placeholders and marked `confidence: "uncertain"`.
- Request parameter extraction (`req.params`, `req.query`) and request body property extraction (`req.body`) via member access, bracket string literals, and object destructuring.
- Handler identification via inline functions, local functions, single-hop imported controllers, and handler arrays.

### What the scanner deliberately does NOT handle yet (Phase 1 Steps 8b–13):

- Middleware classifications and global middleware semantics (Step 8b).
- Authentication detection: Bearer tokens, cookies, API keys, public vs protected routes (Step 8b).
- Route effect inference: statically detecting whether a route mutates data or is read-only (Step 8c).
- Schema validation inference: Zod, Joi, or express-validator integration (Step 8d).
- Whole-object passing: passing `req.body` to another function does not guess fields.
- Computed dynamic keys (e.g., `req.body[computedVar]`).
- Complex multi-hop re-export chains or dynamic handler factory functions (emits `MT-I001`).

---

## 6. The API Model Specification (`v1.1.0`)

### Core Endpoint Fields

- `id`: Canonical identifier (`"METHOD /path"`).
- `method`: HTTP verb (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`).
- `path`: Normalized path string.
- `auth`: Authentication requirements (`type`: `'none' | 'bearer' | 'apiKey' | 'cookie' | 'custom' | 'unknown'`).
- `effect`: Mutation effect (`'read' | 'write' | 'destructive' | 'unknown'`).
- `params`: Array of parameters (`name`, `in: 'path' | 'query' | 'header' | 'body'`, `required`, `type`, `provenance`). Single source of truth for individual fields.
- `requestBody`: Optional whole-payload metadata (`contentType`, whole-payload schema).
- `mountChain`: Ordered list of router mounts from application root to handler (`filePath`, `line`).
- `provenance`: Origin tracking (`kind: 'literal' | 'resolved' | 'inferred' | 'unresolved'`, `filePath`, `line`, `column`, `snippet`).
- `confidence`: `'confirmed' | 'uncertain'`.
- `confidenceReason`: Diagnostic code if uncertain (`MT-R002`, `MT-R003`).

### Diagnostic Codes

- **`MT-P001`**: Parse Error (`error`) — File syntax error preventing AST parsing.
- **`MT-R001`**: Unresolved Import (`warning`) — Missing imported file in module graph.
- **`MT-R002`**: Unresolved Router Mount (`warning`) — Mounted router identifier cannot be resolved or forms a cycle.
- **`MT-R003`**: Dynamic Path (`info`) — Path uses runtime variable/expression; replaced with `<EXPRESSION>`.
- **`MT-I001`**: Unresolved Handler (`info`) — Handler is not an inline function, local function, single-hop import, or handler array.

---

## 7. Fixtures Summary

1. **`fixtures/simple`**: Single-file Express app testing direct route extraction, path parameters, and body inference. Golden model updated to remove unproven `requestBody` blocks.
2. **`fixtures/router-single-file`**: Single-file app testing `express.Router()` mounts and unmounted orphan router emitting `MT-R002`.
3. **`fixtures/router-cross-file`**: Multi-file app testing CommonJS exports, named exports, re-exports, and shared routers across multiple mount prefixes.
4. **`fixtures/nested-routers`**: Deeply nested routers (`app -> users -> admin`), route chaining (`.route()`), and dynamic path expressions emitting `MT-R003`. Unproven `requestBody` block removed.
5. **`fixtures/constant-propagation`**: Path constant propagation, string concatenation, template literals, array mounts, and cyclic variable protection.
6. **`fixtures/inference-basic`**: 10 routes testing parameter and body-field inference (`req.params`, `req.query`, `req.body`), destructuring, renames, non-req names (`request`, `r`), imported controllers, handler arrays, shadowing, and `MT-I001`.

---

## 8. Quality Gates Status

- `pnpm lint`: Pass (0 errors, 0 warnings).
- `pnpm typecheck`: Pass (`tsc -b` exits 0).
- `pnpm test`: Pass (320/320 tests passing across 33 test files).
- `pnpm build`: Pass (all packages bundle cleanly via tsup).

---

## 9. Recent Decisions & Clarifications

1. **Process Enforcement**: No changes are committed or applied to golden files without explicit "approved" command from user.
2. **Params vs requestBody (Single Source of Truth)**: `params` is the single source of truth for individual fields across all locations (`path`, `query`, `header`, `body`). `requestBody` holds only whole-payload metadata.
3. **requestBody Cleanup**: Hand-written, unproven `requestBody` blocks in `fixtures/simple` and `fixtures/nested-routers` have been removed.
4. **Golden Strength**: A plan is proposed to upgrade all golden files to `modelVersion: "1.1.0"`, populate `mountChain`, and upgrade scan tests to `toStrictEqual()` with full diagnostics checking.
5. **Diagnostics Documented**: Full reference documentation created in `docs/diagnostics.md`.
6. **CLI Execution & Shebang Fix**: In pnpm monorepos, a package's own `bin` is not linked to its own `node_modules/.bin`. Workspace root provides `"mantis": "node packages/cli/dist/index.js"` for contributors (`pnpm mantis <cmd>`). Fixed duplicate shebang in `packages/cli/dist/index.js` and `index.cjs` by removing redundant `tsup` banner, and added integration tests in `packages/cli/tests/built-cli.test.ts` asserting executable permissions, shebang validity, and fixture scanning on built artifacts.

---

## 10. Roadmap: Remaining Steps

- **Step 8b**: Auth & middleware detection (Bearer, API keys, session cookies, public vs protected routes).
- **Step 8c**: Handler mutation effects (read vs write vs destructive).
- **Step 8d**: Schema validation inference (Zod, Joi, express-validator schemas into requestBody/params).
- **Step 9**: Runner engine architecture & safe execution harness.
- **Step 10**: CLI commands (`mantis scan`, `mantis test`).
- **Step 11**: End-to-end integration and dogfooding.
- **Step 12**: Performance optimization and caching.
- **Step 13**: Final documentation and release packaging.
