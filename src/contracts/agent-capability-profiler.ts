export type AgentCapabilityTag =
  | 'good_at_review'
  | 'good_at_patch'
  | 'good_at_tests'
  | 'high_hallucination_risk'
  | 'expensive_but_reliable'
  | 'cheap_fast';

export interface AgentCapabilityMetricTotals {
  taskCount: number;
  verifiedTaskCount: number;
  toolCallCount: number;
  successfulToolCallCount: number;
  invalidToolCallCount: number;
  iterationCount: number;
  patchAttemptCount: number;
  patchSuccessCount: number;
  validationAttemptCount: number;
  validationPassCount: number;
  hallucinatedFilePathCount: number;
  repeatedFailureCount: number;
  tokenCount: number;
  verifiedTokenCount: number;
  elapsedMs: number;
  verifiedElapsedMs: number;
}

export interface AgentCapabilityProfile {
  model: string;
  workspaceId: string | null;
  totals: AgentCapabilityMetricTotals;
  toolCallSuccessRate: number;
  invalidToolCallRate: number;
  averageIterations: number;
  patchSuccessRate: number;
  validationPassRate: number;
  averageTokensPerVerifiedTask: number;
  averageTimePerVerifiedTaskMs: number;
  tags: AgentCapabilityTag[];
  updatedAt: string;
}

export interface AgentCapabilityRunMetrics {
  model: string;
  workspaceId: string;
  taskKind: 'review' | 'patch' | 'tests' | 'general';
  toolCallCount: number;
  successfulToolCallCount: number;
  invalidToolCallCount: number;
  iterationCount: number;
  patchAttemptCount: number;
  patchSuccessCount: number;
  validationAttemptCount: number;
  validationPassCount: number;
  hallucinatedFilePathCount: number;
  repeatedFailureCount: number;
  tokenCount: number;
  elapsedMs: number;
  verified: boolean;
  completedAt: string;
}

export interface AgentRoutingRecommendation {
  model: string | null;
  reason: string;
  tags: AgentCapabilityTag[];
  workspaceProfile?: AgentCapabilityProfile;
  globalProfile?: AgentCapabilityProfile;
  autoSwitchAllowed: boolean;
}
