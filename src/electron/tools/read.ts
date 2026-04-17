import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../tool-service';

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
    const targetFile = join(workspacePath, path);

    try {
      const content = await readFile(targetFile, 'utf8');
      const lines = content.split('\n');

      if (lineStart || lineEnd) {
        const start = (lineStart || 1) - 1;
        const end = lineEnd || lines.length;
        const range = lines.slice(start, end);

        if (range.length === 0) {
          return 'No lines found in the specified range.';
        }

        return `Showing lines ${start + 1} to ${start + range.length} of ${lines.length}:\n${range.join('\n')}`;
      }

      // Limit overall content if it's too large
      if (content.length > 50000) {
        return content.slice(0, 50000) + '\n... (truncated due to size, use lineStart/lineEnd to read specific parts)';
      }

      return content;
    } catch (error) {
      return `Error reading file: ${(error as Error).message}`;
    }
  },
};
