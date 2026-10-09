# DevGuard Runner Configuration (`devguard.config.json`)

The `devguard.config.json` file configures the `@devguard/runner` package when sending requests to a running target application.

By default, the runner operates in **safe mode**: only `read` requests are executed, non-local hosts are blocked, and unknown/uncertain routes are skipped.

---

## Example Configuration

```json
{
  "baseUrl": "http://localhost:3000",
  "auth": {
    "header": "Authorization",
    "envVar": "DEVGUARD_AUTH_TOKEN"
  },
  "allowedEffects": ["read"],
  "skip": [
    "DELETE /users/:id",
    "/admin/*"
  ],
  "pathParamSamples": {
    "id": "1",
    "userId": "usr_test123"
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

## Configuration Keys & Defaults

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `baseUrl` | `string` (URL) | *(Required)* | The base URL of the running target application (e.g. `http://localhost:3000`). |
| `auth` | `object` | `undefined` | Optional authentication configuration. |
| `auth.header` | `string` | `"Authorization"` | Header name to attach authentication secret. |
| `auth.value` | `string` | `undefined` | Direct token value. **Recommended**: use `envVar` instead. |
| `auth.envVar` | `string` | `undefined` | Name of the environment variable containing the secret. Automatically read at runtime and never written to disk. |
| `allowedEffects` | `string[]` | `["read"]` | Allowed mutation effects (`read`, `write`, `destructive`). `unknown` is never permitted. `write` and `destructive` require explicit opt-in. |
| `skip` | `string[]` | `[]` | List of endpoint IDs (e.g. `DELETE /users/:id`) or path patterns (e.g. `/admin/*`) to skip. |
| `pathParamSamples` | `Record<string, string \| number>` | `{}` | Explicit sample values for path parameters (e.g. `:id -> "1"`). If a path parameter lacks a sample, the route is skipped. |
| `limits.timeoutMs` | `number` | `5000` | Maximum time in milliseconds before a request times out. |
| `limits.maxResponseBytes` | `number` | `1048576` (1MB) | Maximum response body size in bytes before the stream is aborted and marked `truncated`. |
| `limits.maxRequests` | `number` | `50` | Maximum number of requests to execute in a single run. |
| `limits.concurrency` | `number` | `5` | Maximum number of concurrent in-flight requests. |
| `limits.retries` | `number` | `0` | Number of retry attempts on network-level connection failures. |
| `allowRemote` | `boolean` | `false` | Whether to allow non-local target hostnames. Defaults to local-only (`localhost`, `127.0.0.1`, `[::1]`). |
| `followRedirects` | `boolean` | `false` | Whether to follow redirects. Cross-host redirects are **never** followed. |

---

## Session Output Location

Executed sessions are recorded to `.devguard/sessions/<sessionId>.json`.

> [!IMPORTANT]
> The `.devguard/` directory is automatically ignored by Git (`.gitignore`). Ensure your version control ignores `.devguard/` so session recordings and local test runs are not committed to source repositories.
