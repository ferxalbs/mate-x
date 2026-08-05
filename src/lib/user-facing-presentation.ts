import type {
  AgentOutcome,
  ChatMessage,
  ToolEvent,
} from "../contracts/chat";
import {
  normalizeExecutionOutcome,
  type CompletionKind,
  type ExecutionOutcome,
  type ExecutionValidationStatus,
} from "../contracts/execution";
import type {
  PresentationActivityMetadata,
  PresentationBlocker,
  PresentationEvidenceFreshness,
  PresentationInspectionEvidence,
  PresentationIntent,
  PresentationNextAction,
  PresentationState,
  UserFacingPresentation,
  UserFacingPresentationInput,
} from "../contracts/presentation";
import { sanitizeAssistantOutput } from "./assistant-output";

const INTERNAL_PRESENTATION_TERMS =
  /\b(?:WorkPlan|Work Engine|objective\s+satisfied|objective\s+verification|no-op|changed_unverified|validation\s+not\s+applicable|tool\s+round|agent\s+pass|repository\s+assertion|execution\s+outcome|internal\s+error|failure\s+memory|repo\s+graph|ERR_[A-Z0-9_]+|TYPECHECK_UNAVAILABLE|TOOLCHAIN_AMBIGUOUS|VALIDATION_COMMAND_UNRESOLVED|WORKSPACE_SCOPE|MODEL_TOOLS_UNAVAILABLE|APPROVAL_REQUIRED|MODE_READ_ONLY|WORKSPACE_READ_ONLY|COMMAND_NOT_ALLOWED|ACTION_NOT_ALLOWED|UNCLASSIFIED_OPERATION|DESTRUCTIVE_ACTION|APPROVAL_DENIED|GIT_APPROVAL_REQUIRED|TASK_APPROVAL_REQUIRED|PROVIDER_UNAVAILABLE)\b/i;

const CONTROL_PAYLOAD = /(?:<\|[^>]+\|>|\b(?:tool_call|function_call)\b|^\s*\{\s*["'](?:call|tool)["']\s*:)/i;

const VALIDATION_CLAIM =
  /\b(?:tests?|checks?|typecheck|lint|build)\s+(?:passed|failed|completed|succeeded)\b/i;

const SYNTHESIS_PLACEHOLDER =
  /^No final synthesis text was returned for this run\.?$/i;

const PUBLIC_ACTIVITY_BY_TYPE: Record<string, string> = {
  search: "Finding relevant files",
  read: "Reviewing relevant code",
  edit: "Applying the requested change",
  command: "Running the requested check",
  validation: "Running checks",
  approval: "Waiting for approval",
  result: "Preparing your answer",
  error: "Unable to continue",
  wait: "Reviewing the repository",
};

export function presentUserFacingResponse(
  input: UserFacingPresentationInput,
): UserFacingPresentation {
  const intent = input.presentationIntent ?? inferPresentationIntent(input);
  const changedFiles = input.changedFiles ?? [];
  const changedCount = changedFiles.length;
  const state = getPresentationState(input, intent);
  const compactEvidence = buildCompactEvidence(input, changedCount);
  const nextAction = buildNextAction(input, state, changedCount);
  const naturalSynthesis = getSafeNaturalSynthesis(input);
  const primaryResponse = naturalSynthesis ?? buildFallbackResponse({
    input,
    intent,
    state,
    changedCount,
    compactEvidence,
    nextAction,
  });

  return {
    primaryResponse,
    compactEvidence,
    presentationState: state,
    nextAction,
    showFullOutcomeCard: shouldShowFullOutcomeCard(input),
    activitySummary: buildActivitySummary(input, intent, state, changedCount),
  };
}

/**
 * The renderer uses this adapter so every assistant message follows the same
 * presentation rules, including messages restored from local history.
 */
export function presentChatMessage(
  message: ChatMessage,
  options: { isRunning?: boolean } = {},
): UserFacingPresentation {
  const rawOutcome = message.executionOutcome ?? message.evidencePack?.executionOutcome;
  const outcome = rawOutcome ? normalizeExecutionOutcome(rawOutcome) : undefined;
  const evidenceFreshness =
    message.presentationEvidenceFreshness ?? "current_run";
  const validation = outcome
    ? {
        status: outcome.evidence.validation.status,
        freshness: evidenceFreshness,
        cause: outcome.evidence.validation.cause,
        summary: outcome.evidence.validation.summary,
        contract: outcome.evidence.validation.contract,
      }
    : undefined;
  const blocker = getPresentationBlocker(message.outcome, outcome);
  const intent =
    message.presentationIntent ?? inferPresentationIntentFromOutcome(outcome);
  const agentTerminalState = message.outcome?.status === "blocked" ||
      message.outcome?.status === "needs_approval"
    ? "blocked" as const
    : message.outcome?.status === "failed"
      ? "failed" as const
      : undefined;
  const agentCompletionKind = message.outcome?.status === "needs_approval"
    ? "awaiting_approval" as const
    : undefined;

  return presentUserFacingResponse({
    presentationIntent: intent,
    naturalSynthesis: message.content,
    synthesisStatus: outcome?.evidence.synthesis.status ??
      (message.content.trim() ? "valid" : "missing"),
    terminalState: outcome?.terminalState ?? agentTerminalState,
    completionKind: outcome?.completionKind ?? agentCompletionKind,
    changedFiles: outcome
      ? (outcome.files ?? outcome.evidence.changedFiles).map((file) => ({
          path: file.path,
          operation: file.operation,
        }))
      : undefined,
    inspection: outcome ? getInspectionEvidence(outcome, evidenceFreshness) : undefined,
    validation,
    blocker,
    approvalRequired: outcome?.completionKind === "awaiting_approval" ||
      message.outcome?.status === "needs_approval",
    requiredUserAction: outcome?.evidence.requiredUserAction ??
      getAgentRemediationLabel(message.outcome),
    evidenceFreshness,
    activity: {
      events: message.events,
      isRunning: options.isRunning,
    },
  });
}

export function presentExecutionOutcome(
  outcome: ExecutionOutcome,
  options: {
    naturalSynthesis?: string | null;
    presentationIntent?: PresentationIntent;
    evidenceFreshness?: PresentationEvidenceFreshness;
    events?: readonly ToolEvent[];
  } = {},
) {
  return presentChatMessage({
    id: "presentation-only",
    role: "assistant",
    content: options.naturalSynthesis ?? "",
    createdAt: "",
    events: options.events ? [...options.events] : [],
    executionOutcome: outcome,
    presentationIntent: options.presentationIntent,
    presentationEvidenceFreshness: options.evidenceFreshness ?? "current_run",
  });
}

export function getPresentationActivitySummary(
  input: PresentationActivityMetadata & Pick<
    UserFacingPresentationInput,
    "presentationIntent" | "terminalState" | "completionKind" | "validation" | "inspection"
  >,
) {
  return buildActivitySummary(
    { ...input, activity: input },
    input.presentationIntent ?? "unknown",
    getPresentationState({ ...input, synthesisStatus: "valid" }),
    0,
  );
}

export function getPresentationRunningActivityLabel(
  event?: ToolEvent,
  fallback = "Reviewing the repository",
) {
  if (!event) return fallback;
  const safeLabel = normalizePublicText(event.title ?? event.label);
  if (safeLabel && !INTERNAL_PRESENTATION_TERMS.test(safeLabel)) {
    if (/search|find|match/i.test(safeLabel)) return "Finding relevant files";
    if (/read|inspect|review|inventory/i.test(safeLabel)) return "Reviewing relevant code";
    if (/edit|patch|write|change/i.test(safeLabel)) return "Applying the requested change";
    if (/valid|test|lint|typecheck|build/i.test(safeLabel)) return "Running checks";
    if (/approv|permission/i.test(safeLabel)) return "Waiting for approval";
    if (/response|synth|answer/i.test(safeLabel)) return "Preparing your answer";
  }
  return PUBLIC_ACTIVITY_BY_TYPE[event.type ?? "wait"] ?? fallback;
}

function getSafeNaturalSynthesis(
  input: UserFacingPresentationInput,
) {
  if (input.synthesisStatus !== "valid") return null;
  const normalized = sanitizeAssistantOutput(input.naturalSynthesis ?? "");
  if (!normalized || CONTROL_PAYLOAD.test(normalized)) return null;
  if (SYNTHESIS_PLACEHOLDER.test(normalized)) return null;
  if (INTERNAL_PRESENTATION_TERMS.test(normalized)) return null;
  if (
    input.validation?.freshness === "historical" &&
    VALIDATION_CLAIM.test(normalized) &&
    !/\b(?:historical|previous|prior|earlier|past)\b/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function getPresentationState(
  input: Pick<
    UserFacingPresentationInput,
    "presentationIntent" | "terminalState" | "completionKind" | "synthesisStatus"
  >,
  intent = input.presentationIntent ?? "unknown",
): PresentationState {
  if (!input.terminalState && !input.completionKind) {
    if (intent === "conversation") return "conversation";
    return input.synthesisStatus === "valid" ? "answer" : "missing_synthesis";
  }

  if (input.completionKind === "awaiting_approval") return "approval_required";
  if (input.completionKind === "blocked" || input.terminalState === "blocked") return "blocked";
  if (input.completionKind === "failed" || input.terminalState === "failed" || input.terminalState === "cancelled") return "failed";
  if (input.terminalState === "partial" || input.completionKind === "changed_unverified") return "partial";
  if (input.completionKind === "already_satisfied") return "already_present";
  if (input.completionKind === "changed_verified") return "change_applied";
  if (input.completionKind === "validation_completed") return "validation_complete";
  if (input.completionKind === "inspection_completed") {
    return intent === "repository_overview" ? "repository_overview" : "review_complete";
  }
  return input.synthesisStatus === "valid" ? "answer" : "missing_synthesis";
}

function buildCompactEvidence(
  input: UserFacingPresentationInput,
  changedCount: number,
) {
  const parts: string[] = [];
  if (changedCount > 0) {
    parts.push(`${changedCount} ${changedCount === 1 ? "file" : "files"} changed`);
  }
  if (input.inspection?.count && input.inspection.count > 0) {
    const label = input.inspection.label ?? "files";
    const freshness = getFreshnessPrefix(input.inspection.freshness ?? input.evidenceFreshness);
    parts.push(`${freshness}${input.inspection.count} ${label} checked`);
  }

  const validationLabel = getValidationEvidenceLabel(input.validation);
  if (validationLabel) parts.push(validationLabel);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function getValidationEvidenceLabel(
  validation: UserFacingPresentationInput["validation"],
) {
  if (!validation) return null;
  const freshness = getFreshnessPrefix(validation.freshness);
  const passedSignals = getPassedValidationLabels(validation);
  if (validation.status === "passed") {
    if (passedSignals.length === 1) {
      return `${freshness}${passedSignals[0]}`;
    }
    return `${freshness}Checks passed`;
  }
  if (validation.status === "failed") return `${freshness}Checks failed`;
  if (validation.status === "blocked") return `${freshness}Checks blocked`;
  if (validation.status === "not_run") {
    if (!validation.cause) return null;
    const unavailableLabel = validation.cause === "TYPECHECK_UNAVAILABLE"
      ? `${freshness}Typecheck unavailable`
      : `${freshness}Required check unavailable`;
    return [...passedSignals.map((label) => `${freshness}${label}`), unavailableLabel].join(" · ");
  }
  if (validation.status === "pending" || validation.status === "running") {
    return `${freshness}Checks in progress`;
  }
  return null;
}

function getFreshnessPrefix(freshness?: PresentationEvidenceFreshness) {
  return freshness === "historical" ? "Historical " : "";
}

function buildNextAction(
  input: UserFacingPresentationInput,
  state: PresentationState,
  changedCount: number,
): PresentationNextAction | null {
  const requiredUserAction = getSafeUserAction(input.requiredUserAction);
  if (requiredUserAction) {
    return { kind: getActionKind(state), label: requiredUserAction };
  }

  if (input.approvalRequired || state === "approval_required") {
    return { kind: "approve", label: "Approve the requested action to continue" };
  }

  if (state === "blocked") {
    return {
      kind: "review_scope",
      label: getSafeUserAction(input.blocker?.remediation) ?? "Review the requirement, then try again",
    };
  }

  if (state === "failed") {
    return {
      kind: "retry",
      label: changedCount > 0
        ? "Review the partial changes before trying again"
        : "Try again after reviewing the details",
    };
  }

  if (state === "partial") {
    if (input.validation?.cause || input.validation?.status === "not_run") {
      return { kind: "configure_validation", label: "Review the changes and run the required check" };
    }
    return { kind: "review_changes", label: "Review the changes and complete the remaining check" };
  }

  if (hasRequiredValidationGap(input.validation)) {
    return input.validation?.cause
      ? { kind: "configure_validation", label: "Configure or run the required check" }
      : { kind: "review_checks", label: "Review the failed check before continuing" };
  }

  if (state === "missing_synthesis") {
    return { kind: "retry", label: "Try again to get the final answer" };
  }

  return null;
}

function getActionKind(state: PresentationState): PresentationNextAction["kind"] {
  if (state === "approval_required") return "approve";
  if (state === "blocked") return "review_scope";
  if (state === "failed" || state === "missing_synthesis") return "retry";
  if (state === "partial") return "review_changes";
  return "review_scope";
}

function shouldShowFullOutcomeCard(input: UserFacingPresentationInput) {
  const state = getPresentationState(input);
  if (state === "blocked" || state === "approval_required" || state === "failed" || state === "partial") {
    return true;
  }
  return hasRequiredValidationGap(input.validation) &&
    (input.validation?.status === "failed" ||
      input.validation?.status === "blocked" ||
      input.validation?.status === "not_run");
}

function hasRequiredValidationGap(
  validation: UserFacingPresentationInput["validation"],
) {
  return validation?.contract?.items.some(
    (item) =>
      (item.obligation === "required" || item.obligation === "fallback") &&
      item.applicability === "applicable" &&
      (item.evidence.status !== "passed" || item.availability !== "resolved"),
  ) ?? false;
}

function buildFallbackResponse(input: {
  input: UserFacingPresentationInput;
  intent: PresentationIntent;
  state: PresentationState;
  changedCount: number;
  compactEvidence: string | null;
  nextAction: PresentationNextAction | null;
}) {
  const { input: source, intent, state, changedCount, nextAction } = input;
  const actionSentence = nextAction ? ` Next: ${nextAction.label}.` : "";
  const checkSentence = getFallbackCheckSentence(source.validation);
  const inspectionLimitSentence = source.inspection?.coverage === "partial"
    ? " The available inspection covered only part of the requested scope."
    : "";

  if (state === "conversation") {
    return "I couldn't produce a final answer for that request. Please try again.";
  }
  if (state === "missing_synthesis" && intent === "repository_overview") {
    return `I couldn't produce a complete repository overview from the available inspection.${inspectionLimitSentence}${actionSentence}`;
  }
  if (state === "approval_required") {
    return `I need your approval before I can continue. No files were changed.${actionSentence}`;
  }
  if (state === "blocked") {
    const reason = getSafeUserAction(source.blocker?.summary) ??
      "a required permission or repository condition was not met";
    return `I couldn't continue because ${lowercaseFirst(reason)}.${actionSentence}`;
  }
  if (state === "failed") {
    return changedCount > 0
      ? `I couldn't complete the request. ${changedCount} ${changedCount === 1 ? "file was" : "files were"} changed before it stopped.${actionSentence}`
      : `I couldn't complete the request.${actionSentence}`;
  }
  if (state === "partial") {
    return changedCount > 0
      ? `Updated ${changedCount} ${changedCount === 1 ? "file" : "files"}, but the request is not complete.${checkSentence}${actionSentence}`
      : `The request is only partly complete.${checkSentence}${actionSentence}`;
  }
  if (state === "already_present") {
    return `The requested state is already present. No files were changed.${checkSentence}`;
  }
  if (state === "change_applied") {
    return `Updated ${changedCount} ${changedCount === 1 ? "file" : "files"} to the requested state.${checkSentence}`;
  }
  if (state === "validation_complete") {
    if (source.validation?.status === "passed") {
      return source.validation.freshness === "historical"
        ? "Historical checks passed."
        : "The requested checks passed.";
    }
    return source.validation?.freshness === "historical"
      ? `Historical checks did not pass.${actionSentence}`
      : `The requested checks did not pass.${actionSentence}`;
  }
  if (state === "repository_overview") {
    return `I reviewed the project structure and prepared the repository overview.${inspectionLimitSentence}`;
  }
  if (state === "review_complete") {
    if (source.findingsCount === 0) {
      return `I reviewed the requested scope and found no findings in the inspected files.${getInspectionQualification(source)}`;
    }
    return `I reviewed the requested scope, but the final findings summary was unavailable.${actionSentence}`;
  }
  if (state === "answer") {
    return "I reviewed the request and prepared an answer.";
  }
  return `I couldn't produce a final answer for this request.${actionSentence}`;
}

function getFallbackCheckSentence(
  validation: UserFacingPresentationInput["validation"],
) {
  if (!validation) return "";
  const historical = validation.freshness === "historical";
  if (validation.status === "passed") {
    return historical ? " Historical checks passed." : " The relevant checks passed.";
  }
  if (validation.status === "failed") {
    return historical ? " Historical checks did not pass." : " The relevant checks did not pass.";
  }
  if (validation.status === "blocked") {
    return historical ? " Historical checks were blocked." : " The relevant checks were blocked.";
  }
  if (validation.status === "not_run" && validation.cause) {
    const passedSignals = getPassedValidationLabels(validation);
    const passedSentence = passedSignals.length > 0
      ? ` ${historical ? "Historical " : ""}${passedSignals.join(" and ")}.`
      : "";
    if (validation.cause === "TYPECHECK_UNAVAILABLE") {
      return historical
        ? `${passedSentence} A historical typecheck could not run because the repository does not define a typecheck command.`
        : `${passedSentence} The repository does not define a typecheck command, so that check could not run.`;
    }
    if (validation.cause === "TOOLCHAIN_AMBIGUOUS") {
      return historical
        ? `${passedSentence} A historical check could not run because the repository toolchain could not be resolved.`
        : `${passedSentence} The repository toolchain could not be resolved, so that check could not run.`;
    }
    return historical
      ? `${passedSentence} A historical required check was unavailable.`
      : `${passedSentence} A required check was unavailable.`;
  }
  return "";
}

function getInspectionQualification(input: UserFacingPresentationInput) {
  if (input.validation?.freshness === "historical") return " Historical checks are shown separately.";
  if (input.validation?.status === "passed") return " The relevant checks passed.";
  if (input.validation?.status === "not_run") return " This result is based on inspection; some required runtime checks were not run.";
  return "";
}

function getPassedValidationLabels(
  validation: UserFacingPresentationInput["validation"],
) {
  const signals = [...new Set(
    (validation?.contract?.items ?? [])
      .filter((item) => item.evidence.status === "passed")
      .map((item) => item.signal),
  )];
  return signals.map((signal) => signal === "test"
    ? "Tests passed"
    : signal === "typecheck"
      ? "Typecheck passed"
      : signal === "lint"
        ? "Lint passed"
        : signal === "build"
          ? "Build passed"
          : "Checks passed");
}

function buildActivitySummary(
  input: UserFacingPresentationInput,
  intent: PresentationIntent,
  state: PresentationState,
  changedCount: number,
) {
  const parts: string[] = [];
  const events = (input.activity?.events ?? []).filter(
    (event) => event.visibility !== "technical" && event.visibility !== "restricted",
  );
  const completed = (event: ToolEvent) =>
    event.status === "done" || event.status === "completed";
  const hasInspection = events.some(
    (event) => completed(event) && (event.type === "read" || event.type === "search"),
  );
  const hasEdit = events.some((event) => completed(event) && event.type === "edit");
  const hasValidationFailureEvent = events.some(
    (event) =>
      event.type === "validation" &&
      (event.status === "error" || event.status === "failed" || event.status === "blocked"),
  );
  const hasCompletedValidationEvent = events.some(
    (event) => event.type === "validation" && completed(event),
  );

  if (state === "approval_required") {
    parts.push("Waiting for approval");
  } else if (state === "blocked") {
    parts.push("Waiting for a required decision");
  } else if (state === "failed") {
    parts.push("Unable to complete requested work");
  } else if (state === "partial" || state === "change_applied" || changedCount > 0 || hasEdit) {
    parts.push("Requested change applied");
  } else if (state === "already_present") {
    parts.push("Requested state already present");
  } else if (state === "validation_complete") {
    parts.push("Checks completed");
  } else if (intent === "repository_overview") {
    parts.push("Project structure reviewed");
  } else if (intent === "review" || hasInspection) {
    parts.push("Relevant code inspected");
  }

  if (input.inspection?.count && input.inspection.count > 0) {
    parts.push(`${input.inspection.count} ${input.inspection.label ?? "files"} checked`);
  } else if (
    input.inspection?.status === "satisfied" &&
    input.inspection.label &&
    !hasInspection
  ) {
    parts.push(`${input.inspection.label} checked`);
  }

  if (input.validation?.status === "passed") {
    parts.push(input.validation.freshness === "historical" ? "Historical checks passed" : "Checks passed");
  } else if (
    input.validation?.status === "failed" ||
    input.validation?.status === "blocked" ||
    (input.validation?.status === "not_run" && input.validation.cause)
  ) {
    parts.push("Checks need attention");
  } else if (input.validation?.status === "not_run") {
    parts.push("Checks not run");
  } else if (input.validation?.status === "pending" || input.validation?.status === "running") {
    parts.push("Checks in progress");
  } else if (hasValidationFailureEvent) {
    parts.push("Checks need attention");
  } else if (hasCompletedValidationEvent) {
    parts.push("Checks completed");
  }

  if (parts.length === 0 && input.activity?.isRunning) {
    const activeLabel = normalizePublicText(input.activity.activeLabel);
    if (activeLabel && !INTERNAL_PRESENTATION_TERMS.test(activeLabel)) {
      return activeLabel;
    }
    return getPresentationRunningActivityLabel(
      events.find((event) => event.status === "active" || event.status === "queued"),
    );
  }
  return unique(parts).join(" · ") || null;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function getSafeUserAction(value?: string | null) {
  const normalized = normalizePublicText(value);
  if (!normalized || INTERNAL_PRESENTATION_TERMS.test(normalized)) return null;
  return normalized.replace(/[.!?]+$/, "");
}

function normalizePublicText(value?: string | null) {
  if (!value) return "";
  const normalized = sanitizeAssistantOutput(value).replace(/\s+/g, " ").trim();
  if (!normalized || CONTROL_PAYLOAD.test(normalized)) return "";
  return normalized;
}

function lowercaseFirst(value: string) {
  return value ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function inferPresentationIntent(input: UserFacingPresentationInput): PresentationIntent {
  if (input.terminalState || input.completionKind) {
    return inferPresentationIntentFromOutcome({
      terminalState: input.terminalState,
      completionKind: input.completionKind,
    } as ExecutionOutcome);
  }
  return "conversation";
}

function inferPresentationIntentFromOutcome(
  outcome?: Pick<ExecutionOutcome, "terminalState" | "completionKind">,
): PresentationIntent {
  if (!outcome) return "conversation";
  if (outcome.completionKind === "validation_completed") return "validation";
  if (outcome.completionKind === "inspection_completed") return "review";
  if (
    outcome.completionKind === "changed_verified" ||
    outcome.completionKind === "changed_unverified" ||
    outcome.completionKind === "already_satisfied"
  ) return "change";
  return "unknown";
}

function getPresentationBlocker(
  agentOutcome?: AgentOutcome,
  outcome?: ExecutionOutcome,
): PresentationBlocker | undefined {
  if (agentOutcome?.status === "needs_approval") {
    return { kind: "approval", summary: agentOutcome.summary };
  }
  if (agentOutcome?.status === "blocked") {
    return {
      kind: "blocked",
      summary: agentOutcome.summary,
      remediation: agentOutcome.blocker.remediation?.label,
    };
  }
  if (agentOutcome?.status === "failed") {
    return {
      kind: "failure",
      summary: agentOutcome.summary,
      remediation: agentOutcome.remediation?.label,
    };
  }
  if (outcome?.primaryCause) {
    return {
      kind: outcome.completionKind === "awaiting_approval" ? "approval" :
        outcome.terminalState === "failed" ? "failure" : "blocked",
      summary: outcome.primaryCause.summary,
    };
  }
  return undefined;
}

function getAgentRemediationLabel(outcome?: AgentOutcome) {
  if (!outcome || outcome.status === "completed" || outcome.status === "needs_approval") {
    return undefined;
  }
  return outcome.status === "blocked"
    ? outcome.blocker.remediation?.label
    : outcome.remediation?.label;
}

function getInspectionEvidence(
  outcome: ExecutionOutcome,
  freshness: PresentationEvidenceFreshness,
): PresentationInspectionEvidence | undefined {
  const verification = outcome.evidence.objective?.verification;
  if (!verification) return undefined;
  const requiredAssertion = verification.assertions.find(
    (assertion) =>
      assertion.kind === "required_pattern_present" &&
      assertion.status === "passed",
  );
  const count = new Set(requiredAssertion?.matches.map((match) => match.path) ?? []).size;
  if (count === 0) return undefined;
  const label = requiredAssertion?.scope.includes("semantic:runtime_service")
    ? count === 1 ? "service" : "services"
    : count === 1 ? "file" : "files";
  return {
    count,
    label,
    status: verification.status,
    coverage: verification.coverage,
    freshness,
  };
}

export function getPresentationValidationStatus(
  outcome?: ExecutionOutcome,
): ExecutionValidationStatus | undefined {
  const normalized = outcome ? normalizeExecutionOutcome(outcome) : undefined;
  return normalized?.evidence.validation.status ?? normalized?.validationState;
}

export function getPresentationCompletionKind(
  outcome?: ExecutionOutcome,
): CompletionKind | undefined {
  return outcome ? normalizeExecutionOutcome(outcome).completionKind : undefined;
}
