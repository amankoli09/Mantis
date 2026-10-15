import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  noExternal: ['@mantis/core', '@mantis/adapter-express', '@mantis/runner'],
  external: [
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    'commander',
    'picocolors',
    'undici',
    'zod',
  ],
});
