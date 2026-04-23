import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const rgTool: Tool = {
  name: 'rg',
  description: 'High-performance search using ripgrep. Ideal for massive repositories.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search term or regex pattern.',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether to treat the query as a regular expression. Defaults to false.',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search should be case sensitive. Defaults to false.',
      },
      include: {
        type: 'string',
        description: 'Glob pattern for files to include (e.g., "*.ts").',
      },
      exclude: {
        type: 'string',
        description: 'Glob pattern for files to exclude.',
      },
      wholeWord: {
        type: 'boolean',
        description: 'Whether to match whole words only.',
      },
    },
    required: ['query'],
  },
  async execute(args, { workspacePath, trustContract, settings }) {
    const { query, isRegex = false, caseSensitive = false, include, exclude, wholeWord = false } = args;
    const scopedPaths =
      trustContract && !trustContract.allowedPaths.includes('.')
        ? trustContract.allowedPaths
        : ['.'];

    const commandArgs = [
      '--column',
      '--line-number',
      '--no-heading',
      '--color', 'never',
      '--max-columns', '512',
      '--max-columns-preview',
    ];

    if (!caseSensitive) commandArgs.push('--ignore-case');
    if (!isRegex) commandArgs.push('--fixed-strings');
    if (wholeWord) commandArgs.push('--word-regexp');
    if (include) commandArgs.push('--glob', include);
    if (exclude) commandArgs.push('--glob', `!${exclude}`);
    for (const forbiddenPath of trustContract?.forbiddenPaths ?? []) {
      commandArgs.push('--glob', `!${forbiddenPath}`);
    }

    // -- explicitly tells ripgrep that following arguments are patterns or paths, not flags.
    // This prevents an attacker from supplying flags like '--max-filesize' via the query.
    commandArgs.push('--', query, ...scopedPaths);

    try {
      const { stdout } = await execFileAsync('rg', commandArgs, {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (!stdout.trim()) {
        return 'No matches found.';
      }

      // Limit output to prevent overwhelming the model
      const lines = stdout.split('\n').filter(Boolean);
      const limit = 100;
      if (lines.length > limit) {
        return `${lines.slice(0, limit).join('\n')}\n... (truncated ${lines.length - limit} more matches)`;
      }

      return stdout;
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      if (execError.code === 1 && !execError.stdout) {
        return 'No matches found.';
      }
      return `Error executing rg: ${execError.stderr || execError.stdout || (error as Error).message}`;
    }
  },
};
