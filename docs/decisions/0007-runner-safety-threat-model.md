# ADR 0007: Runner Safety Threat Model & Host Guard Defenses

## Context

Automated API testing tools possess execution capabilities that, if unconstrained, present critical operational hazards:

1. Accidental requests targeting external production domains or internal corporate intranet services.
2. Server-Side Request Forgery (SSRF) through obfuscated IP representations, DNS rebinding, or loopback look-alike hostnames.
3. Leaking authentication credentials (API keys, session cookies, bearer tokens) in test artifacts, session recordings, terminal output, or version control.
4. Server resource exhaustion from unbounded responses, infinite streams, slowloris timeouts, or uncontrolled concurrency.
5. Directory traversal via arbitrary output file path arguments.

## Decision

1. **Host Guard & Localhost Pinning**:
   - By default, `@mantis/runner` only permits HTTP requests to local loopback hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`).
   - Hostnames resolving via DNS are pinned: all resolved IPs must belong to loopback subnets.
   - Bind-all addresses (`0.0.0.0`, `::`), non-HTTP/HTTPS protocols (`file:`, `ftp:`, `ws:`), and URLs containing embedded credentials (`user:pass@host`) are refused outright.
   - Non-local testing requires explicit CLI and configuration authorization (`allowRemote: true`).
2. **Safe Mode Mutation Gating**:
   - Endpoints are gated by static effect analysis. By default, only `read` effects are permitted.
   - `write` and `destructive` mutations require explicit opt-in in `allowedEffects` and interactive confirmation or `--yes` / `--allow-destructive` CLI flags.
   - Endpoints with `unknown` effects or `uncertain` confidence are skipped unconditionally.
3. **Automated Credential Redaction**:
   - Outbound and inbound headers matching sensitive keys (`authorization`, `cookie`, `x-api-key`) and configured secret values in URLs, payloads, and error messages are replaced with `[REDACTED]`.
   - Volatile timestamps in recorded test sessions are isolated to metadata blocks to ensure deterministic outputs.
4. **Transport Resilience**:
   - Responses are read with streaming byte caps (`limits.maxResponseBytes`); exceeding streams are cleanly truncated.
   - Outbound requests bypass ambient `HTTP_PROXY` / `HTTPS_PROXY` via a dedicated direct dispatcher.
   - Traversal in `--out` is strictly prevented using root-bounded path resolution.

## Consequences

- Mantis can be executed safely by developers and in CI pipelines without risk of unexpected production mutation, data loss, or secret leakage.
- Strict host and effect gating prevents misconfigured test suites from triggering external network traffic.
