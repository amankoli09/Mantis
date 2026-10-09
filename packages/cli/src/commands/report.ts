import path from 'node:path';
import { promises as fs } from 'node:fs';
import { type Session, type Finding, type TestCase, BUILTIN_ORACLES } from '@devguard/core';
import { loadSession } from '@devguard/runner';
import { formatSessionTerminal } from '../ui/formatters.js';

export interface ReportCliOptions {
  json?: boolean;
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
 * Executes the `devguard report [session]` command.
 * Re-renders recorded test session findings with zero network traffic.
 */
export async function reportCommand(
  sessionArg?: string,
  options: ReportCliOptions = {},
): Promise<number> {
  const sessionsDir = path.resolve('.devguard/sessions');

  let sessionPath: string;
  if (sessionArg) {
    if (sessionArg.endsWith('.json') || sessionArg.includes(path.sep)) {
      sessionPath = path.resolve(sessionArg);
    } else {
      sessionPath = path.join(sessionsDir, `${sessionArg}.json`);
    }
  } else {
    const latest = await findLatestSession(sessionsDir);
    if (!latest) {
      console.error(
        'Error: No recorded sessions found in ".devguard/sessions/". Run "devguard test" first.',
      );
      return 2;
    }
    sessionPath = latest;
  }

  let session: Session;
  try {
    session = await loadSession(sessionPath);
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

  if (options.json) {
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
