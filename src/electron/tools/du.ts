import { stat, readdir } from 'node:fs/promises';
import type { Stats, Dirent } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../tool-service';
import { resolveWorkspacePath } from './tool-utils';

export const duTool: Tool = {
  name: 'du',
  description:
    'Estimate file space usage of a directory or file. ' +
    'Supports depth-limited breakdowns and top-N largest entry reports.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to check (relative to workspace root). Defaults to ".".',
      },
      depth: {
        type: 'number',
        description:
          'How many directory levels to show in the breakdown (0 = total only, 1 = immediate children, …). Defaults to 1.',
      },
      top: {
        type: 'number',
        description:
          'If set, return only the N largest entries instead of a full tree. Overrides depth.',
      },
    },
  },
  async execute(args, { workspacePath }) {
    const relativePath = (args.path as string | undefined) || '.';
    const depth = typeof args.depth === 'number' ? Math.max(0, args.depth) : 1;
    const top = typeof args.top === 'number' ? Math.max(1, args.top) : undefined;
    const targetPath = resolveWorkspacePath(workspacePath, relativePath);

    try {
      const rootStat = await stat(targetPath).catch((): Stats | null => null);
      if (!rootStat) {
        return `du: cannot access "${relativePath}": No such file or directory`;
      }

      if (rootStat.isFile()) {
        return `${formatSize(rootStat.size)}\t${relativePath}`;
      }

      // Collect per-entry sizes for breakdown / top-N
      const entries = await collectEntries(targetPath, relativePath, depth);
      const totalBytes = await getDirSize(targetPath);

      if (top !== undefined) {
        const sorted = [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, top);
        const lines = sorted.map((e) => `${formatSize(e.bytes)}\t${e.label}`);
        lines.push('');
        lines.push(`Total: ${formatSize(totalBytes)}\t${relativePath}`);
        return lines.join('\n');
      }

      const lines = entries.map((e) => `${formatSize(e.bytes)}\t${e.label}`);
      lines.push('');
      lines.push(`Total: ${formatSize(totalBytes)}\t${relativePath}`);
      return lines.join('\n');
    } catch (error) {
      return `du: error — ${(error as Error).message}`;
    }
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

interface Entry {
  label: string;
  bytes: number;
}

async function collectEntries(
  absPath: string,
  label: string,
  depth: number,
): Promise<Entry[]> {
  if (depth === 0) return [];

  const children = await readdir(absPath, { withFileTypes: true }).catch((): Dirent[] => []);
  const result: Entry[] = [];

  await Promise.all(
    children.map(async (child) => {
      if (child.isSymbolicLink()) return; // skip symlinks to avoid cycles
      const childAbs = join(absPath, child.name);
      const childLabel = `${label}/${child.name}`;
      const bytes = await getDirSize(childAbs);
      result.push({ label: childLabel, bytes });

      if (child.isDirectory() && depth > 1) {
        const nested = await collectEntries(childAbs, childLabel, depth - 1);
        result.push(...nested);
      }
    }),
  );

  // Sort siblings by descending size for readability
  return result.sort((a, b) => b.bytes - a.bytes);
}

async function getDirSize(dirPath: string): Promise<number> {
  const fileStat = await stat(dirPath).catch((): Stats | null => null);
  if (!fileStat) return 0;
  if (fileStat.isFile()) return fileStat.size;
  if (fileStat.isSymbolicLink()) return 0; // skip symlinks

  const entries = await readdir(dirPath, { withFileTypes: true }).catch((): Dirent[] => []);

  const sizes = await Promise.all(
    entries.map(async (entry): Promise<number> => {
      if (entry.isSymbolicLink()) return 0;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) return getDirSize(fullPath);
      if (entry.isFile()) {
        const s = await stat(fullPath).catch((): { size: number } => ({ size: 0 }));
        return s.size;
      }
      return 0;
    }),
  );

  return sizes.reduce((sum, n) => sum + n, 0);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
