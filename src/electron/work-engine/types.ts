export type WorkIntent =
  | "answer"
  | "inspect"
  | "review_changes"
  | "patch"
  | "validate"
  | "security_review"
  | "trace_issue"
  | "generate_evidence"
  | "unknown";

export type WorkRisk = "low" | "medium" | "high" | "unknown";

export type WorkRunbook =
  | "answer_from_context"
  | "inspect_explain"
  | "review_classify_summarize"
  | "patch_test_verify"
  | "audit_reproduce_remediate"
  | "scan_contain_report"
  | "trace_source_to_sink"
  | "validate_only"
  | "evidence_only";

export type SensitiveSurfaceKind =
  | "env"
  | "ipc"
  | "http"
  | "shell"
  | "filesystem"
  | "network"
  | "database"
  | "dependency"
  | "auth"
  | "unknown";

export type PreventiveRiskArea =
  | "auth"
  | "ipc"
  | "filesystem"
  | "network"
  | "database"
  | "dependency"
  | "secrets"
  | "privacy"
  | "unknown";

export interface WorkPlan {
  id: string;
  intent: WorkIntent;
  risk: WorkRisk;
  objective: string;
  runbook: WorkRunbook;
  workingSet: {
    primaryFiles: string[];
    relatedFiles: string[];
    relatedTests: string[];
    changedFiles: string[];
    impactedFiles: string[];
    entrypoints: string[];
    sensitiveSurfaces: Array<{
      kind: SensitiveSurfaceKind;
      files: string[];
      reason: string;
    }>;
    relevantScripts: Array<{ name: string; command: string; reason: string }>;
    knownFailures: Array<{
      signature: string;
      command: string;
      status: string;
      lastSeenAt: string;
    }>;
  };
  validationPlan: {
    required: boolean;
    primaryCommand: string | null;
    fallbackCommand: string | null;
    reason: string | null;
  };
  privacyPlan: {
    requireSanitization: boolean;
    blockIfP0Unsanitized: boolean;
    includeRepoContext: boolean;
    includeToolOutput: boolean;
    reason: string;
  };
  preventivePlan: {
    enabled: boolean;
    riskAreas: PreventiveRiskArea[];
    recommendedControls: string[];
    requiredChecks: string[];
    strictness: "warn";
    reason: string;
  };
  evidencePlan: {
    required: boolean;
    expectedArtifacts: string[];
    requiredClaims: string[];
  };
  stopConditions: string[];
}

export interface WorkPlanMetadata {
  workPlanId: string;
  intent: WorkIntent;
  runbook: WorkRunbook;
  risk: WorkRisk;
  workingSetSummary: {
    primaryFiles: number;
    relatedFiles: number;
    relatedTests: number;
    changedFiles: number;
    impactedFiles: number;
    sensitiveSurfaces: number;
    knownFailures: number;
  };
  validationRequired: boolean;
  privacyPreflightStatus: "pending" | "passed" | "blocked";
  evidenceRequired: boolean;
  finalOutcome: "pending" | "completed" | "blocked" | "failed";
}
