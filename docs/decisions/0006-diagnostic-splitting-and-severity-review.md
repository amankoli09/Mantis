# ADR 0006: Diagnostic Splitting (DG-R004) and DG-R003 Severity Review

## Context

During Issue 7 analysis and Phase 1.5 backlog planning, two diagnostic design issues emerged:
1. `DG-R002` conflated two distinct conditions: broken router mounts (e.g. `app.use('/api', unknownIdent)`) versus unmounted routers (where a router file defines valid routes but is never mounted in the application).
2. `DG-R003` (dynamic runtime path expression) was reviewed for possible escalation from `info` to `warning`.

## Decision

1. **Split `DG-R002` and add `DG-R004`**:
   - `DG-R002`: Kept for broken or cyclic mounts (`warning`).
   - `DG-R004`: Added for unmounted/orphan routers (`warning`). Routes defined on unmounted routers receive `confidence: "uncertain"` and `confidenceReason: "DG-R004"`.
2. **Retain `info` Severity for `DG-R003`**:
   - Express applications legitimately use environment variables (`process.env.PREFIX`) or regex wildcards in paths. Escalating `DG-R003` to `warning` would fail CI builds unnecessarily for valid architectures.
   - It remains `info` by default, but routes are still flagged as `uncertain`.

## Consequences

- Clear distinction in error reporting between a broken mount statement and unused/unmounted router code.
- Zero false-positive CI build failures on valid dynamic path patterns.
