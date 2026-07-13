import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Tool } from '../tool-service';
import {
  createToolError,
  formatToolFailure,
  mapErrnoToToolError,
} from '../tool-result';
import { resolveWorkspacePath } from "./tool-utils";

const MAX_RECURSIVE_ENTRIES = 4_000;

export const lsTool: Tool = {
  name: 'ls',
  description:
    'List directory entries in the active workspace. Use to inspect project structure before reading files. Defaults to the workspace root. Recursive listings are capped to protect performance. Does not read file contents; use read for that. Mutates nothing.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to the workspace root. Defaults to ".".',
      },
      recursive: {
        type: 'boolean',
        description: 'List contents recursively. Defaults to false. Caps at 4000 entries.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings: _settings, signal }) {
    const relativePath = args.path || '.';
    const recursive = args.recursive || false;

    if (signal?.aborted) {
      return formatToolFailure(
        createToolError('CANCELLED', 'Directory listing cancelled.'),
        'ls',
      );
    }

    try {
      const targetDir = resolveWorkspacePath(workspacePath, relativePath);
      const targetStats = await stat(targetDir);
      if (targetStats.isFile()) {
        return [
          'Path is a file; use read to inspect contents.',
          `File: ${relative(workspacePath, targetDir) || relativePath}`,
          `Size: ${targetStats.size} bytes`,
          `Modified: ${targetStats.mtime.toISOString()}`,
        ].join('\n');
      }

      if (!targetStats.isDirectory()) {
        return formatToolFailure(
          createToolError(
            'INVALID_INPUT',
            `Path is not a directory: ${relative(workspacePath, targetDir) || relativePath}`,
          ),
          'ls',
        );
      }

      if (recursive) {
        const results: string[] = [];
        await walk(targetDir, workspacePath, results, signal);
        if (signal?.aborted) {
          return formatToolFailure(
            createToolError('CANCELLED', 'Directory listing cancelled.', {
              mayHavePartialEffects: false,
            }),
            'ls',
          );
        }
        return results.join('\n');
      }

      const entries = await readdir(targetDir, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.isDirectory() ? '[DIR] ' : '      '}${entry.name}`)
        .join('\n');
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes('Path must remain')) {
        return formatToolFailure(
          createToolError('FORBIDDEN', err.message),
          'ls',
        );
      }
      return formatToolFailure(
        mapErrnoToToolError(error, { path: relativePath, operation: 'ls' }),
        'ls',
      );
    }
  },
};

async function walk(
  dir: string,
  root: string,
  results: string[],
  signal?: AbortSignal,
) {
  if (results.length >= MAX_RECURSIVE_ENTRIES || signal?.aborted) {
    return;
  }

  const list = await readdir(dir, { withFileTypes: true });
  for (const entry of list) {
    if (signal?.aborted || results.length >= MAX_RECURSIVE_ENTRIES) {
      if (results.length >= MAX_RECURSIVE_ENTRIES) {
        results.push(
          `... truncated after ${MAX_RECURSIVE_ENTRIES} entries to protect performance.`,
        );
      }
      return;
    }

    const res = join(dir, entry.name);
    const rel = relative(root, res);
    if (entry.isDirectory()) {
      results.push(`[DIR] ${rel}`);
      await walk(res, root, results, signal);
    } else {
      results.push(`      ${rel}`);
    }
  }
}
