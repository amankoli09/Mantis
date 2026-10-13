# Mantis Core — Build Plan (Phase 1: Node.js + Express)

## 0. Mission

Build **Mantis Core**: an engine that reads a backend's source code, produces a trustworthy **API Model** of every endpoint, then tests the running API and explains where it breaks, linking each problem back to the source line.

Phase 1 supports **JavaScript/Node.js + Express only**. Do not add other languages or frameworks yet. The core must stay framework-agnostic so they can be added later as adapters.

No AI dependency. Everything is deterministic.

---

## 1. What makes Mantis Core different (design pillars)

We are not competing with Postman or spec-based tools. These are the ideas that define the engine:

1. **Evidence-carrying model.** Every fact in the API Model (a route, a param, a rule) records _where it came from_ (file, line) and _how it was determined_ (`literal`, `resolved`, `inferred`, `unresolved`). Nothing is asserted without evidence.
2. **Honest confidence.** Each endpoint is `confirmed` or `uncertain` with a reason code. The engine reports what it could _not_ resolve instead of hiding it. A "Resolution Report" is a first-class output.
3. **Code-linked findings.** A failed test is not just "500 on POST /users". It says "500 on POST /users, handler at `src/routes/users.js:42`, reads `req.body.email` with no validation."
4. **Static + runtime cross-checking.** Static analysis says what the code _reads_; runtime says what it _does_. Mismatches are findings (e.g. field read but never validated; route in code but 404 at runtime; route live but not found statically).
5. **Effect classification for safety.** Each endpoint is classified `read`, `write`, or `destructive` (from method plus handler analysis). Safe mode only runs `read` by default. Unknown counts as unsafe.
6. **Deterministic and replayable.** Same input gives the same output (sorted, stable IDs). Every run records request/response pairs so a report can be replayed and diffed without hitting the server again.
7. **Pluggable brains.** Test _generators_ and response _oracles_ are tiny plugins. Adding a check means adding one file.
8. **Consistency analysis.** Compare endpoints against each other (error shape, status codes for similar failures, auth on sibling routes) to find inconsistencies no single-request tester can see.

---

## 2. Tech stack

| Concern              | Choice                                                   | Why                                            |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Language             | **TypeScript** (strict mode)                             | Type-safe model across adapters; helps Phase 2 |
| Runtime              | **Node.js 22 LTS**                                       | Current LTS                                    |
| Monorepo             | **pnpm workspaces** (add Turborepo later if builds slow) | Simple, fast, strict dependency rules          |
| JS parsing           | **@babel/parser + @babel/traverse**                      | Mature, scope and binding aware                |
| TS parsing (Phase 2) | Babel TS plugin or **ts-morph**                          | Reuse the same pipeline                        |
| Model schema         | **Zod**, exported to JSON Schema (`zod-to-json-schema`)  | One source of truth for types and validation   |
| Schema validation    | **Ajv**                                                  | Validate adapter output against JSON Schema    |
| HTTP runner          | **undici**                                               | Fast, timeouts and abort control               |
| CLI                  | **commander** (or `cac`)                                 | Simple, well documented                        |
| Terminal output      | **picocolors** + a small table helper                    | Lightweight                                    |
| Testing              | **Vitest**                                               | Fast, snapshot support                         |
| Property-based tests | **fast-check**                                           | For generators and resolver invariants         |
| Build                | **tsup**                                                 | Simple bundling to ESM and CJS                 |
| Lint/format          | **ESLint + Prettier**                                    | Standard                                       |
| Commits/versioning   | **Conventional Commits + Changesets**                    | Clean history and releases                     |
| CI                   | **GitHub Actions**                                       | Run tests and fixture goldens on every push    |
| Storage              | **JSON files** (in `.mantis/`)                         | No database in Phase 1                         |

---

## 3. Folder structure

```text
mantis/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .github/workflows/ci.yml
├─ docs/
│  ├─ architecture.md
│  ├─ api-model.md
│  ├─ diagnostics.md            # all MT-xxxx codes explained
│  └─ decisions/                # ADRs: 0001-use-babel.md, ...
├─ packages/
│  ├─ core/                     # NO Express-specific code allowed here
│  │  └─ src/
│  │     ├─ model/              # Zod schema, types, JSON Schema export, versioning
│  │     ├─ diagnostics/        # diagnostic codes and reporter
│  │     ├─ adapter/            # Adapter interface (what every framework implements)
│  │     ├─ planner/            # turns API Model into a test plan
│  │     ├─ generators/         # input generators (plugins)
│  │     ├─ oracles/            # response judges (plugins)
│  │     ├─ analysis/           # cross-endpoint consistency, static vs runtime diff
│  │     ├─ report/             # terminal, JSON, (later HTML) reporters
│  │     └─ index.ts
│  ├─ adapter-express/          # everything Express-specific
│  │  └─ src/
│  │     ├─ detect/             # is this an Express project?
│  │     ├─ fs/                 # file walker, ignore rules
│  │     ├─ parse/              # source to AST
│  │     ├─ graph/              # module graph (require/import resolution)
│  │     ├─ resolve/            # routers, mounts, prefixes, constants
│  │     ├─ extract/            # endpoints, params, middleware, auth hints
│  │     ├─ infer/              # req.body/query/params usage, validation libs
│  │     └─ index.ts            # implements the Adapter interface
│  ├─ runner/                   # safe HTTP execution
│  │  └─ src/
│  │     ├─ safety/             # safe mode, host allowlist, dry run
│  │     ├─ http/               # undici client, timeouts, size limits
│  │     ├─ session/            # record and replay
│  │     └─ index.ts
│  └─ cli/                      # thin: parses args, calls the packages
│     └─ src/commands/          # scan.ts, test.ts, report.ts, init.ts
├─ fixtures/                    # sample apps with KNOWN answers
│  ├─ simple/                   # 5-6 routes, one file
│  │  ├─ app/
│  │  └─ expected.model.json    # golden file
│  ├─ nested-routers/
│  ├─ multi-file-esm/
│  ├─ dynamic-paths/
│  ├─ validation-zod/
│  └─ planted-bugs/             # app with deliberate bugs + expected findings
└─ benchmarks/                  # precision/recall scripts for real repos
```

**Hard rules for the structure**

- `core` must never import from `adapter-express`, `runner`, or `cli`.
- `adapter-express` may import from `core` (the model and adapter interface only).
- `cli` is thin and contains no logic that belongs in another package.
- Dependencies point inward: `cli` to `runner`/`adapters` to `core`.

---

## 4. The pipeline

```text
Detect → Walk files → Parse (AST) → Module graph → Resolve routers/mounts
  → Extract endpoints → Infer params/validation/auth/effects
  → API Model (validated) → Plan tests → Execute (runner)
  → Judge (oracles) → Cross-analysis → Report
```

Each stage is a pure function: data in, data out, no hidden global state. Each stage has its own tests.

---

## 5. The API Model (the contract)

Versioned (`"modelVersion": "1.0.0"`), validated with Zod and JSON Schema. Draft shape:

```jsonc
{
  "modelVersion": "1.0.0",
  "project": { "framework": "express", "language": "javascript", "root": "./backend" },
  "endpoints": [
    {
      "id": "GET /api/users/:id", // stable, deterministic
      "method": "GET",
      "path": "/api/users/:id",
      "pathParams": [
        { "name": "id", "provenance": { "kind": "literal", "file": "...", "line": 12 } },
      ],
      "queryParams": [],
      "bodyFields": [
        {
          "name": "email",
          "required": "unknown",
          "type": "unknown",
          "provenance": { "kind": "inferred", "file": "...", "line": 44 },
        },
      ],
      "validation": { "library": "zod", "rules": [] },
      "auth": "unknown", // "required" | "none" | "unknown"
      "effect": "read", // "read" | "write" | "destructive" | "unknown"
      "handler": { "file": "src/routes/users.js", "line": 40 },
      "confidence": "confirmed", // or "uncertain"
      "confidenceReason": null, // e.g. "MT-R002"
      "middleware": ["authenticate"],
    },
  ],
  "diagnostics": [
    {
      "code": "MT-R002",
      "severity": "warning",
      "message": "Router mount could not be resolved (dynamic import)",
      "file": "src/app.js",
      "line": 18,
    },
  ],
}
```

Rules:

- Arrays are sorted deterministically.
- Unknown is a valid value. Never guess and label it as certain.
- Any change to the schema requires a version bump and an ADR.

---

## 6. Build order (agent instructions)

Complete each step, with tests passing, before starting the next. Every step ends with a commit.

### Step 1: Repo skeleton

- pnpm workspace, `tsconfig.base.json` (strict), ESLint, Prettier, Vitest, tsup
- Empty packages: `core`, `adapter-express`, `runner`, `cli`
- CI runs lint, typecheck, and tests
- **Done when:** `pnpm test` and `pnpm build` pass on empty packages and CI is green.

### Step 2: Model and diagnostics (in `core`)

- Zod schema for the API Model, exported JSON Schema, `validateModel()` function
- Diagnostic code registry (`MT-Rxxx` resolver, `MT-Pxxx` parser, `MT-Ixxx` inference, `MT-Txxx` testing)
- Define the `Adapter` interface: `detect(root)` and `scan(root) → ApiModel`
- **Done when:** valid and invalid model samples are tested, and the schema file is generated.

### Step 3: Fixtures first

- Build `fixtures/simple` and `fixtures/nested-routers` with hand-written `expected.model.json`
- **Done when:** the expected files validate against the schema.

### Step 4: Express detection and file walking

- Detect Express via `package.json` and imports (`require('express')`, `import express`)
- Walk files, respecting ignore rules (`node_modules`, `dist`, `build`, `.git`, tests optionally)
- **Done when:** detection works on all fixtures and a non-Express folder is rejected cleanly.

### Step 5: Parsing and direct routes

- Parse to AST (tolerant of syntax errors: report `MT-P001`, continue)
- Extract `app.get/post/put/patch/delete('/path', ...)`, with method, path, file, line
- **Done when:** the `simple` fixture output matches its golden file.

### Step 6: Module graph

- Resolve `require()` and `import` across files (relative paths, `index.js`, extensions)
- Track exports (`module.exports = router`, `export default router`)
- **Done when:** a test proves an imported router is linked to its source file.

### Step 7: Router and mount resolution (the hard part)

- `express.Router()`, `app.use('/prefix', router)`, nested mounts, prefix concatenation
- `router.route('/x').get().post()` chaining
- Constant propagation (`const BASE = '/api'`, string concat, template literals)
- Arrays of paths and handlers
- Unresolvable cases produce `uncertain` endpoints with reason codes, and never crash
- **Done when:** `nested-routers` and `dynamic-paths` fixtures match golden files.

### Step 8: Inference

- `req.params/query/body` usage, including destructuring (`const { email } = req.body`)
- Middleware and auth detection (name and pattern hints, configurable)
- Effect classification (method plus handler hints such as DB write calls)
- Validation library support: **Zod first**, then Joi/express-validator later
- **Done when:** the `validation-zod` fixture shows real types and required fields.

### Step 9: Runner and safety

- `mantis.config.json`: base URL, auth headers, skip list, allowed effects
- Safe mode by default (`read` only), `--dry-run`, refuse non-local hosts unless `--allow-remote`
- Timeouts, max response size, retry limit, concurrency limit
- The user starts the app; Mantis only takes the base URL
- Record every request and response to `.mantis/sessions/`
- **Done when:** the runner hits a fixture app and records results, and safety rules are unit-tested.

### Step 10: Generators and oracles

- Generators: valid input, missing fields, wrong types, empty body, boundary values, oversized strings, weird characters
- Oracles (each one file):
  - `no-5xx-on-bad-input`
  - `no-stack-trace-leak`
  - `no-sensitive-fields` (password, token, secret, `__v`)
  - `auth-enforced` (protected-looking routes respond without a token)
  - `status-sanity` (4xx for invalid input, 2xx for valid)
  - `timing-outlier`
- Each result: `passed | failed | skipped`, a reason, and the exact request/response
- **Done when:** the `planted-bugs` fixture yields exactly the expected findings (no misses, no extras).

### Step 11: Cross-analysis

- Static vs runtime diff (route in code but 404 live, and the reverse)
- Consistency checks (error shape, status codes across similar endpoints, auth on siblings)
- **Done when:** planted inconsistencies in the fixtures are detected.

### Step 12: CLI and reporting

- `mantis scan <path>` (`--json`)
- `mantis test` (`--dry-run`, `--config`, `--allow-remote`)
- `mantis report` (re-render from a recorded session)
- Terminal report, `report.json`, exit code 1 on failures
- **Done when:** the example output from the roadmap is reproduced on the fixtures.

### Step 13: Benchmark on real repos

- `benchmarks/` script runs the scanner on 5 to 10 open-source Express projects
- Record **precision** (found routes that are real) and **recall** (real routes found)
- Fix the top failure patterns, add each as a new fixture
- **Done when:** results are written to the README with real numbers.

---

## 7. Engineering rules for the agent

1. **Tests first for the resolver.** Every new pattern gets a fixture plus golden file before the code.
2. **Golden files are the source of truth.** If output changes, a human reviews the diff before updating it.
3. **Never crash on user code.** Wrap per-file work, emit a diagnostic, continue.
4. **Never silently drop.** Anything not understood becomes an `uncertain` entry or a diagnostic.
5. **Deterministic output.** Sort everything, no timestamps in models (timestamps go only in session metadata).
6. **Pure stages.** No global mutable state between pipeline stages.
7. **Small commits** with Conventional Commit messages, one concern each.
8. **ADR for every big decision** in `docs/decisions/` (short: context, decision, consequences).
9. **No new dependency** without a one-line justification in the commit or ADR.
10. **Stay in scope.** No TypeScript/Python/Java support, no AI, no database in Phase 1.
11. **Explain as you go.** At the end of each step, write a short "what I built and why" note in `docs/learning-log.md`.

---

## 8. Definition of done for Phase 1 core

- Adding a new framework requires only a new adapter package
- Adding a new check requires only one new oracle file
- Every fixture has a golden file and passes in CI
- Unresolvable code is reported with a reason, never hidden
- Output is deterministic and schema-validated
- Safe mode is the default and is tested
- Precision and recall are measured on real projects and published

**First milestone:** a developer points Mantis at a Node.js + Express backend, and it discovers the endpoints and tests them safely, with findings linked to source lines.
