import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SOURCE_PATTERNS, SINK_PATTERNS, TRANSFORM_REGEX } from './patterns';
import type { SecurityTrace, TraceEvidence, TraceNode, TraceOptions } from './types';

const execFileAsync = promisify(execFile);
const CODE_EXTENSIONS = /\.(cjs|mjs|js|jsx|ts|tsx)$/;
const IGNORED_PATH_PARTS = [
  'node_modules/',
  'dist/',
  '.next/',
  'out/',
  'target/',
  'coverage/',
  '.git/',
];

interface LineRecord {
  file: string;
  line: number;
  text: string;
}

interface Candidate {
  label: string;
  evidence: TraceEvidence;
  symbols: string[];
}

type ImportGraph = Map<string, Set<string>>;

function isRelevantFile(file: string) {
  return CODE_EXTENSIONS.test(file) && !IGNORED_PATH_PARTS.some((part) => file.includes(part));
}

function cleanSnippet(text: string) {
  return text.trim().replace(/\s+/g, ' ').slice(0, 220);
}

function evidence(file: string, line: number, text: string): TraceEvidence {
  return { file, line, snippet: cleanSnippet(text) };
}

function extractSymbols(text: string) {
  const symbols = new Set<string>();
  const declaration = text.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
  const assignment = text.match(/^\s*([A-Za-z_$][\w$]*)\s*=/);
  const params = text.match(/\(([^)]*)\)\s*=>|\bfunction\b[^(]*\(([^)]*)\)/);
  const propertyReads = text.match(/\b(req|request)\.(body|query|params|headers)\.?\w*/g);

  if (declaration?.[1]) symbols.add(declaration[1]);
  if (assignment?.[1]) symbols.add(assignment[1]);
  for (const property of propertyReads ?? []) symbols.add(property);
  for (const rawParams of [params?.[1], params?.[2]]) {
    for (const param of rawParams?.split(',') ?? []) {
      const name = param.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (name?.[1]) symbols.add(name[1]);
    }
  }

  for (const token of text.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []) {
    if (token.length > 2 && !RESERVED_SYMBOLS.has(token)) symbols.add(token);
  }

  return Array.from(symbols);
}

const RESERVED_SYMBOLS = new Set([
  'const',
  'let',
  'var',
  'return',
  'await',
  'async',
  'function',
  'import',
  'from',
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
]);

function sharedSymbols(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((symbol) => rightSet.has(symbol));
}

function buildNode(kind: TraceNode['kind'], candidate: Candidate): TraceNode {
  return {
    kind,
    label: candidate.label,
    evidence: candidate.evidence,
    symbols: candidate.symbols.slice(0, 12),
  };
}

function findTransforms(lines: LineRecord[], source: Candidate, sink: Candidate) {
  const sourceSymbols = new Set(source.symbols);
  const sinkSymbols = new Set(sink.symbols);
  return lines
    .filter((line) => line.file === source.evidence.file || line.file === sink.evidence.file)
    .filter((line) => line.line > source.evidence.line || line.file !== source.evidence.file)
    .filter((line) => line.line < sink.evidence.line || line.file !== sink.evidence.file)
    .map((line) => ({ line, symbols: extractSymbols(line.text) }))
    .filter(({ line, symbols }) => TRANSFORM_REGEX.test(line.text) && symbols.some((symbol) => sourceSymbols.has(symbol)) && symbols.some((symbol) => sinkSymbols.has(symbol)))
    .slice(0, 2)
    .map(({ line, symbols }) => ({
      label: 'data transform',
      evidence: evidence(line.file, line.line, line.text),
      symbols,
    }));
}

function rankTrace(source: Candidate, sink: Candidate, transforms: Candidate[], importLinked: boolean) {
  const shared = sharedSymbols(source.symbols, sink.symbols).length;
  if (source.evidence.file === sink.evidence.file && shared > 0 && transforms.length > 0) return 'high';
  if (source.evidence.file === sink.evidence.file && shared > 0) return 'medium';
  if (importLinked && shared > 1 && transforms.length > 0) return 'medium';
  if (shared > 1 && transforms.length > 0) return 'medium';
  return 'low';
}

function patchSuggestion(sink: Candidate) {
  if (/exec|spawn|shell/.test(sink.label)) {
    return 'Use argument arrays, allowlist commands, reject shell metacharacters, and keep user-controlled data out of command strings.';
  }
  if (/DOM|HTML/.test(sink.label)) {
    return 'Render text content or sanitize with a vetted HTML sanitizer before this sink.';
  }
  if (/database/.test(sink.label)) {
    return 'Use parameterized queries or query builder bindings; never concatenate traced input into SQL.';
  }
  if (/file write/.test(sink.label)) {
    return 'Normalize path, enforce workspace allowlist, and reject traversal before writing.';
  }
  if (/dynamic code/.test(sink.label)) {
    return 'Remove dynamic code execution; replace with explicit dispatch or sandboxed interpreter with strict inputs.';
  }
  if (/network/.test(sink.label)) {
    return 'Validate destination URL against an allowlist and strip attacker-controlled headers or tokens.';
  }
  return 'Validate, narrow, or redact traced data before this security-sensitive sink.';
}

function traceTitle(source: Candidate, sink: Candidate) {
  return `${source.label} reaches ${sink.label}`;
}

function resolveImportPath(fromFile: string, importPath: string, knownFiles: Set<string>) {
  if (!importPath.startsWith('.')) return null;

  const fromParts = fromFile.split('/');
  fromParts.pop();

  const normalizedParts: string[] = [];
  for (const part of [...fromParts, ...importPath.split('/')]) {
    if (!part || part === '.') continue;
    if (part === '..') normalizedParts.pop();
    else normalizedParts.push(part);
  }

  const base = normalizedParts.join('/');
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

function buildImportGraph(lines: LineRecord[], files: string[]) {
  const knownFiles = new Set(files);
  const graph: ImportGraph = new Map();

  for (const line of lines) {
    const importPath =
      line.text.match(/\bimport\b.+?\bfrom\s+['"]([^'"]+)['"]/)?.[1] ??
      line.text.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
    if (!importPath) continue;

    const target = resolveImportPath(line.file, importPath, knownFiles);
    if (!target) continue;

    if (!graph.has(line.file)) graph.set(line.file, new Set());
    graph.get(line.file)?.add(target);
  }

  return graph;
}

function areImportLinked(graph: ImportGraph, left: string, right: string) {
  return graph.get(left)?.has(right) || graph.get(right)?.has(left);
}

async function listFiles(workspacePath: string, scope: string, maxFiles: number) {
  const { stdout } = await execFileAsync('rg', ['--files', '--', scope], { cwd: workspacePath });
  return stdout.split('\n').filter(Boolean).filter(isRelevantFile).slice(0, maxFiles);
}

export async function traceSecurityPaths(workspacePath: string, options: TraceOptions): Promise<SecurityTrace[]> {
  const files = await listFiles(workspacePath, options.scope, options.maxFiles);
  const lines: LineRecord[] = [];

  for (const file of files) {
    const content = await readFile(join(workspacePath, file), 'utf8').catch(() => '');
    content.split(/\r?\n/).forEach((text, index) => {
      lines.push({ file: relative(workspacePath, join(workspacePath, file)), line: index + 1, text });
    });
  }

  const importGraph = buildImportGraph(lines, files);
  const sources: Candidate[] = [];
  const sinks: Candidate[] = [];

  for (const line of lines) {
    for (const pattern of SOURCE_PATTERNS) {
      if (pattern.regex.test(line.text)) {
        sources.push({ label: pattern.label, evidence: evidence(line.file, line.line, line.text), symbols: extractSymbols(line.text) });
      }
    }
    for (const pattern of SINK_PATTERNS) {
      if (pattern.regex.test(line.text)) {
        sinks.push({ label: pattern.label, evidence: evidence(line.file, line.line, line.text), symbols: extractSymbols(line.text) });
      }
    }
  }

  const traces: SecurityTrace[] = [];
  for (const source of sources) {
    for (const sink of sinks) {
      const shared = sharedSymbols(source.symbols, sink.symbols);
      const sameFileForward = source.evidence.file === sink.evidence.file && source.evidence.line <= sink.evidence.line;
      const importLinked = areImportLinked(importGraph, source.evidence.file, sink.evidence.file);
      if (!sameFileForward && !importLinked && shared.length < 2) continue;
      if (shared.length === 0 && !sameFileForward) continue;

      const transforms = findTransforms(lines, source, sink);
      const confidence = rankTrace(source, sink, transforms, Boolean(importLinked));
      if (confidence === 'low' && traces.length > 0) continue;

      const path = [
        buildNode('source', source),
        ...transforms.map((transform) => buildNode('transform', transform)),
        buildNode('sink', sink),
      ];
      const title = traceTitle(source, sink);
      traces.push({
        id: `security-trace-${traces.length + 1}`,
        confidence,
        path,
        patchSuggestion: patchSuggestion(sink),
        finding: {
          title,
          severity: confidence === 'high' ? 'warning' : 'note',
          summary: `${title}. Path: ${path.map((node) => node.label).join(' -> ')}.`,
          file: sink.evidence.file,
          recommendation: patchSuggestion(sink),
        },
      });

      if (traces.length >= options.maxTraces) return traces;
    }
  }

  return traces;
}
