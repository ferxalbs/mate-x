/**
 * Main-process GitGate — commit/push require fresh ProofHandle.
 * No emergency bypass in v0.1.2.
 * NES-6.2
 */

import type { FreshnessAnchors, ShipProof } from '../../contracts/engineering-task';
import { ERR_CODES } from '../../contracts/engineering-task';
import type { EngineeringRepository } from './repository';
import { evaluateProofFreshness } from './ship-proof';

export interface GitGateEvaluation {
  allowed: boolean;
  code?: string;
  message?: string;
  proofId?: string;
}

export function evaluateGitGate(input: {
  repo: EngineeringRepository;
  proofHandle: string | null | undefined;
  current: Pick<FreshnessAnchors, 'headSha' | 'diffHash' | 'policyHash' | 'workspaceId'>;
}): GitGateEvaluation {
  if (!input.proofHandle) {
    return {
      allowed: false,
      code: ERR_CODES.ERR_PROOF_REQUIRED,
      message: 'ProofHandle required for git write',
    };
  }

  const proof = input.repo.getProofByHandle(input.proofHandle);
  if (!proof) {
    return {
      allowed: false,
      code: ERR_CODES.ERR_PROOF_INVALID,
      message: 'Unknown or invalid ProofHandle',
    };
  }

  const fresh = evaluateProofFreshness(proof, input.current);
  if (!fresh.ok) {
    return {
      allowed: false,
      code: fresh.code,
      message: fresh.message,
      proofId: proof.proofId,
    };
  }

  return { allowed: true, proofId: proof.proofId };
}

export type GatedGitOp = 'commit' | 'push';

/**
 * Assert git write allowed. Throws never — returns structured denial.
 */
export function assertGitWriteAllowed(
  evaluation: GitGateEvaluation,
  op: GatedGitOp,
): GitGateEvaluation {
  if (!evaluation.allowed) {
    return {
      ...evaluation,
      message: evaluation.message ?? `${op} denied by GitGate`,
    };
  }
  return evaluation;
}

/** Renderer-safe mirror payload (not authoritative). */
export function toGitGateMirror(evaluation: GitGateEvaluation): {
  validated: boolean;
  code?: string;
  message?: string;
} {
  return {
    validated: evaluation.allowed,
    code: evaluation.code,
    message: evaluation.message,
  };
}

export function proofHandleFormatLooksValid(handle: string): boolean {
  return typeof handle === 'string' && handle.startsWith('ph_') && handle.length >= 20;
}

export type { ShipProof };
