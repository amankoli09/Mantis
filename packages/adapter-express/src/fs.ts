import { promises as fs, existsSync, statSync } from 'node:fs';

export interface FileStat {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink?(): boolean;
  size?: number;
}

export interface FileSystem {
  readFile(path: string, encoding: 'utf-8' | 'utf8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  lstat?(path: string): Promise<FileStat>;
  existsSync(path: string): boolean;
  statSync?(path: string): FileStat;
}

export const nodeFileSystem: FileSystem = {
  readFile: (filePath: string, encoding: 'utf-8' | 'utf8') => fs.readFile(filePath, encoding),
  readdir: (dirPath: string) => fs.readdir(dirPath),
  stat: async (targetPath: string) => {
    const s = await fs.stat(targetPath);
    return {
      isDirectory: () => s.isDirectory(),
      isFile: () => s.isFile(),
      isSymbolicLink: () => false,
      size: s.size,
    };
  },
  lstat: async (targetPath: string) => {
    const s = await fs.lstat(targetPath);
    return {
      isDirectory: () => s.isDirectory(),
      isFile: () => s.isFile(),
      isSymbolicLink: () => s.isSymbolicLink(),
      size: s.size,
    };
  },
  existsSync: (targetPath: string) => existsSync(targetPath),
  statSync: (targetPath: string) => {
    const s = statSync(targetPath);
    return {
      isDirectory: () => s.isDirectory(),
      isFile: () => s.isFile(),
      isSymbolicLink: () => false,
      size: s.size,
    };
  },
};

export class MemoryFileSystem implements FileSystem {
  private files = new Map<string, string>();

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [p, content] of Object.entries(initialFiles)) {
      this.files.set(this.normalize(p), content);
    }
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  }

  async readFile(filePath: string, encoding: 'utf-8' | 'utf8' = 'utf-8'): Promise<string> {
    void encoding;
    const normalized = this.normalize(filePath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }
    return content;
  }

  async readdir(dirPath: string): Promise<string[]> {
    const normalizedDir = this.normalize(dirPath);
    const prefix = normalizedDir === '' ? '' : `${normalizedDir}/`;
    const entries = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const segment = rest.split('/')[0];
        if (segment) {
          entries.add(segment);
        }
      }
    }
    return Array.from(entries);
  }

  async stat(targetPath: string): Promise<FileStat> {
    const normalized = this.normalize(targetPath);
    if (this.files.has(normalized)) {
      const content = this.files.get(normalized)!;
      return {
        isDirectory: () => false,
        isFile: () => true,
        size: Buffer.byteLength(content, 'utf-8'),
      };
    }

    const prefix = normalized === '' ? '' : `${normalized}/`;
    let isDir = false;
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        isDir = true;
        break;
      }
    }

    if (isDir) {
      return {
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
      };
    }

    throw new Error(`ENOENT: no such file or directory, stat '${targetPath}'`);
  }

  existsSync(targetPath: string): boolean {
    const normalized = this.normalize(targetPath);
    if (this.files.has(normalized)) return true;
    const prefix = normalized === '' ? '' : `${normalized}/`;
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) return true;
    }
    return false;
  }

  statSync(targetPath: string): FileStat {
    const normalized = this.normalize(targetPath);
    if (this.files.has(normalized)) {
      const content = this.files.get(normalized)!;
      return {
        isDirectory: () => false,
        isFile: () => true,
        size: Buffer.byteLength(content, 'utf-8'),
      };
    }

    const prefix = normalized === '' ? '' : `${normalized}/`;
    let isDir = false;
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        isDir = true;
        break;
      }
    }

    if (isDir) {
      return {
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
      };
    }

    throw new Error(`ENOENT: no such file or directory, stat '${targetPath}'`);
  }
}
