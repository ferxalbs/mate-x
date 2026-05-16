import type { ToolExecutionRecord } from "../../evidence-pack";
import type { FinalRunVerdict } from "../finalizer";
import type { WorkStage } from "../stages";
import type { WorkIntent, WorkPlan, WorkRunbook } from "../types";

export type WorkEngineBenchmarkCategory =
  | "patch_validation"
  | "security"
  | "evidence"
  | "privacy"
  | "failure_memory"
  | "intent_runbook";

export interface WorkEngineBenchmarkScenario {
  id: string;
  name: string;
  category: WorkEngineBenchmarkCategory;
  prompt: string;
  workPlan: WorkPlan;
  stages: WorkStage[];
  toolExecutions: ToolExecutionRecord[];
  finalAnswer: string;
  evidenceAttached: boolean;
  intentExpected: WorkIntent;
  runbookExpected: WorkRunbook;
  verdictExpected: FinalRunVerdict;
  expectedDowngrades?: string[];
  expectedMissingStages?: string[];
  expectEvidenceAccepted?: boolean;
  expectValidationAccepted?: boolean;
  expectSecurityProofAccepted?: boolean;
  expectPrivacyAccepted?: boolean;
}

export type WorkEngineBenchmarkResult = {
  id: string;
  name: string;
  intentExpected: WorkIntent;
  runbookExpected: WorkRunbook;
  verdictExpected: FinalRunVerdict;
  passed: boolean;
  failures: string[];
  observed: {
    intent: WorkIntent;
    runbook: WorkRunbook;
    verdict: FinalRunVerdict;
    downgradedClaims: string[];
    requiredStagesMissing: string[];
    evidenceAccepted: boolean;
    validationAccepted: boolean;
    securityProofAccepted: boolean;
    privacyAccepted: boolean;
  };
};

export type WorkEngineBenchmarkSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<
    string,
    { total: number; passed: number; passRate: number }
  >;
};
