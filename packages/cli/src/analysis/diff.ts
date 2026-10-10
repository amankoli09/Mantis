import type { ApiModel, Endpoint, Diagnostic, Report, Finding } from '@devguard/core';
import { getColors } from '../ui/color.js';

export interface EndpointDiffItem {
  id: string;
  method: string;
  path: string;
  changes?: {
    auth?: { from: string; to: string };
    effect?: { from: string; to: string };
    params?: { from: number; to: number };
  };
}

export interface ApiModelDiff {
  kind: 'api-model';
  addedEndpoints: EndpointDiffItem[];
  removedEndpoints: EndpointDiffItem[];
  modifiedEndpoints: EndpointDiffItem[];
  addedDiagnostics: Diagnostic[];
  resolvedDiagnostics: Diagnostic[];
}

export interface ReportDiff {
  kind: 'report';
  summaryDelta: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  newFindings: Finding[];
  resolvedFindings: Finding[];
  persistentFindings: Finding[];
}

export function diffApiModels(a: ApiModel, b: ApiModel): ApiModelDiff {
  const mapA = new Map<string, Endpoint>(a.endpoints.map((e) => [e.id, e]));
  const mapB = new Map<string, Endpoint>(b.endpoints.map((e) => [e.id, e]));

  const addedEndpoints: EndpointDiffItem[] = [];
  const removedEndpoints: EndpointDiffItem[] = [];
  const modifiedEndpoints: EndpointDiffItem[] = [];

  for (const [id, epB] of mapB) {
    const epA = mapA.get(id);
    if (!epA) {
      addedEndpoints.push({ id, method: epB.method, path: epB.path });
    } else {
      const authChanged = JSON.stringify(epA.auth) !== JSON.stringify(epB.auth);
      const effectChanged = epA.effect !== epB.effect;
      const paramsChanged = (epA.params?.length ?? 0) !== (epB.params?.length ?? 0);

      if (authChanged || effectChanged || paramsChanged) {
        modifiedEndpoints.push({
          id,
          method: epB.method,
          path: epB.path,
          changes: {
            ...(authChanged ? { auth: { from: epA.auth.type, to: epB.auth.type } } : {}),
            ...(effectChanged ? { effect: { from: epA.effect, to: epB.effect } } : {}),
            ...(paramsChanged
              ? { params: { from: epA.params?.length ?? 0, to: epB.params?.length ?? 0 } }
              : {}),
          },
        });
      }
    }
  }

  for (const [id, epA] of mapA) {
    if (!mapB.has(id)) {
      removedEndpoints.push({ id, method: epA.method, path: epA.path });
    }
  }

  const diagKey = (d: Diagnostic) =>
    `${d.code}:${d.file ?? ''}:${d.line ?? 0}:${d.message}`;
  const diagA = new Set(a.diagnostics.map(diagKey));
  const diagB = new Set(b.diagnostics.map(diagKey));

  const addedDiagnostics = b.diagnostics.filter((d) => !diagA.has(diagKey(d)));
  const resolvedDiagnostics = a.diagnostics.filter((d) => !diagB.has(diagKey(d)));

  return {
    kind: 'api-model',
    addedEndpoints,
    removedEndpoints,
    modifiedEndpoints,
    addedDiagnostics,
    resolvedDiagnostics,
  };
}

export function diffReports(a: Report, b: Report): ReportDiff {
  const summaryDelta = {
    total: b.summary.total - a.summary.total,
    passed: b.summary.passed - a.summary.passed,
    failed: b.summary.failed - a.summary.failed,
    skipped: b.summary.skipped - a.summary.skipped,
  };

  const findingKey = (f: Finding) => `${f.ruleId}:${f.endpointId}:${f.message}`;
  const mapA = new Map(a.findings.map((f) => [findingKey(f), f]));
  const mapB = new Map(b.findings.map((f) => [findingKey(f), f]));

  const newFindings = b.findings.filter((f) => !mapA.has(findingKey(f)));
  const resolvedFindings = a.findings.filter((f) => !mapB.has(findingKey(f)));
  const persistentFindings = b.findings.filter((f) => mapA.has(findingKey(f)));

  return {
    kind: 'report',
    summaryDelta,
    newFindings,
    resolvedFindings,
    persistentFindings,
  };
}

export function formatApiModelDiffTerminal(diff: ApiModelDiff, fileA: string, fileB: string): string {
  const c = getColors();
  const lines: string[] = [];
  lines.push(c.bold(`API Model Comparison: ${fileA} ➔ ${fileB}`));
  lines.push('─'.repeat(60));

  const endpointSummaryParts: string[] = [];
  if (diff.addedEndpoints.length > 0) {
    endpointSummaryParts.push(c.green(`+${diff.addedEndpoints.length} added`));
  }
  if (diff.removedEndpoints.length > 0) {
    endpointSummaryParts.push(c.red(`-${diff.removedEndpoints.length} removed`));
  }
  if (diff.modifiedEndpoints.length > 0) {
    endpointSummaryParts.push(c.yellow(`~${diff.modifiedEndpoints.length} modified`));
  }
  if (endpointSummaryParts.length === 0) {
    endpointSummaryParts.push(c.dim('0 endpoint changes'));
  }

  lines.push(`Endpoints: ${endpointSummaryParts.join(', ')}`);

  for (const ep of diff.addedEndpoints) {
    lines.push(`  ${c.green('+')} ${c.bold(ep.method)} ${ep.path} (${ep.id})`);
  }
  for (const ep of diff.removedEndpoints) {
    lines.push(`  ${c.red('-')} ${c.bold(ep.method)} ${ep.path} (${ep.id})`);
  }
  for (const ep of diff.modifiedEndpoints) {
    lines.push(`  ${c.yellow('~')} ${c.bold(ep.method)} ${ep.path} (${ep.id})`);
    if (ep.changes?.auth) {
      lines.push(
        `      auth: ${c.dim(ep.changes.auth.from)} ➔ ${c.bold(ep.changes.auth.to)}`,
      );
    }
    if (ep.changes?.effect) {
      lines.push(
        `      effect: ${c.dim(ep.changes.effect.from)} ➔ ${c.bold(ep.changes.effect.to)}`,
      );
    }
    if (ep.changes?.params) {
      lines.push(
        `      params count: ${c.dim(String(ep.changes.params.from))} ➔ ${c.bold(String(ep.changes.params.to))}`,
      );
    }
  }

  if (diff.addedDiagnostics.length > 0 || diff.resolvedDiagnostics.length > 0) {
    lines.push('');
    lines.push(c.bold('Diagnostics:'));
    for (const d of diff.addedDiagnostics) {
      lines.push(`  ${c.yellow('+')} [${d.code}] ${d.message} (${d.file ?? ''}:${d.line ?? 0})`);
    }
    for (const d of diff.resolvedDiagnostics) {
      lines.push(`  ${c.green('-')} [${d.code}] Resolved: ${d.message}`);
    }
  }

  return lines.join('\n');
}

export function formatReportDiffTerminal(diff: ReportDiff, fileA: string, fileB: string): string {
  const c = getColors();
  const lines: string[] = [];
  lines.push(c.bold(`Report Comparison: ${fileA} ➔ ${fileB}`));
  lines.push('─'.repeat(60));

  const formatDelta = (val: number) => (val > 0 ? `+${val}` : `${val}`);

  const totalDeltaStr = diff.summaryDelta.total !== 0 ? ` (${formatDelta(diff.summaryDelta.total)})` : '';
  const passedDeltaStr = diff.summaryDelta.passed !== 0 ? ` (${formatDelta(diff.summaryDelta.passed)})` : '';
  const failedDeltaStr = diff.summaryDelta.failed !== 0 ? ` (${formatDelta(diff.summaryDelta.failed)})` : '';
  const skippedDeltaStr = diff.summaryDelta.skipped !== 0 ? ` (${formatDelta(diff.summaryDelta.skipped)})` : '';

  lines.push(
    `Summary: Total ${totalDeltaStr} | Passed ${c.green(passedDeltaStr)} | Failed ${c.red(failedDeltaStr)} | Skipped ${c.yellow(skippedDeltaStr)}`,
  );

  lines.push(
    `Findings: ${c.red(`${diff.newFindings.length} new`)}, ${c.green(`${diff.resolvedFindings.length} resolved`)}, ${diff.persistentFindings.length} persistent`,
  );

  if (diff.newFindings.length > 0) {
    lines.push('');
    lines.push(c.bold(c.red('New Findings:')));
    for (const f of diff.newFindings) {
      lines.push(`  ${c.red('+')} [${f.ruleId}] ${c.bold(f.endpointId)}: ${f.message}`);
    }
  }

  if (diff.resolvedFindings.length > 0) {
    lines.push('');
    lines.push(c.bold(c.green('Resolved Findings:')));
    for (const f of diff.resolvedFindings) {
      lines.push(`  ${c.green('-')} [${f.ruleId}] ${c.bold(f.endpointId)}: ${f.message}`);
    }
  }

  return lines.join('\n');
}
