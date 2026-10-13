# Router Single-File Fixture (`fixtures/router-single-file`)

A single-file Express application testing local `express.Router()` instances, mount prefix resolution (`app.use('/prefix', router)`), root mount normalization (`app.use('/', router)`), and unmounted orphan router detection.

## Endpoints

| Endpoint | Method | Path | Effect | Parameters | Description |
| :--- | :---: | :--- | :---: | :--- | :--- |
| `GET /api/users` | `GET` | `/api/users` | `read` | None | Mounted via `app.use('/api', apiRouter)`. Lists users. |
| `POST /api/users` | `POST` | `/api/users` | `write` | None | Mounted via `app.use('/api', apiRouter)`. Creates users. |
| `GET /items/:id` | `GET` | `/items/:id` | `read` | `id` (`in: path`, `required: true`) | Mounted via `app.use('/', v1Router)`. Fetches items by path identifier `:id`. |
| `GET /orphan` | `GET` | `/orphan` | `read` | None | Defined on `orphanRouter` which is never mounted to the Express application. Marked `confidence: "uncertain"`. |

## Diagnostics

- **`MT-R004` (Warning)**: `Router "orphanRouter" is declared but never mounted to the application` emitted at line 26 because `orphanRouter` is instantiated and contains routes, but has no mount binding to the application.
