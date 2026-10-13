import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  type Session,
  type Finding,
  type TestCase,
  type Report,
  validateReport,
  BUILTIN_ORACLES,
} from '@mantis/core';
import { loadSession } from '@mantis/runner';
import { formatSessionTerminal, formatTestTerminal } from '../ui/formatters.js';
import { generateHtmlReport } from '../ui/html-report.js';

export interface ReportCliOptions {
  json?: boolean;
  html?: boolean;
  out?: string;
}

async function findLatestSession(sessionsDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
    if (jsonFiles.length === 0) return null;

    let latestFile: string | null = null;
    let latestMtime = 0;

    for (const f of jsonFiles) {
      const fullPath = path.join(sessionsDir, f.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = fullPath;
      }
    }

    return latestFile;
  } catch {
    return null;
  }
}

/**
 * Executes the `mantis report [session|report.json]` command.
 * Re-renders recorded test session findings or existing report with zero network traffic.
 */
export async function reportCommand(
  targetArg?: string,
  options: ReportCliOptions = {},
): Promise<number> {
  const sessionsDir = path.resolve('.mantis/sessions');

  let filePath: string;
  if (targetArg) {
    if (targetArg.endsWith('.json') || targetArg.includes(path.sep)) {
      filePath = path.resolve(targetArg);
    } else {
      filePath = path.join(sessionsDir, `${targetArg}.json`);
    }
  } else {
    const latest = await findLatestSession(sessionsDir);
    if (!latest) {
      console.error(
        'Error: No recorded sessions found in ".mantis/sessions/". Run "mantis test" first.',
      );
      return 2;
    }
    filePath = latest;
  }

  let rawContent: string;
  try {
    rawContent = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    console.error(`Error loading session file: ${(err as Error).message}`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(`Error parsing JSON: ${(err as Error).message}`);
    return 2;
  }

  // Check if target is a Report file (contains reportVersion)
  const reportValidation = validateReport(parsed);
  if (reportValidation.success && reportValidation.data) {
    const report = reportValidation.data;
    if (options.html) {
      const htmlOutput = generateHtmlReport(report);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), htmlOutput, 'utf-8');
        console.log(`Report written to ${options.out}`);
      } else {
        console.log(htmlOutput);
      }
    } else if (options.json) {
      const jsonOutput = JSON.stringify(report, null, 2);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), jsonOutput, 'utf-8');
        console.log(`Report written to ${options.out}`);
      } else {
        console.log(jsonOutput);
      }
    } else {
      const formatted = formatTestTerminal(report);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), formatted, 'utf-8');
        console.log(`Report written to ${options.out}`);
      } else {
        console.log(formatted);
      }
    }

    return report.summary.failed > 0 || report.findings.length > 0 ? 1 : 0;
  }

  // Otherwise, treat as Session
  let session: Session;
  try {
    session = await loadSession(filePath);
  } catch (err) {
    console.error(`Error loading session file: ${(err as Error).message}`);
    return 2;
  }

  // Re-judge session requests using pure Oracles (0 network traffic)
  const findings: Finding[] = [];
  for (const exec of session.requests) {
    const fakeTestCase: TestCase = {
      id: `${exec.endpointId}::replay`,
      endpointId: exec.endpointId,
      generatorId: 'session-replay',
      description: `Replay of ${exec.endpointId}`,
      expectedBehavior: 'should-accept',
      request: exec.request,
    };

    const fakeEndpoint = {
      id: exec.endpointId,
      method: exec.request.method,
      path: new URL(exec.request.url).pathname,
      effect: exec.request.effect,
      confidence: 'confirmed' as const,
      auth: { type: 'unknown' as const },
      params: [],
      responses: [],
      middleware: [],
      provenance: { kind: 'literal' as const, filePath: 'session.json', line: 1 },
    };

    for (const oracle of BUILTIN_ORACLES) {
      const result = oracle.judge(fakeTestCase, exec, fakeEndpoint);
      findings.push(...result);
    }
  }

  const report: Report = {
    reportVersion: '1.0.0',
    summary: {
      total: session.requests.length,
      passed: session.requests.filter(
        (r) => !((r.response?.status && r.response.status >= 500) || r.error),
      ).length,
      failed: session.requests.filter(
        (r) => (r.response?.status && r.response.status >= 500) || r.error,
      ).length,
      skipped: session.skips.length,
    },
    findings,
    results: session.requests.map((r, i) => ({
      testId: `session-${i + 1}`,
      endpointId: r.endpointId,
      generatorId: 'session-replay',
      status: (r.response?.status && r.response.status >= 500) || r.error ? 'failed' : 'passed',
      request: r.request,
      response: r.response,
      error: r.error?.message,
    })),
    meta: {
      generatedAt: session.meta.createdAt,
      durationMs: session.meta.durationMs,
    },
  };

  if (options.html) {
    const htmlOutput = generateHtmlReport(report);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), htmlOutput, 'utf-8');
      console.log(`Report written to ${options.out}`);
    } else {
      console.log(htmlOutput);
    }
  } else if (options.json) {
    const output = JSON.stringify({ session, findings }, null, 2);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), output, 'utf-8');
      console.log(`Report written to ${options.out}`);
    } else {
      console.log(output);
    }
  } else {
    const formatted = formatSessionTerminal(session, findings);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), formatted, 'utf-8');
      console.log(`Report written to ${options.out}`);
    } else {
      console.log(formatted);
    }
  }

  const hasFailures =
    session.requests.some((r) => (r.response?.status && r.response.status >= 500) || r.error) ||
    findings.length > 0;
  return hasFailures ? 1 : 0;
}
