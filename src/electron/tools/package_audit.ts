import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const packageAuditTool: Tool = {
  name: 'package_audit',
  description: 'Run the package manager security audit to find CVEs in dependencies. Uses npm audit under the hood.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(args, { workspacePath }) {
    try {
      const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024,
      });
      return formatAuditJson(stdout);
    } catch (error: any) {
      if (error.stdout) {
          return formatAuditJson(error.stdout);
      }
      return `Error executing package audit: ${error.message || error}`;
    }
  },
};

function formatAuditJson(stdout: string) {
    try {
        const data = JSON.parse(stdout);
        if (!data.vulnerabilities) return "No vulnerabilities found or unsupported format.";
        
        let report = `## Package Audit Report\n\n`;
        const vulns = Object.values(data.vulnerabilities) as any[];
        if (vulns.length === 0) return "No vulnerabilities found.";
        
        for (const v of vulns.slice(0, 20)) {
            report += `- **${v.name}** (${v.severity}): ${v.via?.[0]?.title || 'Known vulnerability'} (fix available: ${v.fixAvailable ? 'Yes' : 'No'})\n`;
        }
        if (vulns.length > 20) report += `\n... ${vulns.length - 20} more vulnerabilities not shown.`;
        return report;
    } catch(_e) {
        return stdout.substring(0, 2000);
    }
}
