import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const accessControlAuditTool: Tool = {
  name: 'auth_audit',
  description: 'Analyzes application routes and identifies potentially unprotected or inconsistent access control patterns.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to scan for routes (e.g., "src/routes"). Defaults to ".".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings }) {
    const { path = '.' } = args;
    
    try {
      // Find files that likely contain routes
      // -- prevents argument injection from path
      const { stdout } = await execFileAsync('rg', ['--files', '-g', '*.{ts,js}', '--', path], { cwd: workspacePath });
      const files = stdout.split('\n').filter(Boolean);
      const findings: string[] = [];

      for (const file of files) {
        const content = await readFile(join(workspacePath, file), 'utf8');
        
        // Match common route patterns: .get(', .post(', router.get(', etc.
        const routeMatches = content.matchAll(/\.(get|post|put|delete|patch)\s*\(\s*['"](.+?)['"]/g);
        
        for (const match of routeMatches) {
          const method = match[1].toUpperCase();
          const route = match[2];
          
          // Check if the line containing the route has middleware
          const lines = content.split('\n');
          const routeLineIndex = lines.findIndex(l => l.includes(match[0]));
          
          if (routeLineIndex !== -1) {
            const surroundingCode = lines.slice(Math.max(0, routeLineIndex - 1), routeLineIndex + 2).join('\n');
            const hasAuth = /auth|ensure|protect|verify|token|passport|jwt|guard/i.test(surroundingCode);
            
            if (!hasAuth) {
              findings.push(`[POTENTIALLY UNPROTECTED] ${method} ${route} in ${file}`);
            } else {
              findings.push(`[PROTECTED] ${method} ${route} (Detected middleware signature)`);
            }
          }
        }
      }

      return findings.length > 0
        ? `Access Control Audit for "${path}":\n\n${findings.join('\n')}`
        : 'Scan complete. No standard route patterns identified.';
    } catch (error) {
      return `Error auditing access control: ${(error as Error).message}`;
    }
  },
};
