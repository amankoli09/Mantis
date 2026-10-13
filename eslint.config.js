import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.kilo/**',
      '**/.next/**',
      '**/*.d.ts',
      // Fixture app files are plain CJS JS (not TypeScript). Exclude them from
      // ESLint so undefined references and fixture code don't cause lint errors.
      'fixtures/**',
      'benchmarks/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
);
