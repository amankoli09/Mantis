# ADR 0004: FileSystem Abstraction for Express Adapter

## Context

The static analyzer in `@mantis/adapter-express` originally relied directly on Node's `node:fs` module for file walking, existence checking, directory listing, and content reading. This coupled the analyzer strictly to local operating system disk access, preventing its use in:
1. Browser-based interactive playgrounds and WASM-based sandboxes.
2. Fast in-memory unit testing without disk I/O side effects.
3. Virtual file trees (e.g. VS Code virtual workspaces, GitHub web views).

## Decision

We introduced a pluggable `FileSystem` interface in `@mantis/adapter-express/fs.ts`:
- Core methods: `readFile`, `readdir`, `stat`, `lstat`, and `existsSync`.
- Default implementation: `nodeFileSystem` wrapping Node's `fs.promises` and synchronous fallback.
- In-memory implementation: `MemoryFileSystem` mapping path strings to file contents.
- `scanProject` and internal scanners accept an optional `fileSystem?: FileSystem` parameter, defaulting to `nodeFileSystem`.

## Consequences

- The analyzer can scan entirely in-memory file trees with zero disk overhead.
- Direct path for future browser playground integration.
- Full backwards compatibility with existing CLI invocations and test fixtures.
