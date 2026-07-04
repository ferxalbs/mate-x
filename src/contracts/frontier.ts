export type PerformanceMetricKind =
  | "startup"
  | "run"
  | "ipc"
  | "database"
  | "rainy"
  | "tool"
  | "memory"
  | "benchmark";

export interface PerformanceMetric {
  id: string;
  kind: PerformanceMetricKind;
  name: string;
  value: number;
  unit: "ms" | "bytes" | "count" | "percent";
  budget?: number;
  status: "pass" | "warn" | "fail";
  recordedAt: string;
}

export type PowerMode = "efficient" | "balanced" | "max";
export type AgentFirewallMode = "strict" | "balanced" | "audit-only";

export interface PowerRunPolicy {
  mode: PowerMode;
  keepAwake: boolean;
  blockerType: "prevent-app-suspension" | "prevent-display-sleep" | "none";
  reason: string;
}

export interface AgentFirewallDecision {
  id: string;
  command: string;
  decision: "allow" | "require-approval" | "block";
  mode: AgentFirewallMode;
  risk: "low" | "medium" | "high" | "critical";
  reasons: string[];
  recordedAt: string;
}

export interface ThreatGraphNode {
  id: string;
  kind: "entrypoint" | "ipc" | "env" | "dependency" | "workspace";
  label: string;
  sourceRole: "active" | "test" | "docs" | "example" | "generated" | "unknown";
  confidence: number;
}

export interface ThreatGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "imports" | "reads" | "invokes" | "depends-on" | "exposes";
  confidence: number;
}

export interface EvidencePackV2Metadata {
  version: "2";
  externalParameters: Record<string, string>;
  resolvedDependencies: Array<{ uri: string; digest?: string }>;
  agentFirewallDecisions: AgentFirewallDecision[];
  benchmarkSnapshot?: BenchmarkSnapshot;
  privacyRedactionSummary?: {
    redactionCount: number;
    p0Count: number;
    blockedCloudSend: boolean;
  };
}

export interface BenchmarkSnapshot {
  generatedAt: string;
  metrics: PerformanceMetric[];
  powerPolicy: PowerRunPolicy;
}

export interface ThreatGraphSnapshot {
  generatedAt: string;
  nodes: ThreatGraphNode[];
  edges: ThreatGraphEdge[];
}
