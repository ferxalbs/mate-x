import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type { Tool } from '../tool-service';
import { isInsideWorkspace, resolveWorkspacePath } from './tool-utils';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const DEFAULT_MAX_DEPTH = 20;
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'coverage',
  'target',
  '.next',
]);

type SearchOptions = {
  root: string;
  searchName: string;
  exact: boolean;
  includeHidden: boolean;
  extensions: string[];
  exclude: string[];
  maxDepth: number;
  limit: number;
  results: string[];
};

const toStringArray = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const matchesName = (fileName: string, searchName: string, exact: boolean) => {
  const normalizedFileName = fileName.toLowerCase();
  return exact ? normalizedFileName === searchName : normalizedFileName.includes(searchName);
};

const matchesExtension = (fileName: string, extensions: string[]) =>
  extensions.length === 0 || extensions.some((extension) => fileName.toLowerCase().endsWith(`.${extension.toLowerCase()}`));

const isExcluded = (relativePath: string, exclude: string[]) =>
  exclude.some((excluded) => relativePath === excluded || relativePath.includes(excluded));

export const findTool: Tool = {
  name: 'find',
  description: 'Search files by name in workspace using pure Node. Supports exact/substr match, extension filters, excludes, hidden toggle, depth, and caps.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to search in (relative to workspace root). Defaults to ".".',
      },
      name: {
        type: 'string',
        description: 'The substring to match in the filename (case-insensitive).',
      },
      exact: {
        type: 'boolean',
        description: 'Match the full filename instead of substring. Defaults to false.',
      },
      extensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional extension filter without dots, e.g. ["ts", "tsx"].',
      },
      exclude: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional path substrings to exclude.',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files/directories. Defaults to false.',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum directory depth to search. Defaults to 20.',
      },
      limit: {
        type: 'number',
        description: 'Max results to return. Defaults to 500, capped at 2000.',
      },
    },
    required: ['name'],
  },
  async execute(args, { workspacePath }) {
    const targetDir = resolveWorkspacePath(workspacePath, args.path || '.');
    const searchName = String(args.name || '').trim().toLowerCase();
    const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);

    if (!searchName) return 'Find name is required.';
    if (!isInsideWorkspace(workspacePath, targetDir)) return 'Refusing to search outside the workspace.';

    const options: SearchOptions = {
      root: workspacePath,
      searchName,
      exact: args.exact === true,
      includeHidden: args.includeHidden === true,
      extensions: toStringArray(args.extensions).map((extension) => extension.replace(/^\./, '')),
      exclude: toStringArray(args.exclude),
      maxDepth: toPositiveInteger(args.maxDepth, DEFAULT_MAX_DEPTH, 100),
      limit,
      results: [],
    };

    try {
      await searchFiles(targetDir, options, 0);
      if (options.results.length === 0) return 'No matching files found.';
      
      const summary = `Find matches: ${options.results.length} file(s) for "${searchName}"`;
      return `${summary}\n${options.results.join('\n')}`;
    } catch (error) {
      return `Error executing find: ${(error as Error).message}`;
    }
  },
};

async function searchFiles(dir: string, options: SearchOptions, depth: number) {
  if (options.results.length >= options.limit || depth > options.maxDepth) return;
  
  const entries = await readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
  for (const entry of entries) {
    if (options.results.length >= options.limit) return;
    if (!options.includeHidden && entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    
    const fullPath = join(dir, entry.name);
    const relativePath = relative(options.root, fullPath);
    if (isExcluded(relativePath, options.exclude)) continue;

    if (!entry.isDirectory() && matchesName(entry.name, options.searchName, options.exact) && matchesExtension(entry.name, options.extensions)) {
      options.results.push(relativePath);
    }
    
    if (entry.isDirectory()) {
      await searchFiles(fullPath, options, depth + 1);
    }
  }
}
