import { GitService } from '../git-service';
import type { Tool } from '../tool-service';

export const gitTool: Tool = {
  name: 'git_diag',
  description: 'Git diagnostic tools for repository history and diffs. Essential for vulnerability archaeology.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['log', 'show', 'diff'],
        description: 'The git operation to perform.',
      },
      limit: {
        type: 'number',
        description: 'For log: number of commits to show. Defaults to 5.',
      },
      commitHash: {
        type: 'string',
        description: 'For show: the commit hash to inspect.',
      },
    },
    required: ['operation'],
  },
  async execute(args, { workspacePath }) {
    const git = new GitService(workspacePath);
    const { operation, limit = 5, commitHash } = args;

    try {
      switch (operation) {
        case 'log': {
          const commits = await git.getLog(limit);
          return commits
            .map((c) => `${c.hash.slice(0, 7)} - ${c.author_name} (${c.date}): ${c.message}`)
            .join('\n');
        }
        case 'show': {
          if (!commitHash) return 'Error: commitHash is required for show operation.';
          // simple-git doesn't have a direct 'show' in our service yet, 
          // but we can use the internal git instance or extend it.
          // For now, let's just return commit details from log if found.
          const log = await git.getLog(50);
          const commit = log.find((c) => c.hash.startsWith(commitHash));
          if (!commit) return `Commit ${commitHash} not found in last 50 commits.`;
          return JSON.stringify(commit, null, 2);
        }
        case 'diff': {
          const diff = await git.getDiff();
          return JSON.stringify(diff, null, 2);
        }
        default:
          return `Unsupported operation: ${operation}`;
      }
    } catch (error) {
      return `Error executing git operation: ${(error as Error).message}`;
    }
  },
};
