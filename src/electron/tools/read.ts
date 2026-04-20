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
  async execute(args, { workspacePath }) {
    const { path, lineStart, lineEnd } = args;

    try {
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
      return `Error reading file: ${(error as Error).message}`;
    }
  },
};
