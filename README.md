<img width="1429" height="804" alt="Banner" src="https://github.com/user-attachments/assets/9b349b86-0d58-41d4-b383-4666c4c8e837" />

# Mantis

Mantis is an evidence-backed static API model extractor and safety-first runtime contract test engine for Node.js + Express backend codebases. It reconstructs a comprehensive, deterministic API model directly from your source code AST without executing application code, plans safe boundary and type mutation tests, and tests your running service—linking every runtime crash, stack trace leak, or broken authorization check back to the exact source file and line.

---

## ⚡ 3-Command Quick Start

Get started with Mantis in three commands:

```bash
# 1. Initialize configuration with safe defaults
pnpm mantis init

# 2. Statically scan your Express backend
pnpm mantis scan ./fixtures/simple

# 3. Dry-run test plan (zero HTTP requests sent)
pnpm mantis test ./fixtures/simple --dry-run --base-url http://127.0.0.1:3000
```

To run safe contract tests against your running service (read-only by default):

```bash
pnpm mantis test ./fixtures/simple --base-url http://127.0.0.1:3000
```

---

## 🎯 What Mantis Can Do

- **AST-Only Route Extraction**: Discovers Express routes without running application code (`app.get/post/put/delete/patch/all`, `express.Router()`, nested subrouters, route factories, route chaining, ESM and CommonJS, TypeScript and JavaScript).
- **Line-Level Provenance**: Every route, parameter, and rule records where it came from (file, line number) and how it was determined (`literal`, `resolved`, `inferred`, `unresolved`).
- **Conservative Effect Inference**: Analyzes handler AST bodies for database (Prisma, Mongoose, Sequelize, Knex, pg) and filesystem (`fs`) mutations, enforcing the Monotonic Risk Rule (`read` < `write` < `destructive`).
- **Parameter & Zod Schema Extraction**: Extracts path, query, header, and body parameters, mapping Zod schemas and constraints (`email`, `uuid`, `min`, `max`, `enum`) into boundary test cases.
- **Host Guard & Safety by Default**: Strictly restricts HTTP requests to local loopbacks (`localhost`, `127.0.0.1`, `[::1]`) with DNS pinning, SSRF protection, secret redaction (`[REDACTED]`), and proxy bypass.
- **Pure Response Oracles**: Detects unhandled 5xx crashes on invalid inputs (`no-5xx-on-bad-input`), stack trace leaks (`no-stack-trace-leak`), sensitive field exposure (`no-sensitive-fields`), and broken authentication (`auth-enforced`).
- **Cross-Analysis**: Flags routes in code that 404 at runtime (`route-in-code-404-live`), undocumented live routes (`live-route-not-in-code`), and status code or error shape inconsistencies across endpoints.
- **Replayable Reports & Diffing**: Replay recorded sessions offline with pure oracles (`mantis report`), compare models or reports over time (`mantis diff`), and generate standalone HTML reports (`--html`).

---

## 🚧 What Mantis Can't Do Yet

To preserve trust, Mantis clearly defines its current architectural boundaries:

- **Dynamic Route Array Loops**: Applications that mount routes by iterating runtime arrays (e.g. `routes.forEach(r => router.use(r.path, r.route))`) cannot resolve subrouter prefixes statically without executing JavaScript. Such routes are extracted with root paths and tagged `confidence: "uncertain"` (`MT-R002` / `MT-R004`).
- **Dynamic Filesystem Barrel Exports**: Patterns using `fs.readdirSync()` to dynamically `require()` all route files at startup cannot be resolved statically.
- **Non-Express Frameworks**: Phase 1 exclusively supports **Express.js**. Fastify, NestJS, Koa, and Hono are not yet supported.
- **Arbitrary Relational Database Fixtures**: Mantis generates baseline and boundary payloads from AST inspection and schemas, but does not inspect live database tables or synthesize relational foreign keys.
- **Unattended Destructive Operations**: `DELETE` and destructive mutation tests are disabled by default and require explicit configuration plus `--allow-destructive` / `--yes` CLI authorization.

---

## 📊 Real-World Open-Source Express Benchmarks

To measure accuracy in real-world environments, Mantis was validated against 5 open-source Express repositories with hand-curated ground truth endpoints (M1-03):

| Repository                                                                                         | Style                                     |                                            Commit                                             | License |  Truth |  Found | Precision |    Recall | Uncertain | Diagnostics |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------- | :-------------------------------------------------------------------------------------------: | :-----: | -----: | -----: | --------: | --------: | --------: | ----------: |
| [node-todo](https://github.com/scotch-io/node-todo)                                                | Small API (Route Factory)                 |              [`0fdb905`](https://github.com/scotch-io/node-todo/commit/0fdb905)               |   MIT   |      4 |      4 |    100.0% |    100.0% |         0 |           0 |
| [express-mongoose-es6-rest-api](https://github.com/kunalkapadia/express-mongoose-es6-rest-api)     | ES6 / Babel REST API with subrouters      |   [`247fedd`](https://github.com/kunalkapadia/express-mongoose-es6-rest-api/commit/247fedd)   |   MIT   |      8 |      8 |    100.0% |    100.0% |         0 |          10 |
| [express-rest-es2017-boilerplate](https://github.com/danielfsousa/express-rest-es2017-boilerplate) | Modern ES2017 / ESM, MVC with controllers |  [`b8bed6d`](https://github.com/danielfsousa/express-rest-es2017-boilerplate/commit/b8bed6d)  |   MIT   |     15 |     15 |    100.0% |    100.0% |         0 |          14 |
| [node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate)                   | MVC with routes array loop, Joi           |       [`179ae84`](https://github.com/hagopj13/node-express-boilerplate/commit/179ae84)        |   MIT   |     14 |     15 |      0.0% |      0.0% |        14 |          21 |
| [realworld](https://github.com/gothinkster/node-express-realworld-example-app)                     | TypeScript, barrel exports, subrouters    | [`30b68e1`](https://github.com/gothinkster/node-express-realworld-example-app/commit/30b68e1) |   MIT   |     20 |     20 |    100.0% |    100.0% |         0 |           1 |
| **Total / Overall**                                                                                | **5 Repositories**                        |                                               —                                               |    —    | **61** | **62** | **75.8%** | **77.0%** |    **14** |      **46** |

_Note: On repositories using standard declarative router mounts (excluding dynamic array loops), Mantis achieves **100.0% precision** and **100.0% recall** across 47 ground-truth endpoints._

Reproduce benchmark numbers locally with:

```bash
pnpm benchmark
```

See [docs/exit-check.md](docs/exit-check.md) and [docs/false-positive-review.md](docs/false-positive-review.md) for detailed evaluation logs and false-positive calibration.

---

## 🛡️ Safety Summary

Automated testing tools must never damage systems, leak secrets, or contact unauthorized networks. Mantis enforces safety invariants by design:

1. **Safe Mode Default**: Only endpoints with mutation effect `read` run by default. Mutations (`write`, `destructive`) require explicit config and CLI authorization.
2. **Host Guard**: Connections are strictly limited to local loopback addresses (`localhost`, `127.0.0.1`, `[::1]`). DNS hostnames are verified against local subnets. Non-HTTP protocols, bind-all addresses (`0.0.0.0`), and embedded credentials are automatically rejected.
3. **AST-Only Discovery**: Source code is parsed statically with Babel; application code is **never** imported, evaluated, or executed at scan time.
4. **Secret Redaction**: Configured tokens, authorization headers, and leaked credentials in URLs, bodies, and error logs are replaced with `[REDACTED]` prior to display or disk serialization.
5. **Hostile Server Defense**: Streaming responses are bounded by `maxResponseBytes`, timeouts are enforced by `AbortSignal`, and cross-host redirects are refused.

Read the full threat model and test verification in [docs/safety.md](docs/safety.md).

---

## 📖 Documentation

- 💻 **[CLI Reference](docs/cli.md)**: Command flags, options, exit codes (`0`, `1`, `2`), and CI recipes.
- ⚙️ **[Configuration Reference](docs/config.md)**: Complete schema guide for `mantis.config.json` (`allowedEffects`, `limits`, `pathParamSamples`, `probePaths`).
- 🔍 **[Finding Rules Reference](docs/findings.md)**: Catalog of every finding rule ID with payloads, evidence requirements, and confidence rationales.
- ⚠️ **[Diagnostic Codes Reference](docs/diagnostics.md)**: `MT-` diagnostic codes, troubleshooting guide, and known limitations.
- 📐 **[API Model Specification](docs/api-model.md)**: Data schema specification (`v1.2.0`) and the **1.x Stability Promise**.
- 🛡️ **[Safety Architecture](docs/safety.md)**: Comprehensive threat model and attack verification matrix.
- 🏛️ **[Architecture Decisions (ADRs)](docs/decisions/README.md)**: Record of architectural design decisions (ADR 0001 through 0008).
- 📜 **[Changelog](CHANGELOG.md)**: Release history and version updates.

---

## 📦 Monorepo Packages

| Package                   | Path                       | Purpose                                                                                |
| :------------------------ | :------------------------- | :------------------------------------------------------------------------------------- |
| `@mantis/core`            | `packages/core`            | API Model schemas, Zod validators, response oracles, test planners, and cross-analysis |
| `@mantis/adapter-express` | `packages/adapter-express` | Express.js static AST parser, module graph resolver, and route extractor               |
| `@mantis/runner`          | `packages/runner`          | Safety-first HTTP runner, Host Guard, and session recorder                             |
| `@mantis/cli`             | `packages/cli`             | Unified `mantis` command-line orchestrator and terminal / HTML formatters              |

---

## 🐛 Reporting Problems & Contributing

If you encounter a bug, false positive, or unsupported Express pattern:

1. Open an issue on GitHub: **[amankoli1206/Mantis/issues](https://github.com/amankoli1206/Mantis/issues)**
2. Include the output of `pnpm mantis scan <path> --verbose` or the relevant `MT-` diagnostic code.
3. For false-positive findings, attach the sanitized report generated with `--json`.
