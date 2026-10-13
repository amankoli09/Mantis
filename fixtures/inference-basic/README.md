# Parameter & Body-Field Inference Fixture (`fixtures/inference-basic`)

A multi-file Express application designed to exercise handler static AST inspection (Step 8a): identifying request parameter bindings, member expressions, bracket notation, destructuring with renames, imported handlers, handler arrays, and unresolvable handler diagnostics.

## Handlers & Patterns Tested

1. **`GET /users/:id`**: Directly accesses `req.params.id` without duplicating the path parameter in `params`.
2. **`GET /search`**: Reads `req.query.q` and `req.query.limit` into inferred query parameters.
3. **`POST /login`**: Destructures `const { email, password } = req.body` into inferred body parameters.
4. **`POST /register`**: Member expressions `req.body.username` and `req.body.terms` into inferred body parameters.
5. **`POST /profile`**: Bracket notation with string literal `req.body['bio']`.
6. **`POST /articles`**: Middleware array with handler as last element: `app.post('/articles', [middlewareA, middlewareB, handler])`. Reads `const { slug } = req.body`.
7. **`POST /posts`**: Imported controller function one hop via module graph (`const { createPost } = require('./controllers/posts')`).
8. **`POST /comments`**: Variable shadowing where inner callback uses parameter `req` (`items.map(req => req.name)`), correctly ignored by scope checking.
9. **`POST /webhook`**: Request object named `request` instead of `req` (`app.post('/webhook', (request, res) => { request.body.event })`). Correctly identified by parameter binding.
10. **`POST /unresolved`**: Handler is a dynamic function call (`app.post('/unresolved', getDynamicHandler())`). Emits `MT-I001` diagnostic.

## Diagnostics

- **`MT-I001` (Info)**: `Route handler could not be statically resolved: getDynamicHandler()` emitted for `app/app.js:61`.
