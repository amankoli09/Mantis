# DevGuard Finding Rules Reference

This document catalogs the finding rule IDs emitted by the DevGuard Test Engine response oracles (`Step 10`).

---

## 📋 Rule Registry

| Rule ID | Severity | Confidence | Description |
| :--- | :---: | :---: | :--- |
| `no-5xx-on-bad-input` | `error` | `high` | An endpoint responded with HTTP `5xx` when sent an invalid input (e.g. empty body, missing parameter, wrong data type). |
| `server-error-on-valid-input` | `warning` | `low` | An endpoint responded with HTTP `5xx` on a presumed-valid baseline request. |
| `no-stack-trace-leak` | `warning` | `high` | The HTTP response body leaks internal stack traces, file paths with line numbers, or framework debug pages. |
| `no-sensitive-fields` | `warning` | `high` | The HTTP response JSON payload contains sensitive key names (e.g., `password`, `apiKey`, `token`, `secret`). |

---

## 🔍 Detailed Rule Explanations

### 1. `no-5xx-on-bad-input`
- **What it checks**: Checks whether sending invalid inputs (missing required fields, inverted types, empty payloads) results in unhandled server crashes (HTTP 500, 502, 503).
- **Why it matters**: Robust REST APIs must validate incoming input and respond with client-side error codes (`4xx`, typically `400 Bad Request` or `422 Unprocessable Entity`). An unhandled 500 usually points to an uncaught runtime exception (such as `TypeError: Cannot read properties of undefined`).
- **Confidence**: `high`. Because the generator intentionally produced invalid or malformed data, an unhandled server error is strong evidence of missing input validation.
- **Source Link**: Points to the route handler definition and, when available, the inferred provenance of the field that was accessed.

### 2. `server-error-on-valid-input`
- **What it checks**: Checks whether the baseline request (presumed valid) returned HTTP 500.
- **Why it matters**: Indicates the server crashed even on normal traffic.
- **Why confidence is `low`**: Because DevGuard infers baseline inputs statically without executing the server code or consulting full database state, our generated "valid" payload might be missing business-logic requirements (such as an existing foreign key or valid auth token). Claiming an unhandled bug with high confidence would be an overclaim.

### 3. `no-stack-trace-leak`
- **What it checks**: Inspects the response body for stack trace signatures:
  - `at Object.<anonymous>`
  - `at Module._compile`
  - `node_modules/`
  - File paths with line and column numbers
  - Express/framework default error pages (`<pre>Error: ...</pre>`)
- **Why it matters**: Leaking stack traces exposes internal server architecture, dependency versions, directory paths, and source code structure to untrusted clients.
- **Confidence**: `high`. Regex pattern matching against known stack signatures has very low false-positive rates.

### 4. `no-sensitive-fields`
- **What it checks**: Recursively inspects response JSON objects and arrays for sensitive field names:
  - `password`, `passwordHash`, `token`, `secret`, `__v`, `apiKey`, `access_token`, `refresh_token`, `private_key`.
- **Why it matters**: Returning secret tokens or password hashes—even in hashed form—in public or client-facing endpoints is a critical information disclosure vulnerability.
- **Redaction Guarantee**: DevGuard **never** prints or logs the value of a sensitive field. Findings report only the JSON path (e.g., `user.passwordHash`), and evidence snippets have all secret values replaced with `"[REDACTED]"`.
