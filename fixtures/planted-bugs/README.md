# Planted Bugs Fixture

This fixture is a runnable Express application designed for Step 10 of DevGuard Core.
It includes deliberate bugs to test response oracles, as well as clean endpoints to serve as false-positive guards.

## Endpoints

1. `GET /api/health`: Clean liveness probe (200 OK, no leaks).
2. `POST /api/echo`: Clean POST route that validates `message` and returns 400 Bad Request on invalid inputs without throwing or crashing.
3. `POST /api/users`: Deliberate 5xx bug on invalid input (`no-5xx-on-bad-input`). Throws unhandled `TypeError` when `email` is missing or not a string.
4. `GET /api/debug-error`: Deliberate stack-trace leak (`no-stack-trace-leak`). Returns full error stack trace in response JSON.
5. `GET /api/profile`: Deliberate sensitive-field leak (`no-sensitive-fields`). Returns JSON containing `passwordHash` and `apiKey`.
6. `GET /api/internal-fail`: Server failure on valid request (`server-error-on-valid-input`). Returns 500 on valid input, proving baseline distinction.
