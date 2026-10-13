# Mantis Core — Daily Progress & Activity Tracker

This document tracks all day-by-day work, architecture decisions, testing results, and feature additions across the Mantis project.

---

## 📅 2026-10-01 — Step 4: Express Detection & Deterministic File Walking

### 🎯 Goal

Implement Express framework detection (primary `package.json` evidence + secondary source import search) and deterministic, symlink-safe project file walking in `@mantis/adapter-express`.

### 🛠️ Work Done

- **Deterministic File Walker (`walkProjectFiles`)**:
  - Implemented [`packages/adapter-express/src/file-walker.ts`](packages/adapter-express/src/file-walker.ts) with unicode code-point ordering.
  - Supports ignore directories (`node_modules`, `dist`, `build`, `coverage`, `.git`).
  - Ignores symlinks to prevent directory traversal loops and root escapes.
  - Checks maximum file size (default 1MB) and records `skippedHugeFiles`.
  - Normalizes relative paths with forward slashes (`/`).
- **Express Detector (`detectExpress` & `ExpressAdapter`)**:
  - Implemented [`packages/adapter-express/src/detector.ts`](packages/adapter-express/src/detector.ts) returning rich structured `DetectionResult` (`detected`, `signal`, `file`).
  - Primary evidence: parses `package.json` (`dependencies.express` or `devDependencies.express`).
  - Secondary evidence: fast text search for `require('express')` or `import ... from 'express'`.
  - Implemented [`ExpressAdapter`](packages/adapter-express/src/adapter.ts) implementing `FrameworkAdapter`.
- **Fixtures & Tests**:
  - Added [`fixtures/not-express`](fixtures/not-express) (native Node HTTP app).
  - Added [`fixtures/no-package-json-express`](fixtures/no-package-json-express) and [`fixtures/no-package-json-not-express`](fixtures/no-package-json-not-express).
  - Added [`detector.test.ts`](packages/adapter-express/tests/detector.test.ts) (12 tests) and [`file-walker.test.ts`](packages/adapter-express/tests/file-walker.test.ts) (7 tests).
- **Documentation**:
  - Added Step 4 entry with "Why file walking must be deterministic" to [`docs/learning-log.md`](docs/learning-log.md).

### 🧪 Test & Command Verification Status

| Command          | Purpose                             | Status  | Output Details                                      |
| :--------------- | :---------------------------------- | :-----: | :-------------------------------------------------- |
| `pnpm lint`      | ESLint check                        | ✅ PASS | 0 errors / 0 warnings                               |
| `pnpm typecheck` | TypeScript project check (`tsc -b`) | ✅ PASS | 0 type errors across all packages                   |
| `pnpm test`      | Vitest test runner                  | ✅ PASS | 12 test suites passed (63/63 tests)                 |
| `pnpm build`     | tsup compile ESM + CJS + DTS        | ✅ PASS | Built all 4 packages cleanly                        |

---

## 📅 2026-10-01 — Step 3: Fixtures First (Golden Output Models)

### 🎯 Goal

Build the human-readable Express fixture applications and hand-write their expected API Model outputs (`expected.model.json`) *before* writing any parser/scanner code, verifying that all golden files conform to `validateModel()` and match real source line provenance.

### 🛠️ Work Done

- **Fixture Apps (`fixtures/`)**:
  - Created [`fixtures/simple`](fixtures/simple/app/app.js) with 6 routes (GET `/health`, GET `/users`, GET `/users/:id`, POST `/users`, PUT `/users/:id`, DELETE `/users/:id`), path params, and body reads (`req.body.email`).
  - Created [`fixtures/nested-routers`](fixtures/nested-routers/app/app.js) split across 3 files with `express.Router()`, `app.use('/api', router)`, `router.route().get().post()` chaining, and 1 dynamic path route triggering `MT-R003`.
  - Added readable `package.json` files listing Express dependencies in both fixture apps (uninstalled, readable only).
- **Hand-Written Golden Models**:
  - Created [`fixtures/simple/expected.model.json`](fixtures/simple/expected.model.json) with 6 confirmed endpoints and zero diagnostics.
  - Created [`fixtures/nested-routers/expected.model.json`](fixtures/nested-routers/expected.model.json) with 5 endpoints (4 confirmed, 1 uncertain with `MT-R003`) and 1 diagnostic.
- **Fixture Verification Test Suite**:
  - Implemented [`fixtures/__tests__/golden-model-validation.test.ts`](fixtures/__tests__/golden-model-validation.test.ts) verifying all golden files pass `validateModel()`.
  - Implemented [`fixtures/__tests__/provenance-line-check.test.ts`](fixtures/__tests__/provenance-line-check.test.ts) verifying every `provenance.line` across endpoints, params, and request bodies exists on disk, is within line bounds, non-empty, and matches code snippets.
- **Tooling & Config Updates**:
  - Added `fixtures/*/app/**` to [`eslint.config.js`](eslint.config.js) ignores.
  - Created [`vitest.config.ts`](vitest.config.ts) to filter out worktrees.
  - Documented concepts and decisions in [`docs/learning-log.md`](docs/learning-log.md).

### 🧪 Test & Command Verification Status

| Command          | Purpose                             | Status  | Output Details                                      |
| :--------------- | :---------------------------------- | :-----: | :-------------------------------------------------- |
| `pnpm lint`      | ESLint check                        | ✅ PASS | 0 errors / 0 warnings                               |
| `pnpm typecheck` | TypeScript project check (`tsc -b`) | ✅ PASS | 0 type errors across all packages                   |
| `pnpm test`      | Vitest test runner                  | ✅ PASS | 10 test suites passed (44/44 tests, 20 new fixture tests) |
| `pnpm build`     | tsup compile ESM + CJS + DTS        | ✅ PASS | Built all 4 packages cleanly                        |

---

## 📅 2026-09-30 — Step 2: Core API Model, Diagnostics & JSON Schema

### 🎯 Goal

Implement the central framework-agnostic `ApiModel` Zod schema, diagnostic registry, deterministic endpoint helpers, adapter interface, automated JSON Schema generation script, and comprehensive unit tests aligned with `docs/plan.md`.

### 🛠️ Work Done

- **Schema Design & Validation (`@mantis/core`)**:
  - Implemented [`ProvenanceSchema`](packages/core/src/schema/provenance.ts) with `kind` (`literal`, `resolved`, `inferred`, `unresolved`), `filePath`, `line`, `column`, `snippet`.
  - Implemented [`ConfidenceSchema`](packages/core/src/schema/provenance.ts) (`confirmed`, `uncertain`) with required `confidenceReason` for any uncertain endpoints.
  - Implemented [`EndpointSchema`](packages/core/src/schema/endpoint.ts) supporting methods, path, auth, effect (`read`, `write`, `destructive`, `unknown`), parameters, request body, responses, and middleware.
  - Implemented [`ApiModelSchema`](packages/core/src/schema/model.ts) (`modelVersion: "1.0.0"`, `project`, `metadata`, `endpoints`, `diagnostics`) and `validateModel()`.
- **Diagnostic Registry & Templates**:
  - Implemented [`DiagnosticSchema`](packages/core/src/schema/diagnostics.ts) with `file` and `line`, registry, and factory helper `createDiagnostic()` for `MT-P001` (parse error), `MT-R001` (unresolved import), `MT-R002` (unresolved router mount), and `MT-R003` (dynamic path).
- **Framework Adapter Interface**:
  - Defined [`FrameworkAdapter`](packages/core/src/adapter/index.ts) with `name`, `detect(projectRoot)`, and `scan(projectRoot)`.
- **Deterministic Helpers**:
  - Implemented [`generateEndpointId`](packages/core/src/helpers/endpoint-helpers.ts) (`"METHOD /path"`) and [`sortEndpoints`](packages/core/src/helpers/endpoint-helpers.ts) using locale-independent code-point string comparison (`compareStrings`).
- **Automated JSON Schema Export**:
  - Created [`packages/core/scripts/generate-schema.ts`](packages/core/scripts/generate-schema.ts) generating [`packages/core/api-model.schema.json`](packages/core/api-model.schema.json) via `pnpm run gen:schema`.
- **Documentation**:
  - Created [`docs/api-model.md`](docs/api-model.md) explaining all fields in plain language.
  - Updated [`docs/learning-log.md`](docs/learning-log.md) covering why provenance matters.

### 🧪 Test & Command Verification Status

| Command               | Purpose                             | Status  | Output Details                                   |
| :-------------------- | :---------------------------------- | :-----: | :----------------------------------------------- |
| `pnpm run gen:schema` | Generate `api-model.schema.json`    | ✅ PASS | Created valid Draft-07 JSON Schema               |
| `pnpm lint`           | ESLint check                        | ✅ PASS | 0 errors / 0 warnings                            |
| `pnpm typecheck`      | TypeScript project check (`tsc -b`) | ✅ PASS | 0 type errors across all packages                |
| `pnpm test`           | Vitest test runner                  | ✅ PASS | 8 test suites passed (24/24 tests)               |
| `pnpm build`          | `tsup` compile ESM + CJS + DTS      | ✅ PASS | Built clean bundles without test/script emission |

---

## 📅 2026-09-30 — Step 1: Repo Skeleton, Tooling & Verification Tests

### 🎯 Goal

Initialize the clean TypeScript monorepo workspace for Mantis Core with strict typechecking, linting, formatting, testing, dual-format building (ESM/CJS), CI workflow, and initial smoke tests.

### 🛠️ Work Done

- **Monorepo Structure (`pnpm`)**:
  - Created [`pnpm-workspace.yaml`](pnpm-workspace.yaml) linking `packages/*`.
  - Initialized 4 empty packages: `@mantis/core`, `@mantis/adapter-express`, `@mantis/runner`, `@mantis/cli`.
- **TypeScript Strict Setup**:
  - Created [`tsconfig.base.json`](tsconfig.base.json) and root [`tsconfig.json`](tsconfig.json).
- **Linting & Code Formatting**:
  - Configured modern ESLint Flat Config [`eslint.config.js`](eslint.config.js) and Prettier.
- **Dual Builds & Bundling**:
  - Configured `tsup` across all packages for ESM/CJS/DTS outputs.
- **Unit Testing**:
  - Configured Vitest across all packages with smoke tests.
- **Automation & CI**:
  - Configured GitHub Actions CI workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
- **Documentation**:
  - Created [`README.md`](README.md) and [`docs/learning-log.md`](docs/learning-log.md).

### 🧪 Test & Command Verification Status

| Command          | Purpose                             | Status  | Output Details                   |
| :--------------- | :---------------------------------- | :-----: | :------------------------------- |
| `pnpm install`   | Install workspace packages          | ✅ PASS | Synced 5 workspace projects      |
| `pnpm lint`      | ESLint check                        | ✅ PASS | 0 errors / 0 warnings            |
| `pnpm typecheck` | TypeScript project check (`tsc -b`) | ✅ PASS | No type issues                   |
| `pnpm test`      | Vitest test runner                  | ✅ PASS | 4 test suites passed (4/4 tests) |
| `pnpm build`     | tsup compile ESM + CJS + DTS        | ✅ PASS | All 4 packages generated `dist/` |

---

## 📌 Daily Log Template for Future Entries

```markdown
## 📅 YYYY-MM-DD — [Milestone / Feature Name]

### 🎯 Goal

[Brief 1-line description of the day's objective]

### 🛠️ Work Done

- [Task 1]
- [Task 2]

### 🧪 Test & Command Verification Status

| Command          | Purpose    | Status  | Output Details |
| :--------------- | :--------- | :-----: | :------------- |
| `pnpm test`      | Run tests  | ✅ PASS | [Summary]      |
| `pnpm typecheck` | Typecheck  | ✅ PASS | [Summary]      |
| `pnpm lint`      | Lint check | ✅ PASS | [Summary]      |
| `pnpm build`     | Build      | ✅ PASS | [Summary]      |
```
