import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

const SECURITY_PATTERNS = [
  { name: 'XSS Sink (innerHTML)', regex: /\.innerHTML\s*=/g, category: 'XSS' },
  { name: 'XSS Sink (dangerouslySetInnerHTML)', regex: /dangerouslySetInnerHTML/g, category: 'XSS' },
  { name: 'Command Injection (exec)', regex: /exec\(.*\)/g, category: 'Injection' },
  { name: 'Command Injection (spawn)', regex: /spawn\(.*\)/g, category: 'Injection' },
  { name: 'Insecure Eval', regex: /eval\(.*\)/g, category: 'Injection' },
  { name: 'Weak Crypto (MD5)', regex: /md5/gi, category: 'Crypto' },
  { name: 'Weak Crypto (SHA1)', regex: /sha1/gi, category: 'Crypto' },
  { name: 'Hardcoded TODO', regex: /\/\/.*TODO/gi, category: 'Logic' },
  { name: 'Hardcoded FIXME', regex: /\/\/.*FIXME/gi, category: 'Logic' },
];

export const securityAuditTool: Tool = {
  name: 'security_audit',
  description: 'Scans the codebase for high-risk patterns like XSS sinks, command injections, and weak crypto.',
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
      // Use rg to find the files efficiently
      // -- prevents argument injection from relativePath
      const { stdout } = await execFileAsync('rg', ['--files', '--', relativePath], { cwd: workspacePath });
      const files = stdout.split('\n').filter(Boolean);
      const results: Record<string, string[]> = {};

      for (const file of files) {
        if (file.includes('node_modules') || file.includes('.git')) continue;
        
        const content = await readFile(join(workspacePath, file), 'utf8');
        for (const pattern of SECURITY_PATTERNS) {
          const matches = content.match(pattern.regex);
          if (matches) {
            if (!results[pattern.category]) results[pattern.category] = [];
            results[pattern.category].push(`${file}: Found ${pattern.name} (${matches.length} matches)`);
          }
        }
      }

      let report = 'Security Audit Report:\n======================\n';
      const categories = Object.keys(results);
      if (categories.length === 0) return 'No high-risk patterns found.';

      for (const cat of categories) {
        report += `\n[${cat}]\n` + results[cat].slice(0, 10).join('\n');
        if (results[cat].length > 10) report += `\n... and ${results[cat].length - 10} more.`;
      }

      return report;
    } catch (error) {
      return `Error performing security audit: ${(error as Error).message}`;
    }
  },
};
