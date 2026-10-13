# Mantis Runner Safety Architecture

Mantis sends HTTP requests to running services to verify API contracts, auth enforcement, and parameter validation.

Because automated testing tools have the potential to trigger destructive mutations or hit unintended servers, **safety is the foundational invariant** of `@mantis/runner`.

---

## 🛡️ Core Safety Principles

1. **Safe Mode by Default**:
   Only endpoints classified with mutation effect `read` are eligible to run by default. Mutation effects `write` and `destructive` require explicit user opt-in in `mantis.config.json`.
2. **Unknown is Never Safe**:
   Endpoints with mutation effect `unknown` or confidence `uncertain` are **never** executed, even if listed in `allowedEffects`.
3. **No Guessing**:
   If an endpoint has path parameters (e.g. `GET /users/:id`), Mantis requires an explicit sample value in `pathParamSamples`. Missing samples result in an immediate structured skip (`no-sample-for-path-param`).
4. **Host Guard**:
   Mantis refuses to connect to any non-local hostname unless `allowRemote: true` is explicitly configured. Embedded credentials in URLs are rejected outright.
5. **Secret Redaction**:
   Configured secrets and standard authorization headers are never written to disk in `.mantis/sessions/` or printed in `--dry-run` outputs.

---

## 📊 Safety Decision Table

Before issuing an HTTP request, every endpoint in the API Model is evaluated by `evaluateEndpointSafety()`:

| Effect | Confidence | In `allowedEffects`? | In `skip` list? | Has Path Param Samples? | Decision | Structured Skip Reason Code |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `unknown` | *any* | *any* | *any* | *any* | **SKIP** | `disallowed-effect-unknown` |
| *any* | `uncertain` | *any* | *any* | *any* | **SKIP** | `uncertain-endpoint` |
| *any* | *any* | *any* | **YES** | *any* | **SKIP** | `explicitly-skipped` |
| `read` / `write` / `destructive` | `confirmed` | **NO** | NO | *any* | **SKIP** | `effect-not-allowed` |
| `read` / `write` / `destructive` | `confirmed` | **YES** | NO | **NO** | **SKIP** | `no-sample-for-path-param` |
| `read` / `write` / `destructive` | `confirmed` | **YES** | NO | **YES** | **RUN** | *(none)* |

---

## 🌐 Host Guard Rules

The `validateBaseUrl()` function enforces the following:

- **Scheme Validation**: Only `http:` and `https:` protocols are accepted. File schemes (`file:`), WebSockets (`ws:`), and FTP are rejected.
- **Credential Protection**: URLs with embedded user credentials (e.g. `http://user:pass@localhost`) are rejected.
- **Local Host Whitelist**: By default, only local loopback interfaces are allowed:
  - `localhost`
  - `*.localhost` (subdomains of localhost)
  - `127.0.0.1`
  - `::1` or `[::1]`
- **Remote Host Opt-in**: Any external IP or domain (e.g. `example.com`, `10.0.0.5`, `localhost.evil.com`) requires explicit `allowRemote: true`.

---

## 🔒 Secret Redaction & Session Recording

1. **Header Redaction**:
   Headers matching `authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `proxy-authorization`, and configured custom auth headers have their values replaced with `"[REDACTED]"`.
2. **Payload & URL Redaction**:
   Configured secret values are scanned and replaced with `"[REDACTED]"` in all request and response bodies and URLs.
3. **Deterministic Persistence**:
   Sessions saved to `.mantis/sessions/<sessionId>.json` sort all object keys and arrays deterministically, with volatile execution timestamps segregated into the `meta` block.

---

## ⚡ Undici Limits & Transport Resilience

- **Timeouts**: Every request is bounded by an `AbortSignal.timeout(limits.timeoutMs)`.
- **Response Size Cap**: Responses are read via streaming chunks. If cumulative bytes exceed `maxResponseBytes`, the stream is aborted, flagged `truncated: true`, and capped.
- **No Cross-Host Redirects**: Redirects are not followed by default. If `followRedirects: true` is set, redirect targets are strictly validated: the runner will **never** leave the initial hostname.
- **Non-Fatal Resilience**: Network failures, disconnects, and timeouts are recorded as structured error results (`kind: 'timeout' | 'network' | 'abort' | 'other'`) without terminating the test run.
