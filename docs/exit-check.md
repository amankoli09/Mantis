# Phase 1 Exit Check — Real-World Project Validation (M1-03)

This document records the empirical validation of Mantis against real-world, open-source Express repositories that were not authored by the project team.

---

## 1. Selected Projects

| Repository | Style | Commit | License | Route Count |
|---|---|---|---|---:|
| [node-todo](https://github.com/scotch-io/node-todo) | Simple CRUD API (Route Factory) | `0fdb905` | MIT | 4 |
| [express-mongoose-es6-rest-api](https://github.com/kunalkapadia/express-mongoose-es6-rest-api) | ES6 / Babel REST API with subrouters | `247fedd` | MIT | 8 |
| [express-rest-es2017-boilerplate](https://github.com/danielfsousa/express-rest-es2017-boilerplate) | Modern ES2017 / ESM, MVC with controllers | `b8bed6d` | MIT | 15 |
| [realworld](https://github.com/gothinkster/node-express-realworld-example-app) | TypeScript, barrel exports, subrouter root mount | `30b68e1` | MIT | 20 |
| [node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) | MVC with controllers, routes array loop, Joi validation | `179ae84` | MIT | 14 |

---

## 2. Methodology

1. **Ground Truth Compilation**: Every endpoint was verified by hand from route definitions, controllers, and tests, and stored in `benchmarks/<project>/truth.json`.
2. **Automated Scanning**: The benchmark runner (`pnpm benchmark` / `scripts/run-benchmarks.ts`) clones each repository into `benchmarks/.clones/` (gitignored), runs `scanProject()`, and compares discovered endpoints with ground truth.
3. **Metrics Evaluated**:
   - **True Positives (TP)**: Confirmed endpoints matching truth.
   - **False Positives (FP)**: Discovered endpoints not present in truth.
   - **False Negatives (FN)**: Truth endpoints not found or missed.
   - **Precision**: `TP / (TP + FP) * 100`
   - **Recall**: `TP / (TP + FN) * 100`
   - **Uncertain**: Routes requiring runtime evaluation.
   - **Diagnostics**: Static analysis notices, warnings, or errors.

---

## 3. Results Table

| Repository | Style | License | Truth | Found | Precision | Recall | Uncertain | Diagnostics |
|---|---|---|---:|---:|---:|---:|---:|---:|
| [node-todo](https://github.com/scotch-io/node-todo) (0fdb905) | Small API (Route Factory) | MIT | 4 | 4 | 100.0% | 100.0% | 0 | 0 |
| [express-mongoose-es6-rest-api](https://github.com/kunalkapadia/express-mongoose-es6-rest-api) (247fedd) | ES6 / Babel REST API with subrouters | MIT | 8 | 8 | 100.0% | 100.0% | 0 | 10 |
| [express-rest-es2017-boilerplate](https://github.com/danielfsousa/express-rest-es2017-boilerplate) (b8bed6d) | Modern ES2017 / ESM, MVC with controllers | MIT | 15 | 15 | 100.0% | 100.0% | 0 | 14 |
| [realworld](https://github.com/gothinkster/node-express-realworld-example-app) (30b68e1) | TypeScript, barrel exports, subrouter root mount | MIT | 20 | 20 | 100.0% | 100.0% | 0 | 1 |
| [node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) (179ae84) | MVC with controllers, routes array loop, Joi validation | MIT | 14 | 15 | 0.0% | 0.0% | 14 | 21 |
| **Total / Overall** | **5 Repositories** | — | **61** | **62** | **75.8%** | **77.0%** | **14** | **46** |

### Confirmed Endpoints Across Supported Architectures
- **Confirmed Endpoints Evaluated**: 47
- **Precision on Confirmed Endpoints**: **100.0%** (0 false positives)
- **Recall on Confirmed Endpoints**: **100.0%** (47 / 47 discovered)
- **Overall Recall across all repos (including dynamic loops)**: **77.0%** (target: ≥ 80% confirmed, gap documented below)

---

## 4. Top Three Failure Patterns & Scanner Fixes

During the initial benchmark run, 3 failure patterns were detected, reproduced with minimal fixtures, and fixed:

### 1. Wildcard HTTP Verb Support (`app.all()` and `router.all()`)
- **Problem**: Applications using `.all('/path', ...)` were ignored or caused verb mismatches.
- **Fixture**: `fixtures/route-all`
- **Fix**: Expanded `.all()` declarations into standard HTTP verbs (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- **Verification**: `fixtures/route-all/expected.model.json` passes golden validation.

### 2. Root Router Mounts Without Path Prefix & Chaining
- **Problem**: Single-argument mounts (`app.use(router)`) and chained router declarations (`Router().use(...).use(...)`) were dropped or misidentified as middleware.
- **Fixture**: `fixtures/router-root-mount`
- **Fix**: Added chained router root detection unwrapping nested CallExpressions, default router export tracking in `mount-resolver`, and root path defaulting (`/`).
- **Verification**: `fixtures/router-root-mount/expected.model.json` passes golden validation.

### 3. Route Factory Function Pattern
- **Problem**: Microservices exporting a function taking an Express app parameter (`module.exports = function(app) { app.get(...) }`) were not recognized.
- **Fixture**: `fixtures/route-factory`
- **Fix**: Added function parameter binding detection for `app` and `router` parameters receiving HTTP calls.
- **Verification**: `fixtures/route-factory/expected.model.json` passes golden validation.

---

## 5. Documented Known Gaps

### Dynamic Route Array Loops (`node-express-boilerplate`)
- **Pattern**: Routes mounted by iterating over an in-memory configuration array:
  ```js
  const defaultRoutes = [{ path: '/auth', route: authRoute }];
  defaultRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
  ```
- **Handling**: Mantis detects the unresolvable mount target, marks the routes as `confidence: "uncertain"`, and emits `MT-R002` / `MT-R003` diagnostics.
- **Safety Invariant**: Mantis **never** marks an unresolvable or guessed route as `confirmed`, avoiding false-positive contract guarantees. Full static resolution of arbitrary array loops is slated for Phase 2 / Phase 3 AST symbolic evaluation.

---

## 6. How to Reproduce

Run the entire benchmark suite with a single command:

```bash
pnpm benchmark
```
