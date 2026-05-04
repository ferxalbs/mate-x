import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

const URL_PATTERN = /https?:\/\/[a-zA-Z0-9.\-_/?=&%#@+!:[\]]+(?<!['"])/g;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PLACEHOLDER_PATTERN = /\b(?:REPLACE_ME|your-rainy-host|example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)\b/gi;
const NETWORK_SEARCH_PATTERN = 'https?://|[0-9]{1,3}(\\.[0-9]{1,3}){3}|REPLACE_ME|your-rainy-host|example\\.com|localhost';
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
  sourceRole: 'active' | 'test' | 'docs' | 'example' | 'scanner';
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

function sourceRoleFor(file: string, lineContent = ''): NetworkFinding['sourceRole'] {
  const lower = file.toLowerCase();
  const line = lineContent.toLowerCase();
  if (lower.includes('src/electron/tools/')) return 'scanner';
  if (lower.includes('src/electron/privacy/privacy-regex-scanner') || lower.includes('src/electron/privacy/privacy-canary')) return 'scanner';
  if (
    lower.includes('/tools/')
    && (
      line.includes('pattern')
      || line.includes('regex')
      || line.includes('private_ip_blocks')
      || line.includes('ssrf')
      || line.includes('metadata endpoint')
      || line.includes('recommended fixes')
    )
  ) return 'scanner';
  if (lower.includes('/docs/') || lower.endsWith('.md') || lower.endsWith('.mdx')) return 'docs';
  if (lower.includes('/test/') || lower.includes('/tests/') || lower.includes('.test.') || lower.includes('.spec.')) return 'test';
  if (lower.includes('/example') || lower.includes('/examples/') || lower.includes('/fixtures/') || lower.includes('/demo/')) return 'example';
  return 'active';
}

function adjustForSourceRole(
  classification: Pick<NetworkFinding, 'severity' | 'reason'>,
  sourceRole: NetworkFinding['sourceRole'],
): Pick<NetworkFinding, 'severity' | 'reason'> {
  if (sourceRole === 'active') return classification;
  if (classification.severity === 'critical') {
    return { severity: 'medium', reason: `${classification.reason}; found in ${sourceRole}, verify it is not copied into runtime configuration` };
  }
  return { severity: 'info', reason: `${classification.reason}; found in ${sourceRole}, not active runtime evidence by itself` };
}

function classifyIp(ip: string, sourceRole: NetworkFinding['sourceRole']): Pick<NetworkFinding, 'severity' | 'reason'> {
  const classification: Pick<NetworkFinding, 'severity' | 'reason'> = (() => {
  if (ip === '169.254.169.254') {
    return { severity: 'critical', reason: 'cloud metadata endpoint; SSRF target if reachable from outbound request logic' };
  }
  if (PRIVATE_IP_BLOCKS.some(pattern => pattern.test(ip))) {
    return { severity: 'high', reason: 'private or link-local address; block from user-controlled outbound requests' };
  }
  return { severity: 'info', reason: 'public IP literal; verify it belongs in committed source' };
  })();
  return adjustForSourceRole(classification, sourceRole);
}

function classifyUrl(url: string, sourceRole: NetworkFinding['sourceRole']): Pick<NetworkFinding, 'severity' | 'reason'> {
  const lower = url.toLowerCase();
  const classification: Pick<NetworkFinding, 'severity' | 'reason'> = (() => {
  if (lower.includes('your-rainy-host') || lower.includes('replace_me') || lower.includes('example.com')) {
    return { severity: 'high', reason: 'placeholder URL in source; replace with validated configuration or remove dead template' };
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('0.0.0.0')) {
    return { severity: 'medium', reason: 'local endpoint literal; confirm it is dev-only and not production logic' };
  }
  return { severity: 'info', reason: 'external URL; confirm expected egress domain and ownership' };
  })();
  return adjustForSourceRole(classification, sourceRole);
}

function addMatches(
  findings: NetworkFinding[],
  file: string,
  line: number,
  lineContent: string,
  values: Iterable<string>,
  type: NetworkFinding['type'],
) {
  const sourceRole = sourceRoleFor(file, lineContent);
  for (const value of values) {
    const classification = type === 'ip'
      ? classifyIp(value, sourceRole)
      : type === 'url'
        ? classifyUrl(value, sourceRole)
        : adjustForSourceRole({ severity: 'high' as const, reason: 'configuration placeholder token committed in source' }, sourceRole);
    findings.push({ type, value, file, line, sourceRole, ...classification });
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
      const files = targetStat.isFile()
        ? [relativePath]
        : (await execFileAsync('rg', ['--files', '--', relativePath], { cwd: workspacePath })).stdout.split('\n').filter(Boolean);
      const findings: NetworkFinding[] = [];
      const scannedFiles = files.filter(file => !shouldSkipFile(file));

      if (scannedFiles.length > 0) {
        const { stdout } = await execFileAsync(
          'rg',
          ['-n', '--no-heading', NETWORK_SEARCH_PATTERN, '--', ...scannedFiles],
          { cwd: workspacePath, maxBuffer: 1024 * 1024 * 8 },
        ).catch(() => ({ stdout: '' }));
        for (const row of stdout.split('\n').filter(Boolean)) {
          const match = /^(.*?):(\d+):(.*)$/.exec(row);
          if (!match) continue;
          const [, file, lineText, lineContent] = match;
          const line = Number(lineText);
          addMatches(findings, file, line, lineContent, lineContent.match(URL_PATTERN) ?? [], 'url');
          addMatches(findings, file, line, lineContent, lineContent.match(IP_PATTERN) ?? [], 'ip');
          addMatches(findings, file, line, lineContent, lineContent.match(PLACEHOLDER_PATTERN) ?? [], 'placeholder');
        }
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
      report += `Scope: ${relativePath}\nFiles scanned: ${scannedFiles.length}\n`;
      report += `Findings: ${sortedFindings.length} (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.info} info)\n`;

      if (sortedFindings.length === 0) {
        report += '\nNo URLs, IP literals, or known placeholder endpoints found in scanned source.';
        return report;
      }

      report += '\nEvidence\n--------\n';
      for (const finding of sortedFindings.slice(0, 80)) {
        report += `- [${finding.severity.toUpperCase()}] ${finding.type}: ${finding.value}\n`;
        report += `  Location: ${finding.file}:${finding.line} (${finding.sourceRole})\n`;
        report += `  Why it matters: ${finding.reason}\n`;
      }
      if (sortedFindings.length > 80) report += `\n... ${sortedFindings.length - 80} additional evidence item(s) omitted.\n`;

      const hasPlaceholders = sortedFindings.some(finding => finding.type === 'placeholder' && finding.sourceRole === 'active');
      const hasPrivateTargets = sortedFindings.some(finding => finding.sourceRole === 'active' && (finding.severity === 'critical' || finding.reason.includes('private')));
      report += '\nRecommended Fixes\n-----------------\n';
      if (hasPlaceholders) {
        report += '- Active-source placeholders: replace with validated settings loaded in the main process. Fail startup if placeholder values remain.\n';
      }
      if (hasPrivateTargets) {
        report += '- Add outbound request guardrails: allowlist expected domains, reject private/link-local/metadata IPs after DNS resolution, and log blocked targets.\n';
      }
      if (!hasPlaceholders && !hasPrivateTargets) {
        report += '- No active-source network blockers found. Review info-level docs/test findings only if they mirror runtime configuration.\n';
      }
      report += '- For active URLs/IPs, define egress contract: owner, environment, allowed method, and user-input reachability.\n';

      return report;
    } catch (error) {
      return `Error mapping network surface: ${(error as Error).message}`;
    }
  },
};
