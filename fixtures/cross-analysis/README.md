# Cross-Analysis Fixture (Step 11)

This fixture demonstrates cross-analysis correlating static code analysis against live runtime behavior:

1. **Auth Enforced Oracle (`auth-enforced`)**:
   - `GET /api/secure/profile` is protected with Bearer auth, but buggy handler bypass allows unauthenticated requests returning 200 OK.
   - `GET /api/secure/settings` correctly enforces 401 Unauthorized when credentials are missing.
2. **Route in Code but 404 Live (`route-in-code-404-live`)**:
   - `GET /api/dead-route` is declared in code, but live server returns 404 Not Found.
3. **Route Live but Not in Code (`live-route-not-in-code`)**:
   - `/healthz` responds 200 OK live via custom middleware, but is not extracted as a static route.
   - When opted-in via `probePaths: ['/healthz']`, it is flagged as an unmodeled live endpoint.
4. **Consistency Checks**:
   - `POST /api/items`, `POST /api/orders`, and `POST /api/users` return 400 Bad Request with `{ "error": ... }`.
   - `POST /api/tickets` deviates by returning 422 Unprocessable Entity with `{ "message": ... }`.
   - Triggers `consistency/status-code-deviation` and `consistency/error-response-shape`.
