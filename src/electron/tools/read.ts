import { readFile } from 'node:fs/promises';
import { relative } from "node:path";
import type { Tool } from '../tool-service';
import {
  createToolError,
  formatToolFailure,
  mapErrnoToToolError,
} from '../tool-result';
import { limitTextOutput, resolveWorkspacePath } from "./tool-utils";

export const readTool: Tool = {
  name: 'read',
  description:
    'Read a file in the active workspace. Use for inspecting source after locating paths with rg/glob/ls. Supports optional 1-indexed line ranges. Does not search or list directories. Mutates nothing.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the workspace root.',
        minLength: 1,
      },
      lineStart: {
        type: 'number',
        description: 'Optional starting line number (1-indexed, inclusive).',
        minimum: 1,
      },
      lineEnd: {
        type: 'number',
        description: 'Optional ending line number (1-indexed, inclusive).',
        minimum: 1,
      },
    },
    required: ['path'],
  },
  async execute(args, { workspacePath, settings: _settings, signal }) {
    const { path, lineStart, lineEnd } = args;

    if (signal?.aborted) {
      return formatToolFailure(
        createToolError('CANCELLED', 'Read cancelled before start.'),
        'read',
      );
    }

    try {
      if (lineStart !== undefined && (!Number.isFinite(lineStart) || lineStart < 1)) {
        return formatToolFailure(
          createToolError(
            'INVALID_INPUT',
            'Invalid lineStart: must be a positive finite number.',
          ),
          'read',
        );
      }

      if (lineEnd !== undefined && (!Number.isFinite(lineEnd) || lineEnd < 1)) {
        return formatToolFailure(
          createToolError(
            'INVALID_INPUT',
            'Invalid lineEnd: must be a positive finite number.',
          ),
          'read',
        );
      }

      if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) {
        return formatToolFailure(
          createToolError(
            'INVALID_INPUT',
            'Invalid line range: lineEnd must be greater than or equal to lineStart.',
          ),
          'read',
        );
      }

      const targetFile = resolveWorkspacePath(workspacePath, path);
      const content = await readFile(targetFile, 'utf8');
      const lines = content.split('\n');
      const relPath = relative(workspacePath, targetFile);

      if (lineStart || lineEnd) {
        const start = Math.max(1, Number(lineStart || 1)) - 1;
        const end = Math.min(lines.length, Number(lineEnd || lines.length));
        const range = lines.slice(start, end);

        if (range.length === 0) {
          return formatToolFailure(
            createToolError(
              'MISSING_RESOURCE',
              'No lines found in the specified range.',
              {
                recommendedNextAction:
                  'Call read without lineStart/lineEnd or use a range within the file length.',
                details: { path: relPath, lineCount: lines.length },
              },
            ),
            'read',
          );
        }

        return limitTextOutput(
          `File: ${relPath}\nShowing lines ${start + 1} to ${start + range.length} of ${lines.length}:\n${range.join('\n')}`,
          60_000,
        );
      }

      return limitTextOutput(content, 50_000);
    } catch (error) {
      const readError = error as NodeJS.ErrnoException;
      if (readError.code === "ENOENT") {
        const requestedPath = typeof path === "string" ? path.trim() : String(path ?? "");
        return formatToolFailure(
          createToolError(
            'MISSING_RESOURCE',
            `File not found: ${requestedPath || "<empty path>"}`,
            {
              recommendedNextAction:
                'Call rg with an exact filename or symbol pattern, or ls the parent directory, before retrying read.',
              details: { path: requestedPath },
            },
          ),
          'read',
        );
      }

      if (readError.message?.includes('Path must remain')) {
        return formatToolFailure(
          createToolError('FORBIDDEN', readError.message, { retryable: false }),
          'read',
        );
      }

      return formatToolFailure(mapErrnoToToolError(error, { path, operation: 'read' }), 'read');
    }
  },
};
