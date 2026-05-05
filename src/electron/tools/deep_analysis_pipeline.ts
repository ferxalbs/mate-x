import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';
import {
  type Candidate,
  type Severity,
  SEVERITY_RANK,
  scanAttackSurfaceCandidates,
} from './attack_surface_scan';
import { clampNumber, limitTextOutput, resolveWorkspacePath } from './tool-utils';

const execFileAsync = promisify(execFile);

type PipelineCandidate = {
  id: string;
  matcherSlug: string;
  title: string;
  severity: Severity;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  confidence: Candidate['confidence'];
  sourceRole: Candidate['sourceRole'];
  line: number;
  evidence: string;
  reason: string;
};

type FileRecord = {
  schemaVersion: 1;
  runId: string;
  filePath: string;
  candidates: PipelineCandidate[];
  revalidation: Array<{
    candidateId: string;
    verdict: 'confirmed_candidate' | 'likely_false_positive' | 'needs_context';
    signals: string[];
    checkedAt: string;
  }>;
  gitInfo?: {
    recentCommitters: string[];
    lastCommit?: string;
  };
  analysisHistory: Array<{
    stage: 'scan' | 'revalidate' | 'triage' | 'enrich';
    runId: string;
    at: string;
    summary: string;
  }>;
};

const SIGNALS = {
  source: [
    /\b(req|request|response|body|params|query|headers|cookies)\b/i,
    /\b(input|payload|formData|searchParams|argv|env|process\.env)\b/i,
    /\bipcMain\.handle|ipcMain\.on|ipcRenderer\.invoke\b/,
  ],
  sink: [
    /\b(exec|execFile|spawn|execSync|eval|Function|vm\.runIn)\b/,
    /\b(fetch|axios|request|got|http\.request|https\.request)\b/,
    /\b(readFile|writeFile|createReadStream|createWriteStream|unlink|rm)\b/,
    /\b(query|execute|raw|prepare)\b/,
    /\b(dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML)\b/,
  ],
  mitigation: [
    /\b(zod|schema|validate|validated|parse|safeParse|sanitize|escape|encode|allowlist|denylist)\b/i,
    /\b(normalize|resolve|relative|isAbsolute|startsWith|workspacePath|trustContract)\b/,
    /\b(auth|authorize|permission|role|session|csrf|token|rateLimit)\b/i,
    /\b(prepare|parameterized|bind|sql`|\$\d+|\?)\b/,
  ],
  reference: [
    /\b(test|spec|fixture|example|mock|stub|snapshot)\b/i,
    /\b(scanner|canary|fuzzer|prober|poison|audit)\b/i,
    /\b(pattern|regex|rule|matcher)\b/i,
  ],
};

function candidateId(candidate: Candidate) {
  return `${candidate.matcher.slug}:${candidate.file}:${candidate.line}`;
}

function priorityFor(candidate: Candidate): PipelineCandidate['priority'] {
  if (candidate.sourceRole !== 'active') return 'P3';
  if (candidate.severity === 'critical') return 'P0';
  if (candidate.severity === 'high' && candidate.confidence === 'high') return 'P0';
  if (candidate.severity === 'high') return 'P1';
  if (candidate.severity === 'medium') return 'P2';
  return 'P3';
}

function signalLabels(lines: string[], candidate: Candidate) {
  const labels: string[] = [];
  for (const [label, patterns] of Object.entries(SIGNALS)) {
    if (patterns.some((pattern) => lines.some((line) => pattern.test(line)))) labels.push(label);
  }
  if (candidate.sourceRole !== 'active' && !labels.includes('reference')) labels.push('reference');
  return labels;
}

function verdictFor(labels: string[]) {
  const hasSource = labels.includes('source');
  const hasSink = labels.includes('sink');
  const hasMitigation = labels.includes('mitigation');
  const hasReference = labels.includes('reference');
  if (hasReference && !hasSource) return 'likely_false_positive' as const;
  if (hasSource && hasSink && !hasMitigation) return 'confirmed_candidate' as const;
  return 'needs_context' as const;
}

async function readPreviousRecord(path: string): Promise<FileRecord | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as FileRecord;
  } catch {
    return null;
  }
}

async function gitInfo(workspacePath: string, file: string) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--format=%H%x09%an <%ae>', '-n', '8', '--', file],
      { cwd: workspacePath, maxBuffer: 1024 * 256 },
    );
    const rows = stdout.split('\n').filter(Boolean);
    const recentCommitters = [...new Set(rows.map((row) => row.split('\t')[1]).filter(Boolean))].slice(0, 5);
    return { recentCommitters, lastCommit: rows[0]?.split('\t')[0] };
  } catch {
    return { recentCommitters: [] };
  }
}

function mergeRecord(previous: FileRecord | null, next: FileRecord): FileRecord {
  const candidates = new Map<string, PipelineCandidate>();
  for (const candidate of previous?.candidates ?? []) candidates.set(candidate.id, candidate);
  for (const candidate of next.candidates) candidates.set(candidate.id, candidate);

  const revalidation = new Map<string, FileRecord['revalidation'][number]>();
  for (const item of previous?.revalidation ?? []) revalidation.set(item.candidateId, item);
  for (const item of next.revalidation) revalidation.set(item.candidateId, item);

  return {
    ...next,
    candidates: [...candidates.values()].sort((a, b) => (
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line
    )),
    revalidation: [...revalidation.values()],
    analysisHistory: [...(previous?.analysisHistory ?? []), ...next.analysisHistory].slice(-40),
  };
}

function scopeForTrace(file: string) {
  const cleanFile = file.replace(/^\.\//, '');
  const scope = dirname(cleanFile);
  return scope === '.' ? cleanFile : scope;
}

function exactNextCalls(candidate: Candidate) {
  return [
    {
      tool: 'candidate_revalidator',
      arguments: {
        file: candidate.file,
        line: candidate.line,
        title: candidate.matcher.title,
        evidence: candidate.evidence,
      },
    },
    {
      tool: 'security_path_trace',
      arguments: {
        scope: scopeForTrace(candidate.file),
        maxFiles: 120,
        maxTraces: 8,
      },
    },
  ];
}

function pipelineClusterKey(candidate: Candidate) {
  const bucket = Math.floor(candidate.line / 20) * 20;
  return `${candidate.matcher.slug}:${candidate.file}:${bucket}`;
}

function topCandidateClusters(candidates: Candidate[]) {
  const clusters = new Map<string, { representative: Candidate; count: number; lines: number[] }>();
  for (const candidate of candidates) {
    const key = pipelineClusterKey(candidate);
    const current = clusters.get(key);
    if (!current) {
      clusters.set(key, { representative: candidate, count: 1, lines: [candidate.line] });
      continue;
    }
    current.count += 1;
    current.lines.push(candidate.line);
  }
  return [...clusters.values()];
}

function topInvestigationTargets(candidates: Candidate[]) {
  const targets = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.matcher.slug}:${candidate.file}`;
    if (!targets.has(key)) targets.set(key, candidate);
  }
  return [...targets.values()];
}

export const deepAnalysisPipelineTool: Tool = {
  name: 'deep_analysis_pipeline',
  description: 'Runs the MaTE X Deep Analysis Pipeline: cheap candidate scan, additive FileRecord persistence, heuristic revalidation, triage, and Git ownership enrichment. Use before expensive agent review.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory or file to analyze relative to workspace root. Defaults to "src".',
      },
      limit: {
        type: 'number',
        description: 'Maximum candidates to revalidate and report. Defaults to 40.',
      },
      dataDir: {
        type: 'string',
        description: 'Workspace-relative directory for additive FileRecord JSON. Defaults to ".mate-x/deep-analysis".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const relativePath = String(args.path || 'src');
    const limit = clampNumber(args.limit, 5, 120, 40);
    const dataDir = relative(workspacePath, resolveWorkspacePath(workspacePath, args.dataDir, '.mate-x/deep-analysis'));
    const outputRoot = resolveWorkspacePath(workspacePath, dataDir);
    const runId = `deep-${Date.now().toString(36)}`;
    const checkedAt = new Date().toISOString();

    try {
      const { scannedFiles, candidates } = await scanAttackSurfaceCandidates({ workspacePath, relativePath });
      const queue = candidates.slice(0, limit);
      const grouped = new Map<string, Candidate[]>();
      for (const candidate of queue) {
        grouped.set(candidate.file, [...(grouped.get(candidate.file) ?? []), candidate]);
      }

      await mkdir(outputRoot, { recursive: true });
      const written: string[] = [];
      const verdictCounts = { confirmed_candidate: 0, likely_false_positive: 0, needs_context: 0 };

      for (const [file, fileCandidates] of grouped) {
        const absoluteFile = resolveWorkspacePath(workspacePath, file);
        const content = await readFile(absoluteFile, 'utf8').catch(() => '');
        const lines = content.split(/\r?\n/);
        const revalidation = fileCandidates.map((candidate) => {
          const start = Math.max(0, candidate.line - 16);
          const end = Math.min(lines.length, candidate.line + 15);
          const context = [candidate.evidence, ...lines.slice(start, end)];
          const signals = signalLabels(context, candidate);
          const verdict = verdictFor(signals);
          verdictCounts[verdict] += 1;
          return { candidateId: candidateId(candidate), verdict, signals, checkedAt };
        });
        const pipelineCandidates = fileCandidates.map((candidate) => ({
          id: candidateId(candidate),
          matcherSlug: candidate.matcher.slug,
          title: candidate.matcher.title,
          severity: candidate.severity,
          priority: priorityFor(candidate),
          confidence: candidate.confidence,
          sourceRole: candidate.sourceRole,
          line: candidate.line,
          evidence: candidate.evidence,
          reason: candidate.matcher.reason,
        }));
        const recordPath = join(outputRoot, `${file.replace(/[\\/]/g, '__')}.json`);
        const previous = await readPreviousRecord(recordPath);
        const record = mergeRecord(previous, {
          schemaVersion: 1,
          runId,
          filePath: file,
          candidates: pipelineCandidates,
          revalidation,
          gitInfo: await gitInfo(workspacePath, file),
          analysisHistory: [
            { stage: 'scan', runId, at: checkedAt, summary: `${pipelineCandidates.length} candidate(s) merged.` },
            { stage: 'revalidate', runId, at: checkedAt, summary: `${revalidation.length} candidate(s) heuristically revalidated.` },
            { stage: 'triage', runId, at: checkedAt, summary: `Top priority: ${pipelineCandidates[0]?.priority ?? 'P3'}.` },
            { stage: 'enrich', runId, at: checkedAt, summary: 'Git ownership metadata refreshed.' },
          ],
        });
        await mkdir(dirname(recordPath), { recursive: true });
        await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        written.push(relative(workspacePath, recordPath));
      }

      const priorityCounts = queue.reduce<Record<PipelineCandidate['priority'], number>>((acc, candidate) => {
        acc[priorityFor(candidate)] += 1;
        return acc;
      }, { P0: 0, P1: 0, P2: 0, P3: 0 });
      const candidateClusters = topCandidateClusters(candidates);
      const queueClusters = topCandidateClusters(queue);

      let report = 'MaTE X Deep Analysis Pipeline\n=============================\n';
      report += `Run: ${runId}\nScope: ${relativePath}\nFiles scanned: ${scannedFiles.length}\nCandidates found: ${candidates.length} (${candidateClusters.length} clusters)\nCandidates processed: ${queue.length}\n`;
      report += `Priority: ${priorityCounts.P0} P0, ${priorityCounts.P1} P1, ${priorityCounts.P2} P2, ${priorityCounts.P3} P3\n`;
      report += `Revalidation: ${verdictCounts.confirmed_candidate} confirmed candidates, ${verdictCounts.needs_context} need context, ${verdictCounts.likely_false_positive} likely false positives\n`;
      report += `FileRecords: ${written.length} written under ${dataDir}\n`;
      report += '\nPositioning\n-----------\n';
      report += '- Local-first wide-net scan before expensive model work.\n';
      report += '- Additive FileRecords make runs resumable and auditable.\n';
      report += '- Git enrichment turns raw security signals into owner-routed work.\n';
      report += '- Candidates are not vulnerabilities until source-to-sink proof exists.\n';
      report += '\nTop Queue\n---------\n';
      for (const candidate of queue.slice(0, 20)) {
        report += `- [${priorityFor(candidate)}] ${candidate.matcher.title} at ${candidate.file}:${candidate.line} (${candidate.sourceRole}, ${candidate.confidence})\n`;
        report += `  ${candidate.evidence}\n`;
      }
      const duplicateClusters = queueClusters.filter((item) => item.count > 1);
      if (duplicateClusters.length > 0) {
        report += '\nClustered Repeats\n-----------------\n';
        for (const cluster of duplicateClusters.slice(0, 10)) {
          report += `- ${cluster.count}x ${cluster.representative.matcher.title} in ${cluster.representative.file} near L${Math.min(...cluster.lines)}-L${Math.max(...cluster.lines)}\n`;
        }
      }
      report += '\nNext Agent Steps\n----------------\n';
      report += '- Use only tool arguments shown below; security_path_trace accepts scope, maxFiles, maxTraces only.\n';
      report += '- Run security_path_trace before promoting any candidate to finding.\n';
      report += '- Use evidence_pack for final report language.\n';
      const nextToolCalls = topInvestigationTargets(queue).slice(0, 3).map((candidate) => ({
        candidate: `${candidate.matcher.title} at ${candidate.file}:${candidate.line}`,
        calls: exactNextCalls(candidate),
      }));
      report += '\nNEXT_TOOL_CALLS_JSON_DO_NOT_PARAPHRASE\n-------------------------------------\n';
      report += 'Copy this JSON exactly when asked for next exact tool calls. Do not replace arguments with ellipses or pseudo-signatures.\n';
      report += '```json\n';
      report += `${JSON.stringify(nextToolCalls, null, 2)}\n`;
      report += '```\n';
      return limitTextOutput(report, 18_000);
    } catch (error) {
      return `Error running MaTE X deep analysis pipeline: ${(error as Error).message}`;
    }
  },
};
