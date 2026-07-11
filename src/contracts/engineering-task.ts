/**
 * Canonical EngineeringTask domain contracts for MaTE X v0.1.2.
 *
 * Authority: docs/native-engineering-system/10-final-blueprint-v0.1.2.md
 * FR-UNIT status mapping (research → implementation) documented once:
 *   draft_intent → captured
 *   clarifying → clarifying
 *   intent_ready → specified
 *   planning → planning
 *   planned → planned
 *   tasked / analyzing / ready_to_execute → planned | awaiting_approval (gates)
 *   executing → executing
 *   validating → verifying
 *   converging → converging
 *   converged → ready
 *   blocked / cancelled → same
 *   archived → deferred post-v0.1.2
 *
 * EngineeringUnit is a research synonym only — not implemented.
 */

// ── Primitives ──────────────────────────────────────────────────────────────

export type Ulid = string;
export type IsoDateTime = string;
export type Sha256Hex = string;

export type ActorRef =
  | { kind: "human"; userId?: string }
  | { kind: "system"; component: string }
  | { kind: "agent"; agentId: string; adapterId: string };

// ── Readiness (exactly five labels) ─────────────────────────────────────────

export const READINESS_LABELS = [
  "Ready",
  "Needs check",
  "Risk found",
  "Blocked",
  "Not proven",
] as const;

export type ReadinessLabel = (typeof READINESS_LABELS)[number];

// ── pathKind (internal routing only — not a user mode picker) ───────────────

export const PATH_KINDS = ["full", "verify_only", "chat_help"] as const;
export type PathKind = (typeof PATH_KINDS)[number];

/** Stored on EngineeringTask; chat_help does not create an aggregate. */
export type EngineeringTaskPathKind = "full" | "verify_only";

// ── Status enum (collapsed / authoritative) ─────────────────────────────────

export const ENGINEERING_TASK_STATUSES = [
  "captured",
  "clarifying",
  "specified",
  "planning",
  "planned",
  "awaiting_approval",
  "executing",
  "verifying",
  "converging",
  "ready",
  "blocked",
  "failed",
  "cancelled",
] as const;

export type EngineeringTaskStatus = (typeof ENGINEERING_TASK_STATUSES)[number];

const TERMINAL_STATUSES = new Set<EngineeringTaskStatus>([
  "ready",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(status: EngineeringTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ── ID namespaces ───────────────────────────────────────────────────────────

export const ID_PREFIX = {
  engineeringTask: "etask_",
  specification: "spec_",
  decision: "dec_",
  approach: "apr_",
  execution: "exe_",
  validation: "val_",
  evidence: "ev_",
  proof: "proof_",
  lease: "lease_",
  policyPack: "pol_",
} as const;

export type IdNamespace = keyof typeof ID_PREFIX;

const DISPLAY_ID_RE = /^(REQ|AC|TSK|SC)-(\d+)$/;

export function isIdWithPrefix(id: string, prefix: string): boolean {
  return typeof id === "string" && id.startsWith(prefix) && id.length > prefix.length;
}

export function isEngineeringTaskId(id: string): boolean {
  return isIdWithPrefix(id, ID_PREFIX.engineeringTask);
}

export function validateIdFormat(
  id: string,
  namespace: IdNamespace,
): { ok: true } | { ok: false; reason: string } {
  const prefix = ID_PREFIX[namespace];
  if (!isIdWithPrefix(id, prefix)) {
    return { ok: false, reason: `expected prefix ${prefix}` };
  }
  return { ok: true };
}

export function parseDisplayId(
  id: string,
): { kind: "REQ" | "AC" | "TSK" | "SC"; n: number } | null {
  const m = DISPLAY_ID_RE.exec(id);
  if (!m) return null;
  return { kind: m[1] as "REQ" | "AC" | "TSK" | "SC", n: Number(m[2]) };
}

export function formatDisplayId(
  kind: "REQ" | "AC" | "TSK" | "SC",
  n: number,
): string {
  return `${kind}-${String(n).padStart(3, "0")}`;
}

// ── Error codes ─────────────────────────────────────────────────────────────

export const ERR_CODES = {
  ERR_ILLEGAL_TRANSITION: "ERR_ILLEGAL_TRANSITION",
  ERR_VERSION_CONFLICT: "ERR_VERSION_CONFLICT",
  ERR_TASK_NOT_FOUND: "ERR_TASK_NOT_FOUND",
  ERR_INVARIANT_VIOLATION: "ERR_INVARIANT_VIOLATION",
  ERR_NOT_READY: "ERR_NOT_READY",
  ERR_SPEC_QUALITY_FAILED: "ERR_SPEC_QUALITY_FAILED",
  ERR_OPEN_CRITICAL_QUESTIONS: "ERR_OPEN_CRITICAL_QUESTIONS",
  ERR_DECISION_NOT_FOUND: "ERR_DECISION_NOT_FOUND",
  ERR_DECISION_UNLINKED_REQ: "ERR_DECISION_UNLINKED_REQ",
  ERR_TASK_GRAPH_INVALID: "ERR_TASK_GRAPH_INVALID",
  ERR_CONSISTENCY_CRITICAL: "ERR_CONSISTENCY_CRITICAL",
  ERR_LEASE_CONFLICT: "ERR_LEASE_CONFLICT",
  ERR_LEASE_EXPIRED: "ERR_LEASE_EXPIRED",
  ERR_SNAPSHOT_STALE: "ERR_SNAPSHOT_STALE",
  ERR_AGENT_CAPABILITY: "ERR_AGENT_CAPABILITY",
  ERR_AGENT_TIMEOUT: "ERR_AGENT_TIMEOUT",
  ERR_TASK_EVIDENCE_REQUIRED: "ERR_TASK_EVIDENCE_REQUIRED",
  ERR_VALIDATION_SHELL_FORBIDDEN: "ERR_VALIDATION_SHELL_FORBIDDEN",
  ERR_VALIDATION_FAILED: "ERR_VALIDATION_FAILED",
  ERR_VALIDATION_TIMEOUT: "ERR_VALIDATION_TIMEOUT",
  ERR_VALIDATION_REQUIRED_MISSING: "ERR_VALIDATION_REQUIRED_MISSING",
  ERR_POLICY_MUST_VIOLATION: "ERR_POLICY_MUST_VIOLATION",
  ERR_PRIVACY_BLOCKED: "ERR_PRIVACY_BLOCKED",
  ERR_TRUST_DENIED: "ERR_TRUST_DENIED",
  ERR_POLICY_STOP_OPEN: "ERR_POLICY_STOP_OPEN",
  ERR_PROOF_INVALID: "ERR_PROOF_INVALID",
  ERR_PROOF_STALE_HEAD: "ERR_PROOF_STALE_HEAD",
  ERR_PROOF_STALE_DIFF: "ERR_PROOF_STALE_DIFF",
  ERR_PROOF_STALE_POLICY: "ERR_PROOF_STALE_POLICY",
  ERR_PROOF_REQUIRED: "ERR_PROOF_REQUIRED",
  ERR_STORAGE_CORRUPT: "ERR_STORAGE_CORRUPT",
  ERR_CANCELLED: "ERR_CANCELLED",
  ERR_INTERNAL: "ERR_INTERNAL",
  ERR_OBJECTIVE_EMPTY: "ERR_OBJECTIVE_EMPTY",
  ERR_WORKSPACE_REQUIRED: "ERR_WORKSPACE_REQUIRED",
  ERR_APPROVAL_REQUIRED: "ERR_APPROVAL_REQUIRED",
  ERR_AGENT_CANNOT_APPROVE: "ERR_AGENT_CANNOT_APPROVE",
} as const;

export type ErrorCode = (typeof ERR_CODES)[keyof typeof ERR_CODES];

// ── Command types ───────────────────────────────────────────────────────────

export const ENGINEERING_COMMAND_TYPES = [
  "CaptureTask",
  "StartClarification",
  "AnswerDecision",
  "FreezeSpecification",
  "StartPlanCompilation",
  "CompletePlanCompilation",
  "CompileTaskGraph",
  "RunConsistencyAnalysis",
  "SubmitForApproval",
  "ApprovePlanAndTasks",
  "RejectApproval",
  "AcquireLease",
  "ReleaseLease",
  "CompleteTask",
  "BeginVerification",
  "ExecuteValidation",
  "BeginCoverageConvergence",
  "EnqueueRemediation",
  "AcceptConvergence",
  "IssueShipProof",
  "BlockTask",
  "FailTask",
  "CancelTask",
  "ResumeTask",
] as const;

export type EngineeringCommandType = (typeof ENGINEERING_COMMAND_TYPES)[number];

// ── Transition table ────────────────────────────────────────────────────────

/**
 * Core status transitions. Side-effect-only commands (AnswerDecision,
 * CompileTaskGraph, AcquireLease, etc.) either keep status or use dedicated
 * edges below. Guards (checklist, evidence, version) are enforced by the
 * command bus — this table only encodes legal status edges.
 */
type TransitionKey = string;

function key(
  from: EngineeringTaskStatus | null,
  command: EngineeringCommandType,
): TransitionKey {
  return `${from ?? "∅"}→${command}`;
}

/** Static edges: from status (null = create) → command → to status. */
const TRANSITION_MAP = new Map<TransitionKey, EngineeringTaskStatus>([
  [key(null, "CaptureTask"), "captured"],
  [key("captured", "StartClarification"), "clarifying"],
  [key("captured", "FreezeSpecification"), "specified"],
  [key("clarifying", "FreezeSpecification"), "specified"],
  [key("specified", "StartPlanCompilation"), "planning"],
  [key("planning", "CompletePlanCompilation"), "planned"],
  // CompileTaskGraph bumps taskGraphVersion; status stays planned
  [key("planned", "CompileTaskGraph"), "planned"],
  [key("planned", "SubmitForApproval"), "awaiting_approval"],
  [key("awaiting_approval", "ApprovePlanAndTasks"), "executing"],
  // RejectApproval default target is planned; clarifying via payload override
  [key("awaiting_approval", "RejectApproval"), "planned"],
  [key("executing", "BeginVerification"), "verifying"],
  [key("verifying", "BeginCoverageConvergence"), "converging"],
  [key("converging", "AcceptConvergence"), "ready"],
  [key("converging", "EnqueueRemediation"), "executing"],
  // ResumeTask: target is priorLegalStatus from aggregate; table marks edge
  [key("blocked", "ResumeTask"), "blocked"],
]);

/** Commands that do not change status (in-place aggregate mutations). */
const STATUS_PRESERVING_COMMANDS = new Set<EngineeringCommandType>([
  "AnswerDecision",
  "RunConsistencyAnalysis",
  "AcquireLease",
  "ReleaseLease",
  "CompleteTask",
  "ExecuteValidation",
  "IssueShipProof",
]);

const NON_TERMINAL = ENGINEERING_TASK_STATUSES.filter(
  (s) => !TERMINAL_STATUSES.has(s),
);

export type TransitionResult =
  | { ok: true; to: EngineeringTaskStatus }
  | { ok: false; code: typeof ERR_CODES.ERR_ILLEGAL_TRANSITION; message: string };

export function getTransition(
  from: EngineeringTaskStatus | null,
  command: EngineeringCommandType,
  options?: { rejectTarget?: "planned" | "clarifying"; resumeTo?: EngineeringTaskStatus },
): TransitionResult {
  if (command === "BlockTask" || command === "FailTask" || command === "CancelTask") {
    if (from === null || isTerminalStatus(from)) {
      return {
        ok: false,
        code: ERR_CODES.ERR_ILLEGAL_TRANSITION,
        message: `${command} not allowed from ${from ?? "null"}`,
      };
    }
    const to: EngineeringTaskStatus =
      command === "BlockTask"
        ? "blocked"
        : command === "FailTask"
          ? "failed"
          : "cancelled";
    return { ok: true, to };
  }

  if (command === "RejectApproval") {
    if (from !== "awaiting_approval") {
      return {
        ok: false,
        code: ERR_CODES.ERR_ILLEGAL_TRANSITION,
        message: `RejectApproval not allowed from ${from}`,
      };
    }
    // Reject target is only planned | clarifying — never executing (INV reject).
    const to: EngineeringTaskStatus = options?.rejectTarget ?? "planned";
    return { ok: true, to };
  }

  if (command === "ResumeTask") {
    if (from !== "blocked") {
      return {
        ok: false,
        code: ERR_CODES.ERR_ILLEGAL_TRANSITION,
        message: `ResumeTask not allowed from ${from}`,
      };
    }
    const resumeTo = options?.resumeTo;
    if (!resumeTo || isTerminalStatus(resumeTo) || resumeTo === "blocked") {
      // Edge exists; command bus supplies resumeTo. Table default marks legality.
      return { ok: true, to: "blocked" };
    }
    return { ok: true, to: resumeTo };
  }

  if (from !== null && STATUS_PRESERVING_COMMANDS.has(command)) {
    return { ok: true, to: from };
  }

  const mapped = TRANSITION_MAP.get(key(from, command));
  if (!mapped) {
    return {
      ok: false,
      code: ERR_CODES.ERR_ILLEGAL_TRANSITION,
      message: `Illegal transition: ${from ?? "∅"} + ${command}`,
    };
  }
  return { ok: true, to: mapped };
}

export function canTransition(
  from: EngineeringTaskStatus | null,
  command: EngineeringCommandType,
  options?: { rejectTarget?: "planned" | "clarifying"; resumeTo?: EngineeringTaskStatus },
): boolean {
  return getTransition(from, command, options).ok;
}

export function isLegalCommandForStatus(
  status: EngineeringTaskStatus | null,
  command: EngineeringCommandType,
): boolean {
  return canTransition(status, command);
}

export function transitionOrThrow(
  from: EngineeringTaskStatus | null,
  command: EngineeringCommandType,
  options?: { rejectTarget?: "planned" | "clarifying"; resumeTo?: EngineeringTaskStatus },
): EngineeringTaskStatus {
  const result = getTransition(from, command, options);
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.to;
}

export function nonTerminalStatuses(): EngineeringTaskStatus[] {
  return [...NON_TERMINAL];
}

// ── Aggregate + entities ────────────────────────────────────────────────────

export interface PolicyPackRef {
  policyPackId: string;
  version: string;
  policyHash: Sha256Hex;
}

export interface FreshnessAnchors {
  workspaceId: string;
  repositorySnapshotHash: Sha256Hex;
  baseSha: string | null;
  headSha: string;
  diffHash: Sha256Hex;
  policyHash: Sha256Hex;
  specificationVersion: number;
  planVersion: number;
  taskGraphVersion: number;
  generatedAt: IsoDateTime;
}

export interface EngineeringTask {
  engineeringTaskId: string;
  workspaceId: string;
  conversationId: string | null;
  pathKind: EngineeringTaskPathKind;
  title: string;
  objectiveSeed: string;
  status: EngineeringTaskStatus;
  aggregateVersion: number;
  activeSpecificationVersion: number | null;
  activePlanVersion: number | null;
  activeTaskGraphVersion: number | null;
  policyPackRef: PolicyPackRef | null;
  readiness: ReadinessLabel;
  priorLegalStatus: EngineeringTaskStatus | null;
  blockedReasonCode: ErrorCode | null;
  lastExecutionId: string | null;
  lastProofId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  cancelledAt: IsoDateTime | null;
  readyAt: IsoDateTime | null;
}

export interface EngineeringTaskSummary {
  engineeringTaskId: string;
  workspaceId: string;
  pathKind: EngineeringTaskPathKind;
  title: string;
  status: EngineeringTaskStatus;
  readiness: ReadinessLabel;
  aggregateVersion: number;
  objectivePreview: string;
  openDecisionCount: number;
  activeAgentIds: string[];
  updatedAt: IsoDateTime;
  conversationId: string | null;
}

export interface EngineeringTaskDetail extends EngineeringTaskSummary {
  specificationVersion: number | null;
  planVersion: number | null;
  taskGraphVersion: number | null;
  policyPackRef: PolicyPackRef | null;
  blockedReasonCode?: ErrorCode;
  lastExecutionId?: string;
  lastProofId?: string;
  objectiveSeed: string;
}

export type TaskDetailSlice =
  | "specification"
  | "decisions"
  | "plan"
  | "tasks"
  | "executions"
  | "validations"
  | "convergence"
  | "evidence"
  | "proof"
  | "events";

// ── Command / event envelopes ───────────────────────────────────────────────

export interface CommandMeta {
  commandId: string;
  issuedAt: IsoDateTime;
  actor: ActorRef;
  workspaceId: string;
  engineeringTaskId?: string;
  expectedAggregateVersion?: number;
  clientRequestId?: string;
}

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  eventId: string;
  engineeringTaskId: string;
  seq: number;
  type: TType;
  payload: TPayload;
  actor: ActorRef;
  causedByCommandId: string;
  occurredAt: IsoDateTime;
  integrityHash: Sha256Hex;
}

export interface CommandResult<T = unknown> {
  ok: true;
  data: T;
  events: DomainEvent[];
  aggregateVersion: number;
  readiness: ReadinessLabel;
}

export interface CommandError {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
  };
}

export type CommandResponse<T = unknown> = CommandResult<T> | CommandError;

export interface CaptureTaskInput {
  workspaceId: string;
  objectiveSeed: string;
  pathKind?: EngineeringTaskPathKind;
  conversationId?: string;
  title?: string;
}

export interface AnswerDecisionInput {
  engineeringTaskId: string;
  decisionId: string;
  chosenOptionId?: string;
  customValue?: string;
  skipWithAck?: boolean;
}

export interface CompleteTaskInput {
  engineeringTaskId: string;
  taskId: string;
  executionId: string;
  evidenceIds: string[];
  humanReason?: string;
}

export interface AcquireLeaseInput {
  engineeringTaskId: string;
  taskId: string;
  agentId: string;
  ttlMs: number;
}

export interface RejectApprovalInput {
  engineeringTaskId: string;
  reasonCode: string;
  rejectTarget?: "planned" | "clarifying";
  note?: string;
}

// ── Specification ───────────────────────────────────────────────────────────

export interface Requirement {
  reqId: string;
  statement: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: "draft" | "active" | "waived" | "superseded";
}

export interface AcceptanceCriterion {
  acId: string;
  statement: string;
  verificationMethod: "test" | "inspection" | "metric" | "manual" | "unspecified";
  linkedReqIds: string[];
}

export interface QualityChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  required: boolean;
}

export interface SpecificationDocument {
  specificationId: string;
  version: number;
  objective: string;
  problemStatement: string;
  actors: Array<{ id: string; name: string; role: string }>;
  currentBehavior: string;
  desiredBehavior: string;
  userValue: string;
  inScope: string[];
  nonGoals: string[];
  functionalRequirements: Requirement[];
  nonFunctionalRequirements: Array<{
    nfrId: string;
    statement: string;
    category: string;
  }>;
  acceptanceScenarios: AcceptanceCriterion[];
  edgeCases: Array<{ id: string; statement: string }>;
  assumptions: Array<{ id: string; statement: string }>;
  dependencies: Array<{ id: string; statement: string }>;
  constraints: Array<{ id: string; statement: string }>;
  successCriteria: Array<{ scId: string; statement: string; measurable: boolean }>;
  unresolvedQuestions: Array<{ id: string; question: string; critical: boolean }>;
  qualityChecklist: {
    passed: boolean;
    items: QualityChecklistItem[];
  };
  clarificationDecisions: string[];
  approvalIdentity: string | null;
  verifyOnly: boolean;
  contentHash: Sha256Hex;
  createdAt: IsoDateTime;
  frozenAt: IsoDateTime | null;
}

// ── Plan / task graph ───────────────────────────────────────────────────────

export interface ResearchDecision {
  researchId: string;
  statement: string;
  rationale: string;
  rejectedAlternatives: string[];
  linkedReqIds: string[];
  kind: "product_linked" | "platform";
}

export interface TechnicalApproachDocument {
  approachId: string;
  version: number;
  specificationVersion: number;
  researchNotes: Array<{ id: string; text: string }>;
  decisions: ResearchDecision[];
  affectedSurfaces: string[];
  interfaces: Array<{ id: string; kind: string; schemaRef?: string; summary: string }>;
  dataModel: Array<{ id: string; name: string; summary: string }>;
  stateChanges: string[];
  migrations: string[];
  rollout: string;
  rollback: string;
  observability: string;
  validationStrategy: string[];
  contentHash: Sha256Hex;
}

export type GraphTaskStatus =
  | "pending"
  | "ready"
  | "leased"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface TaskNode {
  taskId: string;
  displayId: string;
  title: string;
  description: string;
  phase: "setup" | "foundational" | "slice" | "polish" | "remediation";
  dependsOn: string[];
  fileScopes: { write: string[]; read: string[] };
  linkedReqIds: string[];
  linkedAcIds: string[];
  parallelSafe: boolean;
  validationObligations: string[];
  preconditions: string[];
  completionConditions: string[];
  ownerAgentId?: string;
  status: GraphTaskStatus;
  remediationOf?: string;
  evidenceIds: string[];
  version: number;
}

export interface TaskGraphDocument {
  taskGraphId: string;
  version: number;
  tasks: TaskNode[];
  criticalPathTaskIds: string[];
  mvpSliceTaskIds: string[];
  contentHash: Sha256Hex;
}

// ── Decisions / leases / validation / proof ─────────────────────────────────

export type DecisionTaxonomy =
  | "scope"
  | "requirement"
  | "constraint"
  | "risk"
  | "approval"
  | "exception"
  | "policy";

export interface DecisionQueueItem {
  decisionId: string;
  taxonomy: DecisionTaxonomy;
  question: string;
  impact: 1 | 2 | 3 | 4 | 5;
  uncertainty: 1 | 2 | 3 | 4 | 5;
  options: Array<{ optionId: string; label: string }>;
  required: boolean;
  status: "open" | "answered" | "skipped" | "waived";
  answer?: {
    chosenOptionId?: string;
    customValue?: string;
    answeredAt: IsoDateTime;
    actor: ActorRef;
  };
}

export interface TaskLease {
  leaseId: string;
  engineeringTaskId: string;
  taskId: string;
  agentId: string;
  acquiredAt: IsoDateTime;
  expiresAt: IsoDateTime;
  status: "active" | "released" | "expired" | "revoked";
  workspaceId: string;
}

export interface ValidationCommand {
  validationId: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  shell: false;
  linkedReqIds: string[];
  linkedTaskIds: string[];
  linkedAcIds: string[];
}

export interface ValidationRun {
  validationRunId: string;
  validationPlanId: string;
  validationId: string;
  engineeringTaskId: string;
  relatedTaskIds: string[];
  relatedReqIds: string[];
  executable: string;
  args: string[];
  cwd: string;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  outputSummary: string;
  headSha: string;
  diffHash: Sha256Hex;
  policyHash: Sha256Hex;
  passed: boolean | null;
}

export type CoverageGapKind =
  | "missing_validation"
  | "missing_task_link"
  | "unproven_req"
  | "task_without_req"
  | "task_without_evidence"
  | "failed_validation"
  | "stale_evidence"
  | "policy_block"
  | "unapproved_spec_or_plan"
  | "incomplete_task"
  | "waived";

export interface CoverageGap {
  findingId: string;
  kind: CoverageGapKind;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  message: string;
  linkedIds: string[];
}

export interface CoverageConvergenceReport {
  reportId: string;
  engineeringTaskId: string;
  generatedAt: IsoDateTime;
  gaps: CoverageGap[];
  actionableGapCount: number;
  inputsHash: Sha256Hex;
}

export interface ShipProof {
  proofId: string;
  engineeringTaskId: string;
  proofHandle: string;
  anchors: FreshnessAnchors;
  validationRunIds: string[];
  coverageReportId: string;
  status: "valid" | "revoked" | "stale";
  generatedAt: IsoDateTime;
  traces: Array<{
    reqId: string;
    acIds: string[];
    taskIds: string[];
    validationRunIds: string[];
  }>;
}

export interface PolicyRule {
  ruleId: string;
  severity: "MUST" | "SHOULD" | "MAY";
  statement: string;
  category: string;
}

export interface PolicyPack {
  policyPackId: string;
  version: string;
  policyHash: Sha256Hex;
  rules: PolicyRule[];
  source: "default" | "import" | "amendment";
  createdAt: IsoDateTime;
}

// ── Feature flags (authoritative defaults) ──────────────────────────────────

export interface EngineeringFeatureFlags {
  engineeringControlPlane: boolean;
  legacyFactoryUi: boolean;
  mainProcessGitGate: boolean;
  strictValidationNoTextWaive: boolean;
  multiAgentLeases: boolean;
  llmConsistencyAssist: boolean;
  policyImportFromMarkdown: boolean;
}

export const DEFAULT_ENGINEERING_FEATURE_FLAGS: EngineeringFeatureFlags = {
  engineeringControlPlane: true,
  legacyFactoryUi: false,
  mainProcessGitGate: true,
  strictValidationNoTextWaive: true,
  multiAgentLeases: false,
  llmConsistencyAssist: false,
  policyImportFromMarkdown: true,
};
