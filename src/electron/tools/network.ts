import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

const URL_PATTERN = /https?:\/\/[a-zA-Z0-9.\-_/?=&%#@+!:[\]]+(?<!['"])/g;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export const networkMapTool: Tool = {
  name: 'network_map',
  description: 'Maps the application\'s network surface by extracting hardcoded URLs, API endpoints, and IP addresses.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory or file to scan (relative to workspace root). Defaults to ".".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const relativePath = args.path || '.';
    
    try {
      const { stdout } = await execFileAsync('rg', ['--files', relativePath], { cwd: workspacePath });
      const files = stdout.split('\n').filter(Boolean);
      const results: { urls: Set<string>; ips: Set<string> } = {
        urls: new Set(),
        ips: new Set(),
      };

      for (const file of files) {
        if (file.includes('node_modules') || file.includes('.git') || file.endsWith('.lock')) continue;
        
        const content = await readFile(join(workspacePath, file), 'utf8');
        const urls = content.match(URL_PATTERN);
        if (urls) urls.forEach(u => results.urls.add(u));

        const ips = content.match(IP_PATTERN);
        if (ips) ips.forEach(i => results.ips.add(i));
      }

      let report = 'Network Surface Report:\n======================\n';
      
      if (results.urls.size > 0) {
        report += '\n[Extracted URLs]\n' + Array.from(results.urls).slice(0, 30).join('\n');
        if (results.urls.size > 30) report += `\n... ${results.urls.size - 30} more.`;
      } else {
        report += '\nNo hardcoded URLs found.';
      }

      if (results.ips.size > 0) {
        report += '\n\n[Extracted IP Addresses]\n' + Array.from(results.ips).join('\n');
      }

      return report;
    } catch (error) {
      return `Error mapping network surface: ${(error as Error).message}`;
    }
  },
};
