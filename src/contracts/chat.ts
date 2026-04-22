export type MessageRole = "user" | "assistant";
export type RunStatus = "idle" | "running" | "completed" | "failed";
export type ToolEventStatus = "done" | "active" | "error";
export type MessageArtifactTone = "default" | "success" | "warning";
export type EvidencePackStatus = "complete" | "partial" | "blocked" | "failed";
export type EvidencePackConfidence = "low" | "medium" | "high";
export type AssistantReasoningLevel = "low" | "high" | "max";
export type AssistantMode = "build" | "plan";
export type AssistantAccess = "full" | "approval";

export interface AssistantRunOptions {
  reasoning: AssistantReasoningLevel;
  mode: AssistantMode;
  access: AssistantAccess;
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

export interface EvidencePack {
  status: EvidencePackStatus;
  verdict: EvidencePackVerdict;
  filesModified?: EvidencePackFileChange[];
  commandsExecuted?: EvidencePackCommand[];
  toolsUsed?: EvidencePackToolUsage[];
  testsRun?: EvidencePackTestRun[];
  warnings?: string[];
  unresolvedRisks?: string[];
  touchedPaths?: string[];
  generatedAt: string;
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
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastUpdatedAt: string;
}

export interface AssistantExecution {
  message: ChatMessage;
  suggestedTitle?: string;
}
