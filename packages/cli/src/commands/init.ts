import path from 'node:path';
import { promises as fs } from 'node:fs';

const DEFAULT_CONFIG_TEMPLATE = `{
  "$schema": "https://raw.githubusercontent.com/amankoli1206/Mantis/main/packages/runner/config.schema.json",
  "baseUrl": "http://127.0.0.1:3000",
  "allowedEffects": ["read"],
  "skip": [],
  "pathParamSamples": {
    "id": "1",
    "userId": "1"
  },
  "limits": {
    "timeoutMs": 5000,
    "maxResponseBytes": 1048576,
    "maxRequests": 50,
    "concurrency": 5,
    "retries": 0
  },
  "allowRemote": false,
  "followRedirects": false
}
`;

export async function initCommand(options: { out?: string } = {}): Promise<number> {
  const targetFile = path.resolve(options.out ?? 'devguard.config.json');

  try {
    // Flag 'wx' ensures atomic failure if file already exists
    await fs.writeFile(targetFile, DEFAULT_CONFIG_TEMPLATE, { encoding: 'utf-8', flag: 'wx' });
    console.log(`Created starter configuration file: ${path.basename(targetFile)}`);
    return 0;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      console.error(
        `Error: Configuration file already exists at "${targetFile}". Refusing to overwrite.`,
      );
      return 2;
    }
    console.error(
      `Error creating config file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 3;
  }
}
