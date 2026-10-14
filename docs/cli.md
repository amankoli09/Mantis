# Mantis CLI Reference (`mantis`)

Mantis provides a unified command-line interface (`mantis`) for evidence-backed static API extraction and safety-first runtime contract testing of Express backend services.

The CLI package (`@mantis/cli`) parses arguments, validates configuration against Host Guard safety policies, delegates analysis to `@mantis/adapter-express` and `@mantis/runner`, and formats findings for both interactive developer terminals and automated CI/CD pipelines.

---

## Global Options

| Option          | Description                                                                                                                                   |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `--no-color`    | Disables ANSI colored terminal output. Also automatically respected if the `NO_COLOR` environment variable is present or stdout is not a TTY. |
| `--debug`       | Prints full error stack traces on unhandled errors.                                                                                           |
| `-V, --version` | Outputs current Mantis version (`0.1.0`).                                                                                                     |
| `-h, --help`    | Displays usage summary and available options.                                                                                                 |

---

## Exit Codes

Mantis returns deterministic, standard exit codes for script and CI gating:

| Exit Code | Meaning                           | Examples                                                                                                                                                                                                                        |
| :-------: | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|  **`0`**  | **Success / Clean**               | All tests passed; clean static scan; or findings are below the configured `--fail-on` threshold.                                                                                                                                |
|  **`1`**  | **Findings / Failures**           | Runtime tests executed and produced findings meeting or exceeding `--fail-on` threshold, or the target service returned 500 on valid baseline inputs.                                                                           |
|  **`2`**  | **Usage / Safety / Config Error** | Missing CLI arguments, invalid `mantis.config.json`, Host Guard violation (remote URL without `--allow-remote`), unconfirmed destructive mutations without `--allow-destructive` / `--yes`, or atomic file collision in `init`. |
|  **`3`**  | **Internal Error**                | Unhandled runtime exception or internal crash.                                                                                                                                                                                  |

---

## Commands

> Note: Inside this workspace repository, invoke commands with `pnpm mantis <command>`. When installed globally or as a project devDependency, invoke with `npx mantis <command>` or `mantis <command>`.

---

### 1. `mantis scan <path>`

Statically scans an Express backend codebase and generates an `ApiModel` containing extracted routes, parameter types, Zod schemas, auth requirements, and source code provenances without running application code.

```bash
pnpm mantis scan ./backend
```

#### Arguments:

- `<path>`: Path to the target backend application root directory.

#### Options:

| Flag           | Description                                                                         |
| :------------- | :---------------------------------------------------------------------------------- |
| `--json`       | Output raw JSON conforming to the `ApiModel` schema (`v1.2.0`).                     |
| `--openapi`    | Export an OpenAPI 3.0 specification JSON generated from the static model.           |
| `--out <file>` | Write terminal output, JSON, or OpenAPI spec to the designated file.                |
| `--verbose`    | Display detailed parameter inference types, locations, and source line provenances. |

#### Example:

```bash
# Scan and view human-readable route inventory
pnpm mantis scan ./fixtures/simple --verbose

# Export OpenAPI 3.0 definition for external tooling
pnpm mantis scan ./fixtures/simple --openapi --out openapi.json
```

---

### 2. `mantis test [path]`

Plans and executes safe runtime contract tests against a running backend API instance.

```bash
pnpm mantis test ./backend --base-url http://127.0.0.1:3000
```

#### Arguments:

- `[path]`: Path to the backend application root (defaults to `.`).

#### Options:

| Flag                       | Description                                                                                                                                                               |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--config <file>`          | Path to custom `mantis.config.json` configuration file.                                                                                                                   |
| `--base-url <url>`         | Override the target API base URL (e.g. `http://127.0.0.1:3000`).                                                                                                          |
| `--dry-run`                | Generate the test plan and display planned cases without sending any HTTP requests.                                                                                       |
| `--allow-write`            | Permit executing `write` mutation endpoints (`POST`, `PUT`, `PATCH`).                                                                                                     |
| `--allow-destructive`      | Permit executing `destructive` mutation endpoints (`DELETE`). In interactive terminals, prompts for confirmation; in non-interactive / CI environments, requires `--yes`. |
| `--allow-remote`           | Permit testing non-loopback URLs, disabling the Host Guard local-only restriction.                                                                                        |
| `--yes`                    | Automatically confirm destructive executions without interactive prompting.                                                                                               |
| `--fail-on <severity>`     | Severity threshold for exit code 1 (`error`, `warning`, `info`). Default triggers on any finding.                                                                         |
| `--min-confidence <level>` | Minimum finding confidence to report (`low`, `medium`, `high`). Defaults to `medium`.                                                                                     |
| `--json`                   | Output machine-readable `Report` JSON.                                                                                                                                    |
| `--html`                   | Output standalone, zero-dependency HTML report.                                                                                                                           |
| `--out <file>`             | Write output to the designated file path.                                                                                                                                 |

#### Examples:

```bash
# 1. Dry run verification (0 network requests executed)
pnpm mantis test ./fixtures/simple --dry-run --base-url http://127.0.0.1:3000

# 2. Safe execution (read-only by default)
pnpm mantis test ./fixtures/simple --base-url http://127.0.0.1:3000

# 3. High-confidence CI test gate with standalone HTML report
pnpm mantis test ./fixtures/simple \
  --base-url http://127.0.0.1:3000 \
  --min-confidence high \
  --fail-on error \
  --html --out mantis-report.html
```

---

### 3. `mantis report [session]`

Re-evaluates and displays findings from a recorded test session or report using pure oracles with **zero network traffic**.

```bash
pnpm mantis report
```

#### Arguments:

- `[session]`: Session ID (e.g. `f28a9b2c-...`) or path to a recorded session JSON file in `.mantis/sessions/`. If omitted, Mantis automatically loads the most recent session.

#### Options:

| Flag                       | Description                                                                           |
| :------------------------- | :------------------------------------------------------------------------------------ |
| `--json`                   | Output re-evaluated report as machine-readable JSON.                                  |
| `--html`                   | Output re-evaluated report as standalone HTML.                                        |
| `--out <file>`             | Write replayed report to the designated file path.                                    |
| `--min-confidence <level>` | Minimum finding confidence to report (`low`, `medium`, `high`). Defaults to `medium`. |

#### Example:

```bash
pnpm mantis report .mantis/sessions/latest.json --min-confidence high --html --out report.html
```

---

### 4. `mantis diff <fileA> <fileB>`

Compares two `ApiModel` JSON files or two `Report` JSON files to track endpoint drift, parameter changes, and introduced or resolved findings over time.

```bash
pnpm mantis diff baseline-model.json current-model.json
```

#### Arguments:

- `<fileA>`: Path to baseline `ApiModel` or `Report` JSON file.
- `<fileB>`: Path to target `ApiModel` or `Report` JSON file.

#### Options:

| Flag           | Description                                       |
| :------------- | :------------------------------------------------ |
| `--json`       | Output diff comparison in structured JSON format. |
| `--out <file>` | Write diff output to designated file path.        |

#### Example:

```bash
pnpm mantis diff baseline-report.json latest-report.json
```

---

### 5. `mantis init`

Generates a starter `mantis.config.json` configuration file with recommended safety defaults.

```bash
pnpm mantis init
```

#### Options:

| Flag           | Description                                                                      |
| :------------- | :------------------------------------------------------------------------------- |
| `--out <file>` | Designate a custom configuration file path (defaults to `./mantis.config.json`). |

> **Atomic Safety Guarantee**: `mantis init` uses the atomic file creation flag (`wx`) and **refuses to overwrite** an existing configuration file, exiting with code 2 to prevent accidental data loss.

---

## Continuous Integration (CI / CD) Recipes

### GitHub Actions Workflow

```yaml
name: Mantis API Contract Guard

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  contract-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.24.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Start backend server
        run: |
          pnpm start &
          npx wait-on http://127.0.0.1:3000/health

      - name: Run Mantis Contract Tests
        run: |
          pnpm mantis test . \
            --base-url http://127.0.0.1:3000 \
            --min-confidence high \
            --fail-on error \
            --html --out mantis-report.html \
            --json --out mantis-report.json

      - name: Upload Test Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mantis-report
          path: |
            mantis-report.html
            mantis-report.json
```
