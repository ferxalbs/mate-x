/**
 * ShipProof + ProofHandle registry.
 * NES-6.1
 */

import type {
  CoverageConvergenceReport,
  EngineeringTask,
  FreshnessAnchors,
  ShipProof,
  ValidationRun,
} from '../../contracts/engineering-task';
import { ERR_CODES } from '../../contracts/engineering-task';
import { newNamespacedId, newProofHandle, nowIso } from './ids';
import type { EngineeringRepository } from './repository';

export function issueShipProof(input: {
  repo: EngineeringRepository;
  task: EngineeringTask;
  anchors: FreshnessAnchors;
  validationRuns: ValidationRun[];
  coverage: CoverageConvergenceReport;
  readiness: string;
}):
  | { ok: true; proof: ShipProof }
  | { ok: false; code: string; message: string } {
  if (input.task.status !== 'ready' && input.readiness !== 'Ready') {
    return {
      ok: false,
      code: ERR_CODES.ERR_NOT_READY,
      message: 'ShipProof requires Ready status',
    };
  }
  if (input.coverage.actionableGapCount > 0) {
    return {
      ok: false,
      code: ERR_CODES.ERR_INVARIANT_VIOLATION,
      message: 'ShipProof blocked by coverage gaps',
    };
  }
  if (input.readiness !== 'Ready') {
    return {
      ok: false,
      code: ERR_CODES.ERR_NOT_READY,
      message: 'ShipProof requires Ready readiness',
    };
  }

  const proof: ShipProof = {
    proofId: newNamespacedId('proof'),
    engineeringTaskId: input.task.engineeringTaskId,
    proofHandle: newProofHandle(),
    anchors: input.anchors,
    validationRunIds: input.validationRuns
      .filter((r) => r.passed)
      .map((r) => r.validationRunId),
    coverageReportId: input.coverage.reportId,
    status: 'valid',
    generatedAt: nowIso(),
    traces: [],
  };

  input.repo.applyTransaction({
    task: {
      ...input.task,
      lastProofId: proof.proofId,
      updatedAt: nowIso(),
    },
    events: [],
    proof,
  });

  return { ok: true, proof };
}

export function evaluateProofFreshness(
  proof: ShipProof,
  current: Pick<FreshnessAnchors, 'headSha' | 'diffHash' | 'policyHash' | 'workspaceId'>,
):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (proof.status !== 'valid') {
    return {
      ok: false,
      code: ERR_CODES.ERR_PROOF_INVALID,
      message: `proof status ${proof.status}`,
    };
  }
  if (proof.anchors.workspaceId !== current.workspaceId) {
    return {
      ok: false,
      code: ERR_CODES.ERR_PROOF_INVALID,
      message: 'workspace mismatch',
    };
  }
  if (proof.anchors.headSha !== current.headSha) {
    return {
      ok: false,
      code: ERR_CODES.ERR_PROOF_STALE_HEAD,
      message: 'proof headSha mismatch',
    };
  }
  if (proof.anchors.diffHash !== current.diffHash) {
    return {
      ok: false,
      code: ERR_CODES.ERR_PROOF_STALE_DIFF,
      message: 'proof diffHash mismatch',
    };
  }
  if (proof.anchors.policyHash !== current.policyHash) {
    return {
      ok: false,
      code: ERR_CODES.ERR_PROOF_STALE_POLICY,
      message: 'proof policyHash mismatch',
    };
  }
  return { ok: true };
}
