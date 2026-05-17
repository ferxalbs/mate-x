import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { renderFailureMemoryInstructionFromSummaries } from "./failure-memory-gate-core";
import { classifyWorkIntent } from "./intent";
import { buildPrivacyPreflightResult } from "./privacy-preflight-core";
import { resolveWorkRunbook } from "./runbook-resolver";
import {
  canConfirmVulnerability,
  normalizeSecurityWording,
} from "./security-proof-gate";
import type { WorkPlan } from "./types";
import { evaluateValidationGate } from "./validation-gate";
import { finalizeWorkRun } from "./finalizer";
import { deriveWorkStages, type WorkStage } from "./stages";
import { buildWorkPlanFromSnapshot, type WorkPlanInputSnapshot } from "./work-engine-core";

describe("Work Engine intent classifier", () => {
  test("classifies patch intent", () => {
    assert.equal(classifyWorkIntent("fix this bug"), "patch");
  });

  test("classifies review changes intent", () => {
    assert.equal(classifyWorkIntent("review current changes"), "review_changes");
  });

  test("classifies security intent", () => {
    assert.equal(classifyWorkIntent("is this vulnerable?"), "security_review");
  });

  test("classifies trace intent", () => {
    assert.equal(classifyWorkIntent("trace this input to shell exec"), "trace_issue");
  });

  test("classifies validation intent", () => {
    assert.equal(classifyWorkIntent("run tests"), "validate");
  });
});

describe("Work Engine validation stage derivation", () => {
  test("treats structured passed sandbox reports as passed despite diagnostic words", () => {
    const stages = deriveWorkStages({
      workPlan: makeWorkPlan({ required: true }),
      events: [],
      toolExecutions: [
        {
          toolName: "sandbox_run",
          output: [
            "Sandbox Report: Execution completed.",
            "Status: PASSED",
            "Exit code: 0",
            "Output:",
            "warning: previous error text in diagnostics",
          ].join("\n"),
        } as any,
      ],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: false,
    });

    assert.equal(
      stages.find((stage) => stage.id === "validation_executed")?.status,
      "passed",
    );
  });
});

describe("Work Engine runbook resolver", () => {
  test("maps patch to patch_test_verify", () => {
    assert.equal(resolveWorkRunbook("patch", "low"), "patch_test_verify");
  });

  test("maps security review to audit_reproduce_remediate", () => {
    assert.equal(resolveWorkRunbook("security_review", "high"), "audit_reproduce_remediate");
  });

  test("maps trace issue to trace_source_to_sink", () => {
    assert.equal(resolveWorkRunbook("trace_issue", "high"), "trace_source_to_sink");
  });
});

describe("Work Engine validation gate", () => {
  test("blocks fixed claim when patch lacks validation", () => {
    const gate = evaluateValidationGate(
      makeWorkPlan({ required: true }),
      [],
      "fixed",
    );

    assert.equal(gate.allowed, false);
    assert.match(gate.warnings.join(" "), /Validation required/);
  });

  test("requires fallback validation for high-risk patch", () => {
    const gate = evaluateValidationGate(
      makeWorkPlan({
        required: true,
        risk: "high",
        fallbackCommand: "bun run typecheck",
      }),
      [
        { toolName: "run_tests", args: {}, output: "bun test passed" },
        { toolName: "verify_validation_persistence", args: {}, output: "persisted" },
      ],
      "done",
    );

    assert.equal(gate.allowed, false);
    assert.match(gate.warnings.join(" "), /fallback/);
  });
});

describe("Work Engine security proof gate", () => {
  test("downgrades vulnerability wording without source and sink", () => {
    assert.match(
      normalizeSecurityWording({ wording: "confirmed vulnerability in auth" }),
      /candidate/,
    );
  });

  test("allows confirmed finding with full proof fields", () => {
    assert.equal(
      canConfirmVulnerability({
        wording: "confirmed vulnerability",
        source: "req.body",
        path: "body -> command",
        sink: "exec",
        mitigation: "missing allowlist",
        exploitability: "attacker controls body",
        evidence: "src/server.ts:42",
      }),
      true,
    );
  });
});

describe("Work Engine failure memory gate", () => {
  test("injects similar failed command before retry", () => {
    const text = renderFailureMemoryInstructionFromSummaries([
      {
        command: "bun run typecheck",
        status: "open",
        signature: "ts2322",
        lastSeenAt: "2026-05-15T00:00:00.000Z",
      },
    ]);

    assert.match(text, /Do not repeat/);
    assert.match(text, /bun run typecheck/);
  });
});

describe("Work Engine privacy preflight", () => {
  test("sanitized context passes Privacy Sentinel preflight", () => {
    const result = buildPrivacyPreflightResult({
      blocked: false,
      totalSpans: 1,
      p0Count: 1,
    });

    assert.equal(result.status, "passed");
    assert.match(result.reason, /sanitized/);
  });

  test("P0 unsanitized context blocks cloud send in strict mode", () => {
    const result = buildPrivacyPreflightResult({
      blocked: true,
      reason: "Privacy Firewall outbound assertion failed.",
      totalSpans: 1,
      p0Count: 1,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.p0Count, 1);
  });
});

describe("Work Engine enforcement finalizer", () => {
  test("patch_test_verify cannot finish success without validation stage", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan({ required: true }),
      stages: makeStages({ validation_executed: "pending", evidence_attached: "passed" }),
      toolExecutions: [],
      content: "fixed",
      evidenceAttached: true,
    });

    assert.equal(result.verdict, "needs_validation");
    assert.match(result.content, /validation pending|needs_validation/);
  });

  test("security_review cannot output confirmed vulnerability without proof stage", () => {
    const result = finalizeWorkRun({
      workPlan: { ...makeWorkPlan({ required: false }), runbook: "audit_reproduce_remediate", intent: "security_review" },
      stages: makeStages({ security_proof_checked: "pending", evidence_attached: "passed" }),
      toolExecutions: [],
      content: "confirmed vulnerability in auth",
      evidenceAttached: true,
    });

    assert.match(result.content, /candidate issue/);
    assert.equal(/confirmed vulnerability/.test(result.content), false);
  });

  test("evidence_only cannot invent evidence", () => {
    const result = finalizeWorkRun({
      workPlan: { ...makeWorkPlan({ required: false }), runbook: "evidence_only", intent: "generate_evidence" },
      stages: makeStages({ evidence_attached: "pending" }),
      toolExecutions: [],
      content: "Evidence complete",
      evidenceAttached: false,
    });

    assert.equal(result.verdict, "needs_evidence");
    assert.match(result.content, /Evidence-only run has no runtime Evidence Pack/);
  });

  test("validate_only cannot claim passed if command failed", () => {
    const result = finalizeWorkRun({
      workPlan: { ...makeWorkPlan({ required: true }), runbook: "validate_only", intent: "validate" },
      stages: makeStages({ validation_planned: "passed", validation_executed: "failed", evidence_attached: "passed" }),
      toolExecutions: [{ toolName: "run_tests", args: {}, output: "failed" }],
      content: "validated and passed",
      evidenceAttached: true,
    });

    assert.equal(result.verdict, "failed");
    assert.match(result.content, /Validation failed/);
  });

  test("failure memory checked before repeated failed command", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan({ required: true }),
      stages: makeStages({ failure_memory_checked: "pending", validation_executed: "failed", evidence_attached: "passed" }),
      toolExecutions: [{ toolName: "run_tests", args: {}, output: "failed" }],
      content: "complete",
      evidenceAttached: true,
    });

    assert.equal(result.verdict, "failed");
    assert.match(result.content, /partially complete|failed/);
  });

  test("privacy preflight failed blocks cloud context send", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan({ required: false }),
      stages: makeStages({ privacy_preflight_passed: "blocked" }),
      toolExecutions: [],
      content: "complete",
      evidenceAttached: false,
    });

    assert.equal(result.verdict, "blocked");
  });
});

function makeWorkPlan(input: {
  required: boolean;
  risk?: WorkPlan["risk"];
  fallbackCommand?: string | null;
}): WorkPlan {
  return {
    id: "work-plan-test",
    intent: "patch",
    risk: input.risk ?? "medium",
    objective: "fix",
    runbook: "patch_test_verify",
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
      required: input.required,
      primaryCommand: "bun test",
      fallbackCommand: input.fallbackCommand ?? null,
      reason: "test",
    },
    privacyPlan: {
      requireSanitization: true,
      blockIfP0Unsanitized: true,
      includeRepoContext: true,
      includeToolOutput: true,
      reason: "test",
    },
    evidencePlan: {
      required: true,
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
      (id === "context_compiled" || id === "privacy_preflight_passed" ? "passed" : "skipped"),
    source: "deterministic",
    reason: "test",
    relatedToolEventIds: [],
  }));
}

// ---------------------------------------------------------------------------
// review_changes + changedFiles=0 fix
// ---------------------------------------------------------------------------

function makeReviewSnapshot(opts: {
  changedFiles?: string[];
  impactedFiles?: number;
  sensitiveSurfaces?: number;
  prompt?: string;
}): WorkPlanInputSnapshot {
  return {
    prompt: opts.prompt ?? "Review current changes. Classify risk.",
    mode: "build",
    workspace: { root: "/repo", name: "test-repo" },
    git: {
      branch: "main",
      changedFiles: opts.changedFiles ?? [],
      stagedFiles: [],
      untrackedFiles: [],
    },
    repoGraph: {
      status: "ready",
      entrypoints: ["src/index.ts"],
      impactedFiles: Array.from({ length: opts.impactedFiles ?? 0 }, (_, i) => `src/file${i}.ts`),
      relatedTests: [],
      sensitiveSurfaces: Array.from({ length: opts.sensitiveSurfaces ?? 0 }, (_, i) => ({
        kind: "ipc",
        files: [`src/ipc${i}.ts`],
        reason: "IPC handler",
      })),
    },
  };
}

describe("review_changes with changedFiles=0 — WorkPlan semantics", () => {
  test("risk is low when there are no changed files even with many impacted/sensitive surfaces", () => {
    const plan = buildWorkPlanFromSnapshot(
      makeReviewSnapshot({ impactedFiles: 20, sensitiveSurfaces: 20 }),
    );
    assert.equal(plan.risk, "low");
  });

  test("validationRequired is false for review_changes + changedFiles=0", () => {
    const plan = buildWorkPlanFromSnapshot(makeReviewSnapshot({}));
    assert.equal(plan.validationPlan.required, false);
  });

  test("evidenceRequired is false for review_changes + changedFiles=0", () => {
    const plan = buildWorkPlanFromSnapshot(makeReviewSnapshot({}));
    assert.equal(plan.evidencePlan.required, false);
  });

  test("finalizer verdict is not blocked for review_changes + changedFiles=0", () => {
    const plan = buildWorkPlanFromSnapshot(makeReviewSnapshot({}));
    const stages = deriveWorkStages({
      workPlan: plan,
      events: [],
      toolExecutions: [],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: true,
    });
    const result = finalizeWorkRun({
      workPlan: plan,
      stages,
      toolExecutions: [],
      content: "No changes found. Risk Classification: N/A.",
      evidenceAttached: false,
    });
    assert.notEqual(result.verdict, "blocked");
    assert.notEqual(result.verdict, "needs_validation");
    assert.notEqual(result.verdict, "needs_evidence");
  });

  test("evidence_attached stage is skipped (not pending/blocked) when evidence not required", () => {
    const plan = buildWorkPlanFromSnapshot(makeReviewSnapshot({}));
    const stages = deriveWorkStages({
      workPlan: plan,
      events: [],
      toolExecutions: [],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: true,
    });
    const evidenceStage = stages.find((s) => s.id === "evidence_attached");
    assert.equal(evidenceStage?.status, "skipped");
  });

  test("validation_executed stage is skipped (not pending/blocked) when validation not required", () => {
    const plan = buildWorkPlanFromSnapshot(makeReviewSnapshot({}));
    const stages = deriveWorkStages({
      workPlan: plan,
      events: [],
      toolExecutions: [],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: true,
    });
    const validationStage = stages.find((s) => s.id === "validation_executed");
    assert.equal(validationStage?.status, "skipped");
  });
});

describe("review_changes with changedFiles>0 — validation still required", () => {
  test("validationRequired is true when there are changed files at medium risk", () => {
    const plan = buildWorkPlanFromSnapshot(
      makeReviewSnapshot({ changedFiles: ["src/a.ts", "src/b.ts"] }),
    );
    assert.equal(plan.risk, "medium");
    assert.equal(plan.validationPlan.required, true);
  });
});

describe("explicit validate prompt — validation required even with changedFiles=0", () => {
  test("validate intent requires validation regardless of changed files", () => {
    const plan = buildWorkPlanFromSnapshot({
      prompt: "run tests",
      mode: "build",
      workspace: { root: "/repo", name: "test-repo" },
      git: { branch: "main", changedFiles: [], stagedFiles: [], untrackedFiles: [] },
    });
    assert.equal(plan.intent, "validate");
    assert.equal(plan.validationPlan.required, true);
  });
});

describe("patch_test_verify with no validation — still needs_validation", () => {
  test("patch_test_verify cannot succeed without validation_executed", () => {
    const result = finalizeWorkRun({
      workPlan: makeWorkPlan({ required: true }),
      stages: makeStages({ validation_executed: "pending", evidence_attached: "passed" }),
      toolExecutions: [],
      content: "patch applied",
      evidenceAttached: true,
    });
    assert.equal(result.verdict, "needs_validation");
  });
});

describe("security_review with confirmed finding — still requires proof", () => {
  test("security_review cannot output confirmed vulnerability without security_proof_checked", () => {
    const result = finalizeWorkRun({
      workPlan: {
        ...makeWorkPlan({ required: false }),
        runbook: "audit_reproduce_remediate",
        intent: "security_review",
      },
      stages: makeStages({ security_proof_checked: "pending", evidence_attached: "passed" }),
      toolExecutions: [],
      content: "confirmed vulnerability in auth module",
      evidenceAttached: true,
    });
    assert.match(result.content, /candidate issue/);
    assert.equal(/confirmed vulnerability/.test(result.content), false);
  });
});
