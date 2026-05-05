import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

type SourceRole = 'active' | 'test' | 'docs' | 'example' | 'scanner' | 'generated';
type Severity = 'critical' | 'high' | 'medium' | 'info';

type Matcher = {
  slug: string;
  title: string;
  pattern: RegExp;
  search: string;
  severity: Severity;
  reason: string;
};

type Candidate = {
  matcher: Matcher;
  file: string;
  line: number;
  sourceRole: SourceRole;
  evidence: string;
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
};

const MATCHERS: Matcher[] = [
  {
    slug: 'command-exec',
    title: 'Shell or process execution',
    pattern: /\b(?:exec|execFile|spawn|spawnSync|execSync|system|popen|shell)\s*\(|\bchild_process\b|from\s+['"]node:child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
    search: "\\b(exec|execFile|spawn|spawnSync|execSync|system|popen|shell)\\s*\\(|\\bchild_process\\b|from\\s+['\\\"]node:child_process['\\\"]|require\\s*\\(\\s*['\\\"](?:node:)?child_process['\\\"]\\s*\\)",
    severity: 'high',
    reason: 'process execution can become command injection when arguments include user-controlled data',
  },
  {
    slug: 'dynamic-code',
    title: 'Dynamic code execution',
    pattern: /\b(eval|Function|vm\.runIn|setTimeout|setInterval)\s*\(/,
    search: '\\b(eval|Function|vm\\.runIn|setTimeout|setInterval)\\s*\\(',
    severity: 'high',
    reason: 'dynamic execution can convert untrusted strings into code',
  },
  {
    slug: 'sql-construction',
    title: 'SQL string construction',
    pattern: /\b(query|execute|raw|prepare)\s*\([^)]*(\+|`|\$\{)/,
    search: '\\b(query|execute|raw|prepare)\\s*\\([^)]*(\\+|`|\\$\\{)',
    severity: 'high',
    reason: 'query construction needs parameterization evidence',
  },
  {
    slug: 'path-traversal',
    title: 'Filesystem path assembly',
    pattern: /\b(readFile|writeFile|createReadStream|createWriteStream|unlink|rm|copyFile|rename)\s*\(/,
    search: '\\b(readFile|writeFile|createReadStream|createWriteStream|unlink|rm|copyFile|rename)\\s*\\(',
    severity: 'medium',
    reason: 'filesystem access needs path normalization and workspace-bound checks',
  },
  {
    slug: 'ssrf-egress',
    title: 'Outbound request sink',
    pattern: /\b(fetch|axios|request|got|http\.request|https\.request)\s*\(/,
    search: '\\b(fetch|axios|request|got|http\\.request|https\\.request)\\s*\\(',
    severity: 'medium',
    reason: 'outbound requests need egress allowlists when URLs are user influenced',
  },
  {
    slug: 'ipc-boundary',
    title: 'Electron IPC boundary',
    pattern: /\b(ipcMain\.handle|ipcMain\.on|ipcRenderer\.invoke|contextBridge\.exposeInMainWorld)\b/,
    search: '\\b(ipcMain\\.handle|ipcMain\\.on|ipcRenderer\\.invoke|contextBridge\\.exposeInMainWorld)\\b',
    severity: 'high',
    reason: 'IPC handlers are trust boundaries and need input validation',
  },
  {
    slug: 'unsafe-html',
    title: 'HTML injection sink',
    pattern: /\b(dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML)\b/,
    search: '\\b(dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML)\\b',
    severity: 'medium',
    reason: 'HTML sinks need trusted sanitization evidence',
  },
  {
    slug: 'weak-crypto',
    title: 'Weak crypto primitive',
    pattern: /\b(md5|sha1|createCipher|createDecipher|Math\.random)\b/,
    search: '\\b(md5|sha1|createCipher|createDecipher|Math\\.random)\\b',
    severity: 'medium',
    reason: 'weak primitives can break token, signing, or encryption guarantees',
  },
  {
    slug: 'auth-bypass',
    title: 'Auth bypass marker',
    pattern: /\b(skipAuth|disableAuth|bypass|allowAnonymous|TODO.*auth|FIXME.*auth)\b/i,
    search: '\\b(skipAuth|disableAuth|bypass|allowAnonymous|TODO.*auth|FIXME.*auth)\\b',
    severity: 'high',
    reason: 'auth bypass markers need explicit environment gating or removal',
  },
];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3 };

const shouldSkipFile = (file: string) => (
  file.includes('node_modules/')
  || file.includes('.git/')
  || file.includes('dist/')
  || file.includes('.next/')
  || file.includes('out/')
  || file.includes('target/')
  || file.includes('coverage/')
  || file.endsWith('.lock')
  || file.endsWith('.map')
);

function sourceRoleFor(file: string, evidence: string): SourceRole {
  const lower = file.toLowerCase();
  const line = evidence.toLowerCase();
  if (lower.endsWith('.generated.ts') || lower.endsWith('.d.ts')) return 'generated';
  if (/(scanner|canary|fuzzer|prober|poison|audit|security-trace)/.test(lower)) return 'scanner';
  if (lower.includes('/docs/') || lower.endsWith('.md') || lower.endsWith('.mdx')) return 'docs';
  if (lower.includes('/test/') || lower.includes('/tests/') || lower.includes('.test.') || lower.includes('.spec.')) return 'test';
  if (lower.includes('/example') || lower.includes('/examples/') || lower.includes('/fixtures/') || lower.includes('/demo/')) return 'example';
  if (line.includes('example') || line.includes('fixture')) return 'example';
  return 'active';
}

function adjustSeverity(severity: Severity, sourceRole: SourceRole): Severity {
  if (sourceRole === 'active') return severity;
  if (sourceRole === 'generated') return 'info';
  return severity === 'critical' || severity === 'high' ? 'medium' : 'info';
}

function confidenceFor(sourceRole: SourceRole, evidence: string): Candidate['confidence'] {
  if (sourceRole !== 'active') return 'low';
  if (/\b(req|request|input|payload|body|params|query|argv|env)\b/i.test(evidence)) return 'high';
  return 'medium';
}

function parseRgRows(stdout: string, files: Set<string>): Candidate[] {
  const candidates: Candidate[] = [];
  for (const row of stdout.split('\n').filter(Boolean)) {
    const match = /^(.*?):(\d+):(.*)$/.exec(row);
    if (!match) continue;
    const [, file, lineText, evidence] = match;
    if (!files.has(file)) continue;
    for (const matcher of MATCHERS) {
      if (!matcher.pattern.test(evidence)) continue;
      const sourceRole = sourceRoleFor(file, evidence);
      candidates.push({
        matcher,
        file,
        line: Number(lineText),
        sourceRole,
        evidence: evidence.trim().slice(0, 220),
        severity: adjustSeverity(matcher.severity, sourceRole),
        confidence: confidenceFor(sourceRole, evidence),
      });
    }
  }
  return candidates;
}

function uniqueCandidates(candidates: Candidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.matcher.slug}:${candidate.file}:${candidate.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const attackSurfaceScanTool: Tool = {
  name: 'attack_surface_scan',
  description: 'Runs a cheap wide-net attack surface candidate scan before expensive AI review. Classifies source role, ranks evidence, and returns a focused investigation queue.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory or file to scan relative to workspace root. Defaults to ".".',
      },
      limit: {
        type: 'number',
        description: 'Maximum evidence rows to return. Defaults to 80.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const relativePath = String(args.path || '.');
    const limit = Math.max(10, Math.min(Number(args.limit || 80), 200));

    try {
      const targetStat = await stat(join(workspacePath, relativePath));
      const files = targetStat.isFile()
        ? [relativePath]
        : (await execFileAsync('rg', ['--files', '--', relativePath], { cwd: workspacePath })).stdout.split('\n').filter(Boolean);
      const scannedFiles = files.filter((file) => !shouldSkipFile(file));
      const scannedFileSet = new Set(scannedFiles);
      const searchPattern = MATCHERS.map((matcher) => `(?:${matcher.search})`).join('|');
      const { stdout } = scannedFiles.length === 0
        ? { stdout: '' }
        : await execFileAsync(
          'rg',
          ['-n', '--no-heading', '-e', searchPattern, '--', ...scannedFiles],
          { cwd: workspacePath, maxBuffer: 1024 * 1024 * 12 },
        ).catch(() => ({ stdout: '' }));

      const candidates = uniqueCandidates(parseRgRows(stdout, scannedFileSet)).sort((a, b) => (
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        || (a.sourceRole === 'active' ? -1 : 1)
        || a.file.localeCompare(b.file)
        || a.line - b.line
      ));
      const counts = candidates.reduce<Record<Severity, number>>((acc, candidate) => {
        acc[candidate.severity] += 1;
        return acc;
      }, { critical: 0, high: 0, medium: 0, info: 0 });
      const activeCount = candidates.filter((candidate) => candidate.sourceRole === 'active').length;

      let report = 'MaTE X Attack Surface Scan\n==========================\n';
      report += `Scope: ${relativePath}\nFiles scanned: ${scannedFiles.length}\n`;
      report += `Candidates: ${candidates.length} (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.info} info; ${activeCount} active-source)\n`;
      report += 'Important: these are candidates, not confirmed findings or vulnerabilities. Do not label them as findings until data-flow review confirms exploitability.\n';
      report += '\nPositioning\n-----------\n';
      report += '- MaTE X advantage: local-first candidate pruning before Rainy/Codex reasoning; credentials stay in main-process settings.\n';
      report += '- Use this queue before deep agent review, run candidate_revalidator on top active candidates, call security_path_trace on confirmed candidates, then use evidence_pack for final wording.\n';

      if (candidates.length === 0) {
        report += '\nNo high-signal candidates matched current wide-net rules.';
        return report;
      }

      report += '\nTop Priority Candidate Queue\n----------------------------\n';
      for (const candidate of candidates.slice(0, limit)) {
        report += `- Candidate: ${candidate.matcher.title}\n`;
        report += `  Severity: ${candidate.severity.toUpperCase()}\n`;
        report += `  Confidence: ${candidate.confidence}\n`;
        report += `  Location: ${candidate.file}:${candidate.line} (${candidate.sourceRole})\n`;
        report += `  Evidence: ${candidate.evidence}\n`;
        report += `  Why: ${candidate.matcher.reason}\n`;
      }
      if (candidates.length > limit) report += `\n... ${candidates.length - limit} additional candidate(s) omitted.\n`;

      report += '\nNext Agent Steps\n----------------\n';
      report += '- Prioritize active-source high/critical candidates with high confidence.\n';
      report += '- Treat docs/tests/examples as reference signals unless they feed runtime code.\n';
      report += '- For each real candidate: call candidate_revalidator, read imports/callers if needed, trace source-to-sink flow, verify mitigations, then call evidence_pack before using finding/vulnerability language.\n';

      return report;
    } catch (error) {
      return `Error running DeepSec candidate scan: ${(error as Error).message}`;
    }
  },
};
