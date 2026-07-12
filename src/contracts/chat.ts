import type { ToolPolicyClassification } from "./tool-policy";
import type { RainyServiceTier } from "./rainy";
import type { WorkingSet, WorkingSetMetadata } from "./working-set";
import type { AutonomyPolicy } from "./behavior-mode";

export type MessageRole = "user" | "assistant";
export type RunStatus = "idle" | "running" | "completed" | "failed";
export type ToolEventStatus =
  | "queued"
  | "active"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  /** Legacy persisted values. */
  | "done"
  | "error";
export type ToolEventType =
  | "reasoning"
  | "search"
  | "read"
  | "command"
  | "edit"
  | "validation"
  | "approval"
  | "wait"
  | "result"
  | "error";
export type ToolEventVisibility = "public" | "technical" | "restricted";
export type MessageArtifactTone = "default" | "success" | "warning";
export type EvidencePackStatus = "complete" | "partial" | "blocked" | "failed";
export type EvidencePackConfidence = "low" | "medium" | "high";
export type AssistantReasoningLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | (string & {});
/**
 * Internal path routing only — not a user-facing mode picker.
 * Replaces deleted AssistantMode product identity (NES-8 / CLOSURE 2).
 */
export type EngineeringPathKind = "full" | "verify_only" | "chat_help";
export type AssistantAccess = "scoped" | "full" | "approval";
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
  /** Internal routing only — never a user mode selector */
  pathKind?: EngineeringPathKind;
  access: AssistantAccess;
  /** Canonical tool-autonomy policy. Never maps Auto to unrestricted access. */
  autonomyPolicy?: AutonomyPolicy;
  serviceTier?: RainyServiceTier;
  runbookId?: AssistantRunbookId;
  attachments?: AssistantAttachment[];
  sdkAction?: import("./sdk-orchestrator.types").AgentActionRequest;
  /** Link to control-plane task when present */
  engineeringTaskId?: string | null;
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
  version?: 2;
  runId?: string;
  sequence?: number;
  timestamp?: string;
  agentId?: string;
  parentAgentId?: string;
  groupId?: string;
  type?: ToolEventType;
  title?: string;
  summary?: string;
  label: string;
  detail: string;
  status: ToolEventStatus;
  durationMs?: number;
  visibility?: ToolEventVisibility;
  artifacts?: {
    paths?: string[];
    command?: string;
    diff?: string;
    output?: string;
    evidenceRef?: string;
  };
  result?: {
    count?: number;
    exitCode?: number;
    evidenceRef?: string;
  };
  policy?: ToolPolicyClassification;
}

export interface AgentRunTraceParticipant {
  id: string;
  label: string;
  model?: string;
  parentAgentId?: string;
}

export interface AgentRunTrace {
  runId: string;
  status: RunStatus | "blocked" | "cancelled";
  startedAt: string;
  completedAt?: string;
  activePhase?: string;
  participants: AgentRunTraceParticipant[];
  events: ToolEvent[];
}

export function normalizeToolEvent(
  event: ToolEvent,
  context: { runId?: string; sequence?: number; timestamp?: string } = {},
): ToolEvent {
  const label = event.title ?? event.label;
  const normalizedLabel = label.replace(/^executing\s+/i, "").trim();
  const inferredType = inferToolEventType(normalizedLabel, event.status);

  return {
    ...event,
    version: 2,
    runId: event.runId ?? context.runId,
    sequence: event.sequence ?? context.sequence,
    timestamp: event.timestamp ?? context.timestamp,
    type: event.type ?? inferredType,
    title: event.title ?? humanizeToolEventTitle(normalizedLabel, inferredType, event.status),
    summary: event.summary ?? event.detail,
    visibility: event.visibility ?? "public",
  };
}

function inferToolEventType(label: string, status: ToolEventStatus): ToolEventType {
  if (status === "error" || status === "failed") return "error";
  if (/approv|policy|permission/i.test(label)) return "approval";
  if (/valid|test|lint|typecheck|build/i.test(label)) return "validation";
  if (/edit|patch|write|file.editor/i.test(label)) return "edit";
  if (/command|sandbox|shell|terminal|run/i.test(label)) return "command";
  if (/search|scan|grep|glob/i.test(label)) return "search";
  if (/read|inspect|metadata|inventory/i.test(label)) return "read";
  if (/reason|think|plan/i.test(label)) return "reasoning";
  if (/complete|result|response/i.test(label)) return "result";
  return "wait";
}

function humanizeToolEventTitle(
  label: string,
  type: ToolEventType,
  status: ToolEventStatus,
) {
  const action = status === "active"
    ? { reasoning: "Analizando", search: "Buscando", read: "Leyendo", command: "Ejecutando", edit: "Editando", validation: "Validando", approval: "Esperando aprobación", wait: "Esperando", result: "Preparando resultado", error: "Error" }[type]
    : { reasoning: "Análisis listo", search: "Búsqueda completa", read: "Lectura completa", command: "Comando terminado", edit: "Cambios aplicados", validation: "Validación terminada", approval: "Aprobación resuelta", wait: "Espera terminada", result: "Resultado listo", error: "Error" }[type];
  return label ? `${action}: ${label.replaceAll("_", " ")}` : action;
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

export interface RatchetSuggestion {
  id: string;
  target: "AGENTS.md" | "RULES.md" | ".mate-x/rules.json";
  reason: string;
  rule: string;
  requiresApproval: true;
  actions: ["Add repo rule", "Ignore once", "Never suggest again"];
}

export interface ShipProofSummary {
  verdict: string;
  touchedFilesCount: number;
  riskSurfaces: string[];
  validationCommands: string[];
  passedEvidence: string[];
  failedEvidence: string[];
  missingEvidence: string[];
  privacyStatus: string;
  gitStatus: "allowed" | "blocked";
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
    pathKind?: EngineeringPathKind;
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
  /** @deprecated Never written by product path — migration decoder only may attach historical payload */
  engineeringTaskId?: string | null;
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
