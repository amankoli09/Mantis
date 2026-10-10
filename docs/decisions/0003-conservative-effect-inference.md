# ADR 0003: Conservative Handler Effect Inference

## Context

HTTP method alone is an incomplete heuristic for endpoint mutation risk: a `GET` endpoint might execute database writes or file modifications (`fs.writeFile`), while an unresolvable handler might hide destructive operations. If a security or test automation tool assumes `GET` is always read-only, it could inadvertently trigger side effects during automated probing.

## Decision

We established the **Conservative Risk Elevation Rule** for effect inference:
1. **Evidence can raise risk level, never lower it**:
   - `read` ➔ `write` (if DB write or POST fetch found in GET handler).
   - `read` / `write` ➔ `destructive` (if delete/truncate/drop/remove found).
   - An HTTP `DELETE` method can never be downgraded to `read` or `write`.
2. **Provenance tracking**:
   - Any elevated effect must attach `effectEvidence` linking the exact call expression, library rule (e.g. `Prisma.create`, `Mongoose.save`, `fs.writeFile`), source file, and line number.
3. **Unknown stays unknown**:
   - If the handler cannot be statically resolved, the effect remains `unknown` (or the HTTP method baseline) with diagnostic `DG-I001`.

## Consequences

- Automated test generation will never accidentally test mutation-producing GET endpoints in safe read-only mode without explicit operator approval (`--allow-write`).
- Complete auditable provenance is provided in the ApiModel for every inferred effect.
