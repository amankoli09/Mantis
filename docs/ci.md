# DevGuard CI/CD Integration Guide

DevGuard is engineered for zero-friction integration with modern continuous integration pipelines. It provides deterministic exit codes, JSON and HTML reporting, and diff modes for pull request regression checking.

---

## 1. Exit Code Reference

DevGuard CLI commands (`scan`, `test`, `report`, `diff`) return predictable UNIX exit codes:

| Exit Code | Meaning | Typical Causes |
| :---: | :--- | :--- |
| **`0`** | **Success / Clean** | All tests passed, no policy violations, or clean diff. |
| **`1`** | **Findings / Policy Violation** | Test assertions failed, security oracle violations detected, or regressions found during `devguard diff`. |
| **`2`** | **Configuration / Usage Error** | Missing configuration file, invalid CLI flags, unreadable files, or unreachable target URL. |
| **`3`** | **Internal Error** | Unhandled runtime exception or internal crash. |

---

## 2. GitHub Actions Integration

### 2.1 Basic Scan & OpenAPI Export

Use the official composite action to extract endpoints and generate OpenAPI specifications:

```yaml
name: API Verification
on: [push, pull_request]

jobs:
  devguard-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Scan API & Export OpenAPI
        uses: ./.github/actions/devguard-scan
        with:
          path: './server'
          export-openapi: 'true'
          openapi-out: 'openapi.json'

      - name: Archive OpenAPI Spec
        uses: actions/upload-artifact@v4
        with:
          name: openapi-spec
          path: openapi.json
```

---

### 2.2 PR Diff Regression Checking

Compare endpoint changes and security reports between the pull request branch and `main`:

```yaml
name: PR API Diff Check
on:
  pull_request:
    branches: [main]

jobs:
  diff-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR Branch
        uses: actions/checkout@v4
        with:
          path: 'head'

      - name: Checkout Base Branch (main)
        uses: actions/checkout@v4
        with:
          ref: 'main'
          path: 'base'

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Scan Base Branch
        run: |
          npx --yes @devguard/cli scan ./base --json --out base-model.json

      - name: Scan PR Branch
        run: |
          npx --yes @devguard/cli scan ./head --json --out head-model.json

      - name: Compare API Models
        run: |
          npx --yes @devguard/cli diff base-model.json head-model.json
```

---

### 2.3 Runtime Test Suite with HTML Artifact

Run automated test executions against an active staging or local ephemeral server and publish an interactive HTML report:

```yaml
name: Security & Behavioral Testing
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Start Ephemeral Server
        run: |
          npm install
          npm start &
          npx wait-on http://127.0.0.1:3000/health

      - name: Run DevGuard Test Suite
        run: |
          npx --yes @devguard/cli test . \
            --base-url http://127.0.0.1:3000 \
            --html \
            --out devguard-report.html \
            --fail-on warning

      - name: Upload HTML Test Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: devguard-html-report
          path: devguard-report.html
```

---

## 3. GitLab CI Recipe

```yaml
stages:
  - test

devguard_test:
  stage: test
  image: node:22
  before_script:
    - npm install -g @devguard/cli
  script:
    - npm run start &
    - sleep 3
    - devguard test . --base-url http://127.0.0.1:3000 --html --out report.html
  artifacts:
    when: always
    paths:
      - report.html
```
