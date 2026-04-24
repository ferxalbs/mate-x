import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../tool-service';
import { resolveWorkspacePath } from './tool-utils';

export const duTool: Tool = {
  name: 'du',
  description: 'Estimate file space usage of a directory or file. Useful for finding large files or analyzing disk space.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to check (relative to workspace root). Defaults to ".".',
      },
    },
  },
  async execute(args, { workspacePath }) {
    const relativePath = args.path || '.';
    const targetPath = resolveWorkspacePath(workspacePath, relativePath);
    
    try {
      const sizeBytes = await getDirSize(targetPath);
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
      return `Size of "${relativePath}": ${sizeBytes} bytes (${sizeMB} MB)`;
    } catch (error) {
      return `Error calculating size: ${(error as Error).message}`;
    }
  },
};

async function getDirSize(dirPath: string): Promise<number> {
  const fileStat = await stat(dirPath).catch(() => null);
  if (!fileStat) return 0;
  if (fileStat.isFile()) return fileStat.size;

  let totalSize = 0;
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);

  const tasks = entries.map(async (entry) => {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += await getDirSize(fullPath);
    } else if (entry.isFile()) {
      const { size } = await stat(fullPath).catch(() => ({ size: 0 }));
      totalSize += size;
    }
  });

  await Promise.all(tasks);
  return totalSize;
}
