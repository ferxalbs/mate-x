import { existsSync } from 'node:fs';
import type { Tool } from '../tool-service';
import { createToolError, formatToolFailure } from '../tool-result';
import { ripgrepPath } from '../rg-binary';
import { execFileAbortable } from './process';
import { clampNumber, limitTextOutput, resolveWorkspacePath } from './tool-utils';

const DEFAULT_MAX_RESULTS = 80;
const MAX_RESULTS = 500;
const DEFAULT_MAX_OUTPUT_CHARS = 24_000;
const MAX_OUTPUT_CHARS = 250_000;
const DEFAULT_MAX_FILESIZE = '2M';
const FORBIDDEN_DEFAULT_GLOBS = [
  '!node_modules/**',
  '!dist/**',
  '!out/**',
  '!target/**',
  '!coverage/**',
  '!*.lock',
  '!*.log',
  '!*.map',
];

function normalizePathList(path: unknown): string[] {
  if (Array.isArray(path)) {
    return path
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return typeof path === 'string' && path.trim().length > 0 ? [path.trim()] : ['.'];
}

function normalizeMaxFilesize(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_MAX_FILESIZE;
  }

  const normalized = value.trim();
  return /^\d+[KMG]?$/i.test(normalized) ? normalized : DEFAULT_MAX_FILESIZE;
}

export const rgTool: Tool = {
  name: 'rg',
  description:
    'High-performance code search via ripgrep. Use for symbol, text, and regex discovery before read. Defaults skip node_modules/dist/out/build artifacts and cap noisy results. Does not edit files. Prefer path/include filters to keep results actionable.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search term or regex pattern.',
        minLength: 1,
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
      path: {
        type: 'string',
        description: 'Optional file or directory path to search within. Defaults to the workspace root.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional file or directory paths to search within. Overrides path when provided.',
      },
      contextLines: {
        type: 'number',
        description: 'Optional matching context lines before and after each match. Defaults to 0; max 8.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum result lines returned. Defaults to 80; max 500.',
      },
      maxOutputChars: {
        type: 'number',
        description: 'Maximum output characters returned. Defaults to 24000; max 120000.',
      },
      maxFilesize: {
        type: 'string',
        description: 'Skip files larger than this ripgrep size (examples: 512K, 2M, 1G). Defaults to 2M.',
      },
      hidden: {
        type: 'boolean',
        description: 'Search hidden files and directories. Defaults to false.',
      },
      sort: {
        type: 'string',
        enum: ['none', 'path'],
        description: 'Optional deterministic sorting. Use path for stable review output; none is fastest.',
      },
    },
    required: ['query'],
  },
  async execute(args, { workspacePath, trustContract, settings: _settings, signal }) {
    if (signal?.aborted) {
      return formatToolFailure(
        createToolError('CANCELLED', 'rg cancelled before start.'),
        'rg',
      );
    }

    const {
      query,
      isRegex = false,
      caseSensitive = false,
      include,
      exclude,
      wholeWord = false,
      hidden = false,
      sort = 'none',
    } = args;

    if (typeof query !== 'string' || query.length === 0) {
      return formatToolFailure(
        createToolError('INVALID_INPUT', 'query is required and must be a non-empty string.'),
        'rg',
      );
    }

    const requestedPaths = normalizePathList(args.paths ?? args.path);
    try {
      for (const requestedPath of requestedPaths) {
        resolveWorkspacePath(workspacePath, requestedPath);
      }
    } catch (error) {
      return formatToolFailure(
        createToolError('FORBIDDEN', (error as Error).message),
        'rg',
      );
    }
    const scopedPaths =
      trustContract && !trustContract.allowedPaths.includes('.')
        ? trustContract.allowedPaths
        : requestedPaths;
    const existingScopedPaths = scopedPaths.filter((scopedPath) => existsSync(resolveWorkspacePath(workspacePath, scopedPath)));
    if (existingScopedPaths.length === 0) {
      return 'No matches found. Search paths do not exist in this workspace.';
    }
    const contextLines = clampNumber(args.contextLines, 0, 8, 0);
    const maxResults = clampNumber(args.maxResults, 1, MAX_RESULTS, DEFAULT_MAX_RESULTS);
    const maxOutputChars = clampNumber(args.maxOutputChars, 1000, MAX_OUTPUT_CHARS, DEFAULT_MAX_OUTPUT_CHARS);

    const commandArgs = [
      '--column',
      '--line-number',
      '--no-heading',
      '--color', 'never',
      '--max-columns', '512',
      '--max-columns-preview',
      '--max-filesize', normalizeMaxFilesize(args.maxFilesize),
    ];

    if (caseSensitive) commandArgs.push('--case-sensitive');
    else commandArgs.push('--smart-case');
    if (!isRegex) commandArgs.push('--fixed-strings');
    if (wholeWord) commandArgs.push('--word-regexp');
    if (contextLines > 0) commandArgs.push('--context', String(contextLines));
    if (hidden) commandArgs.push('--hidden');
    if (sort === 'path') commandArgs.push('--sort', 'path');
    if (include) commandArgs.push('--glob', include);
    if (exclude) commandArgs.push('--glob', `!${exclude}`);
    commandArgs.push(...FORBIDDEN_DEFAULT_GLOBS.flatMap((glob) => ['--glob', glob]));
    for (const forbiddenPath of trustContract?.forbiddenPaths ?? []) {
      commandArgs.push('--glob', `!${forbiddenPath}`);
    }

    // -- explicitly tells ripgrep that following arguments are patterns or paths, not flags.
    // This prevents an attacker from supplying flags like '--max-filesize' via the query.
    commandArgs.push('--', query, ...existingScopedPaths);

    try {
      if (signal?.aborted) {
        return formatToolFailure(
          createToolError('CANCELLED', 'rg cancelled before spawn.'),
          'rg',
        );
      }

      const { stdout } = await execFileAbortable(ripgrepPath, commandArgs, {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024,
        signal,
      });

      if (!stdout.trim()) {
        return 'No matches found.';
      }

      const lines = stdout.split('\n').filter(Boolean);
      const cappedLines =
        lines.length > maxResults
          ? `${lines.slice(0, maxResults).join('\n')}\n... (truncated ${lines.length - maxResults} more result lines; narrow path/include or raise maxResults)`
          : stdout;
      const limited = limitTextOutput(cappedLines, maxOutputChars);
      if (limited !== cappedLines) {
        return `${limited}\nTip: narrow path/include or raise maxOutputChars.`;
      }

      return cappedLines;
    } catch (error) {
      if (signal?.aborted || (error as Error)?.name === 'AbortError') {
        return formatToolFailure(
          createToolError('CANCELLED', 'rg cancelled during search.'),
          'rg',
        );
      }

      const execError = error as { stdout?: string; stderr?: string; code?: number };
      if (execError.code === 1 && !execError.stdout) {
        return 'No matches found.';
      }
      return formatToolFailure(
        createToolError(
          'EXECUTION_ERROR',
          `Error executing rg: ${execError.stderr || execError.stdout || (error as Error).message}`,
          { retryable: true },
        ),
        'rg',
      );
    }
  },
};
