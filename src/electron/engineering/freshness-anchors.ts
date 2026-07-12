/**
 * Real FreshnessAnchors for GitGate / ShipProof — no placeholders.
 * NES-6 / R2
 */

import { createHash } from 'node:crypto';

import type {
  EngineeringTask,
  FreshnessAnchors,
} from '../../contracts/engineering-task';
import type { EngineeringRepository } from './repository-types';
import { nowIso, sha256Hex } from './ids';

export interface GitWorkspaceSnapshot {
  workspaceId: string;
  repositoryPath: string;
  branch: string | null;
  baseSha: string | null;
  headSha: string;
  /** Raw diff payload used for hash (must match gate evaluation). */
  diffPayload: unknown;
  policyHash: string;
}

export function hashRepositoryPath(repositoryPath: string): string {
  return sha256Hex(repositoryPath);
}

export function hashDiffPayload(diffPayload: unknown): string {
  return createHash('sha256').update(JSON.stringify(diffPayload)).digest('hex');
}

/**
 * Build authoritative anchors from real workspace/git/policy/task state.
 * Prohibits placeholders such as workspaceId "active" or policyHash "unknown".
 */
export function buildFreshnessAnchors(input: {
  workspaceId: string;
  repositoryPath: string;
  branch: string | null;
  baseSha: string | null;
  headSha: string;
  diffPayload: unknown;
  policyHash: string;
  task: Pick<
    EngineeringTask,
    | 'activeSpecificationVersion'
    | 'activePlanVersion'
    | 'activeTaskGraphVersion'
  >;
  validationRunIds?: string[];
  evidenceLedgerVersion?: number;
}): FreshnessAnchors {
  assertRealAnchor(input.workspaceId, 'workspaceId');
  assertRealAnchor(input.repositoryPath, 'repositoryPath');
  assertRealSha(input.headSha, 'headSha');
  assertRealAnchor(input.policyHash, 'policyHash');
  if (input.policyHash === 'unknown' || input.workspaceId === 'active') {
    throw new Error('Placeholder freshness anchors are prohibited');
  }

  return {
    workspaceId: input.workspaceId,
    repositorySnapshotHash: hashRepositoryPath(input.repositoryPath),
    baseSha: input.baseSha,
    headSha: input.headSha,
    diffHash: hashDiffPayload(input.diffPayload),
    policyHash: input.policyHash,
    specificationVersion: input.task.activeSpecificationVersion ?? 0,
    planVersion: input.task.activePlanVersion ?? 0,
    taskGraphVersion: input.task.activeTaskGraphVersion ?? 0,
    generatedAt: nowIso(),
  };
}

export function currentAnchorsForGate(input: {
  workspaceId: string;
  headSha: string;
  diffHash: string;
  policyHash: string;
}): Pick<FreshnessAnchors, 'workspaceId' | 'headSha' | 'diffHash' | 'policyHash'> {
  assertRealAnchor(input.workspaceId, 'workspaceId');
  assertRealSha(input.headSha, 'headSha');
  assertRealAnchor(input.diffHash, 'diffHash');
  assertRealAnchor(input.policyHash, 'policyHash');
  if (input.workspaceId === 'active' || input.policyHash === 'unknown') {
    throw new Error('Placeholder GitGate anchors are prohibited');
  }
  return input;
}

/**
 * Resolve policy hash from task ref + repository, fail closed if missing.
 */
export function resolvePolicyHash(
  repo: EngineeringRepository,
  task: EngineeringTask,
): string {
  const ref = task.policyPackRef;
  if (!ref) {
    throw new Error('Task has no policyPackRef — cannot build real policyHash');
  }
  const pack = repo.getPolicyPack(ref.policyPackId, ref.version);
  if (!pack?.policyHash) {
    throw new Error('Policy pack missing — fail closed for policyHash');
  }
  if (pack.policyHash === 'unknown') {
    throw new Error('policyHash unknown is prohibited');
  }
  return pack.policyHash;
}

function assertRealAnchor(value: string, name: string): void {
  if (!value || !value.trim()) {
    throw new Error(`${name} is required for freshness anchors`);
  }
  const prohibited = new Set([
    'active',
    'unknown',
    'placeholder',
    'synthetic',
    'n/a',
    'none',
  ]);
  if (prohibited.has(value.trim().toLowerCase())) {
    throw new Error(`Prohibited placeholder value for ${name}: ${value}`);
  }
}

function assertRealSha(value: string, name: string): void {
  assertRealAnchor(value, name);
  // Accept full or short git SHAs (7–64 hex)
  if (!/^[0-9a-f]{7,64}$/i.test(value.trim())) {
    throw new Error(`${name} must be a real git SHA, got: ${value}`);
  }
}
