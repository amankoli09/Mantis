import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude git worktrees managed by Kilo Code and any generated/vendor dirs.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.kilo/**',
      '**/coverage/**',
      '**/benchmarks/**',
    ],
  },
});
