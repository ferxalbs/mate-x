export type MessageRole = "user" | "assistant";
export type RunStatus = "idle" | "running" | "completed" | "failed";
export type ToolEventStatus = "done" | "active" | "error";
export type MessageArtifactTone = "default" | "success" | "warning";
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

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  events?: ToolEvent[];
  artifacts?: MessageArtifact[];
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
