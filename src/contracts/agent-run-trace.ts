import type { BehaviorMode } from "./behavior-mode";

export type RunPhase =
  | "preflight"
  | "inspection"
  | "planning"
  | "execution"
  | "verification"
  | "recovery"
  | "finalization";

export type AgentExecutionSessionState =
  | "created"
  | "running"
  | "awaiting_approval"
  | "verifying"
  | "recovering"
  | "terminal";

export type RunEventVisibility = "public" | "local_diagnostic";

export type RunEventKind =
  | "run.created"
  | "run.started"
  | "run.awaiting_approval"
  | "run.verifying"
  | "run.recovering"
  | "run.completed"
  | "run.partial"
  | "run.blocked"
  | "run.failed"
  | "run.cancelled"
  | "phase.started"
  | "phase.completed"
  | "provider.started"
  | "provider.completed"
  | "provider.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.blocked"
  | "tool.cancelled"
  | "capability.decided"
  | "mutation.prepared"
  | "mutation.committed"
  | "mutation.reverted"
  | "recovery.conflict"
  | "validation.started"
  | "validation.completed"
  | "validation.failed"
  | "validation.blocked"
  | "approval.requested"
  | "approval.resolved";

export type PublicRunPayload = {
  title: string;
  summary?: string;
  status?: "active" | "completed" | "failed" | "blocked" | "cancelled";
  count?: number;
  validationState?: string;
  worktreeHealth?: string;
};

export type LocalDiagnosticPayload = {
  toolClass?: string;
  relativePath?: string;
  capabilityDecisionId?: string;
  code?: string;
  attempt?: number;
  durationMs?: number;
  beforeHash?: string;
  afterHash?: string;
  verifier?: string;
};

export interface AgentRunEventV3 {
  schemaVersion: 3;
  eventId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  engineeringTaskId: string | null;
  executionId: string | null;
  runId: string;
  seq: number;
  occurredAt: string;
  kind: RunEventKind;
  phase: RunPhase;
  mode: BehaviorMode;
  visibility: RunEventVisibility;
  payload: PublicRunPayload | LocalDiagnosticPayload;
  previousIntegrityHash: string | null;
  integrityHash: string;
}

export interface RunEventDelta {
  runId: string;
  fromSeq: number;
  toSeq: number;
  events: AgentRunEventV3[];
}

export type ToolRequirement = "required" | "optional" | "fallback";

export type FailureDisposition =
  | "continue"
  | "stop_phase"
  | "stop_run"
  | "await_approval";

export interface ToolExecutionPolicy {
  requirement: ToolRequirement;
  failureDisposition: FailureDisposition;
}

