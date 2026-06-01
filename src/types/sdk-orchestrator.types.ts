export type AgentId = "codex" | "cursor" | "antigravity";

export interface AgentAction {
  agentId: AgentId;
  actionType: string;
  payload: unknown;
  allowHighImpact?: boolean;
}

export interface AgentActionRequest {
  actionType: string;
  payload: unknown;
  agentId?: AgentId;
  allowHighImpact?: boolean;
}

export interface AgentSdkResult {
  output: unknown;
  tool_execution_events?: ToolExecutionEvent[];
}

export interface ToolExecutionEvent {
  toolName: string;
  status?: "success" | "failed" | "error";
  output?: string;
  durationMs?: number;
}

export interface AgentSdkClient {
  execute(action: AgentAction): Promise<AgentSdkResult>;
}

export interface SDKOrchestratorConfig {
  defaultAgent?: AgentId;
  criticLoop?: {
    minVTS?: number;
    maxRetries?: number;
  };
  routing?: {
    autoRoute?: boolean;
    routingWindowSize?: number;
  };
  timeoutMs?: number;
}

export type AgentActionEvidenceEventType =
  | "AGENT_ACTION_PENDING"
  | "AGENT_ACTION_COMPLETED"
  | "AGENT_ACTION_FAILED"
  | "AGENT_ACTION_BLOCKED"
  | "CRITIC_LOOP_EXHAUSTED";

export interface AgentActionEvidenceEvent {
  type: AgentActionEvidenceEventType;
  agentId: AgentId;
  actionType: string;
  timestamp: string;
  payloadHash?: string;
  outputHash?: string;
  durationMs?: number;
  vts?: number;
  retryCount?: number;
  errorCode?: string;
  errorMessage?: string;
  detectedCategories?: string[];
}

export interface SDKOrchestratorEvidenceRecorder {
  appendAgentActionEvent(event: AgentActionEvidenceEvent): Promise<void>;
}

export interface SDKOrchestratorFailureMemory {
  recordFailure(input: {
    workspaceId: string;
    command: string;
    output?: string;
    errorSignature: string;
    stackTraceExcerpt?: string;
  }): Promise<unknown>;
}

export interface SDKOrchestratorPrivacySentinel {
  scan(payload: string): Promise<{
    hasSecrets: boolean;
    categories: string[];
  }>;
}

export interface SDKOrchestratorDependencies {
  workspaceId: string;
  codexClient: AgentSdkClient;
  cursorClient: AgentSdkClient;
  antigravityClient: AgentSdkClient;
  privacySentinel: SDKOrchestratorPrivacySentinel;
  evidenceRecorder: SDKOrchestratorEvidenceRecorder;
  failureMemory: SDKOrchestratorFailureMemory;
  confirmHighImpact(action: AgentAction): Promise<boolean>;
  config?: SDKOrchestratorConfig;
  now?: () => Date;
}

export interface AgentCapabilityStats {
  successRate: number;
  avgDurationMs: number;
  avgVTS: number;
  sampleSize: number;
}

export type RoutingRecommendations = Record<string, AgentId>;

export interface SDKOrchestratorResult {
  agentId: AgentId;
  actionType: string;
  output: unknown;
  outputHash: string;
  vts: number;
  durationMs: number;
  retryCount: number;
}
