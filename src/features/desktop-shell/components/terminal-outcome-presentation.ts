import type { ExecutionOutcome } from "../../../contracts/execution";
import { presentExecutionOutcome, presentUserFacingResponse } from "../../../lib/user-facing-presentation";

/**
 * Compatibility helpers for older terminal-card callers. The presentation
 * rules live in user-facing-presentation.ts; these functions do not add a
 * second rendering policy.
 */
export function getTerminalAssistantResponse(outcome: ExecutionOutcome) {
  return presentExecutionOutcome(outcome).primaryResponse;
}

export function getOutcomeEvidenceRow(outcome: ExecutionOutcome) {
  return presentExecutionOutcome(outcome).compactEvidence ?? "";
}

export function shouldShowFullOutcomeCard(outcome: ExecutionOutcome) {
  return presentExecutionOutcome(outcome).showFullOutcomeCard;
}

export function getTerminalActivityEvidence(outcome: ExecutionOutcome) {
  const verification = outcome.evidence.objective?.verification;
  return {
    repositoryVerified:
      verification?.status === "satisfied" &&
      verification.coverage === "complete",
    passedChecksLabel:
      presentUserFacingResponse({
        terminalState: outcome.terminalState,
        completionKind: outcome.completionKind,
        validation: {
          status: outcome.evidence.validation.status,
          contract: outcome.evidence.validation.contract,
        },
      }).compactEvidence?.match(/(?:Historical )?(?:Tests|Typecheck|Lint|Build|Checks) passed/)?.[0] ?? null,
  };
}
