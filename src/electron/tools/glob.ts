import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';
import { isPathInsideRoot, resolveWorkspacePathForRead } from './tool-utils';
import { createToolError, formatToolFailure, formatToolSuccess } from '../tool-result';

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const ALWAYS_EXCLUDED_GLOBS = [
  '!node_modules/**',
  '!dist/**',
  '!out/**',
  '!coverage/**',
  '!target/**',
  '!.next/**',
  '!.git/**',
];

const toStringArray = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const isPathAllowed = (workspacePath: string, candidatePath: string, allowedPaths: string[]) => {
  if (allowedPaths.includes('.')) return true;
  const resolvedCandidate = resolve(workspacePath, candidatePath);

  return allowedPaths.some((allowedPath) => {
    const resolvedAllowed = resolve(workspacePath, allowedPath);
    return isPathInsideRoot(resolvedAllowed, resolvedCandidate);
  });
};

const normalizeScopedPaths = (workspacePath: string, requestedPaths: string[], allowedPaths: string[]) => {
  const scopedPaths = allowedPaths.includes('.')
    ? requestedPaths
    : requestedPaths.flatMap((requestedPath) => {
        const resolvedRequested = resolve(workspacePath, requestedPath);
        return allowedPaths.flatMap((allowedPath) => {
          const resolvedAllowed = resolve(workspacePath, allowedPath);
          if (isPathInsideRoot(resolvedAllowed, resolvedRequested)) {
            return [requestedPath];
          }
          if (isPathInsideRoot(resolvedRequested, resolvedAllowed)) {
            return [allowedPath];
          }
          return [];
        });
      });

  return Array.from(new Set(scopedPaths)).filter((scopedPath) => {
    const resolvedPath = resolve(workspacePath, scopedPath);
    return isPathInsideRoot(workspacePath, resolvedPath) && isPathAllowed(workspacePath, scopedPath, allowedPaths);
  });
};

export const globTool: Tool = {
  name: 'glob',
  description: 'Search for files by glob with trust-scope enforcement, excludes, type filters, hidden/ignored toggles, result caps, and summary metadata.',
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
      exclude: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional extra glob patterns to exclude, e.g. ["**/*.test.ts", "fixtures/**"].',
      },
      extensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional extension filter without dots, e.g. ["ts", "tsx"].',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files and directories. Defaults to false.',
      },
      noIgnore: {
        type: 'boolean',
        description: 'Ignore .gitignore/.ignore rules. Defaults to false.',
      },
      limit: {
        type: 'number',
        description: 'Max results to return. Defaults to 500, capped at 2000.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Search timeout in milliseconds. Defaults to 15000, capped at 60000.',
      },
    },
    required: ['pattern'],
  },
  async execute(args, { workspacePath, trustContract }) {
    const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : '';
    const requestedPaths = toStringArray(args.path).length > 0 ? toStringArray(args.path) : ['.'];
    const allowedPaths = trustContract?.allowedPaths?.length ? trustContract.allowedPaths : ['.'];
    const scopedPaths = normalizeScopedPaths(workspacePath, requestedPaths, allowedPaths);
    const excludePatterns = toStringArray(args.exclude);
    const extensions = toStringArray(args.extensions).map((extension) => extension.replace(/^\./, ''));
    const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const timeoutMs = toPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    if (!pattern) {
      return formatToolFailure(
        createToolError('INVALID_INPUT', 'Glob pattern is required.'),
        'glob',
      );
    }
    if (pattern.startsWith('!')) {
      return formatToolFailure(
        createToolError(
          'INVALID_INPUT',
          'Glob pattern must include files. Use exclude for negative patterns.',
        ),
        'glob',
      );
    }
    if (scopedPaths.length === 0) {
      return formatToolFailure(
        createToolError(
          'FORBIDDEN',
          'Requested search scope does not intersect the workspace policy.',
        ),
        'glob',
      );
    }
    const existingPaths: string[] = [];
    const missingPaths: string[] = [];
    for (const scopedPath of scopedPaths) {
      try {
        await resolveWorkspacePathForRead(workspacePath, scopedPath);
        existingPaths.push(scopedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          missingPaths.push(scopedPath);
          continue;
        }
        throw error;
      }
    }
    if (existingPaths.length === 0) {
      return formatToolSuccess(
        {
          discoveryStatus: 'not_found',
          matches: [],
          missingPaths,
          searchedPaths: [],
        },
        {
          textFallback: `Search scope not found: ${missingPaths.join(', ')}.`,
          warnings: ['The requested search root does not exist.'],
          meta: { verified: true },
        },
      );
    }

    const commandArgs = [
      '--files',
      '--color',
      'never',
      '--sort',
      'path',
      '--glob',
      pattern,
    ];

    if (args.includeHidden === true) commandArgs.push('--hidden');
    if (args.noIgnore === true) commandArgs.push('--no-ignore');

    for (const excludedGlob of ALWAYS_EXCLUDED_GLOBS) {
      commandArgs.push('--glob', excludedGlob);
    }

    for (const excludedGlob of excludePatterns) {
      commandArgs.push('--glob', excludedGlob.startsWith('!') ? excludedGlob : `!${excludedGlob}`);
    }

    for (const forbiddenPath of trustContract?.forbiddenPaths ?? []) {
      commandArgs.push('--glob', `!${forbiddenPath}`);
      commandArgs.push('--glob', `!${forbiddenPath}/**`);
    }

    commandArgs.push('--', ...existingPaths);

    try {
      const { stdout } = await execFileAsync('rg', commandArgs, {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      });

      if (!stdout.trim()) {
        return formatToolSuccess(
          {
            discoveryStatus: 'no_matches',
            matches: [],
            missingPaths,
            searchedPaths: existingPaths,
          },
          {
            textFallback: 'No matches found.',
            warnings:
              missingPaths.length > 0
                ? [`Skipped missing roots: ${missingPaths.join(', ')}`]
                : undefined,
            meta: { verified: true },
          },
        );
      }

      const lines = stdout
        .split('\n')
        .filter(Boolean)
        .filter((file) => isPathInsideRoot(workspacePath, resolve(workspacePath, file)))
        .filter((file) => isPathAllowed(workspacePath, file, allowedPaths))
        .filter((file) => extensions.length === 0 || extensions.some((extension) => file.endsWith(`.${extension}`)));
      const visibleLines = lines.slice(0, limit);
      const summary = `Glob matches: ${visibleLines.length}${lines.length > limit ? ` of ${lines.length}` : ''} file(s) for "${pattern}" in ${existingPaths.join(', ')}`;

      const textFallback = lines.length > limit
        ? `${summary}\n${visibleLines.join('\n')}\n... (truncated ${lines.length - limit} more matches)`
        : `${summary}\n${visibleLines.join('\n')}`;
      return formatToolSuccess(
        {
          discoveryStatus: 'completed',
          matches: visibleLines,
          totalMatches: lines.length,
          truncated: lines.length > limit,
          missingPaths,
          searchedPaths: existingPaths,
        },
        {
          textFallback,
          warnings:
            missingPaths.length > 0
              ? [`Skipped missing roots: ${missingPaths.join(', ')}`]
              : undefined,
          meta: { verified: true, truncated: lines.length > limit },
        },
      );
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      if (execError.code === 1 && !execError.stdout) {
        return formatToolSuccess(
          {
            discoveryStatus: 'no_matches',
            matches: [],
            missingPaths,
            searchedPaths: existingPaths,
          },
          { textFallback: 'No matches found.', meta: { verified: true } },
        );
      }
      return formatToolFailure(
        createToolError(
          'EXECUTION_ERROR',
          `glob failed: ${execError.stderr?.trim() || execError.stdout?.trim() || (error as Error).message}`,
          {
            details: {
              discoveryStatus: 'io_failure',
              searchedPaths: existingPaths,
              missingPaths,
            },
          },
        ),
        'glob',
      );
    }
  },
};
