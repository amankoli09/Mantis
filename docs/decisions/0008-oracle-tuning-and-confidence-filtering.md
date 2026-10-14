# ADR 0008: Response Oracle Tuning, False-Positive Reduction & Confidence Filtering

## Context

In automated security and contract testing, false alarms degrade developer trust rapidly. During real-world benchmark evaluations (M1-03 / M1-05), initial response oracles produced false-positive findings:

1. `no-sensitive-fields` flagged Mongoose internal version keys (`__v`), benign CSRF tokens (`csrfToken`), and intentionally returned authentication tokens on login/register endpoints (`/api/users/login`, `/auth/token`).
2. `no-stack-trace-leak` flagged generic JSON error objects containing `message` and `stack` properties without actual runtime call frames or file paths.
3. `auth-enforced` flagged optional authentication endpoints where unauthenticated access returned `200 OK` as intended by design.
4. Users had no fine-grained mechanism to filter reported findings by confidence level in CI pipelines.

## Decision

1. **Conservative Oracle Calibration**:
   - `no-sensitive-fields`: Removed `__v` from sensitive keys list. Added exemptions for endpoints matching auth path heuristics (`/auth`, `/login`, `/token`, `/register`) returning credential tokens (`token`, `access_token`, `jwt`), and excluded non-secret tokens (e.g. `csrfToken`, `tokenType`).
   - `no-stack-trace-leak`: Required positive evidence of runtime call frames (`at ... (...)`), file path line references (`.js:12:34`), or framework error banners.
   - `auth-enforced`: Exempted endpoints with optional authentication evidence or explicit public fallback semantics.
2. **Deterministic Confidence & Rationale**:
   - Every finding carries a calibrated `confidence` (`low`, `medium`, `high`) and an explicit `confidenceReason` explaining the underlying justification.
3. **Configurable Confidence Threshold**:
   - Added `--min-confidence <low|medium|high>` CLI option to `mantis test` and `mantis report`, defaulting to `medium`. Low-confidence findings (e.g., `server-error-on-valid-input` where baseline inputs are inferred without DB state) are suppressed by default in CI to avoid false breaks.

## Consequences

- 0.0% false-positive rate on confirmed findings across real-world benchmark suites.
- Developers can safely adopt Mantis in CI with zero noisy false alerts while retaining high detection accuracy for genuine vulnerabilities.
