import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

const SQL_INJECTION_PATTERNS = [
  { name: 'Template Literal Query', regex: /\.query\s*\(\s*`.*?\$\{.*?\}.*?`\s*\)/gs },
  { name: 'Concatenated Query', regex: /\.query\s*\(\s*['"].*?['"]\s*\+\s*.*?\)/g },
  { name: 'Unsafe Find (NoSQL)', regex: /\.find\s*\(\s*\{\s*.*?\$\{.*?\}.*?\}\s*\)/gs },
  { name: 'Raw Execute', regex: /\.execute\s*\(\s*`.*?\$\{.*?\}.*?`\s*\)/gs },
];

export const sqlAuditTool: Tool = {
  name: 'sql_audit',
  description: 'Scans for SQL and NoSQL injection vulnerabilities, specifically identifying insecure query construction.',
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
      // -- prevents argument injection from relativePath
      const { stdout } = await execFileAsync('rg', ['--files', '--', relativePath], { cwd: workspacePath });
      const files = stdout.split('\n').filter(Boolean);
      const findings: string[] = [];

      for (const file of files) {
        if (file.includes('node_modules') || file.includes('.git')) continue;
        
        const content = await readFile(join(workspacePath, file), 'utf8');
        for (const pattern of SQL_INJECTION_PATTERNS) {
          const matches = content.match(pattern.regex);
          if (matches) {
            findings.push(`${file}: Detected potential ${pattern.name} (${matches.length} matches)`);
          }
        }
      }

      return findings.length > 0 
        ? `SQL/NoSQL Audit findings:\n${findings.join('\n')}`
        : 'No immediate SQL/NoSQL injection patterns identified.';
    } catch (error) {
      return `Error auditing database queries: ${(error as Error).message}`;
    }
  },
};
