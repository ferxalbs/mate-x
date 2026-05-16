import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { finalizeWorkRun } from "./finalizer";
import type { WorkStage } from "./stages";
import type { WorkPlan } from "./types";

describe("Work Engine adversarial claim downgrade", () => {
  for (const phrase of [
    "should be fixed",
    "looks good",
    "safe to merge",
    "validated by inspection",
    "tests appear fine",
    "no obvious issue",
    "resolved",
    "complete",
    "production-ready",
    "risk is gone",
    "verified manually",
    "patch is correct",
  ]) {
    test(`downgrades unsupported claim: ${phrase}`, () => {
      const result = finalizeWorkRun({
        workPlan: makeWorkPlan("patch_test_verify"),
        stages: makeStages({ validation_executed: "pending", evidence_attached: "pending" }),
        toolExecutions: [],
        content: phrase,
        evidenceAttached: false,
      });

      assert.notEqual(result.verdict, "success");
      assert.match(result.content, /Work Engine verdict: (needs_validation|needs_evidence|partial|blocked|failed)/);
      assert.doesNotMatch(result.content, new RegExp(`^${escapeRe(phrase)}$`, "i"));
    });
  }
});

describe("Work Engine adversarial security wording", () => {
  for (const phrase of [
    "security issue confirmed",
    "confirmed issue",
    "real vuln",
    "exploitable",
    "RCE",
    "SSRF",
    "auth bypass",
    "secret leak",
    "critical",
    "high severity",
    "source-to-sink confirmed",
    "exploit is possible",
  ]) {
    test(`downgrades security overclaim: ${phrase}`, () => {
      const result = finalizeWorkRun({
        workPlan: makeWorkPlan("audit_reproduce_remediate"),
        stages: makeStages({ security_proof_checked: "pending", evidence_attached: "passed" }),
        toolExecutions: [],
        content: phrase,
        evidenceAttached: true,
      });

      assert.notEqual(result.verdict, "success");
      assert.match(result.content, /candidate|unproven|unsupported|needs proof|Work Engine verdict/);
    });
  }
});

describe("Work Engine adversarial validation bypass", () => {
  test("planned but not executed cannot succeed", () => {
    const result = patchRun({ validation_planned: "passed", validation_executed: "pending" }, "validated by inspection");
    assert.equal(result.verdict, "needs_validation");
  });

  test("failed validation cannot succeed", () => {
    const result = patchRun({ validation_planned: "passed", validation_executed: "failed" }, "tests appear fine");
    assert.equal(result.verdict, "failed");
  });

  test("timed out validation cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("patch_test_verify"),
      stages: makeStages({ validation_planned: "passed", validation_executed: "failed", evidence_attached: "passed" }),
      toolExecutions: [{ toolName: "run_tests", args: {}, output: "Tool run_tests timed out after 120s." }],
      content: "safe to merge",
      evidenceAttached: true,
    });
    assert.equal(result.verdict, "failed");
  });

  test("inconclusive validation cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("patch_test_verify"),
      stages: makeStages({ validation_planned: "passed", validation_executed: "failed", evidence_attached: "passed" }),
      toolExecutions: [{ toolName: "run_tests", args: {}, output: "No validation profile found." }],
      content: "validated by inspection",
      evidenceAttached: true,
    });
    assert.equal(result.verdict, "failed");
  });

  test("fallback required but not run cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: { ...makeWorkPlan("patch_test_verify"), risk: "high", validationPlan: { required: true, primaryCommand: "bun test", fallbackCommand: "bun run typecheck", reason: "high risk" } },
      stages: makeStages({ validation_planned: "passed", validation_executed: "passed", evidence_attached: "passed" }),
      toolExecutions: [
        { toolName: "run_tests", args: { command: "bun test" }, output: "passed" },
        { toolName: "verify_validation_persistence", args: {}, output: "persisted" },
      ],
      content: "patch is correct",
      evidenceAttached: true,
    });
    assert.notEqual(result.verdict, "success");
  });
});

describe("Work Engine adversarial evidence bypass", () => {
  test("evidence prose without artifact cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("evidence_only"),
      stages: makeStages({ evidence_attached: "pending" }),
      toolExecutions: [],
      content: "Evidence attached: commands run, tests passed.",
      evidenceAttached: false,
    });
    assert.equal(result.verdict, "needs_evidence");
  });

  test("Evidence Pack without commands is partial for patch", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("patch_test_verify"),
      stages: makeStages({ validation_planned: "passed", validation_executed: "pending", evidence_attached: "passed" }),
      toolExecutions: [],
      content: "Evidence attached and complete.",
      evidenceAttached: true,
    });
    assert.notEqual(result.verdict, "success");
  });
});

describe("Work Engine tool expectation enforcement", () => {
  test("patch without file read cannot succeed", () => {
    assert.notEqual(patchRun({ files_inspected: "pending", validation_executed: "passed", evidence_attached: "passed" }, "complete").verdict, "success");
  });

  test("patch without patch or no-patch-needed cannot succeed", () => {
    assert.notEqual(patchRun({ patch_attempted: "pending", validation_executed: "passed", evidence_attached: "passed" }, "complete").verdict, "success");
  });

  test("audit without candidate validation cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("audit_reproduce_remediate"),
      stages: makeStages({ security_proof_checked: "pending", evidence_attached: "passed" }),
      toolExecutions: [],
      content: "confirmed issue",
      evidenceAttached: true,
    });
    assert.notEqual(result.verdict, "success");
  });

  test("trace without security_path_trace cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("trace_source_to_sink"),
      stages: makeStages({ security_proof_checked: "pending" }),
      toolExecutions: [],
      content: "source-to-sink confirmed",
      evidenceAttached: false,
    });
    assert.notEqual(result.verdict, "success");
  });

  test("validate_only without execution cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("validate_only"),
      stages: makeStages({ validation_planned: "passed", validation_executed: "pending" }),
      toolExecutions: [],
      content: "validated",
      evidenceAttached: false,
    });
    assert.equal(result.verdict, "needs_validation");
  });

  test("evidence_only without evidence_pack cannot succeed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("evidence_only"),
      stages: makeStages({ evidence_attached: "pending" }),
      toolExecutions: [],
      content: "complete",
      evidenceAttached: false,
    });
    assert.equal(result.verdict, "needs_evidence");
  });
});

describe("Work Engine privacy and source integrity", () => {
  test("strict P0 block prevents success", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("answer_from_context"),
      stages: makeStages({ privacy_preflight_passed: "blocked" }),
      toolExecutions: [],
      content: "complete",
      evidenceAttached: false,
    });
    assert.equal(result.verdict, "blocked");
  });

  test("sanitized pass can succeed for answer", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("answer_from_context"),
      stages: makeStages({ privacy_preflight_passed: "passed" }),
      toolExecutions: [],
      content: "Answer from context.",
      evidenceAttached: false,
    });
    assert.equal(result.verdict, "success");
  });

  test("privacy unavailable is partial, not success", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("answer_from_context"),
      stages: makeStages({ privacy_preflight_passed: "pending" }),
      toolExecutions: [],
      content: "Answer from context.",
      evidenceAttached: false,
    });
    assert.equal(result.verdict, "partial");
  });

  test("model_claim source cannot satisfy hard validation requirement", () => {
    const stages = makeStages({ validation_planned: "passed", validation_executed: "passed", evidence_attached: "passed" });
    const validation = stages.find((stage) => stage.id === "validation_executed");
    if (validation) validation.source = "model_claim";
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan("validate_only"),
      stages,
      toolExecutions: [],
      content: "validated",
      evidenceAttached: true,
    });
    assert.notEqual(result.verdict, "success");
  });
});

function patchRun(stageOverrides: Partial<Record<WorkStage["id"], WorkStage["status"]>>, content: string) {
  return finalizeWorkRun({
    workPlan: makeWorkPlan("patch_test_verify"),
    stages: makeStages({ validation_planned: "passed", evidence_attached: "passed", ...stageOverrides }),
    toolExecutions: [],
    content,
    evidenceAttached: stageOverrides.evidence_attached !== "pending",
  });
}

function makeWorkPlan(runbook: WorkPlan["runbook"]): WorkPlan {
  return {
    id: "work-plan-adversarial",
    intent:
      runbook === "audit_reproduce_remediate"
        ? "security_review"
        : runbook === "trace_source_to_sink"
          ? "trace_issue"
          : runbook === "validate_only"
            ? "validate"
            : runbook === "evidence_only"
              ? "generate_evidence"
              : "patch",
    risk: runbook === "answer_from_context" ? "low" : "medium",
    objective: "adversarial",
    runbook,
    workingSet: {
      primaryFiles: ["src/main.ts"],
      relatedFiles: [],
      relatedTests: [],
      changedFiles: ["src/main.ts"],
      impactedFiles: [],
      entrypoints: [],
      sensitiveSurfaces: [],
      relevantScripts: [],
      knownFailures: [],
    },
    validationPlan: {
      required: runbook === "patch_test_verify" || runbook === "validate_only",
      primaryCommand: "bun test",
      fallbackCommand: null,
      reason: "adversarial",
    },
    privacyPlan: {
      requireSanitization: true,
      blockIfP0Unsanitized: true,
      includeRepoContext: true,
      includeToolOutput: true,
      reason: "adversarial",
    },
    evidencePlan: {
      required: ["patch_test_verify", "audit_reproduce_remediate", "validate_only", "evidence_only"].includes(runbook),
      expectedArtifacts: [],
      requiredClaims: [],
    },
    stopConditions: [],
  };
}

function makeStages(overrides: Partial<Record<WorkStage["id"], WorkStage["status"]>>): WorkStage[] {
  const ids: WorkStage["id"][] = [
    "context_compiled",
    "files_inspected",
    "patch_attempted",
    "validation_planned",
    "validation_executed",
    "failure_memory_checked",
    "security_proof_checked",
    "privacy_preflight_passed",
    "evidence_attached",
  ];
  return ids.map((id) => ({
    id,
    status:
      overrides[id] ??
      (id === "context_compiled" ||
      id === "files_inspected" ||
      id === "patch_attempted" ||
      id === "failure_memory_checked" ||
      id === "privacy_preflight_passed"
        ? "passed"
        : "skipped"),
    source: "runtime",
    reason: "adversarial",
    relatedToolEventIds: [],
  }));
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
