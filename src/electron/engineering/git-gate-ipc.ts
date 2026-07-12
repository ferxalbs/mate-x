/**
 * Main-process Git write enforcement using real freshness anchors.
 * No renderer authorization; no placeholder workspaceId/policyHash.
 * NES-6.2 / R2 / R3
 */

import type { WorkspaceEntry } from '../../contracts/workspace';
import type { GitService } from '../git-service';
import { evaluateGitGate, assertGitWriteAllowed, type GatedGitOp } from './git-gate';
import {
  currentAnchorsForGate,
  hashDiffPayload,
} from './freshness-anchors';
import { getEngineeringRepository } from './repository';
import { ensureDefaultPolicyPack } from './policy-pack';
import { isMainProcessGitGateEnabled, isReleaseBuild } from './flags';

export async function assertMainProcessGitWrite(input: {
  op: GatedGitOp;
  proofHandle: string | null | undefined;
  resolveWorkspace: () => Promise<WorkspaceEntry>;
  resolveGitService: () => Promise<GitService>;
}): Promise<void> {
  // Release builds always enforce GitGate (R3). Non-release may skip only when
  // explicitly flagged off for local tests — never a product emergency bypass.
  if (isReleaseBuild() || isMainProcessGitGateEnabled()) {
    // enforce below
  } else {
    return;
  }

  const workspace = await input.resolveWorkspace();
  if (!workspace?.id || workspace.id === 'active') {
    throw new Error('ERR_WORKSPACE_REQUIRED: real workspace id required for GitGate');
  }

  const git = await input.resolveGitService();
  const status = await git.getStatusSafe();
  const log = await git.getLog(1);
  const headSha = log[0]?.hash;
  if (!headSha || headSha === 'unknown') {
    throw new Error('ERR_GIT_HEAD: unable to resolve real HEAD SHA for GitGate');
  }
  const diff = await git.getDiff();
  const diffHash = hashDiffPayload(diff);

  const repo = getEngineeringRepository();
  // Prefer policy from proof's pack; fallback to default pack hash (real, not "unknown")
  let policyHash: string | undefined;
  if (input.proofHandle) {
    const proof = repo.getProofByHandle(input.proofHandle);
    policyHash = proof?.anchors.policyHash;
  }
  if (!policyHash) {
    const pack = ensureDefaultPolicyPack(repo);
    policyHash = pack.policyHash;
  }

  const current = currentAnchorsForGate({
    workspaceId: workspace.id,
    headSha,
    diffHash,
    policyHash,
  });

  const evaluation = assertGitWriteAllowed(
    evaluateGitGate({
      repo,
      proofHandle: input.proofHandle,
      current,
    }),
    input.op,
  );

  if (!evaluation.allowed) {
    throw new Error(
      `${evaluation.code ?? 'ERR_PROOF_REQUIRED'}: ${evaluation.message ?? `${input.op} denied by GitGate`}`,
    );
  }

  // Branch is recorded for diagnostics only — not renderer-authoritative
  void status?.current;
}
