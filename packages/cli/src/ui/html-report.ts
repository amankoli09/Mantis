import type { Report, Finding, TestResult } from '@devguard/core';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateHtmlReport(report: Report): string {
  const generatedAt = report.meta?.generatedAt || new Date().toISOString();
  const duration = report.meta?.durationMs ? `${(report.meta.durationMs / 1000).toFixed(2)}s` : 'N/A';
  const passRate =
    report.summary.total > 0
      ? Math.round((report.summary.passed / report.summary.total) * 100)
      : 100;

  const findingsRows = report.findings
    .map((f: Finding, idx: number) => {
      const sevClass = f.severity === 'error' ? 'sev-error' : f.severity === 'warning' ? 'sev-warn' : 'sev-info';
      const confClass = f.confidence === 'high' ? 'conf-high' : f.confidence === 'medium' ? 'conf-med' : 'conf-low';
      const reqSnippet = f.evidence?.request
        ? `${f.evidence.request.method} ${f.evidence.request.path}\n${f.evidence.request.body ? `Body: ${f.evidence.request.body}` : ''}`
        : 'N/A';
      const resSnippet = f.evidence?.response
        ? `Status: ${f.evidence.response.status ?? 'N/A'}\n${f.evidence.response.bodySnippet ? `Body: ${f.evidence.response.bodySnippet}` : ''}`
        : 'N/A';

      return `
      <tr class="finding-row">
        <td><span class="badge ${sevClass}">${escapeHtml(f.severity.toUpperCase())}</span></td>
        <td><code>${escapeHtml(f.ruleId)}</code></td>
        <td><code>${escapeHtml(f.endpointId)}</code></td>
        <td>${escapeHtml(f.message)}</td>
        <td><span class="badge ${confClass}">${escapeHtml(f.confidence)}</span></td>
        <td><span class="source-link">${escapeHtml(f.source.file)}:${f.source.line}</span></td>
        <td>
          <button class="details-btn" onclick="toggleDetails('f-det-${idx}')">Evidence</button>
        </td>
      </tr>
      <tr id="f-det-${idx}" class="details-row" style="display: none;">
        <td colspan="7">
          <div class="evidence-box">
            <div class="evidence-col">
              <strong>Request</strong>
              <pre><code>${escapeHtml(reqSnippet.trim())}</code></pre>
            </div>
            <div class="evidence-col">
              <strong>Response</strong>
              <pre><code>${escapeHtml(resSnippet.trim())}</code></pre>
            </div>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const resultsRows = report.results
    .map((r: TestResult) => {
      const statusClass = r.status === 'passed' ? 'status-pass' : r.status === 'failed' ? 'status-fail' : 'status-skip';
      const errorText = r.error ? `<div class="result-error">${escapeHtml(r.error)}</div>` : '';
      const skipText = r.skipReason ? `<div class="result-skip">Reason: ${escapeHtml(r.skipReason.message)}</div>` : '';

      return `
      <tr class="result-row" data-status="${r.status}">
        <td><span class="badge ${statusClass}">${escapeHtml(r.status.toUpperCase())}</span></td>
        <td><code>${escapeHtml(r.testId)}</code></td>
        <td><code>${escapeHtml(r.endpointId)}</code></td>
        <td><code>${escapeHtml(r.generatorId)}</code></td>
        <td>${r.response?.status ?? 'N/A'}</td>
        <td>${errorText}${skipText || 'OK'}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevGuard Test Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #06b6d4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    .logo { font-size: 1.75rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 0.5rem; }
    .meta-info { font-size: 0.875rem; color: var(--text-muted); text-align: right; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .card-title { font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 2rem; font-weight: 700; }
    .val-pass { color: var(--success); }
    .val-fail { color: var(--danger); }
    .val-skip { color: var(--warning); }
    .val-rate { color: var(--primary); }
    
    h2 { font-size: 1.25rem; margin-bottom: 1rem; color: var(--text); display: flex; align-items: center; justify-content: space-between; }
    .section { margin-bottom: 2.5rem; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      font-size: 0.875rem;
    }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: rgba(0, 0, 0, 0.2); color: var(--text-muted); font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .sev-error, .status-fail { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .sev-warn, .status-skip { background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid var(--warning); }
    .sev-info { background: rgba(6, 182, 212, 0.2); color: var(--info); border: 1px solid var(--info); }
    .status-pass { background: rgba(34, 197, 94, 0.2); color: var(--success); border: 1px solid var(--success); }
    
    .conf-high { background: rgba(34, 197, 94, 0.15); color: var(--success); }
    .conf-med { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
    .conf-low { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); }
    
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: rgba(0, 0, 0, 0.25); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.85em; }
    .source-link { color: var(--primary); }
    .details-btn {
      background: #334155;
      color: var(--text);
      border: none;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .details-btn:hover { background: #475569; }
    .evidence-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      padding: 1rem;
      background: #0f172a;
      border-radius: 6px;
      margin: 0.5rem 0;
    }
    .evidence-col strong { display: block; margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; }
    pre { background: #1e293b; padding: 0.75rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; color: #cbd5e1; }
    
    .filter-group { display: flex; gap: 0.5rem; }
    .filter-btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .filter-btn.active, .filter-btn:hover { color: var(--text); border-color: var(--primary); }
    .empty-state { padding: 2rem; text-align: center; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="logo">🛡️ DevGuard</div>
        <p style="color: var(--text-muted); font-size: 0.9rem;">API Security & Behavioral Test Report</p>
      </div>
      <div class="meta-info">
        <div><strong>Generated:</strong> ${escapeHtml(generatedAt)}</div>
        <div><strong>Duration:</strong> ${escapeHtml(duration)}</div>
        <div><strong>Report Version:</strong> ${escapeHtml(report.reportVersion)}</div>
      </div>
    </header>

    <div class="summary-grid">
      <div class="card">
        <div class="card-title">Total Tests</div>
        <div class="card-value">${report.summary.total}</div>
      </div>
      <div class="card">
        <div class="card-title">Passed</div>
        <div class="card-value val-pass">${report.summary.passed}</div>
      </div>
      <div class="card">
        <div class="card-title">Failed</div>
        <div class="card-value val-fail">${report.summary.failed}</div>
      </div>
      <div class="card">
        <div class="card-title">Skipped</div>
        <div class="card-value val-skip">${report.summary.skipped}</div>
      </div>
      <div class="card">
        <div class="card-title">Pass Rate</div>
        <div class="card-value val-rate">${passRate}%</div>
      </div>
    </div>

    <div class="section">
      <h2>
        <span>Findings (${report.findings.length})</span>
      </h2>
      ${
        report.findings.length === 0
          ? '<div class="card empty-state">🎉 No security or consistency findings detected!</div>'
          : `<table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Rule ID</th>
                  <th>Endpoint</th>
                  <th>Message</th>
                  <th>Confidence</th>
                  <th>Source</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                ${findingsRows}
              </tbody>
            </table>`
      }
    </div>

    <div class="section">
      <h2>
        <span>Execution Results (${report.results.length})</span>
        <div class="filter-group">
          <button class="filter-btn active" onclick="filterResults('all')">All</button>
          <button class="filter-btn" onclick="filterResults('passed')">Passed</button>
          <button class="filter-btn" onclick="filterResults('failed')">Failed</button>
          <button class="filter-btn" onclick="filterResults('skipped')">Skipped</button>
        </div>
      </h2>
      ${
        report.results.length === 0
          ? '<div class="card empty-state">No test results recorded.</div>'
          : `<table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Test ID</th>
                  <th>Endpoint</th>
                  <th>Generator</th>
                  <th>HTTP Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody id="results-tbody">
                ${resultsRows}
              </tbody>
            </table>`
      }
    </div>
  </div>

  <script>
    function toggleDetails(id) {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
      }
    }

    function filterResults(status) {
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      const rows = document.querySelectorAll('.result-row');
      rows.forEach(row => {
        if (status === 'all' || row.getAttribute('data-status') === status) {
          row.style.display = 'table-row';
        } else {
          row.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}
