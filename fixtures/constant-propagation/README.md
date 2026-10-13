# Constant Propagation Fixture (`fixtures/constant-propagation`)

A fixture testing the static evaluation of route paths defined through string constants, binary string concatenations (`+`), template literals with expressions, path arrays, and cyclic constant guards.

## Features Tested

1. **Binary String Concatenation**: `app.get(FULL_PREFIX + '/users', ...)` where `FULL_PREFIX = BASE + config.V1`.
2. **Template Literal Interpolation**: `app.post(\`${TEMPLATE_PREFIX}/users\`, ...)` where `TEMPLATE_PREFIX = \`${BASE}/v2\``.
3. **Path Arrays on Direct Routes**: `app.get(['/a', '/b'], ...)` expanding into two distinct endpoint definitions (`GET /a` and `GET /b`).
4. **Path Arrays on Router Mounts**: `app.use([FULL_PREFIX + '/store', TEMPLATE_PREFIX + '/store'], router)` mounting subrouter routes across both path prefixes (`GET /api/v1/store/items` and `GET /api/v2/store/items`).
5. **Reassigned Mutable Variables**: `let reassigned = '/old'; reassigned = '/new';` marked uncertain (`GET /<reassigned>`).
6. **Environment Variables**: `process.env.MY_ROUTE` marked uncertain (`GET /<process.env.MY_ROUTE>`).
7. **Regular Expressions**: `app.get(/.*regex.*/, ...)` marked uncertain (`GET /</.*regex.*/>`).
8. **Object Property References**: `mutableObj.path` marked uncertain (`GET /<mutableObj.path>`).
9. **Function Invocations**: `app.get(getPath(), ...)` marked uncertain (`GET /<getPath()>`).
10. **Partial String Concatenations**: `FULL_PREFIX + '/' + getPath()` partially resolved to `GET /api/v1/<getPath()>`.
11. **Cyclic Variable Declarations**: `const CYCLIC_A = CYCLIC_B; const CYCLIC_B = CYCLIC_A;` detected with cycle protection without infinite loop (`GET /<CYCLIC_A>`).

## Diagnostics

Emits 7 `MT-R003` (Info) diagnostics corresponding to each unresolvable dynamic runtime expression.
