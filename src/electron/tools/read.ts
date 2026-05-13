import { readFile } from 'node:fs/promises';
import { relative } from "node:path";
import type { Tool } from '../tool-service';
import { limitTextOutput, resolveWorkspacePath } from "./tool-utils";

export const readTool: Tool = {
  name: 'read',
  description: 'Read the contents of a specific file. Useful for auditing code for vulnerabilities.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read (relative to workspace root).',
      },
      lineStart: {
        type: 'number',
        description: 'Optional starting line number (1-indexed).',
      },
      lineEnd: {
        type: 'number',
        description: 'Optional ending line number (1-indexed, inclusive).',
      },
    },
    required: ['path'],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const { path, lineStart, lineEnd } = args;

    try {
      if (lineStart !== undefined && (!Number.isFinite(lineStart) || lineStart < 1)) {
        return 'Invalid lineStart: must be a positive finite number.';
      }

      if (lineEnd !== undefined && (!Number.isFinite(lineEnd) || lineEnd < 1)) {
        return 'Invalid lineEnd: must be a positive finite number.';
      }

      if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) {
        return 'Invalid line range: lineEnd must be greater than or equal to lineStart.';
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
          return 'No lines found in the specified range.';
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
        return [
          `File not found: ${requestedPath || "<empty path>"}`,
          "The file does not exist in the active workspace.",
          `Next step: call rg with an exact filename or symbol pattern before retrying read.`,
        ].join("\n");
      }

      return `Error reading file: ${(error as Error).message}`;
    }
  },
};
