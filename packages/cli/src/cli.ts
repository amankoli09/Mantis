import { Command } from 'commander';
import { setNoColor } from './ui/color.js';
import { scanCommand } from './commands/scan.js';
import { testCommand } from './commands/test.js';
import { reportCommand } from './commands/report.js';
import { initCommand } from './commands/init.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('devguard')
    .description(
      'DevGuard — Evidence-backed API Model extractor and safety-first runtime test engine',
    )
    .version('0.1.0')
    .option('--no-color', 'Disable colored terminal output')
    .option('--debug', 'Print stack traces on internal errors')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.color === false) {
        setNoColor(true);
      }
    });

  program
    .command('scan')
    .description('Statically scan an Express codebase and produce an ApiModel')
    .argument('<path>', 'Path to backend application root directory')
    .option('--json', 'Output raw ApiModel JSON')
    .option('--out <file>', 'Write output to file')
    .option('--verbose', 'Show detailed parameter types and provenances')
    .action(async (targetPath: string, options) => {
      const exitCode = await scanCommand(targetPath, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  program
    .command('test')
    .description('Execute safe runtime tests against target API')
    .argument('[path]', 'Path to backend application root directory', '.')
    .option('--config <file>', 'Path to devguard.config.json')
    .option('--base-url <url>', 'Override target API base URL')
    .option('--dry-run', 'Generate test plan and exit without sending HTTP requests')
    .option('--allow-write', 'Permit write mutation effects')
    .option('--allow-destructive', 'Permit destructive mutation effects (DELETE)')
    .option('--allow-remote', 'Allow testing non-local URLs')
    .option('--yes', 'Confirm destructive executions without prompting')
    .option('--json', 'Output Report JSON')
    .option('--out <file>', 'Write output to file')
    .option('--fail-on <severity>', 'Fail exit threshold (error, warning, info)')
    .action(async (targetPath: string, options) => {
      const exitCode = await testCommand(targetPath, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  program
    .command('report')
    .description('Re-render a recorded test session without network traffic')
    .argument('[session]', 'Session ID or path to recorded session JSON file')
    .option('--json', 'Output Report JSON')
    .option('--out <file>', 'Write output to file')
    .action(async (sessionArg: string | undefined, options) => {
      const exitCode = await reportCommand(sessionArg, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  program
    .command('init')
    .description('Generate starter devguard.config.json configuration')
    .option('--out <file>', 'Custom configuration output file path')
    .action(async (options) => {
      const exitCode = await initCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  if (argv.includes('--no-color')) {
    setNoColor(true);
  }

  const program = createCli();

  // Exit overrides to prevent commander from calling process.exit directly during tests
  function applyExitOverride(cmd: Command) {
    cmd.exitOverride();
    for (const sub of cmd.commands) {
      applyExitOverride(sub);
    }
  }
  applyExitOverride(program);

  try {
    process.exitCode = undefined;
    await program.parseAsync(argv);
    const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
    process.exitCode = undefined;
    return code;
  } catch (err: unknown) {
    process.exitCode = undefined;
    if (err && typeof err === 'object' && 'exitCode' in err) {
      const code = (err as { exitCode: number }).exitCode;
      if (code === 0) return 0;
      return 2;
    }
    const isDebug = argv.includes('--debug');
    console.error(
      `Internal Error: ${err instanceof Error ? (isDebug ? err.stack : err.message) : String(err)}`,
    );
    return 3;
  }
}
