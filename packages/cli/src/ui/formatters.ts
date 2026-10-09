import type { ApiModel, Report, Session, Finding } from '@devguard/core';
import { getColors } from './color.js';

export function formatScanTerminal(model: ApiModel, options: { verbose?: boolean } = {}): string {
  const c = getColors();
  const lines: string[] = [];

  lines.push(c.bold('DevGuard Scanner'));
  const lang = model.project?.language ?? 'javascript';
  const root = model.project?.root ?? '.';
  lines.push(`${c.dim('Framework:')} Express (${lang}) | ${c.dim('Root:')} ${root}`);
  lines.push('');

  const confirmed = model.endpoints.filter((e) => e.confidence === 'confirmed').length;
  const uncertain = model.endpoints.filter((e) => e.confidence === 'uncertain').length;

  lines.push(
    c.bold(
      `Endpoints (${model.endpoints.length} discovered: ${c.green(`${confirmed} confirmed`)}, ${
        uncertain > 0 ? c.yellow(`${uncertain} uncertain`) : `${uncertain} uncertain`
      })`,
    ),
  );

  for (const ep of model.endpoints) {
    const isConfirmed = ep.confidence === 'confirmed';
    const marker = isConfirmed ? c.green('✓') : c.yellow('?');
    const method = c.bold(ep.method.padEnd(7));
    const pathStr = ep.path.padEnd(28);
    const sourceLoc = `${ep.provenance.filePath}:${ep.provenance.line}`;

    let extra = '';
    if (!isConfirmed && ep.confidenceReason) {
      extra = ` ${c.yellow(`[${ep.confidenceReason}]`)}`;
    }

    const bodyOrQueryParams = ep.params
      .filter((p) => p.in === 'body' || p.in === 'query')
      .map((p) => (p.in === 'body' ? `req.body.${p.name}` : `req.query.${p.name}`));

    if (bodyOrQueryParams.length > 0) {
      extra += ` ${c.dim(`(reads ${bodyOrQueryParams.join(', ')})`)}`;
    }

    lines.push(`  ${marker} ${method} ${pathStr} ${c.dim(sourceLoc)}${extra}`);

    if (options.verbose && ep.params.length > 0) {
      for (const p of ep.params) {
        const provLoc = p.provenance ? ` at ${p.provenance.filePath}:${p.provenance.line}` : '';
        lines.push(
          `      ${c.dim(
            `- param ${p.name} (in: ${p.in}, type: ${p.type ?? 'unknown'}, required: ${String(
              p.required,
            )})${provLoc}`,
          )}`,
        );
      }
    }
  }

  if (model.diagnostics.length > 0) {
    lines.push('');
    lines.push(c.bold(`Diagnostics (${model.diagnostics.length}):`));
    for (const diag of model.diagnostics) {
      const sevColor =
        diag.severity === 'error' ? c.red : diag.severity === 'warning' ? c.yellow : c.cyan;
      const fileLoc = diag.file ? ` at ${diag.file}:${diag.line ?? 1}` : '';
      lines.push(`  [${diag.code}] ${sevColor(diag.severity)}: ${diag.message}${c.dim(fileLoc)}`);
    }
  }

  return lines.join('\n');
}

export function formatTestBanner(banner: {
  targetUrl: string;
  allowedEffects: string[];
  planned: number;
  skipped: number;
}): string {
  const c = getColors();
  return (
    `${c.dim('Target:')} ${c.cyan(banner.targetUrl)} | ` +
    `${c.dim('Allowed:')} ${banner.allowedEffects.join(', ')} | ` +
    `${c.dim('Planned:')} ${banner.planned} | ` +
    `${c.dim('Skipped:')} ${banner.skipped}`
  );
}

export function formatFinding(f: Finding): string {
  const c = getColors();
  const lines: string[] = [];
  const sevColor = f.severity === 'error' ? c.red : f.severity === 'warning' ? c.yellow : c.cyan;

  lines.push(`[${sevColor(f.severity.toUpperCase())}] ${c.bold(f.ruleId)}: ${f.message}`);
  lines.push(`  ${c.dim('Endpoint:')} ${c.bold(f.endpointId)}`);

  let sourceStr = `${f.source.file}:${f.source.line}`;
  if (f.source.fieldProvenance) {
    sourceStr += ` (field ${f.source.fieldProvenance.name ?? ''} at line ${f.source.fieldProvenance.line})`;
  }
  lines.push(`  ${c.dim('Source:')}   ${sourceStr}`);

  if (f.evidence.request || f.evidence.response) {
    const reqBody = f.evidence.request.body ? ` body: ${f.evidence.request.body}` : '';
    lines.push(`  ${c.dim('Evidence:')}`);
    lines.push(
      `    ${c.dim('Request:')}  ${f.evidence.request.method} ${f.evidence.request.path}${reqBody}`,
    );
    if (f.evidence.response.status !== undefined) {
      const snippet = f.evidence.response.bodySnippet
        ? `  snippet: ${f.evidence.response.bodySnippet}`
        : '';
      lines.push(`    ${c.dim('Response:')} status ${f.evidence.response.status}${snippet}`);
    }
  }

  return lines.join('\n');
}

export function formatTestTerminal(
  report: Report,
  banner?: { targetUrl: string; allowedEffects: string[]; planned: number; skipped: number },
): string {
  const c = getColors();
  const lines: string[] = [];

  if (banner) {
    lines.push(formatTestBanner(banner));
    lines.push('');
  }

  lines.push(c.bold('Executing test cases...'));
  for (const res of report.results) {
    if (res.status === 'passed') {
      const statusText = res.response ? ` (${res.response.status} OK)` : '';
      lines.push(`  ${c.green('✓')} ${res.testId}${c.dim(statusText)}`);
    } else if (res.status === 'failed') {
      const errText = res.response
        ? ` (${res.response.status} Error)`
        : res.error
          ? ` (${res.error})`
          : '';
      lines.push(`  ${c.red('✕')} ${res.testId}${c.red(errText)}`);
    } else {
      const reason = res.skipReason ? ` (Skipped: ${res.skipReason.code})` : ' (Skipped)';
      lines.push(`  ${c.yellow('⚠')} ${res.testId}${c.dim(reason)}`);
    }
  }

  lines.push('');
  lines.push(
    c.bold(
      `Summary: ${report.summary.total} tests | ` +
        `${c.green(`✓ ${report.summary.passed} Passed`)} | ` +
        `${report.summary.failed > 0 ? c.red(`✕ ${report.summary.failed} Failed`) : `✕ ${report.summary.failed} Failed`} | ` +
        `${report.summary.skipped > 0 ? c.yellow(`⚠ ${report.summary.skipped} Skipped`) : `⚠ ${report.summary.skipped} Skipped`}`,
    ),
  );

  if (report.findings.length > 0) {
    lines.push('');
    lines.push(c.bold(`Findings (${report.findings.length}):`));
    for (const f of report.findings) {
      lines.push(formatFinding(f));
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function formatSessionTerminal(session: Session, findings: Finding[]): string {
  const c = getColors();
  const lines: string[] = [];

  lines.push(c.bold('DevGuard Session Replay'));
  lines.push(
    `${c.dim('Session ID:')} ${session.meta.sessionId} | ` +
      `${c.dim('Target:')} ${session.meta.targetBaseUrl} | ` +
      `${c.dim('Created:')} ${session.meta.createdAt}`,
  );
  lines.push('');

  lines.push(c.bold(`Recorded Requests (${session.requests.length}):`));
  for (const req of session.requests) {
    const status = req.response?.status;
    const marker =
      status && status < 400 ? c.green('✓') : status && status >= 500 ? c.red('✕') : c.yellow('•');
    const statusStr = status ? ` [${status}]` : ' [Error]';
    lines.push(
      `  ${marker} ${req.request.method.padEnd(7)} ${req.request.url} ${c.dim(statusStr)}`,
    );
  }

  if (session.skips.length > 0) {
    lines.push('');
    lines.push(c.bold(`Recorded Skips (${session.skips.length}):`));
    for (const s of session.skips) {
      lines.push(`  ${c.yellow('⚠')} [${s.code}] ${s.endpointId}: ${s.message}`);
    }
  }

  if (findings.length > 0) {
    lines.push('');
    lines.push(c.bold(`Evaluated Findings (${findings.length}):`));
    for (const f of findings) {
      lines.push(formatFinding(f));
      lines.push('');
    }
  }

  return lines.join('\n');
}
