# DevGuard Diagnostic Codes Reference

This document catalogs all diagnostic codes emitted during static analysis by DevGuard adapters and the core model validator.

Diagnostics report non-fatal syntax problems, unresolved module references, dynamic expressions, or unresolvable handlers without terminating the scan process.

---

## Diagnostic Codes Summary

| Code      | Title                     | Severity  | Emitted When                                                                                     | Impact on API Model                                                         |
| :-------- | :------------------------ | :-------: | :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `DG-P001` | Parse Error               |  `error`  | A source file contains invalid syntax and cannot be parsed into an AST.                          | File is skipped; valid routes in other project files continue to be scanned. |
| `DG-R001` | Unresolved Import         | `warning` | An imported router or controller file path cannot be resolved on disk within the module graph.   | Dependent router mounts or handlers cannot be resolved.                    |
| `DG-R002` | Unresolved Router Mount   | `warning` | An `app.use()` or `router.use()` mounts an unresolved identifier or a cyclic mount is detected. | Sub-routes attached to that router cannot be confirmed.                     |
| `DG-R003` | Dynamic Path              |  `info`   | A route path uses a runtime dynamic expression (variable, function call, template, or regex).    | Endpoint is marked `confidence: "uncertain"`; dynamic segments use `<EXPRESSION>`. |
| `DG-I001` | Unresolved Handler        |  `info`   | A route handler cannot be statically resolved (e.g., dynamic factory, multi-hop re-export).       | Route is still extracted with confirmed path/method; inferred params remain empty. |
| `DG-I002` | Unresolved Middleware     |  `info`   | A middleware expression cannot be statically resolved (e.g., dynamic require, unknown factory).   | Middleware is recorded as `<unresolved>`; endpoint authentication remains `unknown`. |

---

## Detailed Code Reference

### `DG-P001`: Parse Error
- **Default Severity**: `error`
- **Template**: `Failed to parse file "<file>": <reason>`
- **When Emitted**:
  Emitted by `@devguard/adapter-express` during the file parsing stage when the Babel parser throws a `SyntaxError` on a file in the project.
- **Handling**:
  The offending file is safely skipped, preventing analyzer crashes. The diagnostic records the file path and Babel parser error message. Other valid files in the project continue to be scanned.

---

### `DG-R001`: Unresolved Import
- **Default Severity**: `warning`
- **Template**: `Could not resolve import "<importPath>" from "<sourceFile>"`
- **When Emitted**:
  Emitted by the module graph builder when an `import` or `require(...)` statement references a file path that does not exist on disk, points outside the project, or fails module resolution.
- **Handling**:
  The module graph records the missing dependency. Any router or controller imports that depend on this file will fail to resolve, typically cascading to a `DG-R002` or `DG-I001` diagnostic.

---

### `DG-R002`: Unresolved Router Mount
- **Default Severity**: `warning`
- **Template**: `Could not resolve router mounted at "<mountPath>" [for identifier "<routerIdentifier>"]`
- **When Emitted**:
  Emitted when `app.use('/prefix', target)` or `router.use('/prefix', target)` is encountered, but `target`:
  1. Cannot be resolved to an Express `Router` declaration (e.g. unknown external middleware, complex member expression, or unimported variable).
  2. Is unmounted (e.g., an orphan router never mounted to the root application).
  3. Forms a cyclic dependency loop between routers.
- **Handling**:
  If the router is an unmounted orphan router that defines routes, those routes are emitted with `confidence: "uncertain"` and `confidenceReason: "DG-R002"`. If `target` is third-party middleware, the mount is skipped.

---

### `DG-R003`: Dynamic Path
- **Default Severity**: `info`
- **Template**: `Route path uses dynamic runtime expression: <rawExpression>`
- **When Emitted**:
  Emitted when an endpoint route path contains runtime expressions that cannot be statically resolved to a string literal (e.g., `process.env.ROUTE`, `getPath()`, regular expressions, or reassigned mutable variables).
- **Handling**:
  - The static analyzer preserves the route entry so test runners and security tooling know an endpoint exists at runtime.
  - The unresolvable segment is replaced with a normalized `<EXPRESSION>` placeholder (whitespace collapsed, capped at 60 characters).
  - The endpoint is marked with:
    - `provenance.kind = "unresolved"`
    - `confidence = "uncertain"`
    - `confidenceReason = "DG-R003"`

---

### `DG-I001`: Unresolved Handler
- **Default Severity**: `info`
- **Template**: `Route handler could not be statically resolved[: <handlerName>] [(<reason>)]`
- **When Emitted**:
  Emitted by handler inference (Step 8a) when an endpoint's handler is not:
  1. An inline function expression or arrow function.
  2. A local function declaration in the same file.
  3. A single-hop imported identifier pointing to a function in another project file.
  4. An array of middleware/handlers ending in a resolvable function.
  Examples: dynamic handler factory calls (`app.get('/path', makeHandler())`), multi-hop re-exports, external npm controller packages, or runtime dispatchers.
- **Handling**:
  - The endpoint's HTTP method and path remain **confirmed** (if statically resolved).
  - The diagnostic is appended to `diagnostics[]` with the route's file and line number.
  - Parameter inference and effect inference cannot inspect the handler body, so `params` remain path-only (or empty) and `effect` defaults to `'unknown'`.

---

### `DG-I002`: Unresolved Middleware
- **Default Severity**: `info`
- **Template**: `Middleware could not be statically resolved[: <middlewareName>] [(<reason>)]`
- **When Emitted**:
  Emitted by middleware inference (Step 8b) when a middleware expression passed to `app.use()`, `router.use()`, or route arguments cannot be statically resolved:
  1. Dynamic require statements (e.g., `const dyn = require(dynamicVar); app.use(dyn)`).
  2. Unknown dynamic middleware factories (e.g., `app.use(createCustomMiddleware())`).
  3. External unresolvable imports.
- **Handling**:
  - The middleware is recorded in the endpoint's `middleware` array with `name: "<unresolved>"` and `provenance.kind = "unresolved"`.
  - The diagnostic is appended to `diagnostics[]` with the middleware registration file and line number.
  - Scan continues safely; the endpoint's authentication classification remains `'unknown'` unless other positive auth evidence exists.

