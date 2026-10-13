# ADR 0006: Diagnostic Splitting (MT-R004) and MT-R003 Severity Review

## Context

During Issue 7 analysis and Phase 1.5 backlog planning, two diagnostic design issues emerged:
1. `MT-R002` conflated two distinct conditions: broken router mounts (e.g. `app.use('/api', unknownIdent)`) versus unmounted routers (where a router file defines valid routes but is never mounted in the application).
2. `MT-R003` (dynamic runtime path expression) was reviewed for possible escalation from `info` to `warning`.

## Decision

1. **Split `MT-R002` and add `MT-R004`**:
   - `MT-R002`: Kept for broken or cyclic mounts (`warning`).
   - `MT-R004`: Added for unmounted/orphan routers (`warning`). Routes defined on unmounted routers receive `confidence: "uncertain"` and `confidenceReason: "MT-R004"`.
2. **Retain `info` Severity for `MT-R003`**:
   - Express applications legitimately use environment variables (`process.env.PREFIX`) or regex wildcards in paths. Escalating `MT-R003` to `warning` would fail CI builds unnecessarily for valid architectures.
   - It remains `info` by default, but routes are still flagged as `uncertain`.

## Consequences

- Clear distinction in error reporting between a broken mount statement and unused/unmounted router code.
- Zero false-positive CI build failures on valid dynamic path patterns.
