/**
 * MIGRATION-ONLY legacy Factory types.
 * Not part of current public contracts.
 * Must not be imported by normal runtime orchestration or UI product surfaces.
 * Does not calculate readiness. Does not write new Factory records.
 * TODO(delete after v0.2.0): remove once all persisted users are migrated.
 */

/** @deprecated migration-only */
export type LegacyAssistantModeAlias =
  | "chat"
  | "review"
  | "factory"
  | "ship"
  | "build"
  | "plan"
  | "critic_loop";

/** @deprecated migration-only */
export type LegacyFactoryRunStageId =
  | "spec"
  | "repo_context"
  | "risk_surfaces"
  | "validation_plan"
  | "agent_actions"
  | "verification_result"
  | "ratchet_suggestions"
  | "ship_proof";

/** @deprecated migration-only */
export type LegacyFactoryRunStageStatus =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "missing";

/** @deprecated migration-only */
export interface LegacyFactoryRunStage {
  id: LegacyFactoryRunStageId;
  label: string;
  status: LegacyFactoryRunStageStatus;
  summary: string;
}

/** @deprecated migration-only */
export interface LegacyFactoryRun {
  id: string;
  mode: Extract<LegacyAssistantModeAlias, "factory" | "ship">;
  prompt: string;
  access: "full" | "approval";
  stages: LegacyFactoryRunStage[];
  ratchetSuggestions: Array<{
    id: string;
    target: string;
    reason: string;
    rule: string;
  }>;
  shipProof?: {
    verdict: string;
    touchedFilesCount: number;
    riskSurfaces: string[];
    validationCommands: string[];
    passedEvidence: string[];
    failedEvidence: string[];
    missingEvidence: string[];
    privacyStatus: string;
    gitStatus: "allowed" | "blocked";
  };
  createdAt: string;
  completedAt?: string;
}

/** Canonical migration input produced by the decoder — not a Factory record. */
export interface CanonicalEngineeringTaskMigrationInput {
  workspaceId: string;
  objectiveSeed: string;
  conversationId: string | null;
  pathKind: "full" | "verify_only" | "chat_help";
  legacyFactoryRunId: string | null;
  migratedAt: string;
  source: "legacy_factory_v0_1_1";
}
