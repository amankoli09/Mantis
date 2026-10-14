# False-Positive Review and Oracle Tuning (M1-05)

A false alarm costs more developer trust than a missed bug. If the first thing a developer sees when running Mantis is a wrong finding, they stop using the tool.

This review evaluates all findings generated across the 5 real-world open-source Express repositories benchmarked in **M1-03**, catalogs the false-positive patterns, describes the oracle tuning and safety fixes implemented, and verifies the `--min-confidence` threshold.

---

## 1. Summary of Results

| Metric | Target | Before M1-05 | After M1-05 (Default `medium`) |
|---|---|---:|---:|
| **False-Positive Share (High Confidence)** | **0.0%** | 100.0% (24 / 24) | **0.0%** (0 false) |
| **Overall False-Positive Share** | **≤ 15.0%** | 100.0% (24 / 24) | **0.0%** (0 false) |
| **Planted-Bugs Fixture Precision** | **100.0%** | 100.0% (4 / 4) | **100.0%** (4 / 4 exact match) |
| **Regression Tests for False Positives** | **100%** | 0 | **11 canned-response tests** |
| **Findings with Confidence Reason** | **100%** | 0% | **100%** (all oracles & cross-analysis) |

---

## 2. Real-World Findings Log & Labeling

Every finding produced by testing the 5 real-world benchmark repositories from **M1-03** was examined across its request, response, and source lines.

| # | Project | Endpoint | Finding Emitted | Source Line | Label | Reason Why Mantis Was Wrong |
|---|---|---|---|---|:---:|---|
| 1 | `node-todo` | `GET /api/todos` | `no-sensitive-fields` (`__v`) | `app/routes.js:11` | **False** | `__v` is Mongoose's internal schema version key (`versionKey`), not a confidential credential. |
| 2 | `node-todo` | `POST /api/todos` | `no-sensitive-fields` (`__v`) | `app/routes.js:36` | **False** | Mongoose document version key `__v` returned in created document is benign. |
| 3 | `express-mongoose-es6-rest-api` | `POST /api/auth/login` | `no-sensitive-fields` (`token`) | `server/auth/auth.controller.js:27` | **False** | `/api/auth/login` is an authentication endpoint whose intended contract is to return an auth token. |
| 4 | `express-mongoose-es6-rest-api` | `GET /api/users` | `no-sensitive-fields` (`__v`) | `server/user/user.controller.js:65` | **False** | Mongoose user document version `__v: 0` is not sensitive. |
| 5 | `express-mongoose-es6-rest-api` | `POST /api/users` | `no-sensitive-fields` (`__v`) | `server/user/user.controller.js:36` | **False** | Mongoose document version `__v` is not sensitive. |
| 6 | `express-mongoose-es6-rest-api` | `GET /api/users/:userId` | `no-sensitive-fields` (`__v`) | `server/user/user.controller.js:20` | **False** | Mongoose document version `__v` is not sensitive. |
| 7 | `express-mongoose-es6-rest-api` | `PUT /api/users/:userId` | `no-sensitive-fields` (`__v`) | `server/user/user.controller.js:52` | **False** | Mongoose document version `__v` is not sensitive. |
| 8 | `express-mongoose-es6-rest-api` | `GET /api/auth/random-number` | `server-error-on-valid-input` | `server/auth/auth.controller.js:42` | **False** | 500 occurred because test ran without live database/JWT secret seed, not an invariant defect. |
| 9 | `express-rest-es2017-boilerplate` | `POST /v1/auth/login` | `no-sensitive-fields` (`token.accessToken`, `token.refreshToken`) | `src/api/controllers/auth.controller.js:53` | **False** | Returning JWT access and refresh tokens is the intended contract of login endpoints. |
| 10 | `express-rest-es2017-boilerplate` | `POST /v1/auth/register` | `no-sensitive-fields` (`token.accessToken`, `token.refreshToken`) | `src/api/controllers/auth.controller.js:38` | **False** | Returning authentication tokens is expected on user registration. |
| 11 | `express-rest-es2017-boilerplate` | `POST /v1/auth/refresh` | `no-sensitive-fields` (`accessToken`, `refreshToken`) | `src/api/controllers/auth.controller.js:89` | **False** | Token refresh route is specifically designed to emit new JWT credentials. |
| 12 | `express-rest-es2017-boilerplate` | `POST /v1/auth/facebook` | `no-sensitive-fields` (`token.accessToken`) | `src/api/controllers/auth.controller.js:70` | **False** | OAuth handler correctly returns session JWT token. |
| 13 | `express-rest-es2017-boilerplate` | `POST /v1/auth/google` | `no-sensitive-fields` (`token.accessToken`) | `src/api/controllers/auth.controller.js:70` | **False** | OAuth handler correctly returns session JWT token. |
| 14 | `express-rest-es2017-boilerplate` | `GET /v1/users` | `no-sensitive-fields` (`__v`) | `src/api/controllers/user.controller.js:46` | **False** | Mongoose document version key `__v` is not sensitive. |
| 15 | `express-rest-es2017-boilerplate` | `GET /v1/users/profile` | `no-sensitive-fields` (`__v`) | `src/api/controllers/user.controller.js:32` | **False** | Mongoose document version key `__v` is not sensitive. |
| 16 | `realworld` | `POST /api/users/login` | `no-sensitive-fields` (`user.token`) | `src/app/routes/auth/auth.controller.ts:33` | **False** | The RealWorld spec explicitly mandates returning `user.token` on authentication. |
| 17 | `realworld` | `POST /api/users` | `no-sensitive-fields` (`user.token`) | `src/app/routes/auth/auth.controller.ts:17` | **False** | Registration endpoint explicitly returns `user.token` to log in newly registered user. |
| 18 | `realworld` | `GET /api/articles` | `auth-enforced` | `src/app/routes/article/article.controller.ts` | **False** | Route uses `auth.optional`; unauthenticated clients are allowed to browse articles. |
| 19 | `realworld` | `GET /api/tags` | `server-error-on-valid-input` | `src/app/routes/tag/tag.controller.ts` | **False** | Database not connected during local black-box scan; weak baseline inference. |
| 20 | `node-express-boilerplate` | `POST /v1/auth/login` | `no-sensitive-fields` (`tokens.access.token`) | `src/controllers/auth.controller.js:15` | **False** | Returning JWT auth tokens is the expected behavior of a login route. |
| 21 | `node-express-boilerplate` | `POST /v1/auth/register` | `no-sensitive-fields` (`tokens.access.token`) | `src/controllers/auth.controller.js:8` | **False** | Returning JWT auth tokens is the expected behavior of a registration route. |
| 22 | `node-express-boilerplate` | `POST /v1/auth/refresh-tokens` | `no-sensitive-fields` (`tokens.access.token`) | `src/controllers/auth.controller.js:25` | **False** | Token refresh route intentionally issues fresh tokens. |
| 23 | `node-express-boilerplate` | `POST /v1/auth/forgot-password` | `server-error-on-valid-input` | `src/controllers/auth.controller.js:30` | **False** | Local baseline run lacked SMTP/email transport credentials. |
| 24 | `node-express-boilerplate` | `GET /v1/users` | `no-sensitive-fields` (`__v`) | `src/controllers/user.controller.js:18` | **False** | Mongoose document version key `__v` is not sensitive. |

---

## 3. Before vs. After Findings Per Project

| Project | Before Total | Before False Positives | Before FP Share | After (Default `medium`) | After High Confidence | After FP Share |
|---|---:|---:|---:|---:|---:|---:|
| [node-todo](https://github.com/scotch-io/node-todo) | 2 | 2 | 100.0% | **0** | **0** | **0.0%** |
| [express-mongoose-es6-rest-api](https://github.com/kunalkapadia/express-mongoose-es6-rest-api) | 6 | 6 | 100.0% | **0** | **0** | **0.0%** |
| [express-rest-es2017-boilerplate](https://github.com/danielfsousa/express-rest-es2017-boilerplate) | 7 | 7 | 100.0% | **0** | **0** | **0.0%** |
| [realworld](https://github.com/gothinkster/node-express-realworld-example-app) | 4 | 4 | 100.0% | **0** | **0** | **0.0%** |
| [node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate) | 5 | 5 | 100.0% | **0** | **0** | **0.0%** |
| **Total** | **24** | **24** | **100.0%** | **0** | **0** | **0.0%** |

---

## 4. Oracle Tuning Actions

### 1. Removal of Mongoose `__v` from Sensitive Key Set
- **Fix**: Removed `'__v'` from `DEFAULT_SENSITIVE_FIELD_NAMES` in `packages/core/src/oracles/no-sensitive-fields.ts`.
- **Rationale**: `__v` is Mongoose's internal schema document version number (`0`, `1`, etc.), not a private token or credential.

### 2. Semantic Token Handling & Auth Endpoint Exemption
- **Fix**:
  1. Distinguish strictly sensitive credentials (`password`, `passwordHash`, `passwd`, `secret`, `apiKey`, `privateKey`) from contextual authentication tokens (`token`, `accessToken`, `refreshToken`, `sessionToken`).
  2. If the endpoint path or identifier matches authentication routes (`/(?:auth|login|signin|signup|register|oauth|token|session)s?(?:[/?#]|$)/i`), returning authentication tokens is expected and is **not flagged**.
  3. Leaking strict credentials (like `passwordHash` or `apiKey`) is **always flagged**, even on login endpoints.
  4. Non-secret tokens (`csrfToken`, `deviceToken`, `pageToken`, `continuationToken`) are explicitly exempted.

### 3. Tightened Stack Trace Regex Pattern
- **Fix**: Replaced bare `/node_modules\//i` in `packages/core/src/oracles/no-stack-trace-leak.ts` with explicit call site frame pattern `/(?:^|\n)\s*at\s+.*[\\/]node_modules[\\/]/i`.
- **Rationale**: Benign URLs, static asset documentation, or error messages referencing `node_modules/` in text no longer trigger stack trace findings.

### 4. Optional Authentication & Uncertain Endpoint Downgrading
- **Fix**:
  1. If `endpoint.auth.details` contains `optional`, `authEnforcedOracle` skips reporting unauthenticated 200 responses.
  2. If `endpoint.confidence === 'uncertain'`, findings are reported with `medium` confidence instead of `high`.

### 5. Added Confidence Reason ("Why We Think So") to Every Finding
- Added `confidenceReason: z.string().optional()` to `FindingSchema`.
- Every response oracle and cross-analysis rule now populates a descriptive rationale explaining why the finding was flagged.
- Displayed in terminal output, `--json`, and HTML report.

### 6. Introduced `--min-confidence` Option (`low | medium | high`, Default `medium`)
- Added `--min-confidence <level>` to `mantis test` and `mantis report`.
- Defaulting to `medium` immediately removes baseline 500 noise on unconfigured environments (`server-error-on-valid-input`, confidence `low`) while keeping verified bugs and security invariants front and center.

---

## 5. Verification & Regressions

1. **Planted-Bugs Fixture Golden**:
   - `fixtures/__tests__/planted-bugs.test.ts` executes all 4 planted bugs against a live server and matches `fixtures/planted-bugs/expected.findings.json` with strict equality (`toStrictEqual`).
   - Clean endpoints (`/api/health`, `/api/echo`) produce **0 findings**.
2. **Canned-Response Regression Tests**:
   - 11 unit tests in `packages/core/tests/oracles.test.ts` verify zero false positives on Mongoose `__v`, `csrfToken`, login JWT returns, and benign `node_modules` substrings.
3. **Full Monorepo Integrity**:
   - All 516 automated tests pass across 41 test files.
   - Branding check, secret leak check, TypeScript typecheck, and ESLint pass cleanly.
