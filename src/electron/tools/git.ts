import { GitService } from '../git-service';
import type { Tool } from '../tool-service';
import {
  createToolError,
  formatToolFailure,
  formatToolSuccess,
} from '../tool-result';

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
          const diff = await git.getDiff();
          return JSON.stringify(diff, null, 2);
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
