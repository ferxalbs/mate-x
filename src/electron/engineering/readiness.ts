/**
 * computeReadiness — pure projection from typed state only.
 * Never reads chat text, FactoryRun stages, or model prose.
 * NES-1.4
 */

import type {
  CoverageConvergenceReport,
  EngineeringTaskStatus,
  ReadinessLabel,
  ShipProof,
  ValidationRun,
} from '../../contracts/engineering-task';

export interface ReadinessInput {
  status: EngineeringTaskStatus;
  openCriticalDecisions: number;
  openPolicyStops: number;
  consistencyCriticalCount: number;
  requiredValidationMissing: boolean;
  requiredValidationFailed: boolean;
  validationRuns: ValidationRun[];
  coverage: CoverageConvergenceReport | null;
  proof: ShipProof | null;
  proofAnchorsMatch: boolean;
  privacyBlocked: boolean;
  policyMustBlocked: boolean;
  leaseHardConflict: boolean;
  highFindings: number;
  mutationWithoutEvidence: boolean;
}

export function computeReadiness(input: ReadinessInput): ReadinessLabel {
  if (
    input.privacyBlocked ||
    input.policyMustBlocked ||
    input.openPolicyStops > 0 ||
    input.leaseHardConflict ||
    input.status === 'blocked'
  ) {
    return 'Blocked';
  }

  if (
    input.requiredValidationMissing ||
    input.requiredValidationFailed ||
    input.mutationWithoutEvidence ||
    (input.proof !== null && !input.proofAnchorsMatch) ||
    (input.proof !== null && input.proof.status !== 'valid')
  ) {
    return 'Not proven';
  }

  if (input.status === 'ready') {
    const actionable = input.coverage?.actionableGapCount ?? 0;
    if (actionable > 0) return 'Not proven';
    if (input.consistencyCriticalCount > 0) return 'Not proven';
    if (input.openCriticalDecisions > 0) return 'Not proven';
    return 'Ready';
  }

  if (input.highFindings > 0 || input.consistencyCriticalCount > 0) {
    return 'Risk found';
  }

  if (
    input.status === 'executing' ||
    input.status === 'verifying' ||
    input.status === 'converging' ||
    input.status === 'planning' ||
    input.status === 'awaiting_approval' ||
    input.status === 'clarifying' ||
    input.openCriticalDecisions > 0
  ) {
    return 'Needs check';
  }

  if (
    input.status === 'captured' ||
    input.status === 'specified' ||
    input.status === 'planned' ||
    input.status === 'failed' ||
    input.status === 'cancelled'
  ) {
    return 'Not proven';
  }

  return 'Needs check';
}
