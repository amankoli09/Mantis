# DevGuard Core

DevGuard Core is an engine that statically analyzes Node.js + Express backend codebases, produces a trustworthy **API Model** of every endpoint, and tests the running API, linking findings back to exact source lines.

---

## 📖 Documentation & Tracking

- 📋 **[Build Plan](file:///Users/amankoli/Desktop/DevGuard/docs/PLAN.md)**: Full 13-step architecture and implementation roadmap.
- 💻 **[CLI Reference](file:///Users/amankoli/Desktop/DevGuard/docs/cli.md)**: Command reference, flags, exit codes, and CI integration guide.
- 📅 **[Daily Progress Tracker](file:///Users/amankoli/Desktop/DevGuard/docs/daily-tracking.md)**: Dated log tracking daily activities, completed tasks, and testing results.
- 📐 **[API Model Specification](file:///Users/amankoli/Desktop/DevGuard/docs/api-model.md)**: Details on every field in the versioned API Model schema (`v1.0.0`).
- 💡 **[Learning Log](file:///Users/amankoli/Desktop/DevGuard/docs/learning-log.md)**: Architectural and tooling decisions explained in plain language.

---

## ⚡ Quick Start with `devguard` CLI

The `devguard` CLI lets you extract API contracts statically and execute safe runtime tests:

### 1. Initialize Configuration

```bash
devguard init
```

### 2. Scan an Express Backend

Statically scan an application and extract the full API Model:

```bash
devguard scan ./fixtures/simple
# Or output machine-readable JSON:
devguard scan ./fixtures/simple --json
```

### 3. Dry-Run Runtime Tests

Generate test cases and verify execution plan without network traffic:

```bash
devguard test ./fixtures/simple --dry-run --base-url http://127.0.0.1:3000
```

### 4. Execute Live Contract Tests

Run safe tests against a running backend:

```bash
devguard test ./fixtures/simple --base-url http://127.0.0.1:3000
```

### 5. Replay and Inspect Session Findings

Re-render recorded test sessions using pure Oracles with zero network traffic:

```bash
devguard report
```

---

## Monorepo Packages

The repository is structured as a `pnpm` monorepo containing the following packages under `packages/`:

| Package                     | Path                       | Purpose                                                              |
| :-------------------------- | :------------------------- | :------------------------------------------------------------------- |
| `@devguard/core`            | `packages/core`            | Core shared data models, schema definitions, diagnostics, and engine |
| `@devguard/adapter-express` | `packages/adapter-express` | Express.js AST parser and route extractor                            |
| `@devguard/runner`          | `packages/runner`          | Test runner and HTTP client executor                                 |
| `@devguard/cli`             | `packages/cli`             | Command-line interface for running scans and test suites             |

---

## Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`

---

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Generate JSON Schema

```bash
pnpm run gen:schema
```

### 3. Build All Packages

```bash
pnpm build
```

### 4. Run Tests

```bash
pnpm test
```

### 5. Typecheck Codebase

```bash
pnpm typecheck
```

### 6. Lint and Format Code

```bash
# Check lint rules
pnpm lint

# Fix lint issues automatically
pnpm lint:fix

# Format code with Prettier
pnpm format

# Verify formatting
pnpm format:check
```

---

## 📊 Real-World Open-Source Express Benchmarks

To measure the accuracy of DevGuard's scanner in real-world scenarios, we benchmarked the engine against diverse open-source Express repositories with hand-curated ground truth endpoints:

| Repository | Style | License | Truth | Found | Precision | Recall | Uncertain | Diagnostics |
|---|---|---|---:|---:|---:|---:|---:|---:|
| [node-todo](https://github.com/scotch-io/node-todo) (0fdb905) | Small API (Route Factory) | MIT | 4 | 4 | 100.0% | 100.0% | 0 | 0 |
| [express-mongoose-es6-rest-api](https://github.com/kunalkapadia/express-mongoose-es6-rest-api) (247fedd) | ES6 / Babel REST API with subrouters | MIT | 8 | 8 | 100.0% | 100.0% | 0 | 10 |
| [express-rest-es2017-boilerplate](https://github.com/danielfsousa/express-rest-es2017-boilerplate) (b8bed6d) | Modern ES2017 / ESM, MVC with controllers | MIT | 15 | 15 | 100.0% | 100.0% | 0 | 14 |
| [node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) (179ae84) | MVC with controllers, routes array loop, Joi validation | MIT | 14 | 15 | 0.0% | 0.0% | 14 | 20 |
| [realworld](https://github.com/gothinkster/node-express-realworld-example-app) (30b68e1) | TypeScript, barrel exports, subrouter root mount | MIT | 20 | 20 | 100.0% | 100.0% | 0 | 1 |
| **Total / Overall** | **5 Repositories** | — | **61** | **62** | **75.8%** | **77.0%** | **14** | **45** |

### Benchmark Evaluation & Key Fixes

Through real-world repository evaluations, we identified and fixed top failure patterns:
1. **Fix 1 — `app.all()` & `router.all()` Expansion**: Handled multi-method wildcard route handlers expanding into standard HTTP verbs (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
2. **Fix 2 — Root Router Mounts & Method Chaining**: Added support for mounting routers without explicit path prefixes (e.g. `app.use(router)`) and chained router declarations (`Router().use(...).use(...)`) across ESM and CommonJS, along with TypeScript source file support.
3. **Fix 3 — Route Factory Functions**: Added detection for route factories exporting functions that take `app` or `router` parameters (e.g., `module.exports = function(app) { ... }`).

