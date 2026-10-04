# DevGuard API Model Specification (`v1.0.0`)

The **DevGuard API Model** (`ApiModel`) is the standardized, framework-agnostic data representation produced when DevGuard statically scans a backend codebase.

It serves as the contract between framework adapters (such as Express, Fastify, or NestJS) and downstream test runners, report generators, and security scanners.

---

## 🏗️ Top-Level Model Structure

An `ApiModel` object contains the following root properties:

```jsonc
{
  "modelVersion": "1.0.0",
  "project": {
    "name": "my-express-app",
    "framework": "express",
    "language": "javascript",
    "root": "./backend"
  },
  "endpoints": [ ... ],
  "diagnostics": [ ... ]
}
```

| Field          | Type           | Required? | Description                                                              |
| :------------- | :------------- | :-------: | :----------------------------------------------------------------------- |
| `modelVersion` | `"1.0.0"`      |    Yes    | Exact schema version string.                                             |
| `project`      | `object`       |    Yes    | Target project information (`framework`, `language`, `root` path).       |
| `metadata`     | `object`       | Optional  | Additional scan run environment information.                             |
| `endpoints`    | `Endpoint[]`   |    Yes    | Array of extracted API endpoints discovered during static code analysis. |
| `diagnostics`  | `Diagnostic[]` |    Yes    | Array of non-fatal warnings, dynamic path notices, or parse issues.      |

---

## 🛣️ 1. Endpoints (`endpoints[]`)

Each item in the `endpoints` array describes a unique HTTP route:

| Field              | Type                   |           Required?           | Description                                                                                                         |
| :----------------- | :--------------------- | :---------------------------: | :------------------------------------------------------------------------------------------------------------------ |
| `id`               | `string`               |              Yes              | Canonical identifier in the format `"METHOD /path"` (e.g., `"GET /api/users/:id"`).                                 |
| `method`           | `enum`                 |              Yes              | HTTP method: `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'OPTIONS' \| 'HEAD'`.                              |
| `path`             | `string`               |              Yes              | Normalized route path (e.g., `"/api/users/:id"`).                                                                   |
| `description`      | `string`               |              No               | Human-readable explanation extracted from comments.                                                                 |
| `auth`             | `object`               |  Yes (defaults to `unknown`)  | Authentication requirement details (`type`: `'none' \| 'bearer' \| 'apiKey' \| 'cookie' \| 'custom' \| 'unknown'`). |
| `effect`           | `enum`                 |  Yes (defaults to `unknown`)  | Mutation behavior: `'read' \| 'write' \| 'destructive' \| 'unknown'`. Safe mode only runs `'read'` by default.      |
| `params`           | `ParamDefinition[]`    |    Yes (defaults to `[]`)     | Parameters extracted from path segments, query strings, or headers.                                                 |
| `requestBody`      | `object`               |              No               | Expected payload structure, content type, and schema.                                                               |
| `responses`        | `ResponseDefinition[]` |    Yes (defaults to `[]`)     | Known HTTP status codes (e.g. `200`, `201`, `400`) and schemas.                                                     |
| `middleware`       | `string[]`             |    Yes (defaults to `[]`)     | List of middleware names applied to this endpoint.                                                                  |
| `provenance`       | `Provenance`           |              Yes              | Source code location where this endpoint was defined (file, line number, snippet).                                  |
| `confidence`       | `enum`                 | Yes (defaults to `confirmed`) | Certainty status: `'confirmed' \| 'uncertain'`.                                                                     |
| `confidenceReason` | `DiagnosticCode`       |    Required if `uncertain`    | Diagnostic code explaining why the route is uncertain (e.g., `'DG-R002'`).                                          |

---

## 🔍 2. Provenance & Confidence

### Provenance (`provenance`)

Every fact in the model records where it came from and how it was determined:

- `kind`: How the fact was extracted:
  - `'literal'`: Declared as a constant or literal string in code (e.g., `app.get('/users', ...)`).
  - `'resolved'`: Derived by static resolution (e.g., constant variable propagation or router mount prefix concatenation).
  - `'inferred'`: Inferred from handler code usage (e.g., reading `req.body.email`).
  - `'unresolved'`: Extracted with incomplete or ambiguous static information. Placeholder (uncertain) routes with `<EXPRESSION>` placeholders always receive `kind: 'unresolved'`.
- `filePath`: Relative or absolute path to the source file (e.g., `"src/routes/users.js"`).
- `line`: Line number in the source file.
- `column`: (Optional) Column number.
- `snippet`: (Optional) Source code snippet.

### Placeholder Normalization Rules (`<EXPRESSION>`)

When a route path contains dynamic expressions that cannot be statically resolved, the unresolvable portion is preserved using an `<EXPRESSION>` placeholder:
- **Whitespace Collapsing**: All consecutive whitespace characters (including newlines and tabs) are collapsed into a single space, and leading/trailing whitespace is trimmed.
- **Length Cap**: The inner expression text is capped at 60 characters. If the collapsed text exceeds 60 characters, it is truncated with `...` (57 characters + `...`).
- **Provenance & Confidence**: Any route containing a dynamic placeholder receives `provenance.kind = 'unresolved'`, `confidence = 'uncertain'`, and `confidenceReason = 'DG-R003'`.

### Confidence (`confidence` & `confidenceReason`)

- `'confirmed'`: Full confidence in the route's path and handler.
- `'uncertain'`: Ambiguity exists (e.g., dynamic import, unresolvable router mount). **Must** include a `confidenceReason` referencing a registered Diagnostic Code (e.g., `DG-R002`, `DG-R003`).

---

## ⚠️ 3. Diagnostics (`diagnostics[]`)

Diagnostics capture issues or ambiguities encountered during analysis without crashing the scan:

| Code      | Severity  | Description                                                                         |
| :-------- | :-------: | :---------------------------------------------------------------------------------- |
| `DG-P001` |  `error`  | **Parse Error**: File syntax error preventing AST generation.                       |
| `DG-R001` | `warning` | **Unresolved Import**: An imported router or controller file could not be resolved. |
| `DG-R002` | `warning` | **Unresolved Router Mount**: A router was mounted but its definition was missing.   |
| `DG-R003` |  `info`   | **Dynamic Path**: Route uses a runtime dynamic expression. Unresolvable segments are replaced with normalized `<EXPRESSION>` placeholders. |

Each diagnostic records:

- `code`: Diagnostic code enum (`DG-P001`, `DG-R001`, `DG-R002`, `DG-R003`).
- `severity`: `'error' | 'warning' | 'info'`.
- `message`: Formatted human-readable explanation.
- `file` & `line`: Source location (optional only for project-wide diagnostics).
