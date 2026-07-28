/**
 * MIGRATION-ONLY legacy Factory types.
 * Not part of current public contracts.
 * Must not be imported by normal runtime orchestration or UI product surfaces.
 * Does not calculate readiness. Does not write new Factory records.
 * TODO(delete after v0.2.0): remove once all persisted users are migrated.
 */

/** Historical migration-only mode alias */
export type LegacyAssistantModeAlias =
  | "chat"
  | "review"
  | "factory"
  | "ship"
  | "build"
  | "plan"
  | "critic_loop";

/** Historical migration-only stage ID */
export type LegacyFactoryRunStageId =
  | "spec"
  | "repo_context"
  | "risk_surfaces"
  | "validation_plan"
  | "agent_actions"
  | "verification_result"
  | "ratchet_suggestions"
  | "ship_proof";

/** Historical migration-only stage status */
export type LegacyFactoryRunStageStatus =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "missing";

/** Historical migration-only stage definition */
export interface LegacyFactoryRunStage {
  id: LegacyFactoryRunStageId;
  label: string;
  status: LegacyFactoryRunStageStatus;
  summary: string;
}

/** Historical migration-only run record */
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
