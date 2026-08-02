import type {
  ObjectiveState,
  ValidationContract,
} from "./work-objective";

export type ExecutionTerminalState =
  | "completed"
  | "partial"
  | "blocked"
  | "failed"
  | "cancelled";

export type ToolExecutionOutcome =
  | "completed"
  | "failed"
  | "blocked"
  | "awaiting_approval";

export type ExecutionValidationStatus =
  | "passed"
  | "failed"
  | "pending"
  | "running"
  | "blocked"
  | "not_run"
  | "not_required";

export type CompletionKind =
  | "changed_verified"
  | "changed_unverified"
  | "already_satisfied"
  | "inspection_completed"
  | "validation_completed"
  | "awaiting_approval"
  | "blocked"
  | "failed";

export type WorktreeHealth =
  | "unchanged"
  | "preexisting_changes"
  | "changed_unverified"
  | "changed_verified"
  | "invalid_edit_reverted"
  | "recovery_conflict";

export interface TypedOutcomeCause {
  code: string;
  summary: string;
  source: "provider" | "tool" | "policy" | "validation" | "recovery" | "runtime";
}

export interface FileMutationOutcome {
  path: string;
  operation: ExecutionChangedFile["operation"];
  verification: "verified" | "pending" | "failed" | "reverted" | "conflict";
}

export interface RecoveryOutcome {
  mutationId: string;
  path: string;
  status: "not_required" | "reverted" | "conflict" | "failed";
  summary: string;
}

export interface CanonicalAction {
  id: string;
  type:
    | "retry_validation"
    | "review_workspace_policy"
    | "inspect_diff"
    | "resolve_recovery_conflict"
    | "select_model"
    | "retry";
  label: string;
}

export type ExecutionSynthesisStatus = "valid" | "missing" | "failed";

export interface ExecutionChangedFile {
  path: string;
  operation: "modified" | "created" | "deleted" | "renamed" | "unknown";
  backupCreated: boolean;
  impactAnalysis: "full" | "skipped" | "none" | "unknown";
}

export interface ExecutionStepFailure {
  name: string;
  reason: string;
}

export interface NormalizedToolEvidence {
  toolName: string;
  outcome: ToolExecutionOutcome;
  summary: string;
  reason?: string;
  changedFiles: ExecutionChangedFile[];
  validationStatus?: Exclude<ExecutionValidationStatus, "not_required">;
  validationExecutionId?: string;
  validationRequirementId?: "test" | "typecheck" | "lint" | "build" | "validation";
  /** Set only when user explicitly approved a non-planned validation command. */
  validationAuthorization?: "approved_override";
  validationCause?: "VALIDATION_COMMAND_UNRESOLVED" | "TYPECHECK_UNAVAILABLE" | "TOOLCHAIN_AMBIGUOUS";
  requirement?: "required" | "optional" | "fallback";
  requiredUserAction?: string;
}

export interface ExecutionEvidence {
  completedSteps: string[];
  failedSteps: ExecutionStepFailure[];
  blockedSteps: ExecutionStepFailure[];
  changedFiles: ExecutionChangedFile[];
  validation: {
    status: ExecutionValidationStatus;
    summary?: string;
    cause?: "VALIDATION_COMMAND_UNRESOLVED" | "TYPECHECK_UNAVAILABLE" | "TOOLCHAIN_AMBIGUOUS";
    executionIds?: string[];
    /** Internal provenance for a validation command explicitly approved once. */
    validationAuthorization?: "approved_override";
    contract?: ValidationContract;
  };
  objective?: {
    state: ObjectiveState;
    mutationOccurred: boolean;
    evidenceIds: string[];
    summary?: string;
  };
  synthesis: {
    status: ExecutionSynthesisStatus;
    summary?: string;
  };
  requiredUserAction?: string;
}

export interface ExecutionOutcome {
  terminalState: ExecutionTerminalState;
  completionKind?: CompletionKind;
  primaryCause?: TypedOutcomeCause | null;
  worktreeHealth?: WorktreeHealth;
  validationState?: ExecutionValidationStatus;
  files?: FileMutationOutcome[];
  recovery?: RecoveryOutcome[];
  nextActions?: CanonicalAction[];
  evidence: ExecutionEvidence;
  summary: string;
}

export function normalizeExecutionOutcome(
  outcome: ExecutionOutcome,
): ExecutionOutcome {
  const historicalState = outcome.terminalState as string;
  const compatibilityKind = outcome.completionKind ?? (
    historicalState === "awaiting_approval"
      ? "awaiting_approval"
      : historicalState === "partial"
        ? outcome.evidence.changedFiles.length > 0 ? "changed_unverified" : "blocked"
        : historicalState === "failed" || historicalState === "cancelled"
          ? "failed"
          : outcome.evidence.changedFiles.length > 0
            ? outcome.evidence.validation.status === "passed" ? "changed_verified" : "changed_unverified"
            : outcome.evidence.validation.status === "passed" ? "validation_completed" : "inspection_completed"
  );
  if (historicalState === "succeeded") {
    return { ...outcome, terminalState: "completed", completionKind: compatibilityKind };
  }
  if (historicalState === "awaiting_approval") {
    return {
      ...outcome,
      terminalState: "blocked",
      completionKind: "awaiting_approval",
      primaryCause: outcome.primaryCause ?? {
        code: "APPROVAL_REQUIRED",
        summary: outcome.summary,
        source: "policy",
      },
    };
  }
  return { ...outcome, completionKind: compatibilityKind };
}

export interface ToolExecutionRecord {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
  parsedOutput?: Record<string, unknown>;
  evidence?: NormalizedToolEvidence;
  /** Internal provenance for an explicitly approved validation override. */
  validationAuthorization?: "approved_override";
  executionPolicy?: import("./agent-run-trace").ToolExecutionPolicy;
}
