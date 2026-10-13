import path from 'node:path';
import { promises as fs } from 'node:fs';
import { validateModel, validateReport } from '@mantis/core';
import {
  diffApiModels,
  diffReports,
  formatApiModelDiffTerminal,
  formatReportDiffTerminal,
} from '../analysis/diff.js';

export interface DiffCliOptions {
  json?: boolean;
  out?: string;
}

export async function diffCommand(
  fileA: string,
  fileB: string,
  options: DiffCliOptions = {},
): Promise<number> {
  const pathA = path.resolve(fileA);
  const pathB = path.resolve(fileB);

  let rawA: string;
  let rawB: string;

  try {
    rawA = await fs.readFile(pathA, 'utf-8');
  } catch (err) {
    console.error(`Error reading ${fileA}: ${(err as Error).message}`);
    return 2;
  }

  try {
    rawB = await fs.readFile(pathB, 'utf-8');
  } catch (err) {
    console.error(`Error reading ${fileB}: ${(err as Error).message}`);
    return 2;
  }

  let jsonA: unknown;
  let jsonB: unknown;

  try {
    jsonA = JSON.parse(rawA);
  } catch (err) {
    console.error(`Error parsing JSON in ${fileA}: ${(err as Error).message}`);
    return 2;
  }

  try {
    jsonB = JSON.parse(rawB);
  } catch (err) {
    console.error(`Error parsing JSON in ${fileB}: ${(err as Error).message}`);
    return 2;
  }

  const resReportA = validateReport(jsonA);
  const resReportB = validateReport(jsonB);

  if (resReportA.success && resReportB.success && resReportA.data && resReportB.data) {
    const diff = diffReports(resReportA.data, resReportB.data);

    if (options.json) {
      const output = JSON.stringify(diff, null, 2);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), output, 'utf-8');
        console.log(`Diff report written to ${options.out}`);
      } else {
        console.log(output);
      }
    } else {
      const formatted = formatReportDiffTerminal(diff, fileA, fileB);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), formatted, 'utf-8');
        console.log(`Diff report written to ${options.out}`);
      } else {
        console.log(formatted);
      }
    }

    // Regressions / new failures trigger non-zero exit code
    const hasRegressions =
      diff.newFindings.length > 0 || diff.summaryDelta.failed > 0;
    return hasRegressions ? 1 : 0;
  }

  const resModelA = validateModel(jsonA);
  const resModelB = validateModel(jsonB);

  if (resModelA.success && resModelB.success && resModelA.data && resModelB.data) {
    const diff = diffApiModels(resModelA.data, resModelB.data);

    if (options.json) {
      const output = JSON.stringify(diff, null, 2);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), output, 'utf-8');
        console.log(`Diff report written to ${options.out}`);
      } else {
        console.log(output);
      }
    } else {
      const formatted = formatApiModelDiffTerminal(diff, fileA, fileB);
      if (options.out) {
        await fs.writeFile(path.resolve(options.out), formatted, 'utf-8');
        console.log(`Diff report written to ${options.out}`);
      } else {
        console.log(formatted);
      }
    }

    return 0;
  }

  console.error(
    'Error: Files must either both be valid Mantis ApiModels or both be valid Mantis Reports.',
  );
  return 2;
}
