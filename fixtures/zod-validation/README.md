# Zod Validation Fixture

This fixture tests Zod validation extraction for Express route handlers and middleware:

1. **Inline Handler Validation**: `POST /users` calls `userSchema.parse(req.body)`, extracting field types (`string`, `number`, `boolean`, `enum`, `array`), required flags (`optional`), nullability (`nullable`), and constraints (`min`, `max`, `email`).
2. **1-Hop Module Imported Schema**: `PUT /users/:id` imports `updateUserSchema` from `./schemas.js`, resolving provenance to `schemas.js` lines.
3. **Middleware Validation**: `POST /products` uses `validate(productSchema)` middleware wrapper, extracting request body schema and field constraints.
4. **Query Parameter Validation**: `GET /search` calls `querySchema.safeParse(req.query)`, extracting query parameters (`q`, `limit`).
5. **Untyped Route**: `GET /untyped` remains unaffected with empty params.
