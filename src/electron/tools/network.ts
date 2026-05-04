import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

const URL_PATTERN = /https?:\/\/[a-zA-Z0-9.\-_/?=&%#@+!:[\]]+(?<!['"])/g;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PLACEHOLDER_PATTERN = /\b(?:REPLACE_ME|your-rainy-host|example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)\b/gi;
const PRIVATE_IP_BLOCKS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

type NetworkFinding = {
  type: 'url' | 'ip' | 'placeholder';
  value: string;
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'info';
  reason: string;
};

const shouldSkipFile = (file: string) => (
  file.includes('node_modules/')
  || file.includes('.git/')
  || file.includes('dist/')
  || file.includes('coverage/')
  || file.endsWith('.lock')
  || file.endsWith('.map')
);

const severityRank = { critical: 0, high: 1, medium: 2, info: 3 } as const;

function classifyIp(ip: string): Pick<NetworkFinding, 'severity' | 'reason'> {
  if (ip === '169.254.169.254') {
    return { severity: 'critical', reason: 'cloud metadata endpoint; SSRF target if reachable from outbound request logic' };
  }
  if (PRIVATE_IP_BLOCKS.some(pattern => pattern.test(ip))) {
    return { severity: 'high', reason: 'private or link-local address; block from user-controlled outbound requests' };
  }
  return { severity: 'info', reason: 'public IP literal; verify it belongs in committed source' };
}

function classifyUrl(url: string): Pick<NetworkFinding, 'severity' | 'reason'> {
  const lower = url.toLowerCase();
  if (lower.includes('your-rainy-host') || lower.includes('replace_me') || lower.includes('example.com')) {
    return { severity: 'high', reason: 'placeholder URL in source; replace with validated configuration or remove dead template' };
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('0.0.0.0')) {
    return { severity: 'medium', reason: 'local endpoint literal; confirm it is dev-only and not production logic' };
  }
  return { severity: 'info', reason: 'external URL; confirm expected egress domain and ownership' };
}

function addMatches(
  findings: NetworkFinding[],
  file: string,
  line: number,
  values: Iterable<string>,
  type: NetworkFinding['type'],
) {
  for (const value of values) {
    const classification = type === 'ip'
      ? classifyIp(value)
      : type === 'url'
        ? classifyUrl(value)
        : { severity: 'high' as const, reason: 'configuration placeholder token committed in source' };
    findings.push({ type, value, file, line, ...classification });
  }
}

function uniqueFindings(findings: NetworkFinding[]) {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.type}:${finding.value}:${finding.file}:${finding.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  async execute(args, { workspacePath, settings: _settings }) {
    const relativePath = args.path || '.';
    
    try {
      const targetStat = await stat(join(workspacePath, relativePath));
      // -- prevents argument injection from relativePath
      const files = targetStat.isFile()
        ? [relativePath]
        : (await execFileAsync('rg', ['--files', '--', relativePath], { cwd: workspacePath })).stdout.split('\n').filter(Boolean);
      const findings: NetworkFinding[] = [];

      for (const file of files) {
        if (shouldSkipFile(file)) continue;
        
        const content = await readFile(join(workspacePath, file), 'utf8');
        const lines = content.split(/\r?\n/);
        lines.forEach((lineContent, index) => {
          addMatches(findings, file, index + 1, lineContent.match(URL_PATTERN) ?? [], 'url');
          addMatches(findings, file, index + 1, lineContent.match(IP_PATTERN) ?? [], 'ip');
          addMatches(findings, file, index + 1, lineContent.match(PLACEHOLDER_PATTERN) ?? [], 'placeholder');
        });
      }

      const sortedFindings = uniqueFindings(findings).sort((a, b) => (
        severityRank[a.severity] - severityRank[b.severity]
        || a.file.localeCompare(b.file)
        || a.line - b.line
      ));
      const counts = sortedFindings.reduce<Record<NetworkFinding['severity'], number>>((acc, finding) => {
        acc[finding.severity] += 1;
        return acc;
      }, { critical: 0, high: 0, medium: 0, info: 0 });

      let report = 'Network Surface Map\n===================\n';
      report += `Scope: ${relativePath}\nFiles scanned: ${files.filter(file => !shouldSkipFile(file)).length}\n`;
      report += `Findings: ${sortedFindings.length} (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.info} info)\n`;

      if (sortedFindings.length === 0) {
        report += '\nNo URLs, IP literals, or known placeholder endpoints found in scanned source.';
        return report;
      }

      report += '\nEvidence\n--------\n';
      for (const finding of sortedFindings.slice(0, 80)) {
        report += `- [${finding.severity.toUpperCase()}] ${finding.type}: ${finding.value}\n`;
        report += `  Location: ${finding.file}:${finding.line}\n`;
        report += `  Why it matters: ${finding.reason}\n`;
      }
      if (sortedFindings.length > 80) report += `\n... ${sortedFindings.length - 80} additional evidence item(s) omitted.\n`;

      const hasPlaceholders = sortedFindings.some(finding => finding.type === 'placeholder');
      const hasPrivateTargets = sortedFindings.some(finding => finding.severity === 'critical' || finding.reason.includes('private'));
      report += '\nRecommended Fixes\n-----------------\n';
      if (hasPlaceholders) {
        report += '- Replace placeholder endpoints with validated settings loaded in the main process. Fail startup if placeholder values remain.\n';
      }
      if (hasPrivateTargets) {
        report += '- Add outbound request guardrails: allowlist expected domains, reject private/link-local/metadata IPs after DNS resolution, and log blocked targets.\n';
      }
      report += '- Treat each listed URL/IP as an egress contract: owner, environment, allowed method, and user-input reachability should be documented or removed.\n';

      return report;
    } catch (error) {
      return `Error mapping network surface: ${(error as Error).message}`;
    }
  },
};
