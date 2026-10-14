# Mantis Safety Architecture & Threat Model

Mantis sends HTTP requests to running services to verify API contracts, auth enforcement, and parameter validation.

Because automated testing tools have the potential to trigger unintended mutations, contact sensitive servers, or leak credentials, **safety is the foundational invariant** of Mantis.

---

## 🛡️ Threat Model & Attack Matrix

| # | Attack Vector | Risk | Mantis Defense | Automated Test Verification |
|---|---|---|---|---|
| **1** | Target `https://example.com` without `--allow-remote` | Accidental probing or hammering of third-party / external production systems. | `validateBaseUrl` checks hostname against local loopback set; throws descriptive refusal unless `allowRemote: true`. | `packages/runner/tests/safety.test.ts`: `refuses non-local URLs when allowRemote is false` |
| **2** | Look-alike hostnames & obfuscated IPs (`127.1`, `2130706433`, `0.0.0.0`, `127.0.0.1@evil.com`, `[::ffff:127.0.0.1]`) | SSRF to internal private networks (`10.0.0.0/8`) or evil domain spoofing bypassing naive hostname checks. | Strict raw and parsed hostname parsing in `validateBaseUrl`: rejects userinfo (`@`), rejects `0.0.0.0` and `[::]`, rejects integer/hex/octal IP formats, allows only canonical `127.x.x.x`, `[::1]`, and `localhost`/`*.localhost`. | `packages/runner/tests/safety.test.ts`: `refuses look-alike hostnames and IP representations` |
| **3** | Hostname resolving to non-local IP (DNS rebinding / dynamic DNS) | Custom domain pointing to external or LAN IP bypassing hostname string checks. | `assertHostResolvesToLocal(hostname)` performs DNS lookup. Asserts all resolved IP addresses are in `127.0.0.0/8` or `::1`. | `packages/runner/tests/safety.test.ts`: `refuses hostnames that resolve via DNS to non-local IP addresses` |
| **4** | Non-HTTP schemes (`file://`, `ftp://`, `ws://`) and embedded credentials (`http://u:p@127.0.0.1`) | Arbitrary local file disclosure, protocol smuggling, or credential leaks in logs. | Strict scheme validation (only `http:` and `https:`) and username/password/@ rejection in `validateBaseUrl`. | `packages/runner/tests/safety.test.ts`: `refuses non-http/https protocols` and `refuses URLs with embedded credentials` |
| **5** | Redirect to another host or external URL | Local server responds with `301`/`302` to `https://evil.com` or another service, stealing auth headers or enabling open redirect SSRF. | `executeRequest` disables redirects by default (`maxRedirections: 0`); when redirect following is enabled, validates target host against initial host and refuses cross-host redirects. | `packages/runner/tests/http-client.test.ts`: `does not follow redirects by default` and `refuses cross-host redirects` |
| **6** | `HTTP_PROXY` / `HTTPS_PROXY` environment variables set | Outbound requests silently rerouted through malicious or intercepting proxy. | HTTP client uses dedicated undici `Agent` with direct connection, bypassing ambient `HTTP_PROXY` / `HTTPS_PROXY` environment variables. | `packages/runner/tests/safety.test.ts`: `bypasses ambient HTTP_PROXY env var and connects directly to local server` |
| **7** | `allowedEffects: ["destructive"]` in config without `--allow-destructive` CLI flag | Config committed to repo silently triggers destructive mutations without explicit CLI authorization. | In `mantis test`: if config has `destructive` in `allowedEffects` and `--allow-destructive` was not provided on the CLI, refuse execution immediately with exit code 2. | `packages/cli/tests/test.test.ts`: `refuses allowedEffects with destructive in config file when --allow-destructive CLI flag is missing` |
| **8** | Endpoints with `unknown` effect or `uncertain` confidence | Running unverified or unparseable routes could execute unexpected mutations. | `evaluateEndpointSafety` enforces: endpoints with `effect === 'unknown'` or `confidence === 'uncertain'` are strictly skipped (`disallowed-effect-unknown`, `uncertain-endpoint`). | `packages/runner/tests/safety.test.ts`: skips endpoint when effect is unknown and skips endpoint when confidence is uncertain |
| **9** | Hostile server: infinite streaming response, slowloris delay, high concurrency | Memory exhaustion (OOM), process hang, or socket starvation. | Stream truncated at `limits.maxResponseBytes`, `AbortSignal.timeout(limits.timeoutMs)`, concurrency bounded by `p-limit`. | `packages/runner/tests/safety.test.ts`: `caps response bytes and aborts stream under infinite hostile server response` and `times out cleanly under slowloris hostile server` |
| **10** | Auth token in session files, terminal, `--debug`, error messages, reports | Credential leakage in terminal logs, git history, or CI artifacts. | `redactExecutionResult` sanitizes headers, query params, body, and `error.message`. Automated secret grep checks all outputs. | `packages/runner/tests/safety.test.ts`: `redacts tokens from error messages and response bodies in ExecutionResult` & `check-secret-leak.js` |
| **11** | Response bodies containing sensitive credentials | Server returns API keys, passwords, or session tokens reflected in response body. | Response body secret scrubber matches configured secrets and sensitive headers, replacing them with `[REDACTED]`. | `packages/runner/tests/safety.test.ts`: `redacts tokens from error messages and response bodies in ExecutionResult` |
| **12** | Directory traversal in `--out` (`--out ../../../evil`) | Arbitrary file write outside working directory. | `resolveSafeOutputPath(outPath, baseDir)` verifies resolved path cannot traverse outside the intended directory via `..`. | `packages/runner/tests/safety.test.ts`: `refuses paths traversing outside target directory using ..` |
| **13** | Scanning executing target code | Untrusted repository executes arbitrary code on developer machine during route scanning. | AST static analysis exclusively (`@babel/parser`, `@babel/traverse`). Code is never imported, required, or evaluated via `eval()`/`vm`. | `packages/runner/tests/safety.test.ts`: `proves scanning does not execute top-level malicious side effects` (verified via `fixtures/safety-malicious-code`) |

---

## 🛡️ Core Safety Principles

1. **Safe Mode by Default**:
   Only endpoints classified with mutation effect `read` are eligible to run by default. Mutation effects `write` and `destructive` require explicit user opt-in in `mantis.config.json` AND explicit `--allow-destructive` CLI flag.
2. **Unknown is Never Safe**:
   Endpoints with mutation effect `unknown` or confidence `uncertain` are **never** executed, even if listed in `allowedEffects`.
3. **No Guessing**:
   If an endpoint has path parameters (e.g. `GET /users/:id`), Mantis requires an explicit sample value in `pathParamSamples`. Missing samples result in an immediate structured skip (`no-sample-for-path-param`).
4. **Host Guard**:
   Mantis refuses to connect to any non-local hostname unless `allowRemote: true` is explicitly configured. Non-canonical IP formats, user credentials, and bind-all addresses are rejected outright.
5. **Secret Redaction & Output Defense**:
   Configured secrets, authorization tokens, and credentials in request/response bodies and error messages are systematically replaced with `[REDACTED]`. Directory traversal via `--out` is strictly prevented.
6. **AST-Only Discovery**:
   Route discovery never imports, requires, or evaluates target application code. Target code is analyzed statically via Babel ASTs.

---

## 📊 Safety Decision Table

Before issuing an HTTP request, every endpoint in the API Model is evaluated by `evaluateEndpointSafety()`:

| Effect | Confidence | In `allowedEffects`? | In `skip` list? | Has Path Param Samples? | Decision | Structured Skip Reason Code |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
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
- **Credential Protection**: URLs with embedded user credentials (e.g. `http://user:pass@localhost`) or userinfo (`@`) are rejected.
- **Bind-All Protection**: Bind-all addresses `0.0.0.0`, `[::]`, and `::` are rejected unconditionally.
- **IP Canonicalization**: Obfuscated integer (`2130706433`), hex, octal, or short (`127.1`) IP representations are rejected.
- **Local Host Whitelist**: By default, only local loopback interfaces are allowed:
  - `localhost`
  - `*.localhost` (subdomains of localhost)
  - `127.0.0.1` (or canonical `127.x.x.x`)
  - `[::1]`
- **DNS Hostname Resolution**: When executing against local hosts, `assertHostResolvesToLocal()` verifies that all resolved IP records belong to loopback addresses (`127.0.0.0/8` or `::1`).
- **Remote Host Opt-in**: Any external IP or domain (e.g. `example.com`, `10.0.0.5`, `localhost.evil.com`) requires explicit `allowRemote: true`.

---

## 🔒 Secret Redaction & Session Recording

1. **Header Redaction**:
   Headers matching `authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `proxy-authorization`, and configured custom auth headers have their values replaced with `"[REDACTED]"`.
2. **Payload, URL & Error Redaction**:
   Configured secret values and auth tokens are scanned and replaced with `"[REDACTED]"` in all request and response bodies, URLs, and error messages.
3. **Deterministic Persistence**:
   Sessions saved to `.mantis/sessions/<sessionId>.json` sort all object keys and arrays deterministically, with volatile execution timestamps segregated into the `meta` block.
4. **Automated Secret Grep**:
   Verified automatically via `pnpm check:secrets` and in continuous integration (`.github/workflows/ci.yml`).

---

## ⚡ Limits & Hostile Server Defense

- **Timeouts**: Every request is bounded by an `AbortSignal.timeout(limits.timeoutMs)`.
- **Response Size Cap**: Responses are read via streaming chunks. If cumulative bytes exceed `maxResponseBytes`, the stream is aborted, flagged `truncated: true`, and capped.
- **No Cross-Host Redirects**: Redirects are not followed by default. If `followRedirects: true` is set, redirect targets are strictly validated: the runner will **never** leave the initial hostname, port, or protocol.
- **Direct Agent Dispatcher**: Outbound connections use a direct Undici `Agent`, ignoring ambient `HTTP_PROXY` and `HTTPS_PROXY` environment variables.
- **Non-Fatal Resilience**: Network failures, disconnects, and timeouts are recorded as structured error results (`kind: 'timeout' | 'network' | 'abort' | 'other'`) without terminating the test run.
