/**
 * ShipProof + ProofHandle registry.
 * NES-6.1
 */

import type {
  CoverageConvergenceReport,
  EngineeringTask,
  FreshnessAnchors,
  OutcomeMap,
  ShipProof,
  ValidationRun,
} from '../../contracts/engineering-task';
import { deriveOutcomeMap, ERR_CODES } from '../../contracts/engineering-task';
import { newNamespacedId, newProofHandle, nowIso } from './ids';
import type { EngineeringRepository } from './repository';

export function issueShipProof(input: {
  repo: EngineeringRepository;
  task: EngineeringTask;
  anchors: FreshnessAnchors;
  validationRuns: ValidationRun[];
  coverage: CoverageConvergenceReport;
  readiness: string;
  outcomeMap?: OutcomeMap;
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
  const outcomeMap = input.outcomeMap ?? (input.task.changeContract
    ? deriveOutcomeMap({
        contract: input.task.changeContract,
        diffHash: input.anchors.diffHash,
        validationRuns: input.validationRuns,
      })
    : undefined);
  if (input.task.changeContract && !outcomeMap) {
    return { ok: false, code: ERR_CODES.ERR_OUTCOME_REQUIRED, message: 'ShipProof requires an outcome check' };
  }
  if (outcomeMap && outcomeMap.diffHash !== input.anchors.diffHash) {
    return {
      ok: false,
      code: ERR_CODES.ERR_PROOF_STALE_DIFF,
      message: 'Outcome check does not match current diff',
    };
  }
  if (outcomeMap && outcomeMap.entries.some((entry) => entry.state !== 'proven' && entry.state !== 'out_of_scope')) {
    const insensitive = outcomeMap.entries.some((entry) => entry.evidence.challenge === 'insensitive');
    return {
      ok: false,
      code: insensitive ? ERR_CODES.ERR_PROOF_CHALLENGE_INSENSITIVE : ERR_CODES.ERR_OUTCOME_UNPROVEN,
      message: insensitive ? 'Proof challenge is insensitive' : 'Required outcome is not proven',
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
    outcomeMap,
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
