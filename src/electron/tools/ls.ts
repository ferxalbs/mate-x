import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Tool } from '../tool-service';

export const lsTool: Tool = {
  name: 'ls',
  description: 'List contents of a directory. Helps understand project structure.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (relative to workspace root). Defaults to ".".',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list contents recursively. Defaults to false.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const relativePath = args.path || '.';
    const targetDir = join(workspacePath, relativePath);
    const recursive = args.recursive || false;

    try {
      if (recursive) {
        const results: string[] = [];
        await this.walk(targetDir, workspacePath, results);
        return results.join('\n');
      }

      const entries = await readdir(targetDir, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.isDirectory() ? '[DIR] ' : '      '}${entry.name}`)
        .join('\n');
    } catch (error) {
      return `Error listing directory: ${(error as Error).message}`;
    }
  },

  async walk(dir: string, root: string, results: string[]) {
    const list = await readdir(dir, { withFileTypes: true });
    for (const entry of list) {
      const res = join(dir, entry.name);
      const rel = relative(root, res);
      if (entry.isDirectory()) {
        results.push(`[DIR] ${rel}`);
        await this.walk(res, root, results);
      } else {
        results.push(`      ${rel}`);
      }
    }
  },
};
