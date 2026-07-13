import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool } from '../tool-service';
import { resolveWorkspacePath } from './tool-utils';

type Verdict = 'confirmed_candidate' | 'likely_false_positive' | 'needs_context';

type Signal = {
  label: string;
  reason: string;
};

const SOURCE_HINTS = [
  /\b(req|request|response|body|params|query|headers|cookies)\b/i,
  /\b(input|payload|formData|searchParams|argv|env|process\.env)\b/i,
  /\bipcMain\.handle|ipcMain\.on|ipcRenderer\.invoke\b/,
];

const MITIGATION_HINTS = [
  /\b(zod|schema|validate|validated|parse|safeParse|sanitize|escape|encode|allowlist|denylist)\b/i,
  /\b(normalize|resolve|relative|isAbsolute|startsWith|workspacePath|trustContract)\b/,
  /\b(auth|authorize|permission|role|session|csrf|token|rateLimit)\b/i,
  /\b(prepare|parameterized|bind|sql`|\$\d+|\?)\b/,
];

const SINK_HINTS = [
  /\b(exec|execFile|spawn|execSync|eval|Function|vm\.runIn)\b/,
  /\b(fetch|axios|request|got|http\.request|https\.request)\b/,
  /\b(readFile|writeFile|createReadStream|createWriteStream|unlink|rm)\b/,
  /\b(query|execute|raw|prepare)\b/,
  /\b(dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML)\b/,
];

const REFERENCE_HINTS = [
  /\b(test|spec|fixture|example|mock|stub|snapshot)\b/i,
  /\b(scanner|canary|fuzzer|prober|poison|audit)\b/i,
  /\b(pattern|regex|rule|matcher)\b/i,
];

function assertInsideWorkspace(workspacePath: string, filePath: string) {
  let absolutePath: string;
  try {
    absolutePath = resolveWorkspacePath(workspacePath, filePath);
  } catch {
    throw new Error('Candidate file must stay inside workspace.');
  }
  // Candidates must be files under the workspace, not the workspace root itself.
  if (absolutePath === resolve(workspacePath)) {
    throw new Error('Candidate file must stay inside workspace.');
  }
  return absolutePath;
}

function collectSignals(lines: string[], patterns: RegExp[], label: string, reason: string): Signal[] {
  return lines.some((line) => patterns.some((pattern) => pattern.test(line)))
    ? [{ label, reason }]
    : [];
}

function collectSafePatternSignals(lines: string[]): Signal[] {
  const context = lines.join('\n');
  const redisEvalMatch = /\bredis\.eval\s*\(\s*`([\s\S]*?)`/.exec(context);
  if (!redisEvalMatch) return [];

  const luaScript = redisEvalMatch[1];
  const hasRedisCalls = /\bredis\.call\s*\(\s*['"`]/.test(luaScript);
  const usesRedisArgs = /\b(?:KEYS|ARGV)\s*\[\s*\d+\s*\]/.test(luaScript);
  const interpolatesIntoScript = /\$\{/.test(luaScript);

  if (hasRedisCalls && usesRedisArgs && !interpolatesIntoScript) {
    return [{
      label: 'safe-pattern',
      reason: 'Redis Lua script is static and passes data through KEYS/ARGV instead of interpolating code',
    }];
  }

  return [];
}

function resolveVerdict(params: {
  sourceSignals: Signal[];
  sinkSignals: Signal[];
  mitigationSignals: Signal[];
  referenceSignals: Signal[];
  safePatternSignals: Signal[];
}): Verdict {
  const { sourceSignals, sinkSignals, mitigationSignals, referenceSignals, safePatternSignals } = params;
  if (safePatternSignals.length > 0) return 'likely_false_positive';
  if (referenceSignals.length > 0 && sourceSignals.length === 0) return 'likely_false_positive';
  if (sourceSignals.length > 0 && sinkSignals.length > 0 && mitigationSignals.length === 0) return 'confirmed_candidate';
  return 'needs_context';
}

export const candidateRevalidatorTool: Tool = {
  name: 'candidate_revalidator',
  description: 'Revalidates one attack_surface_scan candidate with local file context. Separates confirmed candidates, likely false positives, and items needing deeper source-to-sink tracing.',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Candidate file path relative to workspace root.',
      },
      line: {
        type: 'number',
        description: 'Candidate line number from attack_surface_scan.',
      },
      title: {
        type: 'string',
        description: 'Candidate title or matcher type.',
      },
      evidence: {
        type: 'string',
        description: 'Original candidate evidence line.',
      },
      contextRadius: {
        type: 'number',
        description: 'Lines before and after candidate to inspect. Defaults to 18.',
      },
    },
    required: ['file', 'line'],
  },
  async execute(args, { workspacePath }) {
    const file = String(args.file || '');
    const line = Math.max(1, Number(args.line || 1));
    const title = String(args.title || 'Candidate');
    const evidence = String(args.evidence || '');
    const contextRadius = Math.max(6, Math.min(Number(args.contextRadius || 18), 60));

    try {
      const absolutePath = assertInsideWorkspace(workspacePath, file);
      const content = await readFile(absolutePath, 'utf8');
      const allLines = content.split(/\r?\n/);
      const start = Math.max(1, line - contextRadius);
      const end = Math.min(allLines.length, line + contextRadius);
      const contextLines = allLines.slice(start - 1, end);
      const candidateLine = allLines[line - 1] || evidence;

      const sourceSignals = collectSignals(contextLines, SOURCE_HINTS, 'source', 'nearby user-controlled or environment-controlled input');
      const sinkSignals = collectSignals([candidateLine, evidence, ...contextLines], SINK_HINTS, 'sink', 'candidate context contains security-sensitive sink');
      const mitigationSignals = collectSignals(contextLines, MITIGATION_HINTS, 'mitigation', 'nearby validation, sanitization, auth, allowlist, or parameterization signal');
      const referenceSignals = collectSignals([file, candidateLine, evidence], REFERENCE_HINTS, 'reference', 'candidate appears in test, docs, scanner, fixture, or matcher context');
      const safePatternSignals = collectSafePatternSignals(contextLines);
      const verdict = resolveVerdict({ sourceSignals, sinkSignals, mitigationSignals, referenceSignals, safePatternSignals });

      let report = 'Candidate Revalidation\n======================\n';
      report += `Candidate: ${title}\n`;
      report += `Location: ${file}:${line}\n`;
      report += `Context: L${start}-L${end}\n`;
      report += `Verdict: ${verdict}\n`;
      report += 'Important: this verdict is heuristic. Confirmed candidate still needs data-flow proof before becoming a vulnerability finding.\n';

      report += '\nSignals\n-------\n';
      const signals = [...sourceSignals, ...sinkSignals, ...mitigationSignals, ...referenceSignals, ...safePatternSignals];
      if (signals.length === 0) {
        report += '- No strong local signals found.\n';
      } else {
        for (const signal of signals) {
          report += `- ${signal.label}: ${signal.reason}\n`;
        }
      }

      report += '\nEvidence Window\n---------------\n';
      contextLines.forEach((text, index) => {
        const currentLine = start + index;
        const marker = currentLine === line ? '>' : ' ';
        report += `${marker} ${String(currentLine).padStart(4, ' ')} | ${text.slice(0, 180)}\n`;
      });

      report += '\nNext Step\n---------\n';
      if (verdict === 'confirmed_candidate') {
        report += '- Run security_path_trace or manually trace source -> transform -> sink. Promote to finding only with exploitability evidence.\n';
      } else if (verdict === 'likely_false_positive') {
        report += '- Keep as reference signal unless runtime path connects it to active code.\n';
      } else {
        report += '- Read imports/callers and verify whether source reaches sink with mitigation bypass.\n';
      }

      return report;
    } catch (error) {
      return `Error revalidating candidate: ${(error as Error).message}`;
    }
  },
};
