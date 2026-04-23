export type PolicyStopSeverity = "info" | "warning" | "critical";

export type PolicyStopAction =
  | "approve_once"
  | "expand_scope"
  | "abort"
  | "safer_alternative";

export type PolicyStopAttemptKind =
  | "file_read"
  | "file_write"
  | "command"
  | "network"
  | "secret"
  | "code_change"
  | "test_failure"
  | "tool_call";

export interface PolicyStopAttemptedAction {
  kind: PolicyStopAttemptKind;
  toolName?: string;
  target?: string;
  command?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyStop {
  id: string;
  runId: string;
  workspacePath: string;
  createdAt: string;
  severity: PolicyStopSeverity;
  policyId: string;
  title: string;
  explanation: string;
  attemptedAction: PolicyStopAttemptedAction;
  recommendation: PolicyStopAction;
  availableActions: PolicyStopAction[];
  status: "open" | "resolved";
  resolution?: PolicyStopResolution;
}

export interface PolicyStopResolution {
  action: PolicyStopAction;
  resolvedAt: string;
  scopeExpansion?: {
    kind: "path" | "command" | "network";
    value: string;
    expires: "once" | "run";
  };
}

export interface ResolvePolicyStopRequest {
  stopId: string;
  action: PolicyStopAction;
  scopeExpansion?: PolicyStopResolution["scopeExpansion"];
}

export interface PolicyRunState {
  runId: string;
  status: "clear" | "paused";
  openStops: PolicyStop[];
}

