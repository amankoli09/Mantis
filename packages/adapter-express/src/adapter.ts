import type { ApiModel, FrameworkAdapter } from '@devguard/core';
import { type FileSystem, nodeFileSystem } from './fs.js';
import { detectExpress } from './detector.js';
import { scanProject } from './scanner.js';

export class ExpressAdapter implements FrameworkAdapter {
  readonly name = 'adapter-express';

  constructor(private fileSystem: FileSystem = nodeFileSystem) {}

  /**
   * Detects if the given project root is an Express application.
   */
  async detect(projectRoot: string): Promise<boolean> {
    const result = await detectExpress(projectRoot, this.fileSystem);
    return result.detected;
  }

  /**
   * Static analysis scanner for Express applications.
   */
  async scan(projectRoot: string): Promise<ApiModel> {
    return scanProject(projectRoot, {}, this.fileSystem);
  }
}
