# ADR 0001: API Model Schema Version 1.1.0

## Context

Step 8a introduces static inference of request parameters (query, path) and request body fields directly from route handler code. Additionally, router resolution in Step 7 accumulated hierarchical mount prefixes across files, creating the need to track the exact sequence of mounts a route passed through (`mountChain`).

The original schema (`v1.0.0`) had several limitations:
1. `ParamLocation` only allowed `'path' | 'query' | 'header'`, omitting `'body'`.
2. `ParamDefinition.required` was strictly `boolean` defaulting to `false`. For inferred parameters where static access does not prove requirement, the value must be able to represent `'unknown'`.
3. `ParamDefinition` lacked an explicit `type` field (defaulting to `'unknown'`).
4. `Endpoint` had no field recording the ordered router mount hierarchy (`mountChain`).
5. `ApiModel.modelVersion` was locked to the literal `'1.0.0'`.

## Decision

Bump `modelVersion` to `'1.1.0'` with a backward-compatible schema upgrade:

1. **`modelVersion`**: Accept either `'1.0.0'` or `'1.1.0'`, emitting `'1.1.0'` by default.
2. **`ParamLocation`**: Extend enum to include `'body'`: `'path' | 'query' | 'header' | 'body'`.
3. **`ParamDefinition`**:
   - `required`: Allow `boolean | 'unknown'`, defaulting to `'unknown'`.
   - `type`: Add `string`, defaulting to `'unknown'`.
4. **`Endpoint.mountChain`**: Add optional `mountChain` property: array of `{ filePath: string; line: number }`, defaulting to `[]`.
5. **Diagnostics**: Register `DG-I001` (`severity: 'info'`): Route handler could not be statically resolved.

## Consequences

- **Backward Compatibility**: Existing `1.0.0` fixtures remain valid under `validateModel()` because all new fields have defaults or are optional, and `modelVersion` accepts `'1.0.0'`.
- **Downstream Consumers**: Test generators and runners can now distinguish between confirmed path params (`required: true, type: "string"`) and inferred body/query fields (`required: "unknown", type: "unknown"`).
- **Provenance**: Line-level debugging can navigate the full router mount history via `mountChain`.
