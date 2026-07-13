import { basename, relative } from 'node:path';
import type { Tool } from '../tool-service';
import { createToolError, formatToolFailure, formatToolSuccess } from '../tool-result';

export const pwdTool: Tool = {
  name: 'pwd',
  description:
    'Return the active workspace root, name, platform, and optional trust-scope paths. Use when you need the current workspace context before path-based tools. Mutates nothing.',
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
  async execute(args, { workspacePath, trustContract, signal }) {
    if (signal?.aborted) {
      return formatToolFailure(
        createToolError('CANCELLED', 'pwd cancelled.'),
        'pwd',
      );
    }

    const includeTrustScope = args.includeTrustScope !== false;
    const relativeTo = typeof args.relativeTo === 'string' ? args.relativeTo.trim() : '';
    const data = {
      workspaceRoot: workspacePath,
      workspaceName: basename(workspacePath),
      platform: process.platform,
      arch: process.arch,
      relativePath: relativeTo
        ? relative(workspacePath, relativeTo) || '.'
        : undefined,
      allowedPaths:
        includeTrustScope && trustContract
          ? trustContract.allowedPaths
          : undefined,
      forbiddenPaths:
        includeTrustScope && trustContract
          ? trustContract.forbiddenPaths
          : undefined,
    };

    const lines = [
      `Workspace Root: ${data.workspaceRoot}`,
      `Workspace Name: ${data.workspaceName}`,
      `Platform: ${data.platform}`,
      `Arch: ${data.arch}`,
    ];

    if (data.relativePath !== undefined) {
      lines.push(`Relative Path: ${data.relativePath}`);
    }

    if (data.allowedPaths) {
      lines.push(`Allowed Paths: ${data.allowedPaths.join(', ') || '(none)'}`);
    }
    if (data.forbiddenPaths) {
      lines.push(`Forbidden Paths: ${data.forbiddenPaths.join(', ') || '(none)'}`);
    }

    return formatToolSuccess(data, { textFallback: lines.join('\n') });
  },
};
