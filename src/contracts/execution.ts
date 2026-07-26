export type ExecutionTerminalState =
  | "succeeded"
  | "partial"
  | "blocked"
  | "failed"
  | "awaiting_approval";

export type ToolExecutionOutcome =
  | "completed"
  | "failed"
  | "blocked"
  | "awaiting_approval";

export type ExecutionValidationStatus =
  | "passed"
  | "failed"
  | "not_run"
  | "not_required";

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
  };
  synthesis: {
    status: ExecutionSynthesisStatus;
    summary?: string;
  };
  requiredUserAction?: string;
}

export interface ExecutionOutcome {
  terminalState: ExecutionTerminalState;
  evidence: ExecutionEvidence;
  summary: string;
}
