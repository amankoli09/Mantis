# Simple Fixture (`fixtures/simple`)

A single-file Express application designed to test direct HTTP route extraction, path parameter detection, and request body parameter inference.

## Endpoints

| Endpoint | Method | Path | Effect | Parameters | Description |
| :--- | :---: | :--- | :---: | :--- | :--- |
| `GET /health` | `GET` | `/health` | `read` | None | Liveness health check returning a static `{ status: "ok" }` JSON response. |
| `GET /users` | `GET` | `/users` | `read` | None | Lists all user accounts. |
| `POST /users` | `POST` | `/users` | `write` | `email` (`in: body`, `required: unknown`) | Creates a new user account; handler body reads `req.body.email`. |
| `GET /users/:id` | `GET` | `/users/:id` | `read` | `id` (`in: path`, `required: true`) | Fetches a single user by path identifier `:id`. |
| `PUT /users/:id` | `PUT` | `/users/:id` | `write` | `id` (`in: path`, `required: true`), `email` (`in: body`, `required: unknown`) | Updates an existing user; reads path parameter `:id` and `req.body.email`. |
| `DELETE /users/:id` | `DELETE` | `/users/:id` | `destructive` | `id` (`in: path`, `required: true`) | Permanently deletes a user by path identifier `:id`. |

## Diagnostics
No warnings or errors (`diagnostics: []`). All 6 routes are confirmed with literal provenance.
