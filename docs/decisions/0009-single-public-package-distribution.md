# ADR 0009: Single Public Package Distribution (`mantis`) and Monorepo Packaging

## Context

Mantis is authored as a modular TypeScript monorepo consisting of `@mantis/core`, `@mantis/adapter-express`, `@mantis/runner`, and `@mantis/cli`. 

Multi-package publishing (publishing 4 separate npm packages simultaneously) introduces significant overhead:
1. Version synchronization conflicts and dependency skew for consumers.
2. Phantom dependency and peer-dependency installation failures in diverse user package managers (npm, pnpm, yarn, bun).
3. Risk of exposing unstable internal interfaces before long-term stabilization.
4. Unnecessary package installation bloat and supply-chain surface area for users who simply want the CLI binary and test engine.

## Decision

1. **Single Public Package Distribution**:
   - The CLI package (`packages/cli`) is designated as the sole public package distributed to npm as `mantis` (version `0.1.0-alpha.0`).
   - Internal packages (`@mantis/core`, `@mantis/adapter-express`, `@mantis/runner`) and the web application (`frontend`) are marked `"private": true` and are never published independently to the registry.

2. **Self-Contained Bundling via tsup**:
   - `tsup` bundles internal workspace code (`@mantis/core`, `@mantis/adapter-express`, `@mantis/runner`) directly into the distributed CLI bundles (`dist/index.js` ESM and `dist/index.cjs` CJS).
   - Only standard external dependencies (`commander`, `picocolors`, `@babel/*`, `undici`, `zod`) are listed in `dependencies`.

3. **Strict Whitelist & Size Budget**:
   - The npm package whitelists only `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, and `package.json`.
   - Production builds omit sourcemaps to enforce a strict `< 350 KB` compressed tarball budget (achieving ~113 KB compressed, ~598 KB unpacked).
   - Automated pack smoke testing (`pnpm pack:smoke`) guards against accidental inclusion of fixtures, benchmarks, source files, or tests.

4. **Standards-Compliant Dual Exports & Types**:
   - Configures dual ESM/CJS exports with `types` ordered first for maximum compatibility across Node 10, Node 16 CJS, Node 16 ESM, and modern bundlers, verified clean via `publint` and `@arethetypeswrong/cli`.

## Consequences

- Frictionless user onboarding: developers and CI environments install a single package (`npx mantis` or `npm install -g mantis`).
- Zero monorepo linking or peer-dependency errors for end users.
- Fast download times and reduced attack surface.
- Internal refactoring between core, runner, and adapter packages can occur freely without triggering breaking changes on npm.
