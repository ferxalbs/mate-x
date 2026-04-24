import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Tool } from '../tool-service';
import { resolveWorkspacePath } from './tool-utils';

export const findTool: Tool = {
  name: 'find',
  description: 'Search for files by name substring in a directory hierarchy (cross-platform pure Node).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to search in (relative to workspace root). Defaults to ".".',
      },
      name: {
        type: 'string',
        description: 'The substring to match in the filename (case-insensitive).',
      },
    },
    required: ['name'],
  },
  async execute(args, { workspacePath }) {
    const targetDir = resolveWorkspacePath(workspacePath, args.path || '.');
    const searchName = args.name.toLowerCase();
    const results: string[] = [];

    try {
      await searchFiles(targetDir, workspacePath, searchName, results);
      if (results.length === 0) return 'No matching files found.';
      
      const limit = 500;
      if (results.length > limit) {
        return `${results.slice(0, limit).join('\n')}\n... (truncated ${results.length - limit} more matches)`;
      }
      return results.join('\n');
    } catch (error) {
      return `Error executing find: ${(error as Error).message}`;
    }
  },
};

async function searchFiles(dir: string, root: string, searchName: string, results: string[]) {
  if (results.length >= 1000) return; // hard limit to prevent OOM
  
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    
    const fullPath = join(dir, entry.name);
    if (entry.name.toLowerCase().includes(searchName)) {
      results.push(relative(root, fullPath));
    }
    
    if (entry.isDirectory()) {
      await searchFiles(fullPath, root, searchName, results);
    }
  }
}
