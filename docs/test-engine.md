# DevGuard Test Engine Architecture (`Step 10`)

The DevGuard Test Engine turns an `ApiModel` into deterministic test plans, executes them safely through `@devguard/runner`, and judges HTTP responses using pluggable Oracles to report code-linked findings.

---

## 🏗️ Architecture Overview

```text
ApiModel + RunnerConfig
         │
         ▼
    Test Planner (packages/core/src/planner/)
         │
         ├── Built-in Input Generators (valid-baseline, empty-body, missing-field, wrong-type)
         │
         ▼
     TestCase[] (Deterministic ordering, expectedBehavior: should-accept | should-reject)
         │
         ▼
  TestRunnerEngine (Injected runner interface; core never imports network clients)
         │
         ▼
  ExecutionResult[]
         │
         ▼
   Response Oracles (packages/core/src/oracles/)
         │
         ├── no-5xx-on-bad-input
         ├── no-stack-trace-leak
         └── no-sensitive-fields
         │
         ▼
       Report (reportVersion: "1.0.0", findings, summary, test results)
```

---

## 🔌 1. How to Add a New Generator in One File

Generators implement the `GeneratorPlugin` interface:

```typescript
export interface GeneratorPlugin {
  readonly id: string;
  readonly name: string;
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[];
}
```

### Worked Example: `oversized-string` Generator

Create `packages/core/src/generators/oversized-string.ts`:

```typescript
import type { Endpoint, RunnerConfig, TestCase, GeneratorPlugin } from '@devguard/core';
import { resolveEndpointUrl } from '../helpers/planner-helpers.js';

export const oversizedStringGenerator: GeneratorPlugin = {
  id: 'oversized-string',
  name: 'Oversized String Input Generator',
  generate(endpoint: Endpoint, config: RunnerConfig): TestCase[] {
    const bodyParams = endpoint.params.filter((p) => p.in === 'body');
    if (bodyParams.length === 0) return [];

    const { url, skip } = resolveEndpointUrl(endpoint, config);
    const hugeString = 'A'.repeat(10000);

    const bodyObj: Record<string, unknown> = {};
    for (const p of bodyParams) {
      bodyObj[p.name] = hugeString;
    }

    return [
      {
        id: `${endpoint.id}::oversized-string`,
        endpointId: endpoint.id,
        generatorId: 'oversized-string',
        description: `Sends a 10KB string payload to ${endpoint.id}`,
        expectedBehavior: 'should-reject',
        request: {
          endpointId: endpoint.id,
          method: endpoint.method,
          url,
          headers: { 'content-type': 'application/json', accept: 'application/json, */*' },
          body: JSON.stringify(bodyObj),
          effect: endpoint.effect,
        },
        ...(skip ? { skip } : {}),
      },
    ];
  },
};
```

Register it in `packages/core/src/generators/index.ts`:

```typescript
export const BUILTIN_GENERATORS: GeneratorPlugin[] = [
  validBaselineGenerator,
  emptyBodyGenerator,
  missingFieldGenerator,
  wrongTypeGenerator,
  oversizedStringGenerator, // <-- Added here
];
```

---

## ⚖️ 2. How to Add a New Oracle in One File

Oracles implement the `OraclePlugin` interface:

```typescript
export interface OraclePlugin {
  readonly id: string;
  readonly name: string;
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[];
}
```

### Worked Example: `status-sanity` Oracle

Create `packages/core/src/oracles/status-sanity.ts`:

```typescript
import type { Endpoint, ExecutionResult, TestCase, Finding, OraclePlugin } from '@devguard/core';

export const statusSanityOracle: OraclePlugin = {
  id: 'status-sanity',
  name: 'Status Sanity Oracle',
  judge(testCase: TestCase, result: ExecutionResult, endpoint: Endpoint): Finding[] {
    const status = result.response?.status;
    if (status === undefined) return [];

    // On should-reject inputs, receiving a 2xx indicates broken input validation
    if (testCase.expectedBehavior === 'should-reject' && status >= 200 && status < 300) {
      return [
        {
          ruleId: 'status-sanity-accepted-bad-input',
          severity: 'warning',
          endpointId: endpoint.id,
          message: `Endpoint accepted invalid input with HTTP ${status}; expected 4xx client error`,
          evidence: {
            request: {
              method: testCase.request.method,
              path: new URL(testCase.request.url).pathname,
              ...(testCase.request.headers ? { headers: testCase.request.headers } : {}),
              ...(testCase.request.body !== undefined ? { body: testCase.request.body } : {}),
            },
            response: {
              status,
              ...(result.response?.body !== undefined ? { bodySnippet: result.response.body.slice(0, 500) } : {}),
            },
          },
          source: {
            file: endpoint.provenance.filePath,
            line: endpoint.provenance.line,
          },
          confidence: 'high',
        },
      ];
    }

    return [];
  },
};
```

Register it in `packages/core/src/oracles/index.ts`:

```typescript
export const BUILTIN_ORACLES: OraclePlugin[] = [
  no5xxOnBadInputOracle,
  noStackTraceLeakOracle,
  noSensitiveFieldsOracle,
  statusSanityOracle, // <-- Added here
];
```

---

## 🔒 3. Invariants & Security Rules

1. **Zero Secret Leaks**: Evidence excerpts must redact secrets and sensitive values. Oracles scan and redact sensitive fields before attaching snippets.
2. **Deterministic Findings**: Reports sort findings by `endpointId` then `ruleId`. Volatile transport headers (such as `date`, `etag`, `keep-alive`) are omitted from excerpts.
3. **Conservative Confidence**: When an assertion depends on uncertain or incomplete inputs, confidence must be lowered (`low` or `medium`). Oracles must never overclaim.
