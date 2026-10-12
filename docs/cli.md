# DevGuard CLI Reference (`devguard`)

DevGuard provides a unified command-line interface (`devguard`) for evidence-backed static API extraction and safe runtime testing of backend services.

The CLI package (`@devguard/cli`) is designed as a thin orchestrator: it parses CLI flags, loads configuration, delegates analysis and execution to `@devguard/adapter-express`, `@devguard/runner`, and `@devguard/core`, and formats output for human developers and CI/CD pipelines.

---

## Global Options

| Option          | Description                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--no-color`    | Disables ANSI colored terminal output. Also automatically respected if `NO_COLOR` environment variable is set or output is not a TTY. |
| `--debug`       | Prints full error stack traces on internal errors.                                                                                    |
| `-V, --version` | Outputs current DevGuard version.                                                                                                     |
| `-h, --help`    | Displays usage and options.                                                                                                           |

---

## Exit Codes

DevGuard uses deterministic, CI-ready exit codes:

| Exit Code | Meaning                       | Examples                                                                                                                                                                                                                                                              |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`0`**   | Success / Clean               | Clean static scan, all runtime tests passed, or findings below configured threshold (`--fail-on`).                                                                                                                                                                    |
| **`1`**   | Test Failures / Findings      | Runtime tests executed and produced findings that meet or exceed the threshold, or target server returned 500 on valid inputs.                                                                                                                                        |
| **`2`**   | Usage / Safety / Config Error | Missing CLI arguments, unknown options, non-existent target directory, unsupported framework, invalid `devguard.config.json`, Host Guard violation (remote URL without `--allow-remote`), or destructive test attempt in non-interactive environment without `--yes`. |
| **`3`**   | Internal Error                | Unhandled runtime exception or internal crash.                                                                                                                                                                                                                        |

---

## Commands

> Note: Inside this repository, run commands using `pnpm devguard <cmd>`. npm install instructions will come after publishing.

### 1. `devguard scan <path>`

Statically analyzes a Node.js Express backend and extracts an `ApiModel` with source code provenances, parameter types, confidence levels, and static diagnostics.

```bash
pnpm devguard scan ./backend
```

#### Options:

- `--json`: Output raw JSON conforming to the `ApiModel` schema.
- `--out <file>`: Write formatted output or JSON to the specified file path.
- `--verbose`: Show detailed parameter locations, inference types, and source code line numbers.

#### Example:

```bash
pnpm devguard scan ./fixtures/simple --verbose
```

Terminal output displays confirmed endpoints with `✓` and uncertain endpoints with `?`, along with parameter breakdown and diagnostics.

---

### 2. `devguard test [path]`

Plans and executes safe runtime contract tests against a running backend API.

```bash
pnpm devguard test ./backend --base-url http://127.0.0.1:3000
```

#### Options:

- `--config <file>`: Path to `devguard.config.json` (defaults to current directory or target project root).
- `--base-url <url>`: Override the target base URL.
- `--dry-run`: Generate test plan and display planned cases without sending any HTTP requests.
- `--allow-write`: Allow write mutations (`POST`, `PUT`, `PATCH`).
- `--allow-destructive`: Allow destructive mutations (`DELETE`). In interactive terminals, prompts for typed confirmation; in non-interactive terminals / CI, requires `--yes`.
- `--allow-remote`: Permit testing non-loopback URLs (disables Host Guard restriction).
- `--yes`: Auto-confirm destructive mutations without interactive prompt.
- `--fail-on <severity>`: Fail threshold for exit code 1 (`error`, `warning`, `info`). Default triggers on any finding or failure.
- `--json`: Output machine-readable `Report` JSON.
- `--out <file>`: Write output to the specified file path.

#### Example:

```bash
# Dry run verification
pnpm devguard test ./fixtures/simple --dry-run --base-url http://127.0.0.1:3000

# Live test with JSON output for CI
pnpm devguard test ./fixtures/simple --base-url http://127.0.0.1:3000 --json --out test-report.json
```

All test runs automatically record a sanitized, deterministic session file under `.devguard/sessions/<sessionId>.json`.

---

### 3. `devguard report [session]`

Re-evaluates and displays a recorded test session using pure Oracles with **zero network traffic**.

```bash
pnpm devguard report
```

If no session is specified, DevGuard automatically finds and loads the most recent session from `.devguard/sessions/`.

#### Options:

- `--json`: Output evaluated session findings as JSON.
- `--out <file>`: Write report output to a file.

#### Example:

```bash
pnpm devguard report .devguard/sessions/abc-123.json
```

---

### 4. `devguard init`

Generates a starter `devguard.config.json` configuration file with recommended safety defaults.

```bash
pnpm devguard init
```

#### Options:

- `--out <file>`: Custom configuration output path.

> **Safety Guarantee**: `devguard init` uses atomic file creation (`wx` flag) and refuses to overwrite an existing configuration file, exiting with code 2.

---

## Configuration File (`devguard.config.json`)

```json
{
  "$schema": "https://raw.githubusercontent.com/amankoli1206/Mantis/main/packages/runner/config.schema.json",
  "baseUrl": "http://127.0.0.1:3000",
  "allowedEffects": ["read"],
  "skip": [],
  "pathParamSamples": {
    "id": "1",
    "userId": "1"
  },
  "limits": {
    "timeoutMs": 5000,
    "maxResponseBytes": 1048576,
    "maxRequests": 50,
    "concurrency": 5,
    "retries": 0
  },
  "allowRemote": false,
  "followRedirects": false
}
```

---

## CI / CD Integration

### GitHub Actions Workflow Example

```yaml
name: API Contract Guard

on: [push, pull_request]

jobs:
  devguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Start backend server
        run: npm start & npx wait-on http://127.0.0.1:3000/health

      - name: Run DevGuard Test
        run: |
          pnpm devguard test ./backend \
            --base-url http://127.0.0.1:3000 \
            --fail-on error \
            --json \
            --out devguard-report.json

      - name: Archive Test Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: devguard-report
          path: devguard-report.json
```
