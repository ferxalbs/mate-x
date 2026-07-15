import { GitService } from '../git-service';
import type { Tool } from '../tool-service';
import {
  createToolError,
  formatToolFailure,
  formatToolSuccess,
} from '../tool-result';
import type { GitDiff, GitDiffPatch } from '../../contracts/git';

const DEFAULT_DIFF_MAX_CHARS = 40_000;
const MIN_DIFF_MAX_CHARS = 2_000;
const MAX_DIFF_MAX_CHARS = 80_000;

export const gitTool: Tool = {
  name: 'git_diag',
  description:
    'Read-only git diagnostics for the active workspace: log (recent commits), show (commit details), and diff (working tree changes). Use for change review and vulnerability archaeology. Does not commit, push, checkout, or mutate the repository.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['log', 'show', 'diff'],
        description: 'Git diagnostic operation to perform.',
      },
      limit: {
        type: 'number',
        description: 'For log: number of commits to show. Defaults to 5; max 50.',
        minimum: 1,
        maximum: 50,
      },
      commitHash: {
        type: 'string',
        description: 'For show: commit hash prefix to inspect (matched against recent history).',
        minLength: 4,
      },
      path: {
        type: 'string',
        description: 'For diff: optional repository-relative file path to limit patch content.',
      },
      contextLines: {
        type: 'number',
        description: 'For diff: unchanged context lines around each hunk. Defaults to 3; max 20.',
        minimum: 0,
        maximum: 20,
      },
      maxChars: {
        type: 'number',
        description: 'For diff: maximum patch characters returned. Defaults to 40000; range 2000-80000.',
        minimum: MIN_DIFF_MAX_CHARS,
        maximum: MAX_DIFF_MAX_CHARS,
      },
    },
    required: ['operation'],
  },
  async execute(args, { workspacePath, settings: _settings, signal }) {
    if (signal?.aborted) {
      return formatToolFailure(
        createToolError('CANCELLED', 'git_diag cancelled.'),
        'git_diag',
      );
    }

    const git = new GitService(workspacePath);
    const { operation, commitHash } = args;
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 5));

    try {
      switch (operation) {
        case 'log': {
          const commits = await git.getLog(limit);
          const text = commits
            .map((c) => `${c.hash.slice(0, 7)} - ${c.author_name} (${c.date}): ${c.message}`)
            .join('\n');
          return formatToolSuccess(
            {
              operation: 'log',
              count: commits.length,
              commits: commits.map((c) => ({
                hash: c.hash,
                author: c.author_name,
                date: c.date,
                message: c.message,
              })),
            },
            { textFallback: text || 'No commits found.' },
          );
        }
        case 'show': {
          if (!commitHash || typeof commitHash !== 'string') {
            return formatToolFailure(
              createToolError(
                'INVALID_INPUT',
                'commitHash is required for show operation.',
                {
                  recommendedNextAction:
                    'Call git_diag with operation=log first, then show with a hash prefix.',
                },
              ),
              'git_diag',
            );
          }
          const log = await git.getLog(50);
          const commit = log.find((c) => c.hash.startsWith(commitHash));
          if (!commit) {
            return formatToolFailure(
              createToolError(
                'MISSING_RESOURCE',
                `Commit ${commitHash} not found in last 50 commits.`,
                {
                  recommendedNextAction:
                    'Use a longer hash prefix or increase history via operation=log.',
                },
              ),
              'git_diag',
            );
          }
          return formatToolSuccess(
            { operation: 'show', commit },
            { textFallback: JSON.stringify(commit, null, 2) },
          );
        }
        case 'diff': {
          const path = normalizeDiffPath(args.path);
          if (args.path !== undefined && path === null) {
            return formatToolFailure(
              createToolError(
                'INVALID_INPUT',
                'path must be a repository-relative file path without parent traversal.',
              ),
              'git_diag',
            );
          }
          const requestedContextLines = Number(args.contextLines);
          const contextLines = Number.isFinite(requestedContextLines)
            ? Math.min(20, Math.max(0, requestedContextLines))
            : 3;
          const maxChars = Math.min(
            MAX_DIFF_MAX_CHARS,
            Math.max(MIN_DIFF_MAX_CHARS, Number(args.maxChars) || DEFAULT_DIFF_MAX_CHARS),
          );
          const [diff, patch] = await Promise.all([
            git.getDiff(),
            git.getDiffPatch({ path: path || undefined, contextLines }),
          ]);
          return JSON.stringify(buildGitDiffResult(diff, patch, { path: path || null, maxChars }), null, 2);
        }
        default:
          return formatToolFailure(
            createToolError(
              'UNSUPPORTED_OPERATION',
              `Unsupported operation: ${String(operation)}`,
              {
                recommendedNextAction:
                  'Use operation log, show, or diff.',
              },
            ),
            'git_diag',
          );
      }
    } catch (error) {
      return formatToolFailure(
        createToolError(
          'EXECUTION_ERROR',
          `Error executing git operation: ${(error as Error).message}`,
          { retryable: true, mayHavePartialEffects: false },
        ),
        'git_diag',
      );
    }
  },
};

export function buildGitDiffResult(
  diff: GitDiff,
  patch: string,
  options: { path: string | null; maxChars: number },
): GitDiff & { selectedPath: string | null; patch: GitDiffPatch; recommendedNextAction?: string } {
  const boundedPatch = patch.slice(0, options.maxChars);
  const truncated = boundedPatch.length < patch.length;
  const files = options.path
    ? diff.files.filter((file) => file.file === options.path)
    : diff.files;
  return {
    ...diff,
    files,
    insertions: options.path
      ? files.reduce((total, file) => total + file.insertions, 0)
      : diff.insertions,
    deletions: options.path
      ? files.reduce((total, file) => total + file.deletions, 0)
      : diff.deletions,
    selectedPath: options.path,
    patch: {
      patch: boundedPatch,
      totalChars: patch.length,
      returnedChars: boundedPatch.length,
      truncated,
    },
    ...(truncated
      ? {
          recommendedNextAction:
            'Call git_diag diff again with path set to one changed file, or increase maxChars up to 80000.',
        }
      : {}),
  };
}

export function normalizeDiffPath(value: unknown): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    return null;
  }
  return normalized;
}
