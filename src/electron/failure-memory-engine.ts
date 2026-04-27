import { createHash } from 'node:crypto';
import path from 'node:path';

import type { FailureMemory } from '../contracts/workspace';
import { tursoService } from './turso-service';

export interface FailureMemoryInput {
  workspaceId: string;
  command: string;
  exitCode?: number;
  framework?: string;
  failingTests?: string[];
  output?: string;
  errorSignature?: string;
  stackTraceExcerpt?: string;
  affectedFiles?: string[];
  attemptedFix?: string;
  retryFixed?: boolean;
}

export interface SimilarFailureQuery {
  workspaceId: string;
  command?: string;
  framework?: string;
  failingTests?: string[];
  output?: string;
  errorSignature?: string;
  stackTraceExcerpt?: string;
  limit?: number;
}

export interface SimilarFailureMatch {
  failure: FailureMemory;
  score: number;
  reasons: string[];
}

const ANSI_RE = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g');
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g;
const TIME_RE = /\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const HASH_RE = /\b[0-9a-f]{12,}\b/gi;
const RANDOM_ID_RE = /\b(?:tmp|temp|run|test|worker|chunk|id)[-_]?[a-z0-9]{6,}\b/gi;
const POSIX_PATH_RE = /(?:\/[\w .@-]+)+(?::\d+){0,2}/g;
const WINDOWS_PATH_RE = /[A-Za-z]:\\(?:[^\\\s:]+\\)*[^\\\s:]+(?::\d+){0,2}/g;
const LINE_COL_RE = /:(?:\d+)(?::\d+)?\b/g;
const FILE_LINE_RE = /\b([\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|go|py|java|kt|swift|css|scss|json|toml|yaml|yml)):\d+(?::\d+)?\b/;
const FILE_LINE_GLOBAL_RE = /\b([\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|go|py|java|kt|swift|css|scss|json|toml|yaml|yml)):\d+(?::\d+)?\b/g;

export class FailureMemoryEngine {
  buildRecord(input: FailureMemoryInput): Omit<FailureMemory, 'id' | 'occurrenceCount' | 'firstSeenAt' | 'lastSeenAt' | 'resolvedAt'> {
    const stackTraceExcerpt = input.stackTraceExcerpt ?? extractStackTraceExcerpt(input.output ?? '');
    const errorSignature = isStableSignature(input.errorSignature)
      ? input.errorSignature.toLowerCase()
      : computeErrorSignature({
        command: input.command,
        exitCode: input.exitCode,
        failingTests: input.failingTests,
        output: input.output ?? input.errorSignature,
        stackTraceExcerpt,
      });

    return {
      workspaceId: input.workspaceId,
      command: input.command,
      exitCode: input.exitCode,
      framework: input.framework,
      failingTests: dedupe(input.failingTests ?? []),
      errorSignature,
      stackTraceExcerpt: stackTraceExcerpt || undefined,
      affectedFiles: dedupe(input.affectedFiles ?? extractAffectedFiles(input.output ?? '')),
      attemptedFix: input.attemptedFix,
      retryFixed: input.retryFixed,
    };
  }

  async recordFailure(input: FailureMemoryInput): Promise<FailureMemory> {
    return tursoService.upsertFailureMemory(this.buildRecord(input));
  }

  async recordResolution(input: {
    workspaceId: string;
    failureId?: string;
    errorSignature?: string;
    command?: string;
    attemptedFix?: string;
    retryFixed: boolean;
  }): Promise<FailureMemory | null> {
    return tursoService.resolveFailureMemory(input);
  }

  async findSimilarFailures(query: SimilarFailureQuery): Promise<SimilarFailureMatch[]> {
    const signature =
      query.errorSignature ??
      (query.output || query.stackTraceExcerpt
        ? computeErrorSignature({
            command: query.command ?? '',
            failingTests: query.failingTests,
            output: query.output,
            stackTraceExcerpt: query.stackTraceExcerpt,
          })
        : undefined);

    const failures = await this.normalizeStoredSignatures(
      await tursoService.getFailureMemories(query.workspaceId, 80),
    );
    const hasSpecificFailureEvidence = Boolean(
      query.errorSignature ||
      query.output ||
      query.stackTraceExcerpt ||
      (query.failingTests && query.failingTests.length > 0),
    );

    return failures
      .map((failure) => scoreFailure(failure, {
        ...query,
        errorSignature: signature,
      }, hasSpecificFailureEvidence))
      .filter((match) => match.score >= (hasSpecificFailureEvidence ? 0.45 : 0.3))
      .sort((a, b) => b.score - a.score || b.failure.lastSeenAt.localeCompare(a.failure.lastSeenAt))
      .slice(0, query.limit ?? 5);
  }

  private async normalizeStoredSignatures(failures: FailureMemory[]): Promise<FailureMemory[]> {
    return Promise.all(failures.map(async (failure) => {
      const errorSignature = computeErrorSignature({
        command: failure.command,
        exitCode: failure.exitCode,
        failingTests: failure.failingTests,
        output: failure.stackTraceExcerpt ?? failure.errorSignature,
        stackTraceExcerpt: failure.stackTraceExcerpt,
      });
      if (failure.errorSignature === errorSignature) {
        return failure;
      }

      await tursoService.updateFailureMemorySignature(failure.id, errorSignature);
      return {
        ...failure,
        errorSignature,
      };
    }));
  }

  renderPromptSection(matches: SimilarFailureMatch[]): string {
    if (matches.length === 0) {
      return 'Known similar failure from this workspace: none';
    }

    const top = matches[0];
    const failure = top.failure;
    const retry = failure.retryFixed === undefined ? 'unknown' : failure.retryFixed ? 'yes' : 'no';
    return [
      'Known similar failure from this workspace:',
      `- Command: ${failure.command}`,
      `- Exit code: ${failure.exitCode ?? 'unknown'}`,
      `- Framework: ${failure.framework ?? 'unknown'}`,
      `- Error signature: ${failure.errorSignature}`,
      `- Failing tests: ${failure.failingTests.join(', ') || 'none recorded'}`,
      `- Affected files: ${failure.affectedFiles.join(', ') || 'none recorded'}`,
      `- Attempted fix: ${failure.attemptedFix ?? 'none recorded'}`,
      `- Retry fixed it: ${retry}`,
      `- Repeats: ${failure.occurrenceCount}`,
      `- Match: ${Math.round(top.score * 100)}% (${top.reasons.join(', ')})`,
      failure.occurrenceCount > 1
        ? '- Warning: same failure repeated in this workspace. Do not loop; change approach before retrying.'
        : '- Warning: inspect prior failure before retrying.',
      failure.stackTraceExcerpt ? `- Stack excerpt:\n${indent(failure.stackTraceExcerpt)}` : undefined,
    ].filter(Boolean).join('\n');
  }
}

export function computeErrorSignature(input: {
  command?: string;
  exitCode?: number;
  failingTests?: string[];
  output?: string;
  stackTraceExcerpt?: string;
}): string {
  const source = [
    input.exitCode === undefined ? '' : `exit:${input.exitCode}`,
    normalizeCommand(input.command ?? ''),
    ...(input.failingTests ?? []).slice(0, 8).map(normalizeText),
    selectErrorLines(input.stackTraceExcerpt || input.output || '').join('\n'),
  ].filter(Boolean).join('\n');

  const normalized = normalizeText(source).slice(0, 6000);
  return createHash('sha256').update(normalized || 'unknown failure').digest('hex').slice(0, 24);
}

export function extractStackTraceExcerpt(output: string): string {
  const lines = stripAnsi(output).split(/\r?\n/);
  const selected: string[] = [];
  let inTraceback = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^traceback\b/i.test(trimmed)) {
      inTraceback = true;
    }
    if (
      inTraceback ||
      /^\s*at\s+\S+/.test(line) ||
      /\b(error|exception|failed|panic)\b/i.test(trimmed) ||
      FILE_LINE_RE.test(trimmed)
    ) {
      selected.push(normalizeText(line));
    }
    if (selected.length >= 20) {
      break;
    }
  }

  return selected.join('\n').slice(0, 2500);
}

export function extractAffectedFiles(output: string): string[] {
  const matches = stripAnsi(output).match(FILE_LINE_GLOBAL_RE) ?? [];
  return dedupe(matches.map((match) => match.replace(LINE_COL_RE, ''))).slice(0, 30);
}

function scoreFailure(
  failure: FailureMemory,
  query: SimilarFailureQuery,
  hasSpecificFailureEvidence: boolean,
): SimilarFailureMatch {
  let score = 0;
  const reasons: string[] = [];

  if (query.errorSignature && query.errorSignature === failure.errorSignature) {
    score += 0.7;
    reasons.push('same signature');
  }

  if (query.command && normalizeCommand(query.command) === normalizeCommand(failure.command)) {
    score += hasSpecificFailureEvidence ? 0.18 : 0.45;
    reasons.push(hasSpecificFailureEvidence ? 'same command' : 'same command history');
  }

  if (query.framework && query.framework === failure.framework) {
    score += 0.08;
    reasons.push('same framework');
  }

  const testOverlap = overlap(query.failingTests ?? [], failure.failingTests);
  if (testOverlap > 0) {
    score += Math.min(0.25, testOverlap * 0.08);
    reasons.push('failing test overlap');
  }

  if (query.errorSignature && query.errorSignature !== failure.errorSignature) {
    const similarity = tokenSimilarity(query.errorSignature, failure.errorSignature);
    if (similarity > 0.6) {
      score += similarity * 0.2;
      reasons.push('similar signature');
    }
  }

  if (failure.retryFixed === false) {
    score += 0.05;
    reasons.push('prior retry did not fix');
  }

  return { failure, score: Math.min(1, score), reasons };
}

function selectErrorLines(output: string): string[] {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && /\b(error|failed|failure|exception|panic|expected|received|assert|traceback)\b/i.test(line))
    .slice(0, 25)
    .map(normalizeText);
}

function normalizeText(value: string): string {
  return stripAnsi(value)
    .replace(WINDOWS_PATH_RE, '<path>')
    .replace(POSIX_PATH_RE, '<path>')
    .replace(FILE_LINE_GLOBAL_RE, '$1:<line>')
    .replace(LINE_COL_RE, ':<line>')
    .replace(ISO_DATE_RE, '<date>')
    .replace(TIME_RE, '<time>')
    .replace(UUID_RE, '<id>')
    .replace(HASH_RE, '<hash>')
    .replace(RANDOM_ID_RE, '<id>')
    .replace(/\bline\s+\d+\b/gi, 'line <line>')
    .replace(/\bcol(?:umn)?\s+\d+\b/gi, 'col <col>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCommand(command: string): string {
  return command
    .replace(POSIX_PATH_RE, (match) => path.basename(match.replace(LINE_COL_RE, '')))
    .replace(WINDOWS_PATH_RE, '<path>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '');
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function overlap(left: string[], right: string[]): number {
  const rightSet = new Set(right.map(normalizeText));
  return left.map(normalizeText).filter((value) => rightSet.has(value)).length;
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(/[^a-z0-9<>]+/).filter(Boolean));
  const rightTokens = new Set(right.split(/[^a-z0-9<>]+/).filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function indent(value: string): string {
  return value.split('\n').map((line) => `  ${line}`).join('\n');
}

function isStableSignature(value?: string): value is string {
  return Boolean(value && /^[a-f0-9]{24}$/i.test(value));
}

export const failureMemoryEngine = new FailureMemoryEngine();
