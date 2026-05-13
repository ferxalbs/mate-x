import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../tool-service';

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'info';

interface Finding {
  severity: Severity;
  category: string;
  message: string;
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** npm/yarn lifecycle hooks that run arbitrary code on install */
const INSTALL_HOOK_SCRIPTS = new Set([
  'preinstall', 'install', 'postinstall',
  'prepack', 'prepare', 'prepublish', 'prepublishOnly',
]);

/** Shell keywords that may indicate script injection or supply-chain abuse */
const SUSPICIOUS_SHELL_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcurl\b/i,         label: 'curl (remote fetch)' },
  { pattern: /\bwget\b/i,         label: 'wget (remote fetch)' },
  { pattern: /\bsh\s/i,           label: 'sh (shell invocation)' },
  { pattern: /\bbash\b/i,         label: 'bash (shell invocation)' },
  { pattern: /\bpython[23]?\b/i,  label: 'python (inline exec)' },
  { pattern: /node\s+-e\b/i,      label: 'node -e (inline eval)' },
  { pattern: /\beval\b/i,         label: 'eval' },
  { pattern: /\brm\s+-rf?\b/i,    label: 'rm -rf (destructive)' },
  { pattern: /\bpowershell\b/i,   label: 'powershell (Windows exec)' },
  { pattern: /base64\s+--decode/i, label: 'base64 decode (obfuscation)' },
  { pattern: /\|\s*sh\b/i,        label: 'pipe-to-sh (remote exec)' },
];

/** Version specifiers that indicate unpinned / floating dependencies */
const UNPINNED_VERSION_RE = /^[*^~]|^latest$|^next$|^canary$/i;

/** Protocols that bypass registry integrity checks */
const INSECURE_PROTO_RE = /^(git\+)?http:\/\//i;
const GIT_PROTO_RE = /^(git\+https?|git|github|bitbucket|gitlab):/i;
const FILE_PROTO_RE = /^(file:|link:)/i;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const dependencyAnalyzerTool: Tool = {
  name: 'dependency_check',
  description:
    'Analyzes manifest files (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod) ' +
    'for supply-chain risks: suspicious lifecycle scripts, insecure protocols, unpinned versions, ' +
    'install hooks, and git/file dependency substitutions.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to the manifest file relative to workspace root. ' +
          'Defaults to "package.json". ' +
          'Supports: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod.',
      },
      include_info: {
        type: 'boolean',
        description: 'If true, include informational findings (stack detection, pinned deps). Defaults to false.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const relativePath = (args.path as string | undefined) || 'package.json';
    const includeInfo = args.include_info === true;
    const targetFile = join(workspacePath, relativePath);

    try {
      const content = await readFile(targetFile, 'utf8');
      const findings: Finding[] = [];
      const stack: string[] = [];

      if (relativePath.endsWith('package.json')) {
        analyzePackageJson(content, findings, stack, includeInfo);
      } else if (relativePath === 'requirements.txt') {
        analyzeRequirementsTxt(content, findings, includeInfo);
      } else if (relativePath === 'pyproject.toml') {
        analyzePyprojectToml(content, findings, includeInfo);
      } else if (relativePath === 'Cargo.toml') {
        analyzeCargoToml(content, findings, includeInfo);
      } else if (relativePath === 'go.mod') {
        analyzeGoMod(content, findings, includeInfo);
      } else {
        return `dependency_check: unsupported manifest format "${relativePath}". ` +
          'Supported: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod.';
      }

      return formatReport(relativePath, findings, stack);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return `dependency_check: file not found — "${relativePath}"`;
      }
      return `dependency_check: error — ${(error as Error).message}`;
    }
  },
};

// ─── Analysers ────────────────────────────────────────────────────────────────

function analyzePackageJson(
  raw: string,
  findings: Finding[],
  stack: string[],
  includeInfo: boolean,
): void {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    findings.push({ severity: 'critical', category: 'Parse Error', message: 'package.json is not valid JSON.' });
    return;
  }

  // Stack detection
  const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
  if (deps['electron']) stack.push('Electron');
  if (deps['react']) stack.push('React');
  if (deps['express'] || deps['fastify'] || deps['koa']) stack.push('Node HTTP server');
  if (deps['next']) stack.push('Next.js');
  if (deps['vite']) stack.push('Vite');

  // Lifecycle install hooks
  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (scripts) {
    for (const [name, script] of Object.entries(scripts)) {
      if (INSTALL_HOOK_SCRIPTS.has(name)) {
        findings.push({
          severity: 'high',
          category: 'Install Hook',
          message: `"${name}" lifecycle script runs on install: ${script}`,
        });
      }

      for (const { pattern, label } of SUSPICIOUS_SHELL_PATTERNS) {
        if (pattern.test(script)) {
          findings.push({
            severity: 'critical',
            category: 'Suspicious Script',
            message: `Script "${name}" contains ${label}: ${script}`,
          });
          break;
        }
      }
    }
  }

  // Dependency protocol checks
  const allDepSections: Array<[string, Record<string, string>]> = [
    ['dependencies', pkg.dependencies as Record<string, string> ?? {}],
    ['devDependencies', pkg.devDependencies as Record<string, string> ?? {}],
    ['peerDependencies', pkg.peerDependencies as Record<string, string> ?? {}],
    ['optionalDependencies', pkg.optionalDependencies as Record<string, string> ?? {}],
  ];

  for (const [section, map] of allDepSections) {
    for (const [name, version] of Object.entries(map)) {
      if (INSECURE_PROTO_RE.test(version)) {
        findings.push({
          severity: 'critical',
          category: 'Insecure Protocol',
          message: `[${section}] "${name}": uses insecure HTTP protocol — ${version}`,
        });
      } else if (GIT_PROTO_RE.test(version)) {
        findings.push({
          severity: 'high',
          category: 'Git Dependency',
          message: `[${section}] "${name}": resolved from git source — ${version} (bypasses registry integrity)`,
        });
      } else if (FILE_PROTO_RE.test(version)) {
        findings.push({
          severity: 'medium',
          category: 'Local Path Dependency',
          message: `[${section}] "${name}": linked from local path — ${version}`,
        });
      } else if (UNPINNED_VERSION_RE.test(version)) {
        findings.push({
          severity: includeInfo ? 'medium' : 'info',
          category: 'Unpinned Version',
          message: `[${section}] "${name}": version not pinned — ${version}`,
        });
      }
    }
  }

  // Overrides / resolutions (may shadow transitive deps)
  const overrides = (pkg.overrides ?? pkg.resolutions) as Record<string, string> | undefined;
  if (overrides && Object.keys(overrides).length > 0) {
    findings.push({
      severity: 'medium',
      category: 'Dependency Overrides',
      message: `Manifest declares ${Object.keys(overrides).length} override(s)/resolution(s) — verify they do not shadow security patches.`,
    });
  }

  // publishConfig.registry pointing elsewhere
  const publishConfig = pkg.publishConfig as Record<string, string> | undefined;
  if (publishConfig?.registry && !publishConfig.registry.includes('npmjs.com')) {
    findings.push({
      severity: 'medium',
      category: 'Custom Registry',
      message: `publishConfig.registry is not the public npm registry: ${publishConfig.registry}`,
    });
  }
}

function analyzeRequirementsTxt(raw: string, findings: Finding[], includeInfo: boolean): void {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  for (const line of lines) {
    if (/^-i\s+https?:\/\//i.test(line) || /^--index-url\s+http:/i.test(line)) {
      findings.push({ severity: 'critical', category: 'Insecure Index', message: `Insecure index URL: ${line.trim()}` });
    } else if (/^git\+http:/i.test(line) || /^http:\/\//i.test(line)) {
      findings.push({ severity: 'critical', category: 'Insecure Source', message: `Insecure dependency source: ${line.trim()}` });
    } else if (/^git\+https:/i.test(line)) {
      findings.push({ severity: 'high', category: 'Git Dependency', message: `Git-pinned dependency (no registry integrity): ${line.trim()}` });
    } else if (!/[=<>!~^]/.test(line)) {
      if (includeInfo) {
        findings.push({ severity: 'info', category: 'Unpinned Version', message: `Package has no version constraint: ${line.trim()}` });
      }
    }
  }
}

function analyzePyprojectToml(raw: string, findings: Finding[], _includeInfo: boolean): void {
  // Simple text-level checks — no full TOML parser to keep zero deps
  if (/\[\s*tool\.poetry\.scripts\s*\]/i.test(raw)) {
    findings.push({ severity: 'medium', category: 'Install Scripts', message: 'pyproject.toml declares [tool.poetry.scripts] — verify no unsafe entry points.' });
  }
  if (/http:\/\//i.test(raw)) {
    findings.push({ severity: 'critical', category: 'Insecure URL', message: 'pyproject.toml contains an http:// URL — possible insecure registry or source.' });
  }
  const gitMatches = raw.match(/git\+https?:\/\/[^\s"']*/gi) ?? [];
  for (const match of gitMatches) {
    findings.push({ severity: 'high', category: 'Git Dependency', message: `Git-sourced dependency: ${match}` });
  }
}

function analyzeCargoToml(raw: string, findings: Finding[], _includeInfo: boolean): void {
  // Detect `path = "..."` dependencies (local workspace links leaking into published crates)
  const pathDeps = [...raw.matchAll(/^\s*(\w[\w-]*)\s*=.*path\s*=/gm)];
  for (const m of pathDeps) {
    findings.push({ severity: 'medium', category: 'Path Dependency', message: `Cargo path dependency detected: ${m[0].trim()}` });
  }
  // git dependencies
  const gitDeps = [...raw.matchAll(/^\s*(\w[\w-]*)\s*=.*git\s*=\s*"([^"]+)"/gm)];
  for (const m of gitDeps) {
    findings.push({ severity: 'high', category: 'Git Dependency', message: `Cargo git dependency (no registry): ${m[0].trim()}` });
  }
  if (/\[patch\./i.test(raw)) {
    findings.push({ severity: 'medium', category: 'Patch Override', message: 'Cargo.toml uses [patch.*] — verify it does not silently replace security-critical crates.' });
  }
}

function analyzeGoMod(raw: string, findings: Finding[], _includeInfo: boolean): void {
  // replace directives can shadow modules
  const replaces = [...raw.matchAll(/^replace\s+(\S+)\s+=>\s+(.+)$/gm)];
  for (const m of replaces) {
    const target = m[2].trim();
    const isLocal = target.startsWith('./') || target.startsWith('../') || !target.includes('.');
    findings.push({
      severity: isLocal ? 'medium' : 'high',
      category: isLocal ? 'Local Replace Directive' : 'Remote Replace Directive',
      message: `go.mod replaces "${m[1]}" with "${target}"`,
    });
  }
  // retract directives are informational
  if (/^retract\s/m.test(raw)) {
    findings.push({ severity: 'info', category: 'Retracted Versions', message: 'go.mod declares retracted versions — ensure consumers upgrade.' });
  }
}

// ─── Report formatter ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
const SEVERITY_ICON: Record<Severity, string> = { critical: '🔴', high: '🟠', medium: '🟡', info: '🔵' };

function formatReport(file: string, findings: Finding[], stack: string[]): string {
  const visible = findings.filter((f) => f.severity !== 'info' || stack.length > 0);
  const sorted = [...visible].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of sorted) counts[f.severity]++;

  const lines: string[] = [];
  lines.push(`═══ Dependency Security Report: ${file} ═══`);
  if (stack.length > 0) lines.push(`Stack: ${stack.join(' · ')}`);
  lines.push(
    `Summary: ${counts.critical} critical  ${counts.high} high  ${counts.medium} medium  ${counts.info} info`,
  );
  lines.push('');

  if (sorted.length === 0) {
    lines.push('✅ No supply-chain risks identified.');
  } else {
    for (const f of sorted) {
      lines.push(`${SEVERITY_ICON[f.severity]} [${f.severity.toUpperCase()}] [${f.category}]`);
      lines.push(`   ${f.message}`);
    }
  }

  return lines.join('\n');
}
