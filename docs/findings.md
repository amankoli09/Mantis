# Mantis Finding Rules Reference

This document catalogs every finding rule ID evaluated by the Mantis Test Engine response oracles and cross-analysis modules.

Every finding emitted by Mantis contains:

- **`ruleId`**: Canonical string identifier.
- **`endpointId`**: Canonical endpoint representation (e.g. `POST /api/users`).
- **`severity`**: `'error' | 'warning' | 'info'`.
- **`confidence`**: `'high' | 'medium' | 'low'` (filterable via `--min-confidence`).
- **`confidenceReason`**: Explicit human-readable rationale explaining why the confidence level was assigned.
- **`message`**: Clear explanation of the violation.
- **`sourceLocation`**: Source file and line number in the target repository.
- **`evidence`**: Structured proof (request payloads, response status, headers, snippets).

---

## 📋 Rule Summary Table

| Rule ID                                                                    | Category    | Severity  | Confidence | Description                                                               |
| :------------------------------------------------------------------------- | :---------- | :-------: | :--------: | :------------------------------------------------------------------------ |
| [`no-5xx-on-bad-input`](#1-no-5xx-on-bad-input)                            | Robustness  |  `error`  |   `high`   | Unhandled HTTP `5xx` server error returned in response to invalid input.  |
| [`server-error-on-valid-input`](#2-server-error-on-valid-input)            | Reliability | `warning` |   `low`    | HTTP `5xx` server error returned on a baseline request.                   |
| [`no-stack-trace-leak`](#3-no-stack-trace-leak)                            | Security    | `warning` |   `high`   | Response body leaks internal stack traces, call frames, or file paths.    |
| [`no-sensitive-fields`](#4-no-sensitive-fields)                            | Security    | `warning` |   `high`   | Response JSON leaks sensitive field names (passwords, secrets, hashes).   |
| [`auth-enforced`](#5-auth-enforced)                                        | Security    |  `error`  |   `high`   | Route with static auth requirement accepted an unauthenticated request.   |
| [`route-in-code-404-live`](#6-route-in-code-404-live)                      | Consistency | `warning` |  `medium`  | Endpoint confirmed in code returned HTTP `404 Not Found` at runtime.      |
| [`live-route-not-in-code`](#7-live-route-not-in-code)                      | Security    |  `info`   |  `medium`  | Probe path returned live response but route was not found in source code. |
| [`consistency/status-code-deviation`](#8-consistencystatus-code-deviation) | API Design  |  `info`   |   `low`    | Error status code deviates from the dominant convention of the service.   |
| [`consistency/error-response-shape`](#9-consistencyerror-response-shape)   | API Design  |  `info`   |   `low`    | Error response JSON schema deviates from the dominant error shape.        |

---

## 🔍 Detailed Rule Specifications

### 1. `no-5xx-on-bad-input`

- **Category**: Input Robustness & Error Handling
- **Severity**: `error`
- **Default Confidence**: `high`
- **Confidence Reason**: `HTTP 5xx returned in response to synthesized invalid input payload`
- **What it checks**:
  Tests whether invalid input payloads (such as empty objects, omitted required parameters, wrong data types, or out-of-boundary strings/numbers) cause the server to crash with an HTTP `5xx` error.
- **Why it matters**:
  A robust REST API must gracefully validate client input and respond with a `4xx` client error (typically `400 Bad Request` or `422 Unprocessable Entity`). An unhandled `500 Internal Server Error` indicates an uncaught runtime exception (e.g. `TypeError: Cannot read properties of undefined`).
- **Required Evidence**:
  - Request method and path.
  - Test generator case name (`wrong-type`, `boundary-values`, `missing-required`).
  - Request payload sent.
  - HTTP `5xx` response status code and body.
  - Provenance linking to the route handler and accessed parameter in code.
- **Example**:
  ```http
  POST /api/users HTTP/1.1
  Content-Type: application/json

  { "email": 12345 }
  ```
  ```http
  HTTP/1.1 500 Internal Server Error
  Content-Type: application/json

  { "error": "TypeError: req.body.email.toLowerCase is not a function" }
  ```

---

### 2. `server-error-on-valid-input`

- **Category**: Baseline Service Health
- **Severity**: `warning`
- **Default Confidence**: `low`
- **Confidence Reason**: `HTTP 5xx returned on baseline input; payload was statically inferred without live database state`
- **What it checks**:
  Tests whether a synthesized baseline request returns an HTTP `5xx` status.
- **Why confidence is `low`**:
  Mantis synthesizes baseline payloads statically from handler AST inspection and Zod schemas without executing database seeds or inspecting relational database state. If the server expects an existing foreign key or specific database row that doesn't exist, it may legitimately fail. Marking this as high confidence would trigger false-positive alarms.
- **Required Evidence**:
  - Request method, URL, and headers.
  - Response status code (`500`).
- **Example**:
  ```http
  GET /api/orders/9999 HTTP/1.1
  ```
  ```http
  HTTP/1.1 500 Internal Server Error
  ```

---

### 3. `no-stack-trace-leak`

- **Category**: Information Disclosure
- **Severity**: `warning`
- **Default Confidence**: `high`
- **Confidence Reason**: `Response body contains runtime stack trace signatures or file paths`
- **What it checks**:
  Inspects all HTTP response bodies (JSON, HTML, plain text) for signatures of execution call frames, runtime stack traces, and internal source file paths:
  - `at ... (...)`
  - `at async ...`
  - `node_modules/`
  - File path references matching `.js:\d+:\d+` or `.ts:\d+:\d+`
  - Framework error banners (e.g. `<pre>Error: ...</pre>`)
- **Why it matters**:
  Stack traces expose internal architecture, directory hierarchies, dependency versions, and operating system paths to untrusted clients, facilitating targeted exploitation.
- **Required Evidence**:
  - Matched stack trace frame or line number snippet extracted from response body.
  - HTTP status and response snippet.
- **Example**:
  ```json
  {
    "message": "Internal Server Error",
    "stack": "Error: Database connection failed\n    at Connection.connect (/app/node_modules/pg/lib/client.js:132:11)\n    at Object.getUser (/app/src/services/user.ts:45:18)"
  }
  ```

---

### 4. `no-sensitive-fields`

- **Category**: Sensitive Data Protection
- **Severity**: `warning`
- **Default Confidence**: `high`
- **Confidence Reason**: `Response payload exposes sensitive field names (excluding auth tokens on login/register endpoints)`
- **What it checks**:
  Recursively traverses response JSON objects and arrays to detect sensitive field names:
  - `password`, `passwordHash`, `secret`, `apiKey`, `api_key`, `private_key`, `privateKey`, `accessToken`, `refreshToken`.
- **Smart Calibrations (ADR 0008)**:
  - **Auth Endpoint Token Exemption**: Legitimate token issuance endpoints (e.g. `/api/auth/login`, `/token`, `/register`) returning session tokens (`token`, `access_token`, `jwt`) are **exempted** and do not trigger findings.
  - **Mongoose `__v` Excluded**: Internal version keys (`__v`) are ignored.
  - **Benign Token Exemption**: Non-secret tokens like `csrfToken` or `tokenType` are ignored.
- **Required Evidence**:
  - JSON dot-notation path to the sensitive key (e.g., `data.user.passwordHash`).
  - Redacted representation: values are **always scrubbed to `[REDACTED]`** in evidence.
- **Example**:
  ```json
  {
    "id": 1,
    "username": "alice",
    "passwordHash": "[REDACTED]"
  }
  ```

---

### 5. `auth-enforced`

- **Category**: Access Control Enforcement
- **Severity**: `error`
- **Default Confidence**: `high`
- **Confidence Reason**: `Endpoint with verified authentication requirements accepted unauthenticated request with HTTP 2xx`
- **What it checks**:
  Cross-checks static authentication evidence against runtime responses. If an endpoint is statically confirmed to require authentication (`bearer`, `apiKey`, `cookie`, or `custom`), but an unauthenticated request returns an HTTP `2xx` success code, a finding is emitted.
- **Why it matters**:
  Broken Object Level Authorization or bypassed authentication middleware leaves protected resources exposed to unauthorized access.
- **Required Evidence**:
  - Static authentication classification (`auth.type`) and source line provenance (`auth.evidence.signal`, file/line).
  - Runtime request sent without authentication credentials.
  - Runtime HTTP response status (`200 OK`).
- **Example**:
  ```http
  GET /api/admin/users HTTP/1.1
  Host: 127.0.0.1:3000
  (No Authorization header)
  ```
  ```http
  HTTP/1.1 200 OK
  Content-Type: application/json

  [{ "id": 1, "admin": true }]
  ```

---

### 6. `route-in-code-404-live`

- **Category**: Route Synchronization Drift
- **Severity**: `warning`
- **Default Confidence**: `medium`
- **Confidence Reason**: `Route statically extracted from source code returned HTTP 404 when tested live`
- **What it checks**:
  Identifies routes that were statically confirmed in the codebase (e.g. `app.get('/api/users')`) but return HTTP `404 Not Found` when called on the running server.
- **Why it matters**:
  Indicates broken router mount prefixes, missing subrouter attachments (`MT-R004`), or code that is dead or unmounted in the active server environment.
- **Required Evidence**:
  - Source code declaration line and path.
  - Runtime request URL and HTTP 404 response.

---

### 7. `live-route-not-in-code`

- **Category**: Shadow / Undocumented API Detection
- **Severity**: `info`
- **Default Confidence**: `medium`
- **Confidence Reason**: `Live endpoint answered successfully to probe path but was not found in static code extraction`
- **What it checks**:
  When `probePaths` are specified in `mantis.config.json` (e.g. `["/metrics", "/health", "/admin"]`), Mantis sends safe `GET` probes. If a path returns a non-404 response (`200`, `401`, `403`) but does not correspond to any statically extracted endpoint in the `ApiModel`, this finding is emitted.
- **Why it matters**:
  Uncovers undocumented reverse-proxy routes, unmodeled third-party middleware endpoints, or shadow admin backdoors.
- **Required Evidence**:
  - Probe path tested.
  - Runtime HTTP response status code.

---

### 8. `consistency/status-code-deviation`

- **Category**: API Design Consistency
- **Severity**: `info`
- **Default Confidence**: `low`
- **Confidence Reason**: `Endpoint error status code deviates from dominant convention observed across sibling endpoints`
- **What it checks**:
  Analyzes client error responses across all tested endpoints. If 80%+ of endpoints return HTTP `400 Bad Request` for invalid input, but a specific endpoint returns `422 Unprocessable Entity` (or vice versa), Mantis highlights the discrepancy.
- **Why it matters**:
  Inconsistent error status codes degrade SDK and API client developer experience.
- **Required Evidence**:
  - Endpoint HTTP status code.
  - Service-wide dominant status code and frequency.

---

### 9. `consistency/error-response-shape`

- **Category**: API Design Consistency
- **Severity**: `info`
- **Default Confidence**: `low`
- **Confidence Reason**: `Error response JSON keys deviate from the dominant error payload shape across the API`
- **What it checks**:
  Inspects the JSON keys returned in error payloads. If the dominant convention across the service is `{ "error": string, "code": string }`, but an endpoint returns `{ "message": string, "errors": array }`, a consistency notice is generated.
- **Why it matters**:
  Frontend and client applications rely on unified error payload shapes for global error handling and toast notifications.
- **Required Evidence**:
  - Top-level keys of the deviating error response.
  - Dominant key signature observed across sibling endpoints.
