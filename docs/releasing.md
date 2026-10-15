# Releasing Mantis

This document details the packaging model, automated verification, and the owner's manual release procedure for publishing the public `mantis` package to npm.

---

## 1. Packaging Architecture (ADR 0009)

Mantis is organized as a monorepo containing multiple modular packages:
- `packages/core`: Schemas, pure response oracles, test generators, cross-analysis engine (Private).
- `packages/adapter-express`: Static AST analysis, Express route detection, parameter and effect inference (Private).
- `packages/runner`: Hardened HTTP runner, Host Guard, and session recorder (Private).
- `packages/cli`: Single public package distributed as `mantis` (or `@mantis/cli`) on npm.

### Key Invariants:
1. **Self-Contained Distribution**: `packages/cli` bundles internal workspace packages (`@mantis/core`, `@mantis/adapter-express`, `@mantis/runner`) using `tsup` into dual ESM (`dist/index.js`) and CJS (`dist/index.cjs`) formats.
2. **Lean Dependencies**: Consumers only install lightweight runtime dependencies (`commander`, `picocolors`, `@babel/*`, `undici`, `zod`). No internal workspace packages are exposed to npm.
3. **Strict Whitelist**: Packed tarball includes only `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, and `package.json`.
4. **Size Budget**: Compressed tarball size is budgeted at `< 350 KB` (currently ~113 KB); unpacked size `< 1.5 MB` (currently ~598 KB).
5. **Universal Compatibility**: Verified via `publint` and `@arethetypeswrong/cli` across Node 10, Node 16 CJS/ESM, and modern bundlers.

---

## 2. Automated Validation (`pnpm pack:smoke`)

Before any release, the smoke test must pass:

```bash
pnpm pack:smoke
```

This automated script:
1. Builds packages with production targets and removes sourcemaps.
2. Generates an `npm pack` tarball in an isolated directory.
3. Enforces the content whitelist and fails on any forbidden files (`fixtures/`, `benchmarks/`, `.mantis/`, `.env*`, `src/`, `tests/`).
4. Enforces the `< 350 KB` size budget.
5. Installs the packed tarball into a clean dummy project and executes:
   - `npx mantis --help`
   - `npx mantis scan .` on a sample Express application.
6. Runs `publint` and `@arethetypeswrong/cli` against the tarball.

---

## 3. Owner's Manual Publish Checklist (Later)

Follow this checklist when you are ready to publish the first public alpha release to the npm registry:

### Step 1: Pre-Publish Verification
- [ ] Ensure all CI checks and `pnpm pack:smoke` are passing on `main`.
- [ ] Confirm the npm package name is free or owned by your account:
  ```bash
  npm view mantis
  # Or if publishing under a scoped name:
  npm view @mantis/cli
  ```
- [ ] Ensure 2FA (Two-Factor Authentication) is enabled on your npm account.
- [ ] Generate a Granular Access Token with **Publish** permissions for the package.

### Step 2: Local Pack & Dry-Run
- [ ] Build and pack locally:
  ```bash
  pnpm build
  pnpm pack:smoke
  ```
- [ ] Run dry-run publish with provenance:
  ```bash
  cd packages/cli
  npm publish --dry-run --provenance --tag alpha --access public
  ```

### Step 3: Public Release
- [ ] Log in to npm:
  ```bash
  npm login
  ```
- [ ] Publish the package to npm:
  ```bash
  cd packages/cli
  npm publish --tag alpha --access public --provenance
  ```

### Step 4: Post-Publish Stranger Verification
- [ ] Open a clean terminal in an empty directory:
  ```bash
  cd $(mktemp -d)
  npx mantis@alpha --help
  ```
- [ ] Verify command exit code is `0` and help output prints correctly.
- [ ] Update the landing page install block (in `frontend/src/components/InstallBlock.tsx` and `README.md`) on the same day to reflect the active `npm install -g mantis@alpha` / `npx mantis` command.
