import { basename, relative } from 'node:path';
import type { Tool } from '../tool-service';

export const pwdTool: Tool = {
  name: 'pwd',
  description: 'Print current workspace context: root path, repo name, platform, and optional trust scope metadata.',
  parameters: {
    type: 'object',
    properties: {
      includeTrustScope: {
        type: 'boolean',
        description: 'Include allowed/forbidden workspace paths from the active trust contract. Defaults to true.',
      },
      relativeTo: {
        type: 'string',
        description: 'Optional absolute or workspace-relative path to express as relative to the workspace root.',
      },
    },
  }, 
  async execute(args, { workspacePath, trustContract }) {
    const includeTrustScope = args.includeTrustScope !== false;
    const relativeTo = typeof args.relativeTo === 'string' ? args.relativeTo.trim() : '';
    const lines = [
      `Workspace Root: ${workspacePath}`,
      `Workspace Name: ${basename(workspacePath)}`,
      `Platform: ${process.platform}`,
    ];

    if (relativeTo) {
      lines.push(`Relative Path: ${relative(workspacePath, relativeTo) || '.'}`);
    }

    if (includeTrustScope && trustContract) {
      lines.push(`Allowed Paths: ${trustContract.allowedPaths.join(', ') || '(none)'}`);
      lines.push(`Forbidden Paths: ${trustContract.forbiddenPaths.join(', ') || '(none)'}`);
    }

    return lines.join('\n');
  },
};
