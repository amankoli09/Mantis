# Mantis Diagnostic Codes Reference

This document catalogs all diagnostic codes emitted during static analysis by Mantis adapters and the core model validator.

Diagnostics report non-fatal syntax problems, unresolved module references, dynamic expressions, or unresolvable handlers without terminating the scan process.

---

## Diagnostic Codes Summary

| Code      | Title                   | Severity  | Emitted When                                                                                    | Impact on API Model                                                                  |
| :-------- | :---------------------- | :-------: | :---------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `MT-P001` | Parse Error             |  `error`  | A source file contains invalid syntax and cannot be parsed into an AST.                         | File is skipped; valid routes in other project files continue to be scanned.         |
| `MT-R001` | Unresolved Import       | `warning` | An imported router or controller file path cannot be resolved on disk within the module graph.  | Dependent router mounts or handlers cannot be resolved.                              |
| `MT-R002` | Unresolved Router Mount | `warning` | An `app.use()` or `router.use()` mounts an unresolved identifier or a cyclic mount is detected. | Sub-routes attached to that router cannot be confirmed.                              |
| `MT-R003` | Dynamic Path            |  `info`   | A route path uses a runtime dynamic expression (variable, function call, template, or regex).   | Endpoint is marked `confidence: "uncertain"`; dynamic segments use `<EXPRESSION>`.   |
| `MT-R004` | Unmounted Router        | `warning` | An Express router is defined with routes but is never mounted to the application or root graph. | Routes are emitted with `confidence: "uncertain"` and root path prefix.              |
| `MT-I001` | Unresolved Handler      |  `info`   | A route handler cannot be statically resolved (e.g., dynamic factory, multi-hop re-export).     | Route is still extracted with confirmed path/method; inferred params remain empty.   |
| `MT-I002` | Unresolved Middleware   |  `info`   | A middleware expression cannot be statically resolved (e.g., dynamic require, unknown factory). | Middleware is recorded as `<unresolved>`; endpoint authentication remains `unknown`. |

---

## Detailed Code Reference

### `MT-P001`: Parse Error

- **Default Severity**: `error`
- **Template**: `Failed to parse file "<file>": <reason>`
- **When Emitted**:
  Emitted by `@mantis/adapter-express` during the file parsing stage when the Babel parser throws a `SyntaxError` on a file in the project.
- **Handling**:
  The offending file is safely skipped, preventing analyzer crashes. The diagnostic records the file path and Babel parser error message. Other valid files in the project continue to be scanned.

---

### `MT-R001`: Unresolved Import

- **Default Severity**: `warning`
- **Template**: `Could not resolve import "<importPath>" from "<sourceFile>"`
- **When Emitted**:
  Emitted by the module graph builder when an `import` or `require(...)` statement references a file path that does not exist on disk, points outside the project, or fails module resolution.
- **Handling**:
  The module graph records the missing dependency. Any router or controller imports that depend on this file will fail to resolve, typically cascading to a `MT-R002` or `MT-I001` diagnostic.

---

### `MT-R002`: Unresolved Router Mount

- **Default Severity**: `warning`
- **Template**: `Could not resolve router mounted at "<mountPath>" [for identifier "<routerIdentifier>"]`
- **When Emitted**:
  Emitted when `app.use('/prefix', target)` or `router.use('/prefix', target)` is encountered, but `target`:
  1. Cannot be resolved to an Express `Router` declaration (e.g. unknown external middleware, complex member expression, or unimported variable).
  2. Forms a cyclic dependency loop between routers.
- **Handling**:
  If `target` is third-party middleware or an unresolvable expression, the mount is recorded with diagnostic `MT-R002`.

---

### `MT-R003`: Dynamic Path (Severity Review Rationale)

- **Default Severity**: `info`
- **Template**: `Route path uses dynamic runtime expression: <rawExpression>`
- **Severity Review Rationale**:
  In Issue 7 / Phase 1.5 review, `MT-R003` was evaluated for potential promotion to `warning`. We intentionally retain `info` as default: Express route paths frequently utilize environment variables (`process.env.PREFIX`), configuration constants, or regex wildcards for valid architectural reasons. Promoting `MT-R003` to `warning` would cause false-positive CI test gate failures on valid applications. By keeping `info` severity with `confidence: "uncertain"`, Mantis alerts operators without blocking CI unless `--fail-on info` is explicitly configured.
- **When Emitted**:
  Emitted when an endpoint route path contains runtime expressions that cannot be statically resolved to a string literal (e.g., `process.env.ROUTE`, `getPath()`, regular expressions, or reassigned mutable variables).
- **Handling**:
  - The static analyzer preserves the route entry so test runners and security tooling know an endpoint exists at runtime.
  - The unresolvable segment is replaced with a normalized `<EXPRESSION>` placeholder (whitespace collapsed, capped at 60 characters).
  - The endpoint is marked with:
    - `provenance.kind = "unresolved"`
    - `confidence = "uncertain"`
    - `confidenceReason = "MT-R003"`

---

### `MT-R004`: Unmounted Router

- **Default Severity**: `warning`
- **Template**: `Router declared in "<file>" has routes but is never mounted to an application`
- **When Emitted**:
  Emitted when a file creates an Express `Router()` instance and defines routes on it, but the router is never attached via `app.use()` or imported by an application entrypoint.
- **Handling**:
  - Distinguishes dead/orphan routes from broken mount statements (`MT-R002`).
  - Routes attached to the unmounted router are still extracted into the ApiModel so developers have full visibility of candidate code.
  - The extracted routes are tagged with:
    - `confidence: "uncertain"`
    - `confidenceReason: "MT-R004"`
  - Emits diagnostic `MT-R004` pointing to the file and declaration line.

---

### `MT-I001`: Unresolved Handler

- **Default Severity**: `info`
- **Template**: `Route handler could not be statically resolved[: <handlerName>] [(<reason>)]`
- **When Emitted**:
  Emitted by handler inference when an endpoint's handler is not:
  1. An inline function expression or arrow function.
  2. A local function declaration in the same file.
  3. A single-hop imported identifier pointing to a function in another project file.
  4. An array of middleware/handlers ending in a resolvable function.
- **Handling**:
  - The endpoint's HTTP method and path remain **confirmed** (if statically resolved).
  - The diagnostic is appended to `diagnostics[]` with the route's file and line number.
  - Parameter inference and effect inference cannot inspect the handler body, so `params` remain path-only (or empty) and `effect` defaults to `'unknown'`.

---

### `MT-I002`: Unresolved Middleware

- **Default Severity**: `info`
- **Template**: `Middleware could not be statically resolved[: <middlewareName>] [(<reason>)]`
- **When Emitted**:
  Emitted by middleware inference when a middleware expression passed to `app.use()`, `router.use()`, or route arguments cannot be statically resolved:
  1. Dynamic require statements (e.g., `const dyn = require(dynamicVar); app.use(dyn)`).
  2. Unknown dynamic middleware factories (e.g., `app.use(createCustomMiddleware())`).
  3. External unresolvable imports.
- **Handling**:
  - The middleware is recorded in the endpoint's `middleware` array with `name: "<unresolved>"` and `provenance.kind = "unresolved"`.
  - The diagnostic is appended to `diagnostics[]` with the middleware registration file and line number.
  - Scan continues safely; the endpoint's authentication classification remains `'unknown'` unless other positive auth evidence exists.

---

## 🛠️ Troubleshooting Guide

### 1. File Skipped Due to Parse Error (`MT-P001`)

- **Symptom**: `Failed to parse file "src/legacy.js": SyntaxError`
- **Cause**: The file contains non-standard JavaScript or JSX syntax unsupported by standard Babel parser presets without plugins.
- **Solution**:
  1. Verify the file compiles with Node.js or your project's build tool.
  2. If the file is a build artifact, test script, or utility outside your API route tree, exclude it or keep it unreferenced by Express route entrypoints.
  3. Mantis continues scanning all other valid files in the project.

### 2. Missing Sub-Routes from Unresolved Import (`MT-R001`)

- **Symptom**: Subrouters mounted in `app.js` are missing endpoints; diagnostic reports `Could not resolve import "./routes/v1"`.
- **Cause**: Import path omits file extensions, references a non-standard path alias (e.g. `@/routes`), or uses directory imports without an explicit `index.js`.
- **Solution**:
  1. Ensure imported router files exist within the target repository directory.
  2. Check whether path aliases are used; ensure entrypoints reference relative file paths.

### 3. Sub-Routes Missing Mount Prefix (`MT-R002`)

- **Symptom**: Endpoints are extracted with root paths (e.g. `/users` instead of `/api/v1/users`).
- **Cause**: The mount expression `app.use(mountPrefix, router)` could not statically bind `router` to its definition file (e.g., dynamically selected router or factory invocation).
- **Solution**:
  1. Inspect the mount statement reported in the diagnostic.
  2. If router is instantiated via a factory function, ensure it returns an Express `Router()` instance directly.

### 4. Dynamic Path Warning (`MT-R003`)

- **Symptom**: Route appears in report with placeholder `<EXPRESSION>` and confidence `uncertain`.
- **Cause**: Route path uses runtime variables, template strings, or environment variables (e.g., `app.get(\`${API_PREFIX}/users\`)`).
- **Solution**:
  1. If `API_PREFIX` is a constant string defined in the same or imported module, Mantis resolves it automatically via constant propagation.
  2. If the path depends on runtime environment variables, Mantis safely extracts the route with normalized `<EXPRESSION>` and continues testing.

### 5. Orphan Router Warning (`MT-R004`)

- **Symptom**: `Router declared in "routes/admin.js" has routes but is never mounted`.
- **Cause**: A router file defines routes, but `app.use(adminRouter)` is missing, commented out, or conditionally mounted at runtime.
- **Solution**:
  1. If the router is dead code, remove it from the codebase.
  2. If it is meant to be active, mount it in your application entrypoint using standard `app.use('/prefix', router)`.

---

## 🚧 Known Limitations (Empirical Findings from M1-03)

Empirical validation on real-world open-source Express repositories (benchmarked in `M1-03`) identified specific architectural patterns that represent current static analysis boundaries:

### 1. Dynamic Route Array Loops (e.g. `node-express-boilerplate`)

- **Pattern**:
  ```javascript
  const defaultRoutes = [
    { path: '/auth', route: authRoute },
    { path: '/users', route: userRoute },
  ];
  defaultRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
  ```
- **Limitation**:
  Mantis performs static AST analysis without evaluating JavaScript runtime execution. It does not execute `Array.prototype.forEach()` loops or iterate object collections at scan time.
- **Observed Impact**:
  Subrouters (`authRoute`, `userRoute`) cannot be bound to their loop-mounted prefixes. The subrouters are extracted with root paths tagged as `confidence: "uncertain"` with diagnostics `MT-R002` and `MT-R004`.
- **Remediation**:
  Explicit, declarative mounts (`router.use('/auth', authRoute); router.use('/users', userRoute);`) allow 100% confirmed static extraction.

### 2. Dynamic Barrel Re-exports & Computed Exports

- **Pattern**:
  ```javascript
  // routes/index.js
  fs.readdirSync(__dirname).forEach((file) => {
    if (file !== 'index.js') app.use('/' + file.replace('.js', ''), require('./' + file));
  });
  ```
- **Limitation**:
  Filesystem-driven dynamic `require()` calls and computed export objects cannot be traversed statically.
- **Observed Impact**:
  Router files are extracted as unmounted (`MT-R004`) and paths remain relative or uncertain.

### 3. Non-Express Frameworks

- **Limitation**:
  Phase 1 exclusively supports **Express.js** applications. Other frameworks (Fastify, NestJS, Koa, Hono) are not yet supported and are planned for subsequent phases via pluggable adapters.

### 4. Relational Database Fixture Generation

- **Limitation**:
  Mantis synthesizes baseline and boundary request payloads purely from static AST parameter accesses and Zod validation schemas. It does not inspect live relational databases, seed mock databases, or synthesize relational foreign keys (e.g., an existing `:userId` in a foreign database table).
- **Observed Impact**:
  Baseline requests that require pre-existing relational database state may return `500` or `404`. For this reason, `server-error-on-valid-input` is calibrated with `low` confidence and suppressed by default under `--min-confidence medium`.
