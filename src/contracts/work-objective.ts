import type {
  ValidationRequirementId,
  ValidationUnavailableCause,
} from "./workspace";

export type WorkStrategy = "work" | "inspection" | "planning" | "validation";

export type MutationPermission =
  | "read_only"
  | "ask_before_changes"
  | "workspace_changes";

export type ValidationSignal = ValidationRequirementId | "custom";

export type ValidationObligation = "required" | "recommended" | "fallback";

export type ValidationTrigger =
  | "always"
  | "after_mutation"
  | "validation_is_objective"
  | "primary_failed"
  | "primary_inconclusive"
  | "high_risk_change";

export type ValidationApplicability =
  | "applicable"
  | "not_applicable"
  | "pending_trigger";

export type ValidationAvailability = "resolved" | "unavailable" | "ambiguous";

export type ValidationEvidenceStatus =
  | "not_run"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "inconclusive";

export type ValidationCommandAuthoritySource =
  | "repository_script"
  | "local_toolchain"
  | "deno"
  | "native"
  | "explicit_objective"
  | "legacy_plan"
  | null;

export type ObjectiveState = "satisfied" | "unsatisfied" | "unknown";

export type ObjectiveVerificationStatus =
  | "satisfied"
  | "unsatisfied"
  | "indeterminate";

export type ObjectiveAssertionKind =
  | "forbidden_pattern_absent"
  | "required_pattern_present"
  | "allowed_match_only"
  | "file_state";

export type ObjectivePatternMatcher = "literal" | "symbol" | "call_expression";

export interface RepositoryObjectiveAssertion {
  id: string;
  kind: ObjectiveAssertionKind;
  pattern?: string;
  matcher?: ObjectivePatternMatcher;
  scope: string[];
  exclusions: string[];
  allowedContexts?: Array<"declaration" | "stub">;
  reason: string;
}

export interface ObjectiveAssertionMatch {
  path: string;
  line?: number;
  symbol?: string;
}

export interface ObjectiveAssertionResult {
  id: string;
  kind: ObjectiveAssertionKind;
  scope: string[];
  exclusions: string[];
  status: "passed" | "failed" | "indeterminate";
  matches: ObjectiveAssertionMatch[];
  reason: string;
}

export interface ObjectiveVerificationEvidence {
  id: string;
  objectiveId: string;
  objectiveContractHash: string;
  requiredScopeHash: string;
  runId: string;
  workspaceId: string;
  repositorySnapshotId: string;
  repositoryHead: string;
  status: ObjectiveVerificationStatus;
  coverage: "complete" | "partial";
  assertions: ObjectiveAssertionResult[];
  inspectedFiles: string[];
  evidenceExecutionIds: string[];
  createdAt: string;
}

export interface ObjectiveStateAssertion {
  id: string;
  kind: "must_exist" | "must_not_exist";
  expression: string;
  scope?: string | null;
}

export interface ConditionalAcceptanceCriterion {
  id: string;
  criterion: string;
  trigger: ValidationTrigger;
  signal?: ValidationSignal;
  obligation?: ValidationObligation;
}

export interface ObjectiveDelta {
  mutationOccurred: boolean;
  changedFiles: string[];
  preexistingFiles: string[];
  targetState: ObjectiveState;
  evidenceIds: string[];
}

export interface WorkObjectiveContract {
  schemaVersion: 1;
  primaryObjective: string;
  requestedRepositoryState: string[];
  explicitConstraints: string[];
  acceptanceCriteria: string[];
  conditionalAcceptanceCriteria: ConditionalAcceptanceCriterion[];
  evidenceRequirements: string[];
  stateAssertions: ObjectiveStateAssertion[];
  /** Deterministic repository assertions. Natural-language output is never evidence. */
  repositoryAssertions?: RepositoryObjectiveAssertion[];
  mutationPermission: MutationPermission;
  validationIsPrimaryObjective: boolean;
  objectiveAlreadySatisfied: boolean;
  actualDelta: ObjectiveDelta;
  strategy: WorkStrategy;
  source: "structured" | "deterministic_fallback";
}

export interface ValidationContractEvidence {
  status: ValidationEvidenceStatus;
  executionId?: string;
  approvalProvenance?: "approved_override";
}

export interface ValidationContractItem {
  id: string;
  signal: ValidationSignal;
  obligation: ValidationObligation;
  trigger: ValidationTrigger;
  applicability: ValidationApplicability;
  availability: ValidationAvailability;
  command: string | null;
  commandSource: ValidationCommandAuthoritySource;
  unavailableCause?: ValidationUnavailableCause;
  evidence: ValidationContractEvidence;
  reason: string;
}

export interface ValidationContract {
  schemaVersion: 1;
  items: ValidationContractItem[];
  actualMutation: boolean;
  objectiveAlreadySatisfied: boolean;
  validationIsPrimaryObjective: boolean;
  compiledAt: string;
  source: "canonical_compiler" | "legacy_adapter";
}
