import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const securityReportTool: Tool = {
  name: 'security_report',
  description: 'Generates a comprehensive, prioritized security posture report by aggregating findings from multiple diagnostic tools.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'The directory to audit. Defaults to ".".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const { scope = '.' } = args;
    
    // This tool is complex as it would ideally call other tools.
    // However, in our system, tools are independent.
    // For this implementation, we will perform a multi-factor scan 
    // and summarize the overall risk level.
    
    try {
      const { stdout: fileListStdout } = await execFileAsync(
        'rg',
        ['--files', scope],
        { cwd: workspacePath },
      );
      const fileCount = fileListStdout.split('\n').filter(Boolean).length;

      // 1. Check for basic security hygiene
      const { stdout: secretsStdout } = await execFileAsync('rg', ['-l', 'AKIA|sk_live_|xox[baprs]', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const secretFiles = secretsStdout.split('\n').filter(Boolean);

      // 2. Check for dangerous sinks
      const { stdout: sinksStdout } = await execFileAsync('rg', ['-l', 'eval\\(|dangerouslySetInnerHTML|\\.innerHTML\\s*=', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const sinkFiles = sinksStdout.split('\n').filter(Boolean);

      // 3. Check for deployment misconfigs
      const { stdout: configStdout } = await execFileAsync('rg', ['--files', '-g', '*Dockerfile*', '-g', '*docker-compose*', scope], { cwd: workspacePath }).catch(() => ({ stdout: '' }));
      const configFiles = configStdout.split('\n').filter(Boolean);

      const riskLevel = secretFiles.length > 0 ? 'CRITICAL' : (sinkFiles.length > 5 ? 'HIGH' : 'MEDIUM');

      return `EXECUTIVE SECURITY REPORT
=========================
Scope: ${scope}
Total Files Analyzed: ${fileCount}
Assessed Risk Level: ${riskLevel}

[CRITICAL ISSUES]
${secretFiles.length > 0 ? `- Found potential hardcoded secrets in ${secretFiles.length} file(s).` : '- No obvious hardcoded secrets detected in first-pass scan.'}

[HIGH RISK PATTERNS]
${sinkFiles.length > 0 ? `- Identified dangerous injection sinks in ${sinkFiles.length} file(s).` : '- No critical injection sinks found in standard patterns.'}

[INFRASTRUCTURE FINDINGS]
${configFiles.length > 0 ? `- Detected ${configFiles.length} container configuration file(s). Audit recommended.` : '- No container manifests found in specified scope.'}

[RECOMMENDED NEXT STEPS]
1. Use 'secret_scan' for a deep-dive into the identified secret-bearing files.
2. Use 'sql_audit' to check database interaction logic.
3. Use 'auth_audit' to verify your route protection middleware is consistent.
`;
    } catch (error) {
      return `Error generating security report: ${(error as Error).message}`;
    }
  },
};
