# ADR 0005: OpenAPI 3.0 Export Mapping from API Model

## Context

Users require standard OpenAPI 3.0.3 specification files to integrate with API documentation generators (Swagger UI, Redoc), API gateways, and mocking tools. DevGuard extracts high-fidelity AST models (`ApiModel`) containing parameters, request bodies with Zod JSON schemas, and authentication schemes, but had no direct export command.

## Decision

We introduced `exportOpenApi` in `@devguard/core`:
1. **Path Transformation**: Express route parameters (`/users/:userId/posts/:postId`) are deterministically transformed to OpenAPI RFC 6570 URI templates (`/users/{userId}/posts/{postId}`).
2. **Parameter Mapping**: Path, query, and header parameters are mapped to OpenAPI `ParameterObject`s, retaining extracted types and required flags.
3. **Request Body & Schemas**: Extracted Zod JSON schemas in `endpoint.requestBody.schema` are embedded under `requestBody.content['application/json'].schema`.
4. **Security Schemes**: Authenticated endpoints (`bearer`, `apiKey`, `cookie`) configure OpenAPI `components.securitySchemes` and operation-level `security` requirements.
5. **CLI Integration**: Supported via `devguard scan <path> --openapi [--out spec.json]`.

## Consequences

- Direct generation of valid OpenAPI 3.0.3 documents without external third-party tools.
- Preserves high-fidelity validation schemas extracted from static Zod declarations.
