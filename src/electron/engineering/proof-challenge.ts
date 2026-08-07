import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ProofChallengeResult } from '../../contracts/engineering-task';
import { readUtf8FileSafe, writeWorkspaceFileSecure } from '../tools/tool-utils';

const execFileAsync = promisify(execFile);

export interface ProofChallengeArtifact {
  outcomeId: string;
  result: ProofChallengeResult;
  validationId: string;
  mutatedFiles: string[];
  completedAt: string;
  reason?: string;
}

export interface ProofChallengeInput {
  repositoryPath: string;
  outcomeId: string;
  validationId: string;
  /** Relative path plus exact precomputed range. Never accepts arbitrary shell. */
  mutation: { file: string; start: number; end: number; replacement: string };
  validation: { executable: string; args: string[]; timeoutMs: number };
  signal?: AbortSignal;
  readOnlyMode: boolean;
}

/**
 * Runs one high-value, deterministic challenge outside active workspace.
 * Caller selects an already-approved minimal mutation from RepoGraph evidence.
 */
export async function runProofChallenge(input: ProofChallengeInput): Promise<ProofChallengeArtifact> {
  if (input.readOnlyMode) return artifact(input, 'not_applicable', 'Review mode is read-only');
  if (input.signal?.aborted) return artifact(input, 'inconclusive', 'Cancelled before challenge');
  if (!isSafeRelativePath(input.mutation.file) || input.mutation.start < 0 || input.mutation.end < input.mutation.start) {
    return artifact(input, 'inconclusive', 'Unsafe mutation target');
  }

  const sandbox = await mkdtemp(path.join(tmpdir(), 'mate-x-proof-'));
  let worktreeAdded = false;
  try {
    await execFileAsync('git', ['-C', input.repositoryPath, 'worktree', 'add', '--detach', sandbox, 'HEAD']);
    worktreeAdded = true;
    if (input.signal?.aborted) return artifact(input, 'inconclusive', 'Cancelled before mutation');

    const target = await readUtf8FileSafe(sandbox, input.mutation.file);
    await writeWorkspaceFileSecure(
      sandbox,
      input.mutation.file,
      target.content.slice(0, input.mutation.start) + input.mutation.replacement + target.content.slice(input.mutation.end),
    );
    const result = await runValidation(sandbox, input.validation, input.signal);
    if (result === 'cancelled') return artifact(input, 'inconclusive', 'Cancelled during validation');
    return artifact(input, result === 'failed' ? 'sensitive' : 'insensitive');
  } catch (error) {
    return artifact(input, 'inconclusive', error instanceof Error ? error.message.slice(0, 240) : 'Challenge failed');
  } finally {
    if (worktreeAdded) await execFileAsync('git', ['-C', input.repositoryPath, 'worktree', 'remove', '--force', sandbox]).catch(() => undefined);
    await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runValidation(cwd: string, validation: ProofChallengeInput['validation'], signal?: AbortSignal): Promise<'passed' | 'failed' | 'cancelled'> {
  if (signal?.aborted) return 'cancelled';
  try {
    await execFileAsync(validation.executable, validation.args, { cwd, timeout: validation.timeoutMs, signal });
    return 'passed';
  } catch (error) {
    return signal?.aborted || (error as { name?: string }).name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

function artifact(input: ProofChallengeInput, result: ProofChallengeResult, reason?: string): ProofChallengeArtifact {
  return { outcomeId: input.outcomeId, result, validationId: input.validationId, mutatedFiles: [input.mutation.file], completedAt: new Date().toISOString(), reason };
}
