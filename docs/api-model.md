# DevGuard API Model Specification (`v1.2.0`)

The **DevGuard API Model** (`ApiModel`) is the standardized, framework-agnostic data representation produced when DevGuard statically scans a backend codebase.

It serves as the contract between framework adapters (such as Express, Fastify, or NestJS) and downstream test runners, report generators, and security scanners.

---

## 🏗️ Top-Level Model Structure

An `ApiModel` object contains the following root properties:

```jsonc
{
  "modelVersion": "1.2.0",
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
| `modelVersion` | `"1.2.0"` (or `"1.1.0"`, `"1.0.0"`) | Yes | Exact schema version string. Core validator accepts `1.0.0`, `1.1.0`, and `1.2.0`. |
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
| `auth`             | `object`               |  Yes (defaults to `unknown`)  | Authentication requirement (`type`: `'none' \| 'bearer' \| 'apiKey' \| 'cookie' \| 'custom' \| 'unknown'`) and optional `evidence` (`filePath`, `line`, `signal`). |
| `effect`           | `enum`                 |  Yes (defaults to `unknown`)  | Mutation behavior: `'read' \| 'write' \| 'destructive' \| 'unknown'`. Safe mode only runs `'read'` by default.      |
| `effectEvidence`   | `object`               |              No               | Provenance evidence for effect refinement (`filePath`, `line`, `signal`), attached when handler evidence raises or confirms mutation behavior. |
| `params`           | `ParamDefinition[]`    |    Yes (defaults to `[]`)     | Parameters extracted from path segments, query strings, headers, or request body.                                   |
| `requestBody`      | `object`               |              No               | Expected payload structure, content type, and whole-payload schema (see single source of truth rule below).         |
| `responses`        | `ResponseDefinition[]` |    Yes (defaults to `[]`)     | Known HTTP status codes (e.g. `200`, `201`, `400`) and schemas.                                                     |
| `middleware`       | `MiddlewareEntry[] \| string[]` | Yes (defaults to `[]`) | Ordered list of middleware applied to this endpoint, in Express execution order. In v1.2.0, entries contain `{ name, provenance }`. |
| `mountChain`       | `MountEntry[]`         |              No               | Ordered list of router mounts from application root to handler, capturing the file and line of each mount step.    |
| `provenance`       | `Provenance`           |              Yes              | Source code location where this endpoint was defined (file, line number, snippet).                                  |
| `confidence`       | `enum`                 | Yes (defaults to `confirmed`) | Certainty status: `'confirmed' \| 'uncertain'`.                                                                     |
| `confidenceReason` | `DiagnosticCode`       |    Required if `uncertain`    | Diagnostic code explaining why the route is uncertain (e.g., `'DG-R002'`).                                          |

### Effect Refinement & Monotonic Risk Rule (Step 8c)

The initial baseline effect is derived from the HTTP verb:
- `GET`, `HEAD`, `OPTIONS` → `'read'`
- `POST`, `PUT`, `PATCH` → `'write'`
- `DELETE` → `'destructive'`
- Other / custom → `'unknown'`

Static analysis examines the handler AST (one hop from route declaration or controller import, plus 1-hop local helper calls) for positive database or filesystem mutation evidence.

#### Monotonic Risk Rule
Evidence can **raise** the risk level (`read` < `write` < `destructive`), but **never lower it**:
- If evidence indicates a higher risk than the HTTP method suggests (e.g. `User.create()` behind `GET` or `User.delete()` behind `POST`), the effect is raised to `'write'` or `'destructive'`, with `effectEvidence` pointing to the call line and signal.
- If a `POST` handler only reads data, its effect remains `'write'`.
- If a handler is unresolvable (`DG-I001`), the effect stays at its HTTP method baseline (or `unknown`).
- Unknown or arbitrary function calls are not classified.

#### Known-Library Rule Table

| Library / Category | Method / Call Signature | Inferred Effect | Provenance Signal |
| :----------------- | :---------------------- | :-------------- | :---------------- |
| **Prisma** | `prisma.<model>.create`, `createMany`, `update`, `updateMany`, `upsert`, `$executeRaw` | `write` | `prisma:<method>` |
| **Prisma** | `prisma.<model>.delete`, `deleteMany` | `destructive` | `prisma:<method>` |
| **Mongoose** | `<Model>.create`, `insertMany`, `updateOne`, `updateMany`, `findOneAndUpdate`, `findByIdAndUpdate`, `save` | `write` | `mongoose:<method>` |
| **Mongoose** | `<Model>.deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete`, `findOneAndRemove`, `remove` | `destructive` | `mongoose:<method>` |
| **Sequelize** | `<Model>.bulkCreate`, `upsert` | `write` | `sequelize:<method>` |
| **Sequelize** | `<Model>.destroy`, `truncate` | `destructive` | `sequelize:<method>` |
| **Knex** | `knex(...).insert()`, `.update()` | `write` | `knex:<method>` |
| **Knex** | `knex(...).del()`, `.delete()`, `.truncate()` | `destructive` | `knex:<method>` |
| **pg (node-postgres)** | `client.query('INSERT ...' \| 'UPDATE ...')` | `write` | `pg:query:<verb>` |
| **pg (node-postgres)** | `client.query('DELETE ...' \| 'DROP ...' \| 'TRUNCATE ...')` | `destructive` | `pg:query:<verb>` |
| **Node.js fs** | `fs.writeFile`, `writeFileSync`, `appendFile`, `copyFile` | `write` | `fs:<method>` |
| **Node.js fs** | `fs.unlink`, `unlinkSync`, `rm`, `rmSync`, `rmdir` | `destructive` | `fs:<method>` |
| **Fetch / Axios** | `fetch(url, { method: 'POST' \| 'PUT' \| 'PATCH' })`, `axios.post`, `put`, `patch` | `write` | `fetch:<method>` / `axios:<method>` |
| **Fetch / Axios** | `fetch(url, { method: 'DELETE' })`, `axios.delete` | `destructive` | `fetch:DELETE` / `axios:delete` |
| **Generic DB** | `<db>.insert()`, `<item>.save()`, `<repo>.update()` | `write` | `db:<method>` |
| **Generic DB** | `<db>.delete()`, `<repo>.del()`, `<model>.remove()` | `destructive` | `db:<method>` |

### Parameters vs Request Body Rule (Single Source of Truth)

- **`params` is the single source of truth** for all individual field-level parameter accesses across every location (`'path'`, `'query'`, `'header'`, and `'body'`).
  - When static analysis infers individual body field accesses from handler code without schemas, they are recorded in `params` with `in: 'body'`, `required: 'unknown'`, and `type: 'unknown'`.
- **`requestBody` holds whole-payload metadata**:
  - Transport-level metadata (such as `contentType: 'application/json'`).
  - Top-level schema validation definitions (such as Zod schemas extracted in Step 8d).
  - Provenance linking to the schema definition line.
  - If no whole-payload schema or transport metadata is proven by the scanner, the `requestBody` property is omitted.

### Zod Validation Extraction (Step 8d)

When a route handler or middleware uses a Zod schema (`schema.parse(req.body)`, `schema.safeParse(req.query)`, `validate(schema)` middleware, or 1-hop imported schema):
1. **Authoritative Field Types & Required Status**:
   - Primitive types (`string`, `number`, `boolean`, `enum`, `array`, `object`) replace inferred `'unknown'` types.
   - Modifiers (`optional`, `nullable`, `nullish`) resolve `required` to `false` or `true`, setting `nullable: true` when appropriate.
   - Any unsupported or custom type (`z.custom()`, `z.any()`, `z.date()`) remains `'unknown'`.
2. **Field-Level JSON Schema Constraints**:
   - `email` -> `{ format: 'email' }`
   - `uuid` -> `{ format: 'uuid' }`
   - `min` / `gte` -> `{ minimum: N }` (numbers), `{ minLength: N }` (strings), `{ minItems: N }` (arrays)
   - `max` / `lte` -> `{ maximum: N }` (numbers), `{ maxLength: N }` (strings), `{ maxItems: N }` (arrays)
   - `enum` -> `{ enum: [...] }`
3. **Resolved Provenance**:
   - Each parameter's provenance is `{ kind: 'resolved', filePath, line }`, linking directly to the schema definition line of that field.
   - `requestBody.schema` receives `{ kind: 'resolved', filePath, line }`, linking directly to the schema declaration line.
4. **Targeted Test Generation**:
   - Downstream generators (`boundary-values`, `wrong-type`, `valid-baseline`) consume these schema constraints to synthesize targeted boundary tests (e.g. `below-min`, `above-max`, `too-short`, `too-long`, `invalid-email`, `invalid-uuid`, `invalid-enum`).

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

## 🔒 3. Authentication Detection & Evidence

DevGuard detects authentication requirements statically from active middleware chains and handler inspectable code.
**Honesty rule**: DevGuard never infers `auth: 'none'`. If no known authentication evidence is discovered, `auth` remains `type: 'unknown'`.

### Auth Classification Rule Set

| Classification (`type`) | Evidence Signal (`signal`) | Detection Condition |
| :---------------------- | :------------------------- | :------------------ |
| `bearer`                | `header:authorization:Bearer` | Inspects `req.headers.authorization` or `req.headers['authorization']` and checks for `'Bearer'` token prefix or substring. |
| `apiKey`                | `header:x-api-key`         | Inspects `req.headers['x-api-key']` or `req.headers['apikey']`. |
| `cookie`                | `session:user`             | Inspects `req.session.user`, `req.session.userId`, `req.session.passport`, or `req.cookies`. |
| `custom`                | `name:<middlewareName>`    | Middleware identifier matches auth naming heuristics (e.g. `requireAuth`, `authenticate`, `protect`, `ensureLoggedIn`, `verifyToken`). |
| `unknown`               | *(none)*                   | Default when no positive authentication evidence is found. Never claims `none`. |

When authentication is classified, `auth.evidence` records `{ filePath, line, signal }` pinpointing the exact source file and line providing the proof.

---

## ⚠️ 4. Diagnostics (`diagnostics[]`)

Diagnostics capture issues or ambiguities encountered during analysis without crashing the scan:

| Code      | Severity  | Description                                                                         |
| :-------- | :-------: | :---------------------------------------------------------------------------------- |
| `DG-P001` |  `error`  | **Parse Error**: File syntax error preventing AST generation.                       |
| `DG-R001` | `warning` | **Unresolved Import**: An imported router or controller file could not be resolved. |
| `DG-R002` | `warning` | **Unresolved Router Mount**: A router was mounted but its definition was missing.   |
| `DG-R003` |  `info`   | **Dynamic Path**: Route uses a runtime dynamic expression. Unresolvable segments are replaced with normalized `<EXPRESSION>` placeholders. |
| `DG-I001` |  `info`   | **Unresolved Handler**: Route handler could not be statically resolved. Inferred fields remain empty. |
| `DG-I002` |  `info`   | **Unresolved Middleware**: Middleware expression could not be statically resolved. Appears as `<unresolved>` in middleware chain. |

Each diagnostic records:

- `code`: Diagnostic code enum (`DG-P001`, `DG-R001`, `DG-R002`, `DG-R003`, `DG-I001`, `DG-I002`).
- `severity`: `'error' | 'warning' | 'info'`.
- `message`: Formatted human-readable explanation.
- `file` & `line`: Source location (optional only for project-wide diagnostics).
