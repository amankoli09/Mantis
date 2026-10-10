import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { promises as fs } from 'node:fs';
import { scanProject } from '@devguard/adapter-express';
import {
  type RunnerConfig,
  type AllowedEffect,
  type Report,
  type Session,
  planTests,
  runTests,
} from '@devguard/core';
import { loadConfig, validateBaseUrl, createTestRunner, saveSession } from '@devguard/runner';
import { formatTestTerminal, formatTestBanner } from '../ui/formatters.js';

export interface TestCliOptions {
  config?: string;
  baseUrl?: string;
  dryRun?: boolean;
  allowWrite?: boolean;
  allowDestructive?: boolean;
  allowRemote?: boolean;
  yes?: boolean;
  json?: boolean;
  out?: string;
  failOn?: 'error' | 'warning' | 'info';
}

async function promptDestructiveConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      'WARNING: Destructive requests may permanently alter or remove data. Proceed? (yes/no): ',
      (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        resolve(trimmed === 'yes' || trimmed === 'y');
      },
    );
  });
}

/**
 * Executes the `devguard test [path]` command.
 */
export async function testCommand(
  targetPath?: string,
  options: TestCliOptions = {},
): Promise<number> {
  const resolvedTarget = path.resolve(targetPath ?? '.');

  // 1. Resolve / Load configuration
  let config: RunnerConfig;
  const configCandidate = options.config ?? 'devguard.config.json';
  let candidatePath = path.resolve(configCandidate);

  let hasConfigFile = false;
  try {
    await fs.access(candidatePath);
    hasConfigFile = true;
  } catch {
    if (!options.config && resolvedTarget) {
      const targetConfig = path.resolve(resolvedTarget, 'devguard.config.json');
      try {
        await fs.access(targetConfig);
        candidatePath = targetConfig;
        hasConfigFile = true;
      } catch {
        hasConfigFile = false;
      }
    }
  }

  if (hasConfigFile) {
    try {
      config = await loadConfig(candidatePath);
    } catch (err) {
      console.error(`Error loading configuration: ${(err as Error).message}`);
      return 2;
    }
  } else if (options.baseUrl) {
    config = {
      baseUrl: options.baseUrl,
      allowedEffects: ['read'],
      skip: [],
      pathParamSamples: {},
      limits: {
        timeoutMs: 5000,
        maxResponseBytes: 1048576,
        maxRequests: 50,
        concurrency: 5,
        retries: 0,
      },
      allowRemote: false,
      followRedirects: false,
      probePaths: [],
    };
  } else {
    console.error(
      'Error: No configuration found. Run "devguard init" to create devguard.config.json or specify --base-url <url>.',
    );
    return 2;
  }

  // 2. Apply CLI overrides
  if (options.baseUrl) {
    config.baseUrl = options.baseUrl;
  }
  if (options.allowRemote !== undefined) {
    config.allowRemote = options.allowRemote;
  }

  const effects = new Set<AllowedEffect>(config.allowedEffects);
  if (options.allowWrite) {
    effects.add('write');
  }
  if (options.allowDestructive) {
    effects.add('destructive');
  }
  config.allowedEffects = Array.from(effects);

  // 3. Safety Check: Host Guard
  try {
    validateBaseUrl(config.baseUrl, config.allowRemote);
  } catch (err) {
    console.error(`Host Guard Error: ${(err as Error).message}`);
    return 2;
  }

  // 4. Safety Check: Destructive confirmation
  if (config.allowedEffects.includes('destructive')) {
    const isTty = process.stdout.isTTY ?? false;
    if (!options.yes) {
      if (!isTty) {
        console.error(
          'Error: --allow-destructive in a non-interactive shell requires --yes to confirm execution.',
        );
        return 2;
      }
      const confirmed = await promptDestructiveConfirmation();
      if (!confirmed) {
        console.log('Execution cancelled by user.');
        return 2;
      }
    }
  }

  // 5. Scan project to produce ApiModel
  let model;
  try {
    model = await scanProject(resolvedTarget);
  } catch (err) {
    console.error(`Error scanning target: ${(err as Error).message}`);
    return 2;
  }

  // 6. Plan tests
  const testCases = planTests(model, config);
  const plannedCount = testCases.filter((tc) => !tc.skip).length;
  const skippedCount = testCases.filter((tc) => tc.skip).length;

  const banner = {
    targetUrl: config.baseUrl,
    allowedEffects: config.allowedEffects,
    planned: plannedCount,
    skipped: skippedCount,
  };

  // 7. Dry-Run Mode (0 HTTP requests sent)
  if (options.dryRun) {
    if (options.json) {
      const output = JSON.stringify({ banner, testCases }, null, 2);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), output, 'utf-8');
      } else {
        console.log(output);
      }
      return 0;
    }

    console.log(formatTestBanner(banner));
    console.log('\nDry-run mode: planned test cases (0 network requests executed):');
    for (const tc of testCases) {
      const prefix = tc.skip ? '[SKIP]' : '[PLAN]';
      const reason = tc.skip ? ` (${tc.skip.code})` : '';
      console.log(`  ${prefix} ${tc.id}${reason}`);
    }
    return 0;
  }

  // 8. Live Execution
  const runner = createTestRunner(config);
  const report: Report = await runTests({ model, config, runner });

  // 9. Save session recording
  const session: Session = {
    meta: {
      sessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      durationMs: report.meta?.durationMs ?? 0,
      targetBaseUrl: config.baseUrl,
      toolVersion: '0.1.0',
    },
    config,
    requests: report.results
      .filter((r) => r.status !== 'skipped')
      .map((r) => ({
        endpointId: r.endpointId,
        request: r.request,
        response: r.response,
        error: r.error ? { kind: 'other', message: r.error } : undefined,
        durationMs: 0,
      })),
    skips: report.results
      .filter((r) => r.status === 'skipped' && r.skipReason)
      .map((r) => r.skipReason!),
  };

  try {
    await saveSession(session, '.devguard/sessions');
  } catch {
    // Non-fatal if session saving fails
  }

  // 10. Print / Write Report Output
  if (options.json) {
    const jsonOutput = JSON.stringify(report, null, 2);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), jsonOutput, 'utf-8');
      console.log(`Report written to ${options.out}`);
    } else {
      console.log(jsonOutput);
    }
  } else {
    const formatted = formatTestTerminal(report, banner);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), formatted, 'utf-8');
      console.log(`Report written to ${options.out}`);
    } else {
      console.log(formatted);
    }
  }

  // 11. Exit code evaluation
  const failOn = options.failOn;
  if (failOn) {
    const severities =
      failOn === 'info'
        ? ['info', 'warning', 'error']
        : failOn === 'warning'
          ? ['warning', 'error']
          : ['error'];
    const hasThresholdFindings = report.findings.some((f) => severities.includes(f.severity));
    return hasThresholdFindings || report.summary.failed > 0 ? 1 : 0;
  }

  return report.summary.failed > 0 || report.findings.length > 0 ? 1 : 0;
}
