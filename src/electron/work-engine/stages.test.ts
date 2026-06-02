import { test } from "bun:test";
import assert from "node:assert/strict";

import type { ToolExecutionRecord } from "../evidence-pack";
import { deriveWorkStages, shouldEmitPreventiveWarning } from "./stages";
import type { WorkPlan } from "./types";

function baseWorkPlan(overrides: Partial<WorkPlan> = {}): WorkPlan {
  const plan: WorkPlan = {
    id: "work-plan-test",
    intent: "answer",
    risk: "low",
    objective: "Explain code.",
    runbook: "answer_from_context",
    workingSet: {
      primaryFiles: [],
      relatedFiles: [],
      relatedTests: [],
      changedFiles: [],
      impactedFiles: [],
      entrypoints: [],
      sensitiveSurfaces: [],
      relevantScripts: [],
      knownFailures: [],
    },
    validationPlan: {
      required: false,
      primaryCommand: null,
      fallbackCommand: null,
      reason: null,
    },
    privacyPlan: {
      requireSanitization: false,
      blockIfP0Unsanitized: true,
      includeRepoContext: false,
      includeToolOutput: false,
      reason: "Privacy Sentinel active.",
    },
    preventivePlan: {
      enabled: false,
      riskAreas: [],
      recommendedControls: [],
      requiredChecks: [],
      strictness: "warn",
      reason: "Low-risk workflow with no sensitive surface signal.",
    },
    evidencePlan: {
      required: false,
      expectedArtifacts: [],
      requiredClaims: [],
    },
    stopConditions: [],
  };
  return { ...plan, ...overrides };
}

function stageStatus(plan: WorkPlan, stageId: string) {
  return deriveWorkStages({
    workPlan: plan,
    events: [],
    toolExecutions: [],
    privacyBlocked: false,
    evidenceAttached: false,
    noPatchNeeded: false,
  }).find((stage) => stage.id === stageId)?.status;
}

test("low-risk answer workflow skips Preventive Guard warning stages", () => {
  const plan = baseWorkPlan();

  assert.equal(stageStatus(plan, "preventive_risk_classified"), "skipped");
  assert.equal(stageStatus(plan, "preventive_validation_warned"), "skipped");
  assert.equal(shouldEmitPreventiveWarning(plan, []), false);
});

test("high-risk sensitive workflow classifies preventive risk without blocking privacy stage", () => {
  const plan = baseWorkPlan({
    intent: "security_review",
    risk: "high",
    runbook: "audit_reproduce_remediate",
    workingSet: {
      ...baseWorkPlan().workingSet,
      sensitiveSurfaces: [{ kind: "auth", files: ["src/auth.ts"], reason: "Auth boundary." }],
    },
    validationPlan: {
      required: true,
      primaryCommand: "bun run typecheck",
      fallbackCommand: "bun run lint",
      reason: "High-risk workflow.",
    },
    preventivePlan: {
      enabled: true,
      riskAreas: ["auth"],
      recommendedControls: ["Preserve deny-by-default authorization and explicit role checks."],
      requiredChecks: ["Run planned validation before final confidence claims."],
      strictness: "warn",
      reason: "Preventive Guard enabled.",
    },
  });

  const stages = deriveWorkStages({
    workPlan: plan,
    events: [],
    toolExecutions: [],
    privacyBlocked: true,
    evidenceAttached: false,
    noPatchNeeded: false,
  });

  assert.equal(stages.find((stage) => stage.id === "preventive_risk_classified")?.status, "passed");
  assert.equal(stages.find((stage) => stage.id === "preventive_validation_warned")?.status, "skipped");
  assert.equal(stages.find((stage) => stage.id === "privacy_preflight_passed")?.status, "blocked");
  assert.equal(shouldEmitPreventiveWarning(plan, []), true);
});

test("validation and proof evidence satisfy Preventive Guard warning stage", () => {
  const plan = baseWorkPlan({
    risk: "high",
    runbook: "trace_source_to_sink",
    preventivePlan: {
      enabled: true,
      riskAreas: ["database"],
      recommendedControls: ["Use parameterized queries and migration-safe validation."],
      requiredChecks: ["Prove source-to-sink path before vulnerability wording."],
      strictness: "warn",
      reason: "Preventive Guard enabled.",
    },
  });
  const toolExecutions = [
    { toolName: "run_tests", output: "ok" },
    { toolName: "security_path_trace", output: "trace ok" },
  ] as ToolExecutionRecord[];

  const stages = deriveWorkStages({
    workPlan: plan,
    events: [],
    toolExecutions,
    privacyBlocked: false,
    evidenceAttached: false,
    noPatchNeeded: false,
  });

  assert.equal(stages.find((stage) => stage.id === "preventive_validation_warned")?.status, "passed");
  assert.equal(shouldEmitPreventiveWarning(plan, toolExecutions), false);
});
