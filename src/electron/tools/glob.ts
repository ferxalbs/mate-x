import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const globTool: Tool = {
  name: 'glob',
  description: 'Search for files matching a glob pattern. Respects .gitignore and is extremely fast. Best for finding files by name or extension.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to search for (e.g., "**/*.ts" or "src/components/**/*.tsx").',
      },
      path: {
        type: 'string',
        description: 'Optional path or directory to restrict the search within. Defaults to the workspace root.',
      },
    },
    required: ['pattern'],
  },
  async execute(args, { workspacePath, trustContract }) {
    const { pattern, path } = args;
    const requestedPaths = path ? [path] : ['.'];
    const scopedPaths =
      trustContract && !trustContract.allowedPaths.includes('.')
        ? trustContract.allowedPaths
        : requestedPaths;

    const commandArgs = [
      '--files',
      '--color', 'never',
      '--glob', pattern,
    ];

    for (const forbiddenPath of trustContract?.forbiddenPaths ?? []) {
      commandArgs.push('--glob', `!${forbiddenPath}`);
    }

    commandArgs.push('--', ...scopedPaths);

    try {
      const { stdout } = await execFileAsync('rg', commandArgs, {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!stdout.trim()) {
        return 'No matches found.';
      }

      const lines = stdout.split('\n').filter(Boolean);
      const limit = 500;
      if (lines.length > limit) {
        return `${lines.slice(0, limit).join('\n')}\n... (truncated ${lines.length - limit} more matches)`;
      }

      return stdout;
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      if (execError.code === 1 && !execError.stdout) {
        return 'No matches found.';
      }
      return `Error executing glob tool: ${execError.stderr || execError.stdout || (error as Error).message}`;
    }
  },
};
