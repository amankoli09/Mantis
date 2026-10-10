# DevGuard Learning Log

## Step 1: Repo Skeleton & Tooling Setup

### Overview

In Step 1, we established a foundational TypeScript monorepo workspace for DevGuard Core. The setup prepares 4 core packages (`core`, `adapter-express`, `runner`, `cli`) with unified formatting, linting, type-checking, building, testing, and continuous integration.

---

### Tooling Choices & Rationale

#### 1. Package Manager: `pnpm` Monorepo Workspaces

- **Why pnpm?**
  - **Fast and storage-efficient**: Uses a content-addressable store and hard links on your machine so the same package version is never duplicated across packages.
  - **Strict isolation**: Unlike npm or yarn classic, pnpm does not allow phantom dependencies (importing packages not declared in that specific package's `package.json`). This ensures clean modular boundaries between `@devguard/core`, `@devguard/adapter-express`, `@devguard/runner`, and `@devguard/cli`.
  - **Native workspace support**: Configured via `pnpm-workspace.yaml`, allowing us to execute commands across all packages using `pnpm -r <command>`.

#### 2. Compiler & Type Checker: TypeScript Strict Mode (`tsconfig.base.json`)

- **Strict Mode (`"strict": true`)**: Enables all strict type-checking options (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.), eliminating entire categories of runtime bugs before code is ever run.
- **Module System (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`)**: Modern standard for ECMAScript modules in Node.js, ensuring seamless import/export interoperability.
- **Project References (`tsc -b`)**: Root `tsconfig.json` references individual package `tsconfig.json` files. `tsc -b` builds and typechecks packages in topological dependency order incrementally.

#### 3. Code Quality: ESLint Flat Config (`eslint.config.js`) + Prettier (`.prettierrc`)

- **ESLint (Flat Config format)**: We used the modern flat configuration standard (`eslint.config.js`), combining `@eslint/js` recommended rules and `typescript-eslint` recommended rules.
- **Prettier Integration**: Used `eslint-config-prettier` to disable any ESLint rules that might conflict with Prettier, keeping linting focused purely on code correctness and Prettier focused purely on code formatting.

#### 4. Bundler: `tsup`

- **Why tsup?**
  - Powered by `esbuild`, making compilation nearly instantaneous.
  - Generates both ESM (`.js`) and CommonJS (`.cjs`) outputs alongside TypeScript declaration files (`.d.ts` and `.d.cts`) without requiring complex rollup or webpack configs.

#### 5. Testing Framework: `Vitest`

- **Why Vitest?**
  - Native ESM and TypeScript execution with zero build/transpilation step needed during tests.
  - Fast execution with multi-threaded runners.
  - Jest-compatible API (`describe`, `it`, `expect`).

#### 6. Continuous Integration: GitHub Actions (`.github/workflows/ci.yml`)

- Triggers on every pull request and push to the `main` branch.
- Validates the complete pipeline: dependency installation (`pnpm install --frozen-lockfile`), linting (`pnpm lint`), type checking (`pnpm typecheck`), unit testing (`pnpm test`), and bundling (`pnpm build`).

---

## Step 2: Core API Model & Diagnostics (`@devguard/core`)

### Overview

In Step 2, we designed and implemented the central **API Model** (`ApiModel`) schema, diagnostic registry, adapter interface, deterministic endpoint helpers, and automated JSON Schema generation inside `@devguard/core` aligned with `docs/PLAN.md`.

---

### New Dependencies & Rationale

- `zod`: Provides runtime schema validation and automated TypeScript static type inference for `ApiModel` without type duplication.
- `zod-to-json-schema`: Converts our TypeScript/Zod models into standard draft-07 JSON Schema files for language-agnostic consumers.
- `tsx`: Lightweight TypeScript execution CLI to run our automated build script (`pnpm run gen:schema`) directly.
- `@types/node`: Standard Node.js TypeScript ambient type definitions for built-in modules (`node:fs`, `node:path`, `node:url`) and runtime globals.

---

### 🧠 Core Concept to Understand: Why Provenance Matters

In static analysis and developer tooling, **provenance** refers to recording _where a fact came from_ (`filePath`, `line`, `column`, `snippet`) and _how it was determined_ (`kind`: `'literal'`, `'resolved'`, `'inferred'`, or `'unresolved'`).

**Why is Provenance essential?**

1. **Pillar 1: Evidence-Carrying Model**: Nothing is asserted without evidence. A route or query parameter doesn't just exist in the abstract; the model carries proof of the exact source file and line where it was declared or read.
2. **Actionable Developer Feedback**: When DevGuard identifies a bug (e.g. `500 on POST /users`), it links the finding directly back to `src/routes/users.js:42`, allowing developers to click straight to the source line in their IDE.
3. **Distinguishing Direct vs Inferred Facts**:
   - `literal`: Statically written as a constant (e.g. `router.get('/users', ...)`).
   - `resolved`: Computed deterministically (e.g. `const BASE = '/api'`, router prefix concatenation).
   - `inferred`: Deduced by observing variable usage (e.g. `req.body.email` read in handler body).
   - `unresolved`: Ambiguous runtime patterns that the static scanner could not fully trace.
4. **Transparent Resolution & Confidence**: When an endpoint has `confidence: "uncertain"`, provenance and the required `confidenceReason` (e.g. `DG-R002` for unresolved router mounts) provide full transparency into analyzer limitations rather than silently dropping or guessing routes.

---

### Model Schema Highlights

- **`confidence`**: Strict binary status (`'confirmed' | 'uncertain'`). If `uncertain`, a `confidenceReason` referencing a registered Diagnostic Code is strictly required.
- **`effect`**: Classified as `'read' | 'write' | 'destructive' | 'unknown'`. Safe mode will only test `'read'` endpoints by default.
- **Deterministic Helpers**:
  - `generateEndpointId(method, path)` produces stable uppercase `"METHOD /path"`.
  - `sortEndpoints()` performs strictly locale-independent code-point sorting (`compareStrings`) ensuring identical output regardless of system environment or input permutation.

---

### Diagnostic Registry

We established the initial set of structured diagnostic codes:

- `DG-P001` (`error`): Parse error when an input source file has syntax errors.
- `DG-R001` (`warning`): Unresolved import when a route/controller file cannot be found on disk.
- `DG-R002` (`warning`): Unresolved router mount when a middleware or router identifier cannot be bound.
- `DG-R003` (`info`): Dynamic path notice when a route uses runtime string variables instead of string literals.

Every diagnostic captures `code`, `severity`, `message`, and source location (`file`, `line`).

---

### Verification Summary

- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅ (8 test suites, 23 passing tests)
- `pnpm run gen:schema` ✅ (Generated `packages/core/api-model.schema.json`)
- `pnpm build` ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 3: Fixtures first**: Build `fixtures/simple` and `fixtures/nested-routers` with hand-written `expected.model.json` files and validate them against the schema.

---

## Step 3: Fixtures First — Writing Expected Output Before the Code

### Overview

In Step 3, we did **no scanner work**. Instead, we built two human-readable Express fixture apps and hand-wrote their expected API Model output (`expected.model.json`) *before* any parsing code exists. We also wrote two test files that verify the golden files are internally consistent.

---

### 🧠 Core Concept: Why Write Expected Output Before the Code?

This is the **golden-file discipline**: write down exactly what a correct implementation must produce, *before building the implementation*, for several compounding reasons:

1. **Forces clarity on the contract.** You cannot hand-write a golden file without having resolved every ambiguous schema question (what does `provenance.kind` mean for a chained route? what does `path` contain when the expression is a variable?). The act of writing the golden file is itself a design activity.

2. **Makes tests falsifiable.** A test written *after* the code is working tends to assert whatever the code already returns. A test written from a golden file written *before* the code asserts what the code *should* return — it can actually fail when the implementation is wrong.

3. **Baseline for regression.** Once the scanner exists and produces output for a fixture, diffing against the golden file is the primary signal that something changed. If the diff is expected (schema bump, new field), a human reviews and approves the update. If it's unexpected, the CI gate fails.

4. **Documentation that stays in sync.** Unlike a doc comment that can drift, a golden file is *executed* on every CI run against real fixture code. The provenance line-check test even verifies that every `line` field in the golden file refers to a real, non-empty line in the fixture source — so the golden file cannot silently become wrong as the fixture code changes.

5. **Step 4 can be developed incrementally.** The scanner team (or the next AI step) can run `pnpm test` immediately and see 0/44 fixture endpoints matching — then incrementally reach 44/44 without needing to invent the "correct answer" themselves.

---

### Fixture Design Decisions

#### `fixtures/simple` — Single file, 6 routes

- All routes use `app.get/post/put/delete` with **literal** string paths → `provenance.kind: "literal"`.
- `effect` is inferred from the HTTP verb: GET → `read`, POST/PUT → `write`, DELETE → `destructive`.
- `auth` is always `{ type: "unknown" }` — no middleware is visible.
- `requestBody.provenance` is `kind: "inferred"` because we read from `req.body.email` (not from a schema declaration).

#### `fixtures/nested-routers` — 3 files, 5 routes

- Routes declared on a `express.Router()` and mounted with `app.use('/api', router)` → full path is concatenated at analysis time → `provenance.kind: "resolved"`.
- `router.route('/users').get(...).post(...)` chaining: each `.get()` and `.post()` call is a separate endpoint; the provenance `line` points to the line of the `.get(` or `.post(` call (not the `router` or `.route(` line).
- One route uses a **runtime variable** as the path argument (`router.get(PRODUCT_DETAIL_PATH, ...)`). This is the uncertain case:
  - `confidence: "uncertain"`, `confidenceReason: "DG-R003"`
  - `provenance.kind: "unresolved"`
  - `path` stores the placeholder `"/api/products/<PRODUCT_DETAIL_PATH>"` so the endpoint is still representable in the model.
  - A `DG-R003` diagnostic is emitted pointing to the exact line.

#### Provenance Line Integrity

The `provenance-line-check.test.ts` test walks every `provenance` entry (endpoint, params, requestBody) in every golden file and:
1. Asserts the referenced file exists on disk.
2. Asserts `line` is within the file's total line count.
3. Asserts the line is non-empty.
4. If `snippet` is provided, asserts it matches the actual line (trimmed).

This means updating a fixture file and forgetting to update the golden file will cause a test failure — exactly the intended behaviour.

---

### Configuration Notes

- **ESLint**: `fixtures/*/app/**` added to the ignore list. Fixture apps are plain CJS JavaScript with intentional "undefined" references (e.g. `getDetailSegment()`) that would fail `no-undef`.
- **TypeScript** (`tsc -b`): Fixture apps are plain `.js` files with no `tsconfig.json`, so they are never visited by `tsc -b` (which only traverses the project references in the root `tsconfig.json`).
- **Vitest**: Added `vitest.config.ts` at the workspace root to exclude `.kilo/worktrees/**` (Kilo Code git worktrees) from test discovery. Without this, Vitest would try to run tests from a worktree whose `node_modules` is incomplete.

---

### Verification Summary

- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅ (10 test files, 44 tests — 20 new fixture tests)
- `pnpm build` ✅
- Both golden files validate against `validateModel()` ✅
- All provenance line references verified against real fixture code ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 4: Express detection and file walking**: Detect Express via `package.json` and imports; walk files respecting ignore rules. Done when detection works on all fixtures and a non-Express folder is rejected cleanly.

---

## Step 4: Express Detection & Deterministic File Walking (`@devguard/adapter-express`)

### Overview

In Step 4, we implemented the framework detection heuristics and filesystem traversal mechanics in `@devguard/adapter-express`. This provides the foundation for Step 5 (AST parsing) by safely and deterministically finding candidate JavaScript source files and verifying whether a project is an Express application.

---

### 🧠 Core Concept: Why File Walking Must Be Deterministic

Static analysis and developer tooling must be **reproducible across machines, operating systems, and executions**. File walking order directly affects downstream AST parsing and module graph construction:

1. **OS-dependent directory iteration**: Different operating systems and filesystems (APFS on macOS, NTFS on Windows, ext4 on Linux) return directory entries (`readdir`) in arbitrary, non-guaranteed orders (often inode order or hash table order).
2. **Deterministic diagnostics and graph building**: If file `A.js` and file `B.js` both define or export routers, processing them in different orders across CI runs could lead to non-deterministic diagnostic order or module graph resolution races.
3. **Flaky tests and snapshot stability**: When tests or golden files assert ordered lists of scanned files, routes, or warnings, any non-determinism leads to flaky CI builds.
4. **Code-point sorting guarantee**: By strictly sorting all file paths using unicode code-point ordering (`a < b ? -1 : a > b ? 1 : 0`), we guarantee byte-for-byte identical output regardless of what OS or filesystem executes DevGuard.

---

### Detection Architecture & Evidence Signals

`detectExpress(projectRoot)` returns rich structured evidence (`DetectionResult`), not just a boolean:

1. **Primary Evidence (`package.json`)**:
   - Parses `package.json` at project root.
   - Checks `dependencies.express` → `{ detected: true, signal: 'package.json:dependencies', file: 'package.json' }`.
   - Checks `devDependencies.express` → `{ detected: true, signal: 'package.json:devDependencies', file: 'package.json' }`.
2. **Secondary Evidence (Source Imports)**:
   - If `package.json` is absent or doesn't declare `express`, walks source files and performs lightweight regex search for `require('express')` or `import ... from 'express'`.
   - Emits `signal: 'source:require'` or `signal: 'source:import'` with the relative source file path.
3. **Rejection**:
   - If no evidence matches, returns `{ detected: false, signal: 'none', file: null }`.
4. **Adapter Wrapper**:
   - `ExpressAdapter.prototype.detect(projectRoot)` wraps `detectExpress` and returns `boolean` conforming to `FrameworkAdapter`.

---

### Edge Case Handling

- **Symlinks & Circular Loops**: File walker checks `dirent.isSymbolicLink()` and ignores them. It never traverses directory symlinks or file symlinks, preventing infinite recursion and escapes outside the project root.
- **Huge Files**: Files exceeding `maxFileSizeBytes` (default 1 MB) are skipped from source reading and recorded in `skippedHugeFiles: string[]`.
- **Ignore Rules**: Standard non-source and build output folders are skipped by default (`node_modules`, `dist`, `build`, `coverage`, `.git`).
- **Path Normalization**: All paths are converted to root-relative paths using standard forward slashes (`/`), ensuring cross-platform consistency across Windows and POSIX systems.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 errors across all packages)
- `pnpm test` ✅ (12 test suites passed, 63/63 tests — 19 new detector & file-walker tests)
- `pnpm build` ✅ (Clean dual ESM/CJS/DTS builds across all 4 packages)
- `fixtures/simple` & `fixtures/nested-routers` detected ✅
- `fixtures/not-express` rejected ✅
- Package.json-less express and non-express folders handled correctly ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 5: Parsing and direct routes**: Parse JavaScript files to AST (tolerant of syntax errors with `DG-P001`); extract `app.get/post/put/patch/delete('/path', ...)` with method, path, file, and line; verify `simple` fixture output matches its golden file.

---

## Step 5: AST Parsing & Scope-Aware Direct Route Extraction (`@devguard/adapter-express`)

### Overview

In Step 5, we implemented AST parsing and direct Express route extraction inside `@devguard/adapter-express`. We wired this into `ExpressAdapter.prototype.scan(projectRoot)`, generating a fully validated `ApiModel` that matches all 6 routes in the `fixtures/simple` baseline fixture.

---

### 🧠 Core Concept: What an AST is and Why Scope-Aware Binding Beats Name Matching

#### 1. What is an Abstract Syntax Tree (AST)?
Source code text is just a stream of characters. An **AST (Abstract Syntax Tree)** is a hierarchical tree data structure produced by a parser (like `@babel/parser`) that represents the syntactic grammar and semantics of the program without whitespace or formatting details. For example, `app.get('/users', handler)` is converted into a `CallExpression` node with a `MemberExpression` callee (`app.get`) and arguments (`'/users'`, `handler`).

#### 2. Why Scope-Aware Binding Beats Simple Name Matching
A naive static analyzer might look for any identifier literally named `app` or search strings for `.get(`. This leads to severe false positives and false negatives:

- **False Positives (Object Name Collisions)**: A codebase might have `const app = new SlackClient()` or `const app = new VueApp()`. A name-matching scanner would falsely report `app.get('/channel')` as an Express HTTP route.
- **False Negatives (Alternative Variable Names)**: A developer might write `const server = express()` or `const api = express()`. A name-matching scanner looking only for `app.` would completely miss these endpoints.
- **Shadowing & Re-declarations**: A local variable `const app = 'my-string'` inside a nested block would confuse a regex or name-based analyzer.

#### 3. How Scope-Aware Binding Works (`@babel/traverse`)
Babel tracks identifier declarations and lexical scopes. We use a 3-phase analysis:
1. **Identify Factory**: Find the exact binding representing `express` (e.g. `const express = require('express')` or `import express from 'express'`).
2. **Track Instances**: Find variable declarations calling that bound factory (`const app = express()` or `const server = express()`), recording the unique `Binding` object.
3. **Verify References**: When inspecting a method call like `callee.property === 'get'`, we check `path.scope.getBinding(callee.object.name)`. Only if that binding is in our tracked Express app set do we extract the route.

---

### Extraction Pipeline

1. **Parser (`parseFile`)**:
   - Parses code using `@babel/parser` with `sourceType: 'unambiguous'` (supporting CJS and ESM) and `errorRecovery: true`.
   - On syntax errors, catches the error and emits a `DG-P001` diagnostic (`severity: 'error'`) with line/column coordinates without crashing the scan.
2. **Route Extractor (`extractDirectRoutes`)**:
   - Extracts direct `app.get/post/put/patch/delete/head/options('/path', ...)` routes.
   - Sets HTTP method and default `effect` (`GET/HEAD/OPTIONS` $\to$ `read`, `POST/PUT/PATCH` $\to$ `write`, `DELETE` $\to$ `destructive`).
   - Extracts path parameter definitions (`:id` segments $\to$ `in: 'path'`, `required: true`).
   - Non-literal dynamic path expressions emit `DG-R003` diagnostics and mark endpoints as `uncertain`.
3. **Scanner (`scanProject` / `ExpressAdapter.scan`)**:
   - Walks project files, parses ASTs, extracts direct routes, sorts with `sortEndpoints()`, and validates with `validateModel()`.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 type errors across all packages)
- `pnpm test` ✅ (15 test suites passed, 74/74 tests — 11 new Step 5 tests)
- `pnpm build` ✅ (Clean dual ESM/CJS/DTS builds across all 4 packages)
- Scanned `fixtures/simple/app` extracts all 6 endpoints correctly matching golden file ✅
- Syntax errors in source files emit `DG-P001` without crashing ✅
- Non-express objects named `app` are cleanly ignored ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 6: Module graph**: Resolve `require()` and `import` across files (relative paths, `index.js`, extensions); track router exports (`module.exports = router`, `export default router`).

---

## Step 6: Deterministic Module Graph Construction (`@devguard/adapter-express`)

### Overview

In Step 6, we implemented cross-file module resolution and graph construction in `@devguard/adapter-express`. The module graph tracks imports and exports across CommonJS and ESM syntax, maps relative specifiers to real project files (with extension and index probing), distinguishes external dependencies from local files, and handles cyclic dependencies without infinite recursion.

---

### 🧠 Core Concept: What a Module Graph Is and Why Step 7 Can't Work Without It

#### 1. What is a Module Graph?
A **Module Graph** is a directed graph where:
- **Nodes** represent source files in the project (`ModuleNode`), each containing its parsed imports and exports.
- **Edges** represent import/export relationships linking local variable bindings in an importing module to exported identifiers in a target module.

#### 2. Why Step 7 (Router & Mount Resolution) Cannot Work Without It
In real-world Express applications, routes and routers are rarely defined in a single file:
- An entry point (`app.js`) declares `const usersRouter = require('./routes/users')` and mounts it with `app.use('/api', usersRouter)`.
- The child router is declared and populated inside `routes/users.js`, finishing with `module.exports = router;`.

Without a module graph:
1. **Broken Identifier Links**: Step 5 only analyzes individual files in isolation. In `app.js`, it sees `app.use('/api', usersRouter)` but has no idea what `usersRouter` is or where its route handlers live.
2. **Missing Mount Prefixes**: Step 5 analyzing `routes/users.js` in isolation would see `router.get('/users', ...)` and extract `/users` without the `/api` mount prefix defined in `app.js`.
3. **Multi-level Router Nesting**: Real apps mount routers inside routers (e.g. `app.use('/api/v1', apiRouter)` -> `apiRouter.use('/users', usersRouter)` -> `usersRouter.get('/:id', ...)`). Tracing this chain of prefix concatenations requires traversing the directed edges of the module graph from entry points down to leaf routers.
4. **Resilience to Imports & Re-exports**: By tracking exact local bindings, imported names, and exported names across files, Step 7 can unambiguously follow router objects regardless of variable renames (`const { router: uRouter } = require('./users')`).

---

### Resolution Pipeline & Semantics

1. **Specifier Resolution (`resolveSpecifier`)**:
   - Bare specifiers (e.g., `'express'`, `'node:path'`, `@org/pkg`) $\to$ marked `isExternal: true, sourcePath: null` and not followed.
   - Relative specifiers (`./`, `../`) $\to$ resolved from the directory of the importing file.
   - Candidate probing order: exact path $\to$ `.js`, `.cjs`, `.mjs` $\to$ `<dir>/index.js`, `<dir>/index.cjs`, `<dir>/index.mjs`.
   - Security check: Never resolves outside the project root directory.
2. **Diagnostics for Unresolved / Dynamic Specifiers**:
   - Missing relative files emit `DG-R001` (`severity: 'warning'`) with file and line.
   - Dynamic `require(variable)` or `require(expr)` calls emit `DG-R001` with file and line.
   - The scan never throws or crashes on missing or dynamic imports.
3. **Exports Tracking**:
   - CommonJS: `module.exports = x`, `module.exports = { a, b }`, `exports.a = x`, `module.exports.a = x`.
   - ESM: `export default x`, `export { a, b }`, `export const a = ...`, `export function foo() {}`, `export class Bar {}`.
4. **Deterministic Ordering**:
   - Module nodes, imports, exports, and diagnostics are sorted by unicode code points and source line numbers.
5. **Cycle Tolerance**:
   - Node construction is file-isolated into a `Map<string, ModuleNode>`, guaranteeing instant termination on cyclic requires.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 type errors across all packages)
- `pnpm test` ✅ (16 test suites passed, 83/83 tests — 9 new Step 6 module-graph tests)
- `pnpm build` ✅ (Clean dual ESM/CJS/DTS builds across all 4 packages)
- `fixtures/nested-routers` correctly links `app.js` to `routes/users.js` and `routes/products.js` ✅
- Directory index files and extensions resolved properly ✅
- Cyclic imports terminate safely ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 7: Router and mount resolution**: Trace `express.Router()`, `app.use('/prefix', router)`, nested router mounts, prefix concatenation, `router.route()` chaining, and constant propagation.

---

## Step 7a: Single-File Routers & Mounts Resolution (`@devguard/adapter-express`)

### Overview

In Step 7a, we implemented single-file Express router detection and mount resolution in `@devguard/adapter-express`. We identified `express.Router()` and `require('express').Router()` instances via lexical scope bindings, extracted routes defined on routers, resolved `app.use('/prefix', router)` and `app.use(router)` mounts within the same file, and flagged unmounted routers as `uncertain` (`DG-R002`) rather than silently dropping them.

---

### 🧠 Core Concept: Why Prefix Resolution Is a Graph Problem

In Express, endpoints do not exist as flat, independent strings. Instead, the final URL of an endpoint is determined by a **tree (or DAG) of mount prefixes**:

1. **Mount Chains as Graph Edges**:
   - An Express application or parent router mounts a child router with a path prefix: `app.use('/api', apiRouter)`.
   - The child router can mount further sub-routers: `apiRouter.use('/v1', v1Router)`.
   - The leaf router defines the relative handler path: `v1Router.get('/users/:id', ...)`.
   - The final resolved path `/api/v1/users/:id` is the concatenation of path segments along the path from the root `app` node down to the leaf handler node.

2. **Multiple Mount Points for a Single Router**:
   - A single router instance can be mounted at multiple prefixes:
     ```javascript
     app.use('/api/v1', commonRouter);
     app.use('/api/v2', commonRouter);
     ```
   - In graph terms, the router node has **multiple incoming edges** (in-degree > 1). Static analysis cannot simply mutate the router's routes in-place. It must traverse each incoming edge independently, generating distinct endpoint instances (`GET /api/v1/users` and `GET /api/v2/users`) from the same underlying AST handler definition.

3. **Unmounted & Orphan Subgraphs**:
   - A router node with in-degree 0 (no incoming `app.use()` edges from a reachable entry point) represents an unmounted / dead router.
   - Graph reachability analysis immediately identifies these orphan nodes, enabling DevGuard to report them as `confidence: "uncertain"` with reason `DG-R002` instead of guessing or silently dropping them.

4. **Cross-File Edge Traversals (Preview for 7b+)**:
   - In multi-file projects, the mount edges span across module boundaries via the Module Graph constructed in Step 6. Resolving prefixes across files is therefore a depth-first or topological traversal combining the module dependency graph with the router mount hierarchy.

---

### Resolution Pipeline & Semantics

1. **Scope-Aware Router Identification**:
   - Matches `express.Router()`, `const { Router } = require('express'); Router()`, and `require('express').Router()`.
   - Rejects non-express objects named `router` (e.g. `const router = new CustomRouter()`).
2. **Path Joining & Normalization (`joinPaths`)**:
   - Handles trailing slashes, empty prefixes, and root `'/'` mounts cleanly without double slashes:
     - `joinPaths('/api', '/users')` $\to$ `'/api/users'`
     - `joinPaths('/', '/items/:id')` $\to$ `'/items/:id'`
     - `joinPaths('', '/orphan')` $\to$ `'/orphan'`
3. **Mount Resolution**:
   - `app.use('/prefix', router)` prepends `'/prefix'`.
   - `app.use(router)` defaults to root prefix `'/'`.
   - Provenance line is recorded at the `.get(` / `.post(` call line.
4. **Unmounted Routers (`DG-R002`)**:
   - Routers with zero mounts emit `DG-R002` (`severity: 'warning'`) and emit their routes with `confidence: "uncertain"`, `confidenceReason: "DG-R002"`, and `provenance.kind: "unresolved"`.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 type errors across all packages)
- `pnpm test` ✅ (16 test suites passed, 87/87 tests)
- `pnpm build` ✅ (Clean dual ESM/CJS/DTS builds across all 4 packages)
- `fixtures/router-single-file` hand-written golden model validated and matched ✅
- Existing `fixtures/simple` golden tests pass unchanged ✅

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 7b: Cross-file router & mount resolution**: Trace `express.Router()` exported across files via the Module Graph and resolve cross-file `app.use('/prefix', importedRouter)`.

---

## Step 7b: Cross-File Router & Mount Resolution (`@devguard/adapter-express`)

### Overview

In Step 7b, we implemented cross-file Express router and mount resolution in `@devguard/adapter-express`. We linked `app.use('/prefix', importedRouter)` mounts across file boundaries using the Module Graph constructed in Step 6, supported all CommonJS and ESM export styles (default exports, named exports in object literals, direct `exports.name` assignments, destructured requires, namespace member access `mod.router`, and one-level re-exports like `module.exports = require('./router')`), detected cycles with explicit `DG-R002` diagnostics without looping or crashing, generated routes correctly when a router is mounted at multiple prefixes, and maintained route provenance at the definition line in the router's source file.

---

### 🧠 Core Concept: How Binding Resolution Crosses File Boundaries

In a single file, variable binding resolution is governed strictly by the AST scope hierarchy: lexical scopes nest inside one another, and resolving an identifier is simply a lookup in the current scope or its parent scopes.

However, once code is organized across multiple files, **lexical scope terminates at the file boundary**:

```text
File A (app.js)                              File B (routes/users.js)
┌─────────────────────────────────┐          ┌──────────────────────────────────┐
│ const usersRouter =             │          │ const router = express.Router(); │
│   require('./routes/users');    │          │ router.get('/profile', ...);     │
│                                 │          │                                  │
│ app.use('/users', usersRouter); │──mount──►│ module.exports = router;         │
└─────────────────────────────────┘          └──────────────────────────────────┘
```

To resolve `usersRouter` across this boundary, static analysis must bridge two independent scope trees via a **module contract**:

1. **Import Binding in the Importer Scope**:
   In `app.js`, scope analysis observes that `usersRouter` is bound to a `require('./routes/users')` call (or ESM `import`). The analyzer extracts the import tuple:
   $$( \text{importerFile: "app.js"}, \text{localName: "usersRouter"}, \text{specifier: "./routes/users"}, \text{importedName: "default"} )$$

2. **Module Graph Edge Traversal**:
   The module graph resolves the relative specifier `./routes/users` against `app.js`'s directory, yielding the canonical target file path `routes/users.js`.

3. **Export Binding in the Exporter Scope**:
   In `routes/users.js`, the analyzer examines the module's export table for an export matching `importedName: "default"`. It identifies:
   $$\text{module.exports} = \text{router} \implies ( \text{exportedName: "default"}, \text{localName: "router"} )$$

4. **Connecting Export to Abstract Value**:
   Finally, within `routes/users.js`'s local scope, the analyzer looks up the binding `router`, proving that it was instantiated via `express.Router()`. The mount prefix `'/users'` is then attached to this router instance, resolving the final route `GET /users/profile`.

5. **Indirection, Re-exports, and Cycles**:
   When files re-export other modules (e.g. `module.exports = require('./admin')`), this resolution chain becomes a recursive graph traversal:
   $$\text{Mount} \longrightarrow \text{Import} \longrightarrow \text{Target File} \longrightarrow \text{Re-export} \longrightarrow \text{Final Router}$$
   To guarantee termination in cyclic codebases (e.g., File A exports B, File B exports A), the resolver maintains a `visited` set of `(file, symbol)` pairs. If a cycle is detected, traversal aborts cleanly, emits `DG-R002`, and avoids infinite loops or invalid confirmations.

---

### Implementation Highlights

1. **Comprehensive Import & Export Pairing Support**:
   - **Default Exports**: `module.exports = router` and `export default router`.
   - **Named Exports**: `module.exports = { itemsRouter }` and `export { itemsRouter }`.
   - **Property Assignments**: `exports.ordersRouter = router` and `module.exports.ordersRouter = router`.
   - **Destructured Requires**: `const { itemsRouter } = require('./routes/items')`.
   - **Namespace Member Access**: `const ordersMod = require('./routes/orders'); app.use('/orders', ordersMod.ordersRouter)`.
   - **One-Level Re-exports**: `module.exports = require('./admin')` and `export { a } from './b'`.
2. **Cycle Protection**:
   - `visited` set records `Set<"${targetFile}:${exportedName}">`.
   - Emits `DG-R002` diagnostic (`severity: 'warning'`) when a cycle is encountered, terminating recursion safely.
3. **Multiple Mounts**:
   - Routers mounted at multiple prefixes (e.g. `app.use('/v1', shared); app.use('/v2', shared);`) record multiple mounts and emit endpoints under both prefixes (`GET /v1/ping` and `GET /v2/ping`).
4. **Provenance Integrity**:
   - Route provenance stays at the `.get(` / `.post(` definition line in the router's own file (`routes/users.js:6`), not at the `app.use` line.
5. **Fail-Safe Diagnostics**:
   - Unresolvable imports (`imp.sourcePath === null`), missing exports, dynamic requires, or cycles emit `DG-R002` without crashing.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 type errors across all packages)
- `pnpm test` ✅ (16 test suites passed, 106/106 tests)
  - `fixtures/router-cross-file` hand-written golden model validates and matches all 6 export patterns ✅
  - `fixtures/nested-routers` confirmed routes match with correct `/api` prefixes (`GET /api/users/:id` and `GET /api/products`) ✅
  - Unresolved imports emit `DG-R001` and `DG-R002` with 0 confirmed routes ✅
  - Cyclic router exports detect cycles and emit `DG-R002` ✅
  - Multiple mounts on same router produce distinct routes under both prefixes ✅
  - Deterministic output across repeated runs ✅
- `pnpm build` ✅ (Clean builds across all packages)

---

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 7c: Nested routers & route chaining**: Support `router.use()` inside sub-routers and `router.route('/path').get().post()` chaining.

---

## Step 7c: Nested Routers & Route Chaining (`@devguard/adapter-express`)

### Overview

In Step 7c, we implemented resolution for deeply nested routers (`router.use('/prefix', otherRouter)`) spanning across multiple files, and added parsing support for route chaining (`router.route('/path').get().post()`). By moving to a proper graph traversal algorithm (Depth-First Search) for prefix concatenation, DevGuard can now correctly construct endpoints for "diamond" mount structures (where a single router is reached via multiple paths) while still detecting and breaking cycles without false positives.

---

### 🧠 Core Concept: Mount Trees vs Diamond Dependencies

In Step 7b, we handled simple cross-file mounts (e.g. `app` mounts `routerA`). However, Express allows routers to mount other routers, creating deep trees: `app` $\to$ `routerA` $\to$ `routerB` $\to$ `routerC`.

Even more complex is a **Diamond Dependency**:
```javascript
// shared.js
const router = express.Router(); router.get('/ping', ...);

// v1.js
const shared = require('./shared'); router.use('/shared', shared);

// v2.js
const shared = require('./shared'); router.use('/shared', shared);

// app.js
app.use('/v1', require('./v1'));
app.use('/v2', require('./v2'));
```
In this scenario, `shared.js` is reached via two distinct paths:
1. `app` $\to$ `/v1` $\to$ `/shared` $\to$ `/ping` (`GET /v1/shared/ping`)
2. `app` $\to$ `/v2` $\to$ `/shared` $\to$ `/ping` (`GET /v2/shared/ping`)

A naive cycle detection mechanism (like a global `visited` set) would flag the second traversal of `shared.js` as a cycle (`DG-R002`) and drop it! To solve this, cycle detection must be **path-specific**: the `visitedPath` set is cloned for each branch in the DFS, allowing a node to be visited multiple times as long as it doesn't appear twice within the *same* branch.

---

### Implementation Highlights

1. **Graph Construction and DFS Traversal**:
   - `ExtractedMount` was extended with `sourceRouterId` to distinguish between root mounts (`app.use`) and nested mounts (`router.use`).
   - `resolveCrossFileRoutes` first builds a directed graph of `ResolvedMount` edges.
   - It then performs a DFS from all `app` mounts down to the leaves, tracking the accumulated prefix and cloning the `visitedPath` set at each step to prevent cycles and support diamond mounts.
2. **Route Chaining (`.route()`)**:
   - The AST parser now traverses upwards through `CallExpression` and `MemberExpression` nodes to detect chained method calls (e.g., `app.route('/path').get().post()`).
   - Line number extraction (`startLine`) correctly resolves to the line of the exact HTTP method call (e.g., `.get(`) rather than the line where `.route(` started, providing precise provenance.
3. **Graceful Middleware Skipping**:
   - Express allows middleware before a router: `app.use('/api', authMiddleware, apiRouter)`. 
   - The parser evaluates all arguments to `use()`. Any identifiers that don't resolve to a known router are gracefully ignored, allowing the scanner to correctly connect the mount edge without being thrown off by middleware functions.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 type errors across all packages)
- `pnpm test` ✅ (16 test suites passed, 108/108 tests)
  - `fixtures/nested-routers` outputs confirmed routes with multi-level `/api/admin/metrics` prefixes ✅
  - `router.route()` chaining extracts correct line numbers ✅
  - Diamond-shaped mounts resolve both paths with 0 false-positive `DG-R002` diagnostics ✅
  - Unidentifiable router arguments and `app.route` chains tested successfully ✅
- `pnpm build` ✅ (Clean builds across all packages)

---

### Next Step Preview (Per `docs/PLAN.md`)

- **Step 7d: Constant propagation and dynamic path interpolation**: Resolve `const BASE = '/api'; app.use(BASE, router)` and template literals.

---

## Step 7d: Constant Propagation & Dynamic Paths (\`@devguard/adapter-express\`)

### Overview

In Step 7d, we implemented constant propagation for route paths and mount prefixes. The static analyzer now tracks \`const\` bindings across local scope and module boundaries to resolve paths like \`app.use(BASE, router)\` or \`app.get(['/a', '/b'] + '/c')\`. Paths that include purely static strings, array expressions, binary string concatenation, and template literals are now resolved properly, greatly reducing false \`DG-R003\` (uncertain path) diagnostics in real-world Express apps. Dynamic paths that cannot be statically resolved now correctly emit a placeholder (e.g. \`<getDetailSegment()>\`) and preserve the endpoint as \`uncertain\`.

---

### 🧠 Core Concept: Static Evaluation & Cross-file Resolution

Real Express applications heavily use constants (e.g. \`const API_PREFIX = '/api/v1'\`) exported from configuration files to mount routers or define routes. To accurately track these routes without executing the code, DevGuard must:

1. **Statically Evaluate AST nodes**: Recursively compute values for \`StringLiteral\`, \`ArrayExpression\`, \`BinaryExpression\` (concatenation), and \`TemplateLiteral\` nodes.
2. **Track Local Const Bindings**: When an \`Identifier\` is encountered, DevGuard verifies if it is bound as a true \`const\` in the local scope, and evaluates its initialization expression.
3. **Cross-file Constant Resolution**: If the \`Identifier\` originates from an import/require, DevGuard traverses the Module Graph (built in Step 6), locates the corresponding export in the target AST, and resolves it across file boundaries.

A unified recursive evaluator \`resolvePathConstant\` evaluates these nodes, handling both successful resolutions and partial resolutions (injecting placeholders for dynamic portions).

---

### Implementation Highlights

1. **\`resolvePathConstant\` Evaluator**:
   - Computes strings for literal nodes.
   - Computes Cartesian products for array interpolations (e.g., \`['/v1', '/v2'] + '/users'\` resolves to \`['/v1/users', '/v2/users']\`).
   - Replaces unresolvable dynamic expressions (like function calls or mutations) with a \`<EXPRESSION>\` placeholder, while retaining any statically resolvable prefix/suffix.
2. **AST Caching**:
   - \`scanner.ts\` was updated to perform a two-pass extraction. In the first pass, ASTs are parsed and cached (\`astCache: Map<string, { ast: File, code: string }>\`).
   - In the second pass, \`extractFileDeclarations\` uses the \`astCache\` and \`moduleGraph\` to evaluate constants imported from other files efficiently without re-parsing.
3. **Array Prefix Support**:
   - \`app.use(['/a', '/b'], router)\` is now correctly mapped to multiple prefixes, allowing DevGuard to emit routes for both mount points.
4. **Provenance Precision**:
   - The scanner now accurately distinguishes between \`literal\` paths (no variable substitution) and \`resolved\` paths (evaluated from constants or interpolations).

---

### Verification Summary

- \`pnpm lint\` ✅ (0 errors, 0 warnings)
- \`pnpm typecheck\` ✅ (0 type errors across all packages)
- \`pnpm test\` ✅ (17 test suites passed, 138/138 tests)
  - Evaluates cross-file path constants like \`const { API_PREFIX } = require('./config')\` ✅
  - Evaluates array literals, template strings, and string concatenation ✅
  - Emits \`kind: 'resolved'\` for paths evaluated from constants and \`kind: 'literal'\` for inline strings ✅
  - Unresolvable dynamic path interpolation produces \`<EXPRESSION>\` placeholder and retains \`confidence: 'uncertain'\` ✅
- \`pnpm build\` ✅ (Clean builds across all packages)

---

### Remaining Uncertainties

- **Step 8 (Handler Analysis)**: Currently, the analysis only considers routing. We have not yet tackled analyzing handler bodies, validating Zod schemas, or extracting Request/Response shapes.
- **Complex Dynamic Paths**: The current constant evaluator deliberately ignores variable reassignments (\`let\` / \`var\`), \`process.env\` lookups, and function calls.

---

### Next Step Preview (Per \`docs/PLAN.md\`)

- **Step 8: Controller parsing & Schema extraction**: Parse route handler bodies, extract Zod/Joi schema validations, and define HTTP request/response payloads.

---

## Step 8a: Parameter & Body-Field Inference (@devguard/adapter-express)

### Overview

In Step 8a, we implemented parameter and body-field inference in `@devguard/adapter-express`. The scanner now resolves route handlers (inline functions, 1-hop imported controller identifiers via the module graph, and handler arrays where the last element is the handler). It identifies the request object binding (`fnNode.params[0]`, regardless of identifier name such as `req`, `request`, or `r`), tracks parameter accesses (`req.params`, `req.query`, `req.body`, bracket string literals, and destructuring with renames), records inferred parameters with provenance, and emits `DG-I001` (Unresolved Handler) when a handler expression cannot be statically resolved.

---

### 🧠 Core Concept: Why Static Inference Uses `required: 'unknown'` Instead of Guessing

A central architectural decision in DevGuard is that static AST extraction must report **truthful ground truth, not speculative guesses**:

1. **Member Access Does Not Imply Requirement**:
   When JavaScript code contains `const email = req.body.email;`, the runtime will evaluate `req.body.email` to `undefined` if `email` was omitted by the caller (assuming body parsing middleware initialized `req.body` to an object). Without an explicit guard (e.g. `if (!req.body.email) return res.status(400)`) or a validation schema like Zod/Joi, the static analyzer cannot know whether `email` is optional or required.
2. **False Precision is Harmful**:
   Marking an inferred field as `required: true` would produce false-positive API contract violations for optional query parameters (such as `req.query.search` or `req.query.page`). Marking it `required: false` could mislead client generators into treating mandatory parameters as optional.
3. **Explicit Unknown State**:
   By typing inferred parameters as `required: 'unknown'` and `type: 'unknown'` with `provenance.kind: 'inferred'`, the API model cleanly communicates:
   - We know with static certainty that the handler code reads this property from the request.
   - We know exactly which line and file accessed it.
   - Contractual guarantees (types, required vs optional) are deferred until validation library analysis (e.g., Zod, Joi, express-validator in Step 8d).
   - In contrast, path parameters declared in the route path string (`:id`) have `required: true` and `type: 'string'` with `provenance.kind: 'literal'` because the Express routing engine will strictly not match the route if that path segment is absent.

---

### Implementation Highlights

1. **ADR 0001 & ApiModel v1.1.0 Bump**:
   - Upgraded core API schema to `modelVersion: '1.1.0'` while maintaining 100% backward compatibility with `1.0.0`.
   - Added `'body'` to `ParamLocation`.
   - Added `required: z.union([z.boolean(), z.literal('unknown')])`.
   - Added `mountChain?: MountEntry[]` to endpoints tracking the exact sequence of router mounts from the root application.
   - Added diagnostic code `DG-I001` (Unresolved Handler).
2. **Handler Identification**:
   - Resolves inline functions (`FunctionExpression`, `ArrowFunctionExpression`).
   - Resolves local function declarations / variable declarators.
   - Resolves 1-hop imported functions via `moduleGraph` and `astCache` (ESM named/default exports and CJS exports).
   - Handles arrays of handlers by picking the last handler element.
   - Emits `DG-I001` when the handler candidate is dynamic or unresolvable (e.g. `getDynamicHandler()`).
3. **Scope-Aware Request Object Binding**:
   - Binds the handler's first parameter (`fnNode.params[0]`) regardless of name (`req`, `request`, `r`).
   - Verifies identifier references via Babel scope binding equality (`scope.getBinding(id.name)?.identifier === reqParamNode`).
   - Correctly ignores shadowed variables in nested callbacks (e.g., `items.map(req => req.name)`).
4. **Access Detection & Deliberate Skips**:
   - Supported forms: `req.params.x`, `req.query.x`, `req.body.x`, bracket access with string literals (`req['query']['x']`), direct destructuring with renames (`const { author, category: cat } = req.body` extracts `category`, not `cat`), and aliases (`const body = req.body; body.x`).
   - Deliberately skipped: computed property keys (`req.body[computedKey]`), whole-object passing (`save(req.body)` extracts 0 fields without guessing), and object rest/spread.
5. **Deduplication & Deterministic Ordering**:
   - Preserves the earliest line/column for duplicate accesses to the same field.
   - Sorts parameters deterministically: `path` (1) -> `query` (2) -> `header` (3) -> `body` (4) -> `cookie` (5) -> `unknown` (6), breaking ties alphabetically by parameter name.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 type errors across all packages)
- `pnpm test` ✅ (18 test suites passed, 173/173 tests)
  - 8 new unit/integration tests in `packages/adapter-express/tests/inference.test.ts`
  - Validates full `fixtures/inference-basic` golden model and diagnostics
- `pnpm build` ✅ (Clean builds across all packages)

---

### Remaining Uncertainties

- **Step 8b–8d (Auth detection, middleware semantics, effects, validation libraries)**: Left untouched as planned. Handler effects remain mapped by HTTP method convention until body effects analysis in 8c.
- **Transitive (2+ hop) Controller Exports**: Currently handles 1-hop imported controllers (`app.get('/items', controller)`). Multi-hop re-exports (`controllers/index.js` re-exporting `items.js`) are not resolved in 8a.

---

## Issue 2 Refactor: Modularizing `route-extractor.ts` (Zero Behavior Change)

### Overview

In Issue #2, we decoupled the monolithic `packages/adapter-express/src/route-extractor.ts` (originally ~2,100 lines) into focused, single-responsibility modules under `packages/adapter-express/src/extract/` without altering analyzer behavior. The 178 tests—including strict `1.1.0` fixture golden deep equality tests—served as the safety net guaranteeing byte-for-byte behavioral preservation.

---

### Module Architecture

1. **`extract/types.ts`**: Shared TypeScript interfaces (`PendingRouterRoute`, `ExtractedMount`, `ExtractedRouter`, `FileDeclarations`, `ExtractRoutesResult`) to prevent circular type dependencies.
2. **`extract/path-evaluator.ts`**: Constant evaluation, string binary concatenation, template literals, array product combination capping, path joining (`joinPaths`), and placeholder formatting (`formatPlaceholder`).
3. **`extract/handler-resolver.ts`**: Function AST node resolution (`findHandler`), inspecting inline closures, local function declarations, and 1-hop imported controller exports from the module graph.
4. **`extract/param-inference.ts`**: AST visitor logic inspecting `req.params`, `req.query`, `req.body`, and headers access, destructuring with aliases, and deterministic sorting (`mergeAndSortParams`).
5. **`extract/declarations.ts`**: Per-file AST extraction of Express app instances, router factories, routes (`app.get/post`, `router.route`), and mounts (`app.use`).
6. **`extract/mount-resolver.ts`**: Cross-file router mount resolution, cycle protection, DFS traversal tracking `mountChain`, and final `Endpoint` synthesis.
7. **`extract/route-extractor.ts`**: Thin orchestrator implementing `extractDirectRoutes` and re-exporting module public APIs.
8. **`src/route-extractor.ts`**: Backward-compatibility shim preserving package deep import paths.

---

### 🧠 Core Concept to Understand: Refactoring Under Strict Invariants

When refactoring complex static analysis engines, splitting files without tests or with partial assertions frequently introduces subtle regressions (such as parameter ordering shifts, dropped diagnostics, or lost AST provenance). Because Issue #1 locked in strict deep equality (`expect(model).toStrictEqual(goldenModel)`) across all 6 fixtures, every refactoring step was executed under complete behavioral determinism:

1. **Acyclic Dependency Hierarchy**: Level 0 leaves (`types`, `path-evaluator`, `handler-resolver`, `param-inference`) have zero sibling dependencies.
2. **No Global State**: All module functions accept pure data structures (`File`, `Scope`, `ModuleGraph`) and return immutable records.
3. **Verified Zero Circularity**: Validated using `madge` with zero cycles across all internal modules.

---

## Step 8b: Middleware & Authentication Detection per Endpoint

### Overview

In Step 8b, we implemented static detection of middleware chains and authentication requirements per endpoint.
In Express, middleware executes in strict registration order:
```javascript
app.use(logger);       // Applies to all routes registered after this line
app.get('/health', h); // logger applies; auth does NOT
app.use(sessionGuard); // Applies to all routes registered after this line
app.get('/users', h);  // BOTH logger and sessionGuard apply
```
DevGuard captures this registration sequence across 4 tiers:
1. Application-level: `app.use(mw)`
2. Mount-level: `app.use('/prefix', mw, router)`
3. Router-level: `router.use(mw)`
4. Route-level: `app.get('/path', mw, handler)` or handler arrays `[mw1, mw2, handler]`

---

### 🧠 Core Concept to Understand: Why "No Auth Middleware Found" != "No Auth"

A fundamental principle of DevGuard static analysis is the **honesty rule**:
*Never claim an endpoint is unauthenticated (`auth: 'none'`) without concrete proof.*

1. **Absence of Evidence is Not Evidence of Absence**:
   In backend frameworks, authentication may be enforced in numerous ways outside recognizable middleware:
   - Within the route handler body itself (`if (!req.user) return res.status(401)`).
   - In a custom database session check inside an unanalyzed utility.
   - At the API gateway level (e.g. AWS API Gateway, Cloudflare Access, Envoy proxy, Kubernetes Ingress) before traffic even hits Node.js.
   - Inside third-party framework wrappers or custom decorators.
   Therefore, if the static analyzer does not find explicit authentication signals, the endpoint must be labeled as `auth: 'unknown'`. Claiming `auth: 'none'` would risk false negatives and tell security engineers that a route is public when it might actually be secured.

2. **Express Registration Order Dictates Active Middleware**:
   Unlike declarative frameworks (such as NestJS or Spring) where middleware/guards are bound to classes or methods via annotations regardless of line order, Express is purely imperative and order-dependent. A middleware registered at line 50 does *not* apply to a route registered at line 40, even within the same file. To model this faithfully:
   - DevGuard tracks source line numbers of every `.use()` call and route registration.
   - Routes inherit only those application- and router-level middlewares that were registered *before* the route or mount in code order.
   - Unresolvable middleware expressions (e.g. `app.use(dynamicRequire())`) emit informational diagnostic `DG-I002` and appear in the chain as `<unresolved>`, preserving the accurate count and ordering of the pipeline.

---

### Auth Rule Set & Positive Evidence Table

| Auth Type | Evidence Signal | Detection Mechanism |
| :--- | :--- | :--- |
| `bearer` | `header:authorization:Bearer` | Inspects middleware AST for checks on `req.headers.authorization` or `req.headers['authorization']` matching `Bearer` string token pattern. |
| `apiKey` | `header:x-api-key` | Inspects middleware AST for checks on `req.headers['x-api-key']` or `req.headers['apikey']`. |
| `cookie` | `session:user` | Inspects middleware AST for checks on `req.session.user`, `req.session.userId`, `req.session.passport`, or `req.cookies`. |
| `custom` | `name:<name>` | Middleware function or identifier name matches security heuristics (`auth`, `authenticate`, `requireAuth`, `protect`, `verifyToken`, `ensureLoggedIn`, `jwt`). |
| `unknown` | *(none)* | Default when no positive evidence exists. Never emits `none`. |

Every classified authentication requirement records `auth.evidence` with `{ filePath, line, signal }` for complete traceability.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 errors)
- `pnpm test` ✅ (18 test suites, 228/228 tests passing)
- `pnpm build` ✅ (Core, adapter-express, runner, cli built cleanly)

---

## Step 9: Runner, Safety Engine, Config & Session Recording (`@devguard/runner`)

### Overview

In Step 9, we built the `@devguard/runner` package. For the first time in DevGuard's lifecycle, the tool transitions from purely inspecting static ASTs to actively sending HTTP requests to running services.

---

### 🧠 Core Concept to Understand: Why a Testing Tool's Biggest Risk is the Tool Itself, and Why Every Skipped Request Needs a Recorded Reason

When building automated security and API testing software, engineers often worry most about missing a vulnerability (false negatives). But in production and staging environments, **the testing tool itself is frequently the greatest hazard**:

1. **The Danger of Unguarded Automated Requests**:
   - Sending blind `DELETE`, `PUT`, or `POST` requests can permanently purge live databases, corrupt tenant state, trigger third-party billing charges (e.g. Stripe, Twilio), or deadlock backend workers.
   - Targeting the wrong base URL (due to misconfiguration, typos, or DNS rebinding) can accidentally attack external servers or unauthorized infrastructure.
   - For these reasons, DevGuard establishes **safe mode by default**: only `read` requests are eligible to run, non-local network calls are blocked by host guards, and unknown mutation effects are treated as hazardous by default.

2. **Why Every Skipped Request Must Have a Structured Reason**:
   - In automated testing, silently dropping a test is worse than a test failure. If an endpoint is omitted without notice, users assume the route was tested and certified safe.
   - In DevGuard, nothing is ever silently dropped. Every endpoint evaluated by the safety engine that cannot run receives a structured `SkipReason` containing a machine-readable code and a human-readable explanation:
     - `disallowed-effect-unknown`: the scanner could not prove whether the endpoint mutates state.
     - `uncertain-endpoint`: the route path contains dynamic `<EXPRESSION>` placeholders that cannot resolve to a concrete URL.
     - `effect-not-allowed`: the endpoint performs writes or destructive operations not opted into via `allowedEffects`.
     - `no-sample-for-path-param`: an explicit sample for a path segment (e.g. `:id`) was not provided, preventing arbitrary parameter guessing.
     - `explicitly-skipped`: matches a user-defined skip pattern in `devguard.config.json`.
   - Recording all skip reasons directly into `.devguard/sessions/<sessionId>.json` guarantees that security audits and test reports can transparently explain test coverage gaps without re-running against the live server.

---

## Step 10: Test Planner, Input Generators & Response Oracles (`@devguard/core`)

### Overview

In Step 10, we implemented the core test planner, modular input generators, response oracles, and test orchestration engine in `@devguard/core`. The engine turns the static `ApiModel` into deterministic test plans, executes them through an injected test runner interface, and evaluates responses using pluggable oracles to generate code-linked, provenance-backed findings.

---

### 🧠 Core Concept to Understand: What a Test Oracle Is, and Why "5xx on Bad Input" Is a Strong Signal While "5xx on Our Guessed Valid Input" Is a Weak One

#### 1. What Is a Test Oracle?
In software testing theory, a **test oracle** is a mechanism or principle that determines whether a program executed correctly or failed.
Generating an HTTP request is only half the problem; judging whether the server's response was acceptable requires an oracle. In black-box testing without formal API specifications, oracles cannot verify business correctness (e.g. "did the user's balance update to exactly $42.50?"). Instead, we rely on **universal behavioral invariants**:
- Input validation invariants: invalid inputs must not crash the server (`no-5xx-on-bad-input`).
- Information hygiene invariants: stack traces and sensitive internal identifiers must never leak to the client (`no-stack-trace-leak`, `no-sensitive-fields`).

#### 2. The Asymmetry: Strong Signal vs Weak Signal
When testing REST backends without executing user code beforehand, there is a fundamental difference in confidence between two types of 5xx errors:

1. **"5xx on Bad Input" is a Strong Signal (`confidence: 'high'`)**:
   - The generator deliberately crafts an invalid request: an empty body, an omitted required parameter, or an inverted data type (e.g., sending a number where a string was read).
   - In standard HTTP REST conventions, the server is contractually obligated to catch invalid data and return a client error (`4xx`, such as `400 Bad Request` or `422 Unprocessable Entity`).
   - If the server instead responds with `500 Internal Server Error`, it almost certainly means an unhandled exception occurred in the route handler (e.g., `TypeError: Cannot read properties of undefined`).
   - Because our premise is deliberately adversarial input, a 500 response is unambiguous proof of missing input validation. We can report this finding with `confidence: 'high'`.

2. **"5xx on Our Guessed Valid Input" is a Weak Signal (`confidence: 'low'`)**:
   - The generator attempts to construct a "valid" baseline request based on static AST inference.
   - However, static analysis cannot see live database state, foreign keys, or complex domain validation rules (e.g. requiring a pre-existing organization ID or specific email domain).
   - If our guessed baseline request returns a 500, did the server fail due to a real server bug, or did it fail because our static guess violated an unmodeled prerequisite?
   - Therefore, DevGuard separates this into `server-error-on-valid-input` and assigns it `confidence: 'low'`.
   - This prevents false accusations and ensures developers trust DevGuard's findings.

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm typecheck` ✅ (0 errors across all packages)
- `pnpm test` ✅ (28 test suites, 293/293 tests passing)
- `fixtures/planted-bugs` end-to-end integration test passes with `toStrictEqual` against `expected.findings.json` ✅
- Report validates against Zod schema and exported JSON Schema (`report.schema.json`) ✅
- Deterministic report verified across two runs against live server ✅



🧠 Learning Note for the Owner
Concept to Understand: What a Test Oracle Is, and Why "5xx on Bad Input" Is a Strong Signal While "5xx on Guessed Valid Input" Is a Weak One

In automated security and software testing, a test oracle is the mechanism used to judge whether an execution was successful or buggy. In black-box testing where the tool has no prior knowledge of business logic, we cannot assert that a response body matches exact business formulas. Instead, we rely on universal behavioral invariants—rules that every well-written HTTP API must satisfy regardless of domain.

The most critical insight in Step 10 is the asymmetry between input signals:

"5xx on Bad Input" is a Strong Signal (high confidence): When DevGuard sends an intentionally malformed request (an empty body, an omitted field, or an inverted data type), the HTTP contract dictates that the server should reject the request with a client error (4xx, such as 400 Bad Request or 422 Unprocessable Entity). If the server responds with a 500 Internal Server Error, it almost certainly means an unhandled runtime exception occurred in the handler code (such as attempting .trim() or .toLowerCase() on an undefined value). Because the input was designed to test input validation, a 500 response is unambiguous proof of a missing validation guard.

"5xx on Our Guessed Valid Input" is a Weak Signal (low confidence): When DevGuard generates a "valid" baseline request, it does so through static AST inference without seeing the live database or runtime environment. The server might return a 500 not because the endpoint has an unhandled bug, but because our static guess lacked an unmodeled prerequisite (such as an existing database entity or a valid external API token). If DevGuard claimed this was a definitive bug, developers would dismiss the tool due to false alarms. By reporting it as server-error-on-valid-input with confidence: 'low', DevGuard stays honest and trustworthy.

---

## Step 12: DevGuard CLI (`devguard scan`, `devguard test`, `devguard report`, and `devguard init`)

### Context and Goal

Until Step 12, DevGuard was an ecosystem of libraries (`@devguard/core`, `@devguard/adapter-express`, `@devguard/runner`). Step 12 delivers the actual user-facing product: the unified `devguard` CLI binary.

A developer or CI runner can invoke:
```bash
devguard scan ./backend
devguard test ./backend --base-url http://127.0.0.1:3000
devguard report
```

### Architecture: The Thin CLI Principle

The cardinal architectural rule for `@devguard/cli` is that **zero analysis, scanning, testing, or judgment logic resides in the CLI package**:
- Argument parsing and flag validation: Commander.
- Terminal styling: `picocolors` with full `NO_COLOR`, `--no-color`, and non-TTY fallback.
- Static scanning: delegates 100% to `@devguard/adapter-express` (`detectExpress`, `scanProject`).
- Test planning, generation, and execution: delegates to `@devguard/core` (`planTests`, `runTests`) and `@devguard/runner` (`loadConfig`, `validateBaseUrl`, `createTestRunner`, `saveSession`).
- Offline session reporting: delegates to `@devguard/runner` (`loadSession`) and `@devguard/core` (`BUILTIN_ORACLES`).

This ensures that every capability provided by the CLI is completely accessible programmatically by other tools, IDE extensions, or SDKs without shell wrapping.

### Commands Implemented

1. **`devguard scan <path>`**:
   - Validates directory existence and Express framework detection (exiting 2 if absent).
   - Extracts `ApiModel` and formats human-readable terminal output (`✓` confirmed, `?` uncertain, parameter types and provenances).
   - Supports `--json` for machine-readable output and `--out <file>`.

2. **`devguard test [path]`**:
   - Resolves `devguard.config.json` (or accepts `--base-url`).
   - Enforces **Host Guard**: non-local URLs without `--allow-remote` immediately exit 2.
   - Enforces **Destructive Safety**: `--allow-destructive` prompts interactively; in non-TTY/CI environments, requires `--yes` or exits 2.
   - Supports `--dry-run`: plans test cases and outputs summary without sending any HTTP requests.
   - Saves session recording into `.devguard/sessions/<sessionId>.json`.
   - Supports `--fail-on <severity>` (`error`, `warning`, `info`) for configurable CI gating.

3. **`devguard report [session]`**:
   - Re-evaluates recorded sessions using pure Oracles with **zero network traffic**.
   - If no session is specified, automatically loads the most recent session from `.devguard/sessions/`.
   - Exits 0 if clean, 1 if failures or findings exist, 2 if session file is missing/corrupted.

4. **`devguard init`**:
   - Writes starter `devguard.config.json` with safe defaults (`allowedEffects: ['read']`, loopback `baseUrl`).
   - Uses atomic `wx` flag to refuse overwriting existing configurations (exits 2).

### Exit Codes Contract

| Exit Code | Semantics |
|---|---|
| **0** | Clean scan, all tests passed, or findings below `--fail-on` threshold. |
| **1** | Runtime tests executed and produced findings/failures at or above threshold. |
| **2** | Usage error, missing config, framework detection failure, Host Guard violation, or non-TTY destructive without `--yes`. |
| **3** | Internal error / unhandled crash. |

---

### Verification Summary

- `pnpm lint` ✅ (0 errors, 0 warnings across monorepo)
- `pnpm typecheck` ✅ (0 errors, `tsc -b` exits 0)
- `pnpm test` ✅ (33 test files, 320/320 tests passing)
- Command-level test suites: `init.test.ts`, `scan.test.ts`, `test.test.ts`, `report.test.ts`, `color.test.ts` passing ✅
- Production binary test: `./packages/cli/dist/index.js` verified for `scan`, `test --dry-run`, and `init` ✅

---

### 🧠 Learning Note for the Owner
**Concept to Understand: Why CLIs Must Stay Thin, and Why Exit Codes Matter in CI**

1. **Why CLIs Must Stay Thin**:
   A common antipattern in software engineering is putting business logic, validation rules, or orchestration inside CLI action handlers. When that happens, the logic becomes trapped in standard I/O (stdout, stdin, process exit codes) and cannot be unit-tested without mocking terminal processes. Furthermore, if you later want to build a VS Code extension, a GitHub Action, or a Web UI, you are forced to either shell out to the binary or duplicate the logic.
   By keeping `@devguard/cli` strictly thin—doing nothing more than parsing arguments, calling library functions, and formatting output—all core functionality remains modular, portable, and easily tested.

2. **Why Exit Codes Matter in CI**:
   In automated CI/CD pipelines (like GitHub Actions, GitLab CI, or Jenkins), the exit status code of a process is the single source of truth determining pipeline success or failure.
   If a tool exits `1` for both "your tests found a security bug" and "you misspelled a CLI flag", the CI system cannot differentiate between code failure and tooling misconfiguration.
   By establishing explicit exit codes:
   - `0`: The codebase is clean; pipeline succeeds.
   - `1`: The tests executed properly and found real defects; pipeline fails with actionable test findings.
   - `2`: A configuration error or safety guard prevented tests from running; pipeline fails fast so the developer can fix their setup.
   - `3`: The tool crashed internally; pipeline alerts the tool maintainers.
   This contract makes DevGuard robust and predictable in enterprise pipelines.

---

## Step 13 — Benchmark on Real Open-Source Express Repositories

### Context & Objective

Prior to Step 13, DevGuard was tested exclusively against synthetic test fixtures crafted in-house (`fixtures/simple`, `fixtures/nested-routers`, etc.). While synthetic fixtures verify individual unit invariants, they can mask blind spots when encountering idioms that real-world Express developers use in the wild.

The goal of Step 13 was to:
1. Benchmark DevGuard against 5 real open-source Express repositories with varied architectures (small APIs, MVC controllers, ES6/Babel, TypeScript, array iteration mounts).
2. Measure ground truth precision and recall per repository and overall.
3. Diagnose and rank failure causes, then fix the top three failure patterns as distinct, golden-tested commits without regressions.

---

### Selected Benchmark Repositories & Pinned Commits

| Repository | Pinned Commit | License | Architecture Style | Truth Endpoints |
|---|---|---|---|---:|
| `node-todo` | `0fdb905` | MIT | Small API, CommonJS route factory function | 4 |
| `express-mongoose-es6-rest-api` | `247fedd` | MIT | ES6 / Babel REST API with subrouters | 8 |
| `express-rest-es2017-boilerplate` | `b8bed6d` | MIT | ES2017 / ESM, MVC with controllers | 15 |
| `node-express-boilerplate` | `179ae84` | MIT | Routes array loop (`routes.forEach(r => router.use(r.path, r.route))`) | 14 |
| `realworld` | `30b68e1` | MIT | TypeScript, barrel exports, chained subrouter root mount | 20 |

---

### Benchmark Methodology

Ground truth endpoints were compiled by inspecting route definitions, test suites, and documentation, stored in versioned JSON at `benchmarks/<repo>/truth.json`.
The evaluation script `scripts/run-benchmarks.ts` clones missing repositories at benchmark time into `.clones/` (ignored by git to avoid vendoring 3rd-party code), runs `scanProject()`, and computes:
- **Precision**: `True Positives / (True Positives + False Positives)`
- **Recall**: `True Positives / (True Positives + False Negatives)`
- **Uncertain endpoints count**: Endpoints where dynamic resolution could not be statically guaranteed (emitted with confidence: "uncertain").
- **Diagnostics count**: Emitted static analysis warnings or errors.

---

### Benchmark Results & Performance Progression

#### Pre-Fix Baseline:
- Recall: **37.7%**
- Precision: **60.5%**
- `node-todo`: 0% recall (route factory unrecognized)
- `realworld`: 0% recall (TypeScript files omitted by file-walker, subrouter chaining unhandled)
- `node-express-boilerplate`: 0% recall (dynamic array loop flagged as uncertain)

#### Post-Fix Results:
| Repository | Style | License | Truth | Found | Precision | Recall | Uncertain | Diagnostics |
|---|---|---|---:|---:|---:|---:|---:|---:|
| [node-todo](https://github.com/scotch-io/node-todo) (0fdb905) | Small API (Route Factory) | MIT | 4 | 4 | 100.0% | 100.0% | 0 | 0 |
| [express-mongoose-es6-rest-api](https://github.com/kunalkapadia/express-mongoose-es6-rest-api) (247fedd) | ES6 / Babel REST API with subrouters | MIT | 8 | 8 | 100.0% | 100.0% | 0 | 10 |
| [express-rest-es2017-boilerplate](https://github.com/danielfsousa/express-rest-es2017-boilerplate) (b8bed6d) | Modern ES2017 / ESM, MVC with controllers | MIT | 15 | 15 | 100.0% | 100.0% | 0 | 14 |
| [node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) (179ae84) | MVC with controllers, routes array loop, Joi validation | MIT | 14 | 15 | 0.0% | 0.0% | 14 | 20 |
| [realworld](https://github.com/gothinkster/node-express-realworld-example-app) (30b68e1) | TypeScript, barrel exports, subrouter root mount | MIT | 20 | 20 | 100.0% | 100.0% | 0 | 1 |
| **Total / Overall** | **5 Repositories** | — | **61** | **62** | **75.8%** | **77.0%** | **14** | **45** |

4 out of 5 repositories achieve **100.0% precision** and **100.0% recall**!

---

### Top Three Failure Patterns & Scanner Fixes

1. **Fix 1 — Wildcard HTTP Verb Support (`app.all()` and `router.all()`)**:
   - *Problem*: Express applications frequently use `.all('/path', ...)` to attach universal handlers across all verbs. DevGuard previously only recognized specific HTTP verbs (`get`, `post`, `put`, `delete`, `patch`).
   - *Solution*: Added `'all'` to the candidate method set and expanded any `.all()` declaration into canonical standard HTTP verbs (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), ensuring complete contract coverage.
   - *Verification*: Fixture `fixtures/route-all` and golden model `fixtures/route-all/expected.model.json`.

2. **Fix 2 — Root Router Mounts Without Path Prefix and Router Method Chaining**:
   - *Problem*: Express allows mounting routers without an explicit path argument (`app.use(router)` or `router.use(subrouter)`), defaulting the mount prefix to `'/'`. Additionally, modern projects chain Router calls (e.g. `Router().use(controllerA).use(controllerB)` or `export default Router().use('/api', api)`). Previous logic dropped unchained CallExpressions or treated single-argument router mounts as middleware.
   - *Solution*: Added chained router root detection unwrapping nested CallExpressions, default router export tracking in `mount-resolver`, root path defaulting (`/`) for single-argument router mounts, and added `.ts`, `.cts`, `.mts` extensions to `file-walker.ts` and `module-graph.ts`.
   - *Verification*: Fixture `fixtures/router-root-mount` and golden model `fixtures/router-root-mount/expected.model.json`.

3. **Fix 3 — Route Factory Function Pattern**:
   - *Problem*: Small APIs and microservices commonly structure routes by exporting a factory function accepting an Express application instance: `module.exports = function(app) { app.get(...) }`. Because `app` was a parameter rather than a direct `express()` call, routes inside the factory were ignored.
   - *Solution*: Added detection in Phase 2 for function parameters named `app` or `router` (or receiving HTTP calls), registering them as valid Express app and router bindings for direct route extraction.
   - *Verification*: Fixture `fixtures/route-factory` and golden model `fixtures/route-factory/expected.model.json`.

---

### 🧠 Learning Note for the Owner
**Concept to Understand: Why Empirical Benchmarking Beats Spec-Driven Assumptions in Static Analysis**

When developing static analysis engines:
1. **Developer Idioms Diverge From Library Specs**: The official Express documentation highlights `const app = express(); app.get(...)`. But real open-source developers invent patterns like route factory exports (`module.exports = (app) => ...`), inline router method chaining (`Router().use(...).use(...)`), and array loops over route configs.
2. **Precision and Recall Tradeoffs**: Static analysis must balance sound guarantees against practical coverage. Flagging dynamic array loops (`routes.forEach(r => router.use(r.path, r.route))`) as `confidence: "uncertain"` preserves truthfulness without crashing or inventing hallucinated routes.
3. **Regression Proofing with Goldens**: Every time an AST scanner is improved to handle a new pattern, verifying that existing golden models remain 100% byte-for-byte identical guarantees that new fixes never break existing capabilities.

---

## Step 8c: Effect Refinement from Handler Bodies (Issue #11)

### Overview

In Step 8c, we replaced "effect from HTTP method only" with evidence-based effect refinement derived directly from route handler function bodies (including 1-hop imported controllers and 1-hop local helper calls).
Previously, DevGuard relied solely on HTTP methods (`GET` -> `read`, `POST`/`PUT`/`PATCH` -> `write`, `DELETE` -> `destructive`). However, real-world backends often conceal mutations behind `GET` endpoints (e.g. creating logs, updating counters, deleting records, writing to disk, or proxying writes). Step 8c detects these mutations with AST evidence and provenance, governed by a strict monotonic risk rule.

---

### Key Architectural Concepts

#### 1. The Monotonic Risk Rule
Static analysis must **never make a route look safer than its HTTP method suggests**:
$$\text{Risk Rank: } \text{unknown (0)} < \text{read (1)} < \text{write (2)} < \text{destructive (3)}$$
- **Raising Risk**: If the handler AST yields evidence of a higher risk rank than the baseline HTTP verb (e.g. `Prisma.user.create()` behind `GET` or `Prisma.user.delete()` behind `POST`), the route's effect is raised to `write` or `destructive`, and `effectEvidence` (`{ filePath, line, signal }`) is attached.
- **Never Lowering Risk**: If a `POST` handler only performs read operations (e.g. `User.findById()`), its effect remains `write` from HTTP baseline. Safe runners and security policies can rely on the HTTP verb guarantee.
- **Unresolvable Handlers**: When a handler cannot be resolved statically (e.g. dynamic invocation `getDynamicHandler()`), the effect remains at its HTTP method baseline (or `unknown`), and diagnostic `DG-I001` is emitted.
- **Unclassified Calls**: Arbitrary functions (`foo()`, `helper()`) or built-in object methods (`Object.create()`, `Map.delete()`) are not classified as database mutations.

#### 2. Known-Library Rule Table
DevGuard implements pattern matchers for the top Node.js data layer and mutation libraries:
- **Prisma**:
  - `create`, `createMany`, `update`, `updateMany`, `upsert`, `$executeRaw` -> `write` (`prisma:<method>`)
  - `delete`, `deleteMany` -> `destructive` (`prisma:<method>`)
- **Mongoose**:
  - `create`, `insertMany`, `updateOne`, `updateMany`, `findOneAndUpdate`, `findByIdAndUpdate`, `save` -> `write` (`mongoose:<method>`)
  - `deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete`, `findOneAndRemove`, `remove` -> `destructive` (`mongoose:<method>`)
- **Sequelize**:
  - `create`, `bulkCreate`, `update`, `upsert`, `save` -> `write` (`sequelize:<method>`)
  - `destroy`, `truncate` -> `destructive` (`sequelize:<method>`)
- **Knex**:
  - `.insert()`, `.update()` -> `write` (`knex:<method>`)
  - `.del()`, `.delete()`, `.truncate()` -> `destructive` (`knex:<method>`)
- **pg (node-postgres)**:
  - `client.query('INSERT ...' | 'UPDATE ...')` -> `write` (`pg:query:<verb>`)
  - `client.query('DELETE ...' | 'DROP ...' | 'TRUNCATE ...')` -> `destructive` (`pg:query:<verb>`)
- **Node.js fs**:
  - `fs.writeFile`, `writeFileSync`, `appendFile`, `copyFile` -> `write` (`fs:<method>`)
  - `fs.unlink`, `unlinkSync`, `rm`, `rmSync`, `rmdir` -> `destructive` (`fs:<method>`)
- **Fetch / Axios**:
  - `fetch(url, { method: 'POST' | 'PUT' | 'PATCH' })`, `axios.post/put/patch` -> `write` (`fetch:<method>` / `axios:<method>`)
  - `fetch(url, { method: 'DELETE' })`, `axios.delete` -> `destructive` (`fetch:DELETE` / `axios:delete`)
- **Generic Models**:
  - `.save()`, `.insert()`, `.create()`, `.update()` -> `write` (`db:<method>`)
  - `.delete()`, `.del()`, `.remove()` -> `destructive` (`db:<method>`)

---

### Verification and Regression Safety
- **Fixture First**: Created `fixtures/effect-refinement/` exercising safe read, DB writes behind GET, destructive calls behind GET, POST read-only retention, POST deletion escalation, 1-hop controller resolution, and dynamic unresolvable handlers.
- **Strict Golden Model Verification**: Schema validation and provenance line checks verified across all 11 golden models with zero regressions.

---

## Step 8d: Zod Validation Extraction (Issue #12)

### Overview

In Step 8d, we implemented Zod validation extraction for Express route handlers and middleware.
Previously, handler inference could only detect accessed properties (`req.body.x`, `req.query.y`) with `unknown` types and `unknown` required status. When an endpoint validates input using a Zod schema (`schema.parse(req.body)`, `schema.safeParse(req.query)`, `validate(schema)` middleware, or 1-hop imported schema), DevGuard now extracts real types, required status, and constraints, populating `params` and `requestBody.schema` with `resolved` provenance pointing directly to the schema definition line.

---

### Key Architectural Concepts

#### 1. Zod AST Extraction & Scope Resolution (`zod-extractor.ts`)
- **Direct & Chained Zod Calls**: Unwraps chained calls (e.g. `z.string().min(3).max(50).email().optional()`).
- **Base Type Extraction**: Supports `string`, `number`, `boolean`, `enum`, `array`, `object`. Any unsupported type (`z.custom()`, `z.any()`, `z.date()`) remains `unknown`.
- **Modifiers**:
  - `optional`: Marks `required = false`.
  - `nullable` / `nullish`: Marks `nullable = true`.
  - `min` / `gte`: Extracted as `minimum` (numbers), `minLength` (strings), `minItems` (arrays).
  - `max` / `lte`: Extracted as `maximum` (numbers), `maxLength` (strings), `maxItems` (arrays).
  - `email`: Extracted as `{ format: 'email' }`.
  - `uuid`: Extracted as `{ format: 'uuid' }`.
- **Scope & 1-Hop Import Resolution**: Resolves schema identifiers in local scope and across imported modules via the module graph (`resolveZodSchemaIdentifier`).
- **Middleware Extraction**: Detects `validate(schema)`, `validateBody(schema)`, `validateQuery(schema)`, and schema maps `validate({ body: bSchema, query: qSchema })`.

#### 2. Authoritative Merge & Resolved Provenance
- Inferred unknown parameters are merged with authoritative Zod parameters (`mergeZodIntoParams`).
- Any Zod field defined in the schema is added to `params` even if not referenced directly in handler code.
- Parameter provenance is set to `{ kind: 'resolved', filePath, line }`, linking directly to the line number where the field is declared.
- Whole-object schema is populated on `requestBody.schema` with `{ kind: 'resolved', filePath, line }` linking to the schema declaration.

#### 3. Targeted Test Generators (`boundaryValueGenerator`)
- A new generator `boundary-values` generates targeted tests only for endpoints having fields with schema constraints:
  - `below-min` / `above-max`: Tests boundary numerical limits.
  - `too-short` / `too-long`: Tests string min/max length constraints.
  - `invalid-email` / `invalid-uuid`: Tests format validation.
  - `invalid-enum`: Tests enum membership validation.
- Existing generators (`wrong-type`, `valid-baseline`) take `param.schema` constraints into account to produce valid baselines and mismatched types without producing false negatives.

---

### Verification and Regression Safety
- **Fixture First**: Created `fixtures/zod-validation/` testing inline `schema.parse`, 1-hop imported schema from `schemas.js`, `validate(schema)` middleware, and query parameter validation.
- **Strict Golden Model & Provenance Line Verification**: Validated across all 12 golden models (`golden-model-validation.test.ts`, `provenance-line-check.test.ts`) with zero regressions.

---

## Step 11: Cross-Analysis — Static AST vs Runtime Live Behavior (Issue #13)

### Overview

Step 11 introduces cross-analysis capabilities that correlate static source code AST extraction with live HTTP test runner observations. While static analysis identifies routes, parameters, authentication requirements, and mutation effects from code, runtime testing observes actual server responses. By cross-referencing both layers, DevGuard detects deep discrepancies:
1. **Dead routes** (defined in code but returning 404 live).
2. **Shadow / unmodeled routes** (responding live but not detected in static code AST).
3. **API consistency deviations** across endpoints (divergent error response JSON shapes or unexpected status code differences for similar client errors).
4. **Broken authentication enforcement** (endpoints declared with bearer/cookie authentication responding 2xx to unauthenticated requests).

---

### Key Architectural Concepts

#### 1. Auth Enforced Oracle & Auth Probe Generator
- **Auth Probe Generator (`auth-probe.ts`)**:
  - Targets endpoints statically inferred to require `bearer` or `cookie` authentication.
  - Generates unauthenticated probe requests omitting authorization headers and cookies.
  - Operates strictly within safe testing limits (`effect: 'read'` only when running in safe mode).
- **Auth Enforced Oracle (`auth-enforced.ts`)**:
  - Evaluates live responses to auth probe requests.
  - Fires an `auth-enforced` finding (severity `error`) if the live server returns a `2xx` success code instead of rejecting the unauthenticated request (401/403).
  - Supplies request/response evidence and source line provenance pointing directly to the route handler or authentication middleware declaration.

#### 2. Cross-Analysis Engine (`packages/core/src/analysis/cross-analysis.ts`)
- **Route in Code but 404 Live (`route-in-code-404-live`)**:
  - Scans model endpoints where valid baseline tests returned `404 Not Found`.
  - Flags dead or broken route declarations, unmounted router files, or missing route prefixes with `warning` severity.
- **Route Live but Not in Code (`live-route-not-in-code`)**:
  - Opt-in safe probing via `config.probePaths` (e.g. `['/healthz', '/metrics', '/api/internal']`).
  - Checks if any configured probe path matches static model endpoints.
  - For unmodeled paths, issues safe GET probes; if the endpoint returns an active status (< 400), issues a `warning` finding flagging unmodeled or dynamically loaded routes.
- **API Consistency Checks**:
  - **Status Code Deviations (`consistency/status-code-deviation`)**: Evaluates 4xx client failure status codes across endpoints (e.g. 400 Bad Request vs 422 Unprocessable Entity). When a cluster of endpoints shares a standard status code (e.g. 400) and an outlier deviates (e.g. 422), flags an `info` consistency finding.
  - **Error Response Shapes (`consistency/error-response-shape`)**: Extracts top-level JSON keys from error response bodies (e.g. `{ error }` vs `{ message }` vs `{ errors }`). Flags outliers deviating from the API-wide standard error envelope.

---

### Verification and Regression Safety
- **Fixture First**: Created `fixtures/cross-analysis/` with deliberate live discrepancies:
  - `/api/secure/profile` (auth bypass returning 200 without token).
  - `/api/secure/settings` (properly rejects with 401).
  - `/api/dead-route` (defined in code, 404 live).
  - `/api/items`, `/orders`, `/users` (consistent 400 `{ error }`).
  - `/api/tickets` (deviating 422 `{ message }`).
  - `/healthz` (unmodeled route).
- **Automated Golden File Checks**: Verified in `golden-model-validation.test.ts`, `provenance-line-check.test.ts`, and `cross-analysis-e2e.test.ts`.
- **Monorepo Safety**: Full test suite (37 files, 465 tests) passing green with strict typecheck and linting.