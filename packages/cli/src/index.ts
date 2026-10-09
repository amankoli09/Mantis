import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli.js';

export const PACKAGE_NAME = '@devguard/cli';

export * from './ui/color.js';
export * from './ui/formatters.js';
export * from './commands/scan.js';
export * from './commands/test.js';
export * from './commands/report.js';
export * from './commands/init.js';
export * from './cli.js';

// Determine if this file is the execution entrypoint
function checkIsEntrypoint(): boolean {
  if (!process.argv[1] || process.env.VITEST) return false;
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    if (path.resolve(process.argv[1]) === currentFilePath) {
      return true;
    }
  } catch {
    // Ignore URL parse error
  }
  const binName = path.basename(process.argv[1]);
  return binName === 'devguard' || (binName === 'index.js' && process.argv[1].includes('cli'));
}

if (checkIsEntrypoint()) {
  runCli(process.argv).then((code) => {
    process.exit(code);
  });
}
