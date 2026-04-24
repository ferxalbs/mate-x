import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const sourceMapAnalyzerTool: Tool = {
  name: 'source_map_analyzer',
  description: 'Aggressively scans minified bundles and source maps (.map, .js) for leaked secrets and environment variables (VITE_, REACT_APP_, etc).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory to scan (e.g., "dist", "build", ".next"). Defaults to ".".',
      },
    },
  },
  async execute(args, { workspacePath }) {
    const targetDir = args.path || '.';
    const patterns = [
      'process\\.env', 'VITE_', 'NEXT_PUBLIC_', 'REACT_APP_', 
      'API_KEY', 'SECRET', 'TOKEN', 'password'
    ];

    const commandArgs = [
      '--files-with-matches',
      '--ignore-case',
      '--color', 'never',
      '--type-add', 'bundle:*.{js,map}',
      '--type', 'bundle'
    ];

    for (const pat of patterns) {
        commandArgs.push('-e', pat);
    }
    
    // ignore node_modules
    commandArgs.push('--glob', '!node_modules/**');
    commandArgs.push('--', targetDir);

    try {
      const { stdout } = await execFileAsync('rg', commandArgs, {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!stdout.trim()) {
        return 'No leaked secrets or suspicious patterns found in bundles.';
      }

      const files = stdout.split('\n').filter(Boolean);
      return `🚨 Potential Secret Leaks Detected!\n\nThe following bundles/maps contain suspicious patterns (like API_KEY or env variables):\n\n${files.map(f => `- ${f}`).join('\n')}\n\nUse the 'rg' tool to investigate the exact lines in these files.`;
    } catch (error: any) {
      if (error.code === 1 && !error.stdout) {
        return 'No leaked secrets or suspicious patterns found in bundles.';
      }
      return `Error executing source map analyzer: ${error.message || error}`;
    }
  },
};
