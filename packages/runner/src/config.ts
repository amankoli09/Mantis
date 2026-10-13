import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RunnerConfigSchema, type RunnerConfig } from '@mantis/core';

/**
 * Validates a raw configuration object against RunnerConfigSchema.
 * Produces clear, human-readable error messages pointing to specific invalid fields.
 */
export function validateConfig(raw: unknown): RunnerConfig {
  const result = RunnerConfigSchema.safeParse(raw);
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => {
        const field = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `  - ${field}: ${issue.message}`;
      })
      .join('\n');
    throw new Error(`Invalid runner configuration:\n${formattedErrors}`);
  }
  return result.data;
}

/**
 * Loads and validates a mantis.config.json file.
 * Automatically resolves environment variables for auth secrets.
 */
export async function loadConfig(
  configPath?: string,
  env: Record<string, string | undefined> = process.env
): Promise<RunnerConfig> {
  const resolvedPath = path.resolve(configPath ?? 'mantis.config.json');

  let rawContent: string;
  try {
    rawContent = await fs.readFile(resolvedPath, 'utf8');
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      throw new Error(`Configuration file does not exist: "${resolvedPath}"`);
    }
    throw new Error(`Failed to read configuration file "${resolvedPath}": ${nodeErr.message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: unknown) {
    throw new Error(`Failed to parse configuration file "${resolvedPath}": malformed JSON (${(err as Error).message})`);
  }

  const config = validateConfig(parsed);

  // Resolve secret from environment variable if configured
  if (config.auth?.envVar) {
    const secretValue = env[config.auth.envVar];
    if (!secretValue) {
      throw new Error(
        `Config specifies auth.envVar "${config.auth.envVar}", but this environment variable is not defined.`
      );
    }
    config.auth.value = secretValue;
  }

  return config;
}
