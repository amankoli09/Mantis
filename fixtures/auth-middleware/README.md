# Fixture: `auth-middleware`

## Purpose

Demonstrates deterministic static detection of middleware chains and authentication requirements per endpoint in accordance with Express registration order semantics (Step 8b).

## Scenarios Covered

1. **Non-Auth Middleware**: `express.json()` and `requestLogger` apply to subsequent routes but never classify endpoints as authenticated.
2. **Unresolvable Middleware**: `dynamicMw` (loaded via dynamic expression) cannot be statically resolved, emitting diagnostic `MT-I002` and recording `<unresolved>` middleware.
3. **Registration Order (Public Route)**: `GET /public` is registered before `app.use(sessionGuard)`, so it has no authentication (`auth.type: "unknown"`).
4. **Route-Level Middleware**: `GET /custom-auth` passes `requireAuth` as a route argument, classifying `auth.type: "custom"` with evidence.
5. **App-Level Auth Middleware**: `app.use(sessionGuard)` protects routes registered after it (`GET /profile`), classifying `auth.type: "cookie"` with evidence.
6. **Router-Level Middleware Ordering**:
   - `GET /items/public-items` is registered before `router.use(checkApiKey)` (`auth.type: "unknown"`).
   - `GET /items/secret-items` is registered after `router.use(checkApiKey)` (`auth.type: "apiKey"` with evidence).
7. **Mount-Level Middleware**: `app.use('/admin', verifyBearerToken, adminRouter)` attaches `verifyBearerToken` to all endpoints in `adminRouter` (`GET /admin/dashboard`, `auth.type: "bearer"` with evidence).
8. **1-Hop Imported Middleware**: Auth middlewares defined and exported in `middleware/auth.js` are resolved across file boundaries.
9. **Shadowing**: Local variable declarations sharing names with imported middleware do not corrupt static binding resolution.

## Endpoints Summary

| Endpoint | Method | Path | Auth Type | Auth Signal | Middleware Stack |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /admin/dashboard` | `GET` | `/admin/dashboard` | `bearer` | `header:authorization:Bearer` | `express.json`, `requestLogger`, `<unresolved>`, `sessionGuard`, `verifyBearerToken` |
| `GET /custom-auth` | `GET` | `/custom-auth` | `custom` | `name:requireAuth` | `express.json`, `requestLogger`, `<unresolved>`, `requireAuth` |
| `GET /items/public-items` | `GET` | `/items/public-items` | `unknown` | None | `express.json`, `requestLogger`, `<unresolved>` |
| `GET /items/secret-items` | `GET` | `/items/secret-items` | `apiKey` | `header:x-api-key` | `express.json`, `requestLogger`, `<unresolved>`, `checkApiKey` |
| `GET /profile` | `GET` | `/profile` | `cookie` | `session:user` | `express.json`, `requestLogger`, `<unresolved>`, `sessionGuard` |
| `GET /public` | `GET` | `/public` | `unknown` | None | `express.json`, `requestLogger`, `<unresolved>` |
