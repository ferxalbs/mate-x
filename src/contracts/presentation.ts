import type {
  CompletionKind,
  ExecutionChangedFile,
  ExecutionSynthesisStatus,
  ExecutionTerminalState,
  ExecutionValidationStatus,
} from "./execution";
import type { ToolEvent } from "./chat";
import type { ValidationContract } from "./work-objective";

export type PresentationIntent =
  | "conversation"
  | "repository_overview"
  | "review"
  | "change"
  | "validation"
  | "unknown";

export type PresentationEvidenceFreshness =
  | "current_run"
  | "historical"
  | "unknown";

export type PresentationState =
  | "conversation"
  | "answer"
  | "repository_overview"
  | "review_complete"
  | "change_applied"
  | "already_present"
  | "validation_complete"
  | "partial"
  | "blocked"
  | "approval_required"
  | "failed"
  | "missing_synthesis";

export type PresentationNextActionKind =
  | "approve"
  | "review_changes"
  | "review_checks"
  | "retry"
  | "review_scope"
  | "configure_validation";

export interface PresentationNextAction {
  kind: PresentationNextActionKind;
  label: string;
}

export type PresentationChangedFile = Pick<
  ExecutionChangedFile,
  "path" | "operation"
>;

export interface PresentationValidationEvidence {
  status: ExecutionValidationStatus;
  freshness?: PresentationEvidenceFreshness;
  cause?: string;
  summary?: string;
  contract?: ValidationContract;
}

export interface PresentationInspectionEvidence {
  count?: number;
  label?: string;
  status?: "satisfied" | "unsatisfied" | "indeterminate";
  coverage?: "complete" | "partial";
  freshness?: PresentationEvidenceFreshness;
}

export interface PresentationBlocker {
  kind: "blocked" | "approval" | "failure";
  summary?: string;
  remediation?: string;
}

export interface PresentationActivityMetadata {
  events?: readonly ToolEvent[];
  isRunning?: boolean;
  activeLabel?: string;
}

export interface UserFacingPresentationInput {
  /** The original intent can be supplied when it is available. */
  userIntent?: string;
  presentationIntent?: PresentationIntent;
  naturalSynthesis?: string | null;
  synthesisStatus?: ExecutionSynthesisStatus;
  terminalState?: ExecutionTerminalState;
  completionKind?: CompletionKind;
  changedFiles?: readonly PresentationChangedFile[];
  inspection?: PresentationInspectionEvidence;
  validation?: PresentationValidationEvidence;
  blocker?: PresentationBlocker;
  approvalRequired?: boolean;
  requiredUserAction?: string | null;
  activity?: PresentationActivityMetadata;
  findingsCount?: number;
  evidenceFreshness?: PresentationEvidenceFreshness;
}

export interface UserFacingPresentation {
  primaryResponse: string;
  compactEvidence: string | null;
  presentationState: PresentationState;
  nextAction: PresentationNextAction | null;
  showFullOutcomeCard: boolean;
  activitySummary: string | null;
}
