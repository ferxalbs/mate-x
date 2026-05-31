import type { ToolPolicyClassification } from "./tool-policy";
import type { RainyServiceTier } from "./rainy";
import type { WorkingSet, WorkingSetMetadata } from "./working-set";

export type MessageRole = "user" | "assistant";
export type RunStatus = "idle" | "running" | "completed" | "failed";
export type ToolEventStatus = "done" | "active" | "error";
export type MessageArtifactTone = "default" | "success" | "warning";
export type EvidencePackStatus = "complete" | "partial" | "blocked" | "failed";
export type EvidencePackConfidence = "low" | "medium" | "high";
export type AssistantReasoningLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | (string & {});
export type AssistantMode = "build" | "plan" | "critic_loop";
export type AssistantAccess = "full" | "approval";
export type AssistantRunbookId =
  | "patch_test_verify"
  | "audit_reproduce_remediate"
  | "review_classify_summarize"
  | "scan_contain_report";

export interface AssistantRunbookStage {
  id: string;
  name: string;
  required: boolean;
  description: string;
}

export interface AssistantRunbookDefinition {
  id: AssistantRunbookId;
  name: string;
  objective: string;
  mandatoryStages: AssistantRunbookStage[];
  requiredChecks: string[];
  successCriteria: string[];
  stopConditions: string[];
  finalEvidenceFormat: string[];
}

export interface AssistantRunOptions {
  reasoningEnabled: boolean;
  reasoning: AssistantReasoningLevel;
  mode: AssistantMode;
  access: AssistantAccess;
  serviceTier?: RainyServiceTier;
  runbookId?: AssistantRunbookId;
  attachments?: AssistantAttachment[];
}

export type AssistantAttachmentKind = "image" | "video" | "file";

export interface AssistantAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssistantAttachmentKind;
  dataUrl?: string;
  text?: string;
}

export interface AssistantRunProgress {
  runId: string;
  status: Extract<RunStatus, "running" | "failed">;
  content: string;
  thought?: string;
  events: ToolEvent[];
  artifacts: MessageArtifact[];
}

export interface ToolEvent {
  id: string;
  label: string;
  detail: string;
  status: ToolEventStatus;
  policy?: ToolPolicyClassification;
}

export interface MessageArtifact {
  id: string;
  label: string;
  value: string;
  tone?: MessageArtifactTone;
}

export interface EvidencePackVerdict {
  label: string;
  summary: string;
  confidence: EvidencePackConfidence;
}

export interface EvidencePackFileChange {
  path: string;
  changeType?: "modified" | "created" | "deleted" | "renamed";
  diffSummary?: string;
}

export interface EvidencePackCommand {
  command: string;
  exitCode?: number;
  summary?: string;
}

export interface EvidencePackToolUsage {
  name: string;
  count?: number;
}

export interface EvidencePackTestRun {
  name: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  summary?: string;
}

export type EvidencePackReproductionType =
  | "unit_test"
  | "integration_test"
  | "minimal_script"
  | "http_request"
  | "browser_scenario"
  | "validation_run"
  | "static_proof";

export type EvidencePackReproductionStatus =
  | "created"
  | "existing"
  | "described"
  | "blocked"
  | "not_applicable"
  | "unknown";

export interface EvidencePackReproduction {
  type: EvidencePackReproductionType;
  status: EvidencePackReproductionStatus;
  existedBeforePatch?: boolean;
  prePatchOutcome?: "failed" | "passed" | "blocked" | "not_applicable" | "unknown";
  postPatchOutcome?: "failed" | "passed" | "blocked" | "not_applicable" | "unknown";
  location?: string;
  command?: string;
  summary?: string;
}

export interface EvidencePackStageResult {
  id: string;
  name: string;
  status: "completed" | "failed" | "blocked" | "unknown";
  summary?: string;
}

export interface EvidencePackCheckResult {
  name: string;
  status: "passed" | "failed" | "unknown";
  summary?: string;
}

export type VerifiedTaskScoreStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "failed";

export interface VerifiedTaskScoreSignal {
  id:
    | "target_files_identified"
    | "relevant_files_inspected"
    | "patch_applied"
    | "validation_command_selected"
    | "validation_command_executed"
    | "validation_passed"
    | "reproduction_exists"
    | "failure_context_recorded"
    | "unresolved_risks_absent"
    | "claimed_files_exist"
    | "claimed_commands_ran";
  label: string;
  satisfied: boolean;
  weight: number;
  evidence?: string;
}

export interface VerifiedTaskScore {
  score: number;
  status: VerifiedTaskScoreStatus;
  missingEvidence: string[];
  signals: VerifiedTaskScoreSignal[];
  generatedAt: string;
}

export interface EvidencePackAttestation {
  status: "signed" | "blocked" | "failed";
  taskId: string;
  path?: string;
  statementDigest?: string;
  keyId?: string;
  reason?: string;
  generatedAt: string;
}

export interface EvidencePackAgentIdentity {
  id: string;
  createdAt: string;
  boundToUser: boolean;
  policyHash: string;
}

export interface EvidencePackPolicyStop {
  id: string;
  kind: string;
  policyId: string;
  title: string;
  status: string;
  target?: string;
  command?: string;
  metadata?: Record<string, unknown>;
  resolution?: {
    action: string;
    resolvedAt: string;
  };
}

export interface EvidencePack {
  status: EvidencePackStatus;
  governanceMode?: "governed" | "unrestricted";
  verdict: EvidencePackVerdict;
  verifiedTaskScore?: VerifiedTaskScore;
  attestation?: EvidencePackAttestation;
  agentIdentity?: EvidencePackAgentIdentity;
  filesModified?: EvidencePackFileChange[];
  commandsExecuted?: EvidencePackCommand[];
  toolsUsed?: EvidencePackToolUsage[];
  testsRun?: EvidencePackTestRun[];
  reproduction?: EvidencePackReproduction;
  stages?: EvidencePackStageResult[];
  checks?: EvidencePackCheckResult[];
  policyStops?: EvidencePackPolicyStop[];
  stopConditionTriggered?: string;
  warnings?: string[];
  unresolvedRisks?: string[];
  recommendation?: string;
  touchedPaths?: string[];
  generatedAt: string;
}

export interface ReproducibleRunInitialState {
  workspaceId: string;
  workspacePath: string;
  workspaceName: string;
  branch: string;
  threadId: string;
  activeMessageCount: number;
  settings: {
    reasoningEnabled: boolean;
    reasoning: AssistantReasoningLevel;
    mode: AssistantMode;
    access: AssistantAccess;
    runbookId?: AssistantRunbookId;
  };
  trustAutonomy?: string;
}

export interface ReproducibleRunDecision {
  id: string;
  at: string;
  summary: string;
  reason: string;
}

export interface ReproducibleRunResult {
  status: "completed" | "failed";
  summary: string;
  evidencePack?: EvidencePack;
  workingSet?: WorkingSetMetadata;
}

export interface ReproducibleRunIntegrity {
  algorithm: "sha256";
  canonicalVersion: 1;
  eventHashes: string[];
  rootHash: string;
  generatedAt: string;
}

export interface ReproducibleRun {
  id: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  title: string;
  userIntent: string;
  status: Extract<RunStatus, "running" | "completed" | "failed">;
  startedAt: string;
  completedAt?: string;
  initialState: ReproducibleRunInitialState;
  decisions: ReproducibleRunDecision[];
  events: ToolEvent[];
  artifacts: MessageArtifact[];
  result?: ReproducibleRunResult;
  integrity?: ReproducibleRunIntegrity;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thought?: string;
  createdAt: string;
  events?: ToolEvent[];
  artifacts?: MessageArtifact[];
  evidencePack?: EvidencePack;
  workingSet?: WorkingSet;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  runs?: ReproducibleRun[];
  lastUpdatedAt: string;
  isArchived?: boolean;
}

export interface AssistantExecution {
  message: ChatMessage;
  suggestedTitle?: string;
}
