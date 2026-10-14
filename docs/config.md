# Mantis Runner Configuration (`mantis.config.json`)

The `mantis.config.json` file configures the `@mantis/runner` package when planning and executing runtime tests against a running backend API.

By default, the runner operates under **safe mode invariants**:

1. Only `read` mutation effects are executed (`allowedEffects: ["read"]`).
2. Requests are strictly restricted to local loopbacks (`localhost`, `127.0.0.1`, `[::1]`).
3. Endpoints with `unknown` mutation effects or `uncertain` confidence are skipped.
4. Path parameters without explicit samples are skipped.

---

## Complete Configuration Example

```json
{
  "$schema": "https://raw.githubusercontent.com/amankoli1206/Mantis/main/packages/runner/config.schema.json",
  "baseUrl": "http://127.0.0.1:3000",
  "auth": {
    "header": "Authorization",
    "envVar": "MANTIS_AUTH_TOKEN"
  },
  "allowedEffects": ["read"],
  "skip": ["DELETE /users/:id", "/admin/*"],
  "pathParamSamples": {
    "id": "1",
    "userId": "usr_test123",
    "slug": "welcome-post"
  },
  "probePaths": ["/metrics", "/health", "/admin", "/status"],
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

## Configuration Keys Reference

| Key                       | Type                                     | Default           | Description                                                                                                                                                                                        |
| :------------------------ | :--------------------------------------- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                 | `string` (valid URL)                     | _(Required)_      | The base URL of the running target application (e.g. `http://127.0.0.1:3000`). Must be a valid `http:` or `https:` URL.                                                                            |
| `auth`                    | `object`                                 | `undefined`       | Optional authentication configuration for authenticated tests.                                                                                                                                     |
| `auth.header`             | `string`                                 | `"Authorization"` | Header name used to attach authentication secret (e.g. `Authorization`, `X-API-Key`).                                                                                                              |
| `auth.value`              | `string`                                 | `undefined`       | Static token value. **Recommended**: use `envVar` instead to avoid committing tokens.                                                                                                              |
| `auth.envVar`             | `string`                                 | `undefined`       | Name of the environment variable holding the token (e.g., `MANTIS_AUTH_TOKEN`). Read at runtime and never persisted to session files.                                                              |
| `allowedEffects`          | `("read" \| "write" \| "destructive")[]` | `["read"]`        | Mutation effects permitted to execute. `unknown` is never permitted. `write` and `destructive` require explicit CLI confirmation (`--allow-write`, `--allow-destructive`).                         |
| `skip`                    | `string[]`                               | `[]`              | List of endpoint IDs (e.g. `"DELETE /users/:id"`) or wildcard paths (e.g. `"/admin/*"`) to exclude from test execution.                                                                            |
| `pathParamSamples`        | `Record<string, string \| number>`       | `{}`              | Explicit sample values for path parameters (e.g. `{"id": "1", "slug": "demo"}`). If an endpoint has a path parameter without a matching sample, it is safely skipped (`no-sample-for-path-param`). |
| `probePaths`              | `string[]`                               | `undefined`       | Array of path strings (e.g. `["/metrics", "/health", "/admin"]`) probed at runtime to detect shadow or unmodeled endpoints (`live-route-not-in-code`).                                             |
| `limits.timeoutMs`        | `number` (integer > 0)                   | `5000`            | Maximum request duration in milliseconds before an `AbortSignal` timeout aborts the request.                                                                                                       |
| `limits.maxResponseBytes` | `number` (integer > 0)                   | `1048576` (1MB)   | Maximum response body size in bytes before the stream is truncated and flagged `truncated: true`.                                                                                                  |
| `limits.maxRequests`      | `number` (integer > 0)                   | `50`              | Maximum total requests executed during a test session.                                                                                                                                             |
| `limits.concurrency`      | `number` (integer > 0)                   | `5`               | Maximum number of concurrent in-flight requests.                                                                                                                                                   |
| `limits.retries`          | `number` (integer >= 0)                  | `0`               | Number of retry attempts on network-level connection reset or socket errors.                                                                                                                       |
| `allowRemote`             | `boolean`                                | `false`           | When `false`, Host Guard restricts requests strictly to loopback addresses (`localhost`, `127.0.0.1`, `[::1]`). Set `true` to test remote or staging hosts.                                        |
| `followRedirects`         | `boolean`                                | `false`           | When `true`, follows HTTP 301/302 redirects. Redirect targets are strictly host-pinned: cross-host redirects are rejected immediately.                                                             |

---

## Safety Safeguards & Precedence Rules

1. **CLI Flag Precedence**:
   - If `allowedEffects` in `mantis.config.json` contains `"destructive"`, running `mantis test` **fails immediately with exit code 2** unless `--allow-destructive` is passed on the CLI.
   - If `baseUrl` points to a non-local address, running `mantis test` **fails immediately with exit code 2** unless `--allow-remote` is passed on the CLI or `allowRemote: true` is configured.
2. **Path Parameter Samples**:
   - Mantis never guesses path parameter values. Any endpoint containing `:paramName` requires a sample in `pathParamSamples`. If none is provided, the endpoint is skipped with structured skip reason `no-sample-for-path-param`.
3. **Session Output**:
   - Sessions are recorded deterministically to `.mantis/sessions/<sessionId>.json`.
   - All authorization tokens and configured secrets are scrubbed to `[REDACTED]` prior to serialization.
