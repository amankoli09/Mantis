# Nested Routers Fixture (`fixtures/nested-routers`)

A multi-file Express application testing deeply nested router mounts, route chaining via `router.route()`, parameter inference, and runtime dynamic path detection.

## Routing Architectures Tested

1. **Deep Hierarchical Mounts**: `app.use('/api', usersRouter)` -> `usersRouter.use('/admin', require('./admin'))` -> `adminRouter.get('/metrics')`. This produces a 2-step `mountChain`.
2. **Route Chaining**: `router.route('/users').get(...).post(...)` registering multiple HTTP methods on a single chained path declaration.
3. **Dynamic Runtime Expressions**: `router.get(PRODUCT_DETAIL_PATH, ...)` where `PRODUCT_DETAIL_PATH = '/products/' + getDetailSegment()`. Static analysis cannot compute the function result, so it preserves `<getDetailSegment()>` and marks the route uncertain.

## Endpoints

| Endpoint | Method | Path | Effect | Parameters | Confidence | Description |
| :--- | :---: | :--- | :---: | :--- | :---: | :--- |
| `GET /api/admin/metrics` | `GET` | `/api/admin/metrics` | `read` | None | `confirmed` | Deeply nested endpoint in `routes/admin.js:5` mounted via `app.js:12` and `routes/users.js:25`. |
| `GET /api/products` | `GET` | `/api/products` | `read` | None | `confirmed` | List products mounted via `app.js:13` and `routes/products.js:8`. |
| `GET /api/products/<getDetailSegment()>` | `GET` | `/api/products/<getDetailSegment()>` | `read` | None | `uncertain` | Dynamic path expression in `routes/products.js:17` resolved with normalized placeholder. |
| `GET /api/users` | `GET` | `/api/users` | `read` | None | `confirmed` | List users registered via `router.route('/users').get(...)` in `routes/users.js:10`. |
| `POST /api/users` | `POST` | `/api/users` | `write` | `email` (`in: body`, `required: unknown`) | `confirmed` | Create user registered via `router.route('/users').post(...)` in `routes/users.js:13`. Reads `req.body.email`. |
| `GET /api/users/:id` | `GET` | `/api/users/:id` | `read` | `id` (`in: path`, `required: true`) | `confirmed` | Fetch user by ID registered via `router.get('/users/:id')` in `routes/users.js:19`. |

## Diagnostics

- **`DG-R003` (Info)**: `Route path uses dynamic runtime expression: '/products/' + getDetailSegment()` emitted for `routes/products.js:17`.
