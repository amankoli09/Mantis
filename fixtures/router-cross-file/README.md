# Router Cross-File Fixture (`fixtures/router-cross-file`)

A multi-file Express application testing cross-file router module imports and diverse export styles resolved through the static module graph.

## Export & Mount Styles Tested

1. **Default Export**: `routes/users.js` exports `module.exports = router`, mounted at `app.use('/users', usersRouter)`.
2. **Named Destructured Export**: `routes/items.js` exports `exports.itemsRouter = router`, imported as `const { itemsRouter } = require('./routes/items')`, mounted at `app.use('/items', itemsRouter)`.
3. **Module Object Member**: `routes/orders.js` exports `module.exports.ordersRouter = router`, imported as `const ordersMod = require('./routes/orders')`, mounted at `app.use('/orders', ordersMod.ordersRouter)`.
4. **Re-Exported Router**: `routes/reexport.js` acts as an intermediary re-exporting `require('./admin')`, mounted at `app.use('/admin', reexportRouter)`.
5. **Shared Router (Multi-Mount)**: `routes/shared.js` exports a ping router mounted twice under different prefixes: `app.use('/v1', sharedRouter)` and `app.use('/v2', sharedRouter)`.

## Endpoints

| Endpoint | Method | Path | Effect | Source File & Line | Mount Line in `app.js` |
| :--- | :---: | :--- | :---: | :--- | :--- |
| `GET /admin/metrics` | `GET` | `/admin/metrics` | `read` | `routes/admin.js:6` | `app.js:15` |
| `GET /items/all` | `GET` | `/items/all` | `read` | `routes/items.js:6` | `app.js:13` |
| `POST /orders/checkout` | `POST` | `/orders/checkout` | `write` | `routes/orders.js:6` | `app.js:14` |
| `GET /users/profile` | `GET` | `/users/profile` | `read` | `routes/users.js:6` | `app.js:12` |
| `GET /v1/ping` | `GET` | `/v1/ping` | `read` | `routes/shared.js:6` | `app.js:16` |
| `GET /v2/ping` | `GET` | `/v2/ping` | `read` | `routes/shared.js:6` | `app.js:17` |

## Diagnostics
No warnings or errors (`diagnostics: []`). All 6 routes are confirmed with resolved provenance.
