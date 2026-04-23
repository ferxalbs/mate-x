import { stat } from 'node:fs/promises';
import { relative } from "node:path";
import type { Tool } from '../tool-service';
import { resolveWorkspacePath } from "./tool-utils";

export const fileMetadataTool: Tool = {
  name: 'file_metadata',
  description: 'Get detailed metadata about a file, including size, permissions, and timestamps.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to inspect (relative to workspace root).',
      },
    },
    required: ['path'],
  },
  async execute(args, { workspacePath, settings }) {
    const { path } = args;

    try {
      const targetFile = resolveWorkspacePath(workspacePath, path);
      const stats = await stat(targetFile);
      const isUnix = process.platform !== 'win32';
      
      const details = {
        path: relative(workspacePath, targetFile),
        size: `${stats.size} bytes`,
        sizeKB: `${(stats.size / 1024).toFixed(2)} KB`,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: isUnix ? (stats.mode & 0o777).toString(8) : 'N/A (Windows)',
      };

      return JSON.stringify(details, null, 2);
    } catch (error) {
      return `Error retrieving metadata: ${(error as Error).message}`;
    }
  },
};
