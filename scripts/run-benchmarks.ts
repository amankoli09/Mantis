import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { scanProject } from '../packages/adapter-express/src/index.js';

interface TruthEndpoint {
  method: string;
  path: string;
}

interface BenchmarkTruth {
  name: string;
  url: string;
  commit: string;
  license: string;
  style: string;
  endpoints: TruthEndpoint[];
}

interface BenchmarkResult {
  name: string;
  url: string;
  commit: string;
  style: string;
  license: string;
  truthCount: number;
  foundCount: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  uncertainCount: number;
  diagnosticsCount: number;
}

const BENCHMARKS: string[] = [
  'node-todo',
  'express-mongoose-es6-rest-api',
  'express-rest-es2017-boilerplate',
  'node-express-boilerplate',
  'realworld',
];

function normalizePath(p: string): string {
  let cleaned = p.trim();
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

function endpointKey(method: string, pathStr: string): string {
  return `${method.toUpperCase()} ${normalizePath(pathStr)}`;
}

async function ensureRepo(truth: BenchmarkTruth, clonesDir: string): Promise<string> {
  const targetDir = path.join(clonesDir, truth.name);
  try {
    await fs.access(path.join(targetDir, '.git'));
    return targetDir;
  } catch {
    console.log(`Cloning ${truth.name} (${truth.url})...`);
    await fs.mkdir(clonesDir, { recursive: true });
    execSync(`git clone --depth 1 ${truth.url} "${targetDir}"`, { stdio: 'inherit' });
    return targetDir;
  }
}

export async function runBenchmarks(): Promise<BenchmarkResult[]> {
  const projectRoot = process.cwd();
  const benchmarksDir = path.join(projectRoot, 'benchmarks');
  const clonesDir = path.join(benchmarksDir, '.clones');

  const results: BenchmarkResult[] = [];

  for (const name of BENCHMARKS) {
    const truthFile = path.join(benchmarksDir, name, 'truth.json');
    const rawTruth = await fs.readFile(truthFile, 'utf-8');
    const truth: BenchmarkTruth = JSON.parse(rawTruth);

    const repoPath = await ensureRepo(truth, clonesDir);

    console.log(`Scanning ${truth.name}...`);
    const model = await scanProject(repoPath);

    const truthSet = new Set(truth.endpoints.map((e) => endpointKey(e.method, e.path)));
    const foundSet = new Set(model.endpoints.map((e) => endpointKey(e.method, e.path)));

    let tp = 0;
    let fp = 0;
    for (const found of foundSet) {
      if (truthSet.has(found)) {
        tp++;
      } else {
        fp++;
      }
    }

    let fn = 0;
    for (const expected of truthSet) {
      if (!foundSet.has(expected)) {
        fn++;
      }
    }

    const precision = foundSet.size > 0 ? (tp / foundSet.size) * 100 : 100;
    const recall = truthSet.size > 0 ? (tp / truthSet.size) * 100 : 0;
    const uncertainCount = model.endpoints.filter((e) => e.confidence === 'uncertain').length;
    const diagnosticsCount = model.diagnostics.length;

    results.push({
      name: truth.name,
      url: truth.url,
      commit: truth.commit.slice(0, 7),
      style: truth.style,
      license: truth.license,
      truthCount: truth.endpoints.length,
      foundCount: model.endpoints.length,
      tp,
      fp,
      fn,
      precision,
      recall,
      uncertainCount,
      diagnosticsCount,
    });
  }

  return results;
}

export function formatResultsTable(results: BenchmarkResult[]): string {
  let totalTruth = 0;
  let totalFound = 0;
  let totalTp = 0;
  let totalUncertain = 0;
  let totalDiagnostics = 0;

  for (const r of results) {
    totalTruth += r.truthCount;
    totalFound += r.foundCount;
    totalTp += r.tp;
    totalUncertain += r.uncertainCount;
    totalDiagnostics += r.diagnosticsCount;
  }

  const overallPrecision = totalFound > 0 ? ((totalTp / totalFound) * 100).toFixed(1) : '100.0';
  const overallRecall = totalTruth > 0 ? ((totalTp / totalTruth) * 100).toFixed(1) : '0.0';

  const rows: string[] = [];
  rows.push('| Repository | Style | License | Truth | Found | Precision | Recall | Uncertain | Diagnostics |');
  rows.push('|---|---|---|---:|---:|---:|---:|---:|---:|');

  for (const r of results) {
    const pStr = `${r.precision.toFixed(1)}%`;
    const recStr = `${r.recall.toFixed(1)}%`;
    rows.push(
      `| [${r.name}](${r.url}) (${r.commit}) | ${r.style} | ${r.license} | ${r.truthCount} | ${r.foundCount} | ${pStr} | ${recStr} | ${r.uncertainCount} | ${r.diagnosticsCount} |`
    );
  }

  rows.push(
    `| **Total / Overall** | **5 Repositories** | — | **${totalTruth}** | **${totalFound}** | **${overallPrecision}%** | **${overallRecall}%** | **${totalUncertain}** | **${totalDiagnostics}** |`
  );

  return rows.join('\n');
}

async function main() {
  const results = await runBenchmarks();
  const table = formatResultsTable(results);
  console.log('\n--- Benchmark Results Table ---\n');
  console.log(table);
  console.log('\n');

  const mdReport = `## Real-World Open-Source Express Benchmarks\n\n${table}\n`;
  await fs.writeFile(path.join(process.cwd(), 'benchmarks/RESULTS.md'), mdReport, 'utf-8');
}

if (process.argv[1]?.includes('run-benchmarks')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
