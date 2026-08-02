import { test } from "bun:test";
import assert from "node:assert/strict";

import type { ToolExecutionRecord } from "../evidence-pack";
import {
  resolveRunIntentOutcome,
  resolveToolAuthorization,
} from "../capability-resolver";
import { createDefaultWorkspaceTrustContract } from "../workspace-trust";
import { finalizeWorkRun } from "./finalizer";
import {
  buildExecutionEvidence,
  buildUserFacingExecutionSummary,
  normalizeToolEvidence,
  normalizeToolExecution,
} from "./execution-evidence";
import type { WorkStage } from "./stages";
import type { WorkPlan } from "./types";

const plan: WorkPlan = {
  id: "execution-evidence-test",
  intent: "patch",
  risk: "medium",
  objective: "Apply and validate a repository change.",
  runbook: "patch_test_verify",
  workingSet: {
    primaryFiles: ["src/example.ts"],
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
    required: true,
    primaryCommand: "bun test",
    fallbackCommand: null,
    reason: "Validation is required after mutation.",
  },
  privacyPlan: {
    requireSanitization: false,
    blockIfP0Unsanitized: false,
    includeRepoContext: true,
    includeToolOutput: true,
    reason: "No sensitive context in this test.",
  },
  preventivePlan: {
    enabled: false,
    riskAreas: [],
    recommendedControls: [],
    requiredChecks: [],
    strictness: "warn",
    reason: "Disabled for test.",
  },
  evidencePlan: {
    required: false,
    expectedArtifacts: [],
    requiredClaims: [],
  },
  stopConditions: [],
};

const stages: WorkStage[] = [
  stage("context_compiled", "passed"),
  stage("files_inspected", "passed"),
  stage("patch_attempted", "passed"),
  stage("validation_planned", "passed"),
  stage("validation_executed", "passed"),
  stage("failure_memory_checked", "skipped"),
  stage("privacy_preflight_passed", "passed"),
  stage("evidence_attached", "skipped"),
];

function stage(id: WorkStage["id"], status: WorkStage["status"]): WorkStage {
  return {
    id,
    status,
    source: "runtime",
    reason: `${id} ${status}`,
    relatedToolEventIds: [],
  };
}

function execution(
  toolName: string,
  output: string,
  parsedOutput?: Record<string, unknown>,
): ToolExecutionRecord {
  return { toolName, args: { path: "src/example.ts" }, output, parsedOutput };
}

const passedValidation = execution(
  "sandbox_run",
  JSON.stringify({
    ok: true,
    status: "completed",
    exitCode: 0,
    summary: "Tests passed.",
    validationExecution: {
      executionId: "validation-exec-test",
      command: "bun test",
      processStarted: true,
      exitCode: 0,
      requirementId: "test",
    },
  }),
);

const authorizationCases = [
  ["workspace", "review", "blocked"],
  ["approval-required", "execute", "needs_approval"],
  ["read-only", "execute", "blocked"],
  ["workspace", "execute", "allowed"],
  ["workspace", "plan", "blocked"],
  ["approval-required", "review", "blocked"],
] as const;

const presentationEvidence = {
  completedSteps: [],
  failedSteps: [],
  blockedSteps: [],
  changedFiles: [],
  validation: { status: "not_required" as const },
  synthesis: { status: "valid" as const },
};

test("changed_verified uses natural completed wording", () => {
  const summary = buildUserFacingExecutionSummary("completed", {
    ...presentationEvidence,
    changedFiles: [{ path: "src/example.ts", operation: "modified", backupCreated: false, impactAnalysis: "skipped" }],
    validation: { status: "passed" },
  }, "changed_verified");

  assert.equal(summary, "Changes applied to 1 file.\nRequired verification passed.");
});

test("changed_unverified presents unavailable typecheck as one verification gap", () => {
  const summary = buildUserFacingExecutionSummary("partial", {
    ...presentationEvidence,
    changedFiles: ["a.ts", "b.ts", "c.ts"].map((path) => ({
      path,
      operation: "modified" as const,
      backupCreated: false,
      impactAnalysis: "skipped" as const,
    })),
    validation: {
      status: "not_run",
      cause: "TYPECHECK_UNAVAILABLE",
      contract: {
        schemaVersion: 1,
        actualMutation: true,
        objectiveAlreadySatisfied: false,
        validationIsPrimaryObjective: false,
        compiledAt: "2026-08-01T00:00:00.000Z",
        source: "canonical_compiler",
        items: [{
          id: "tests",
          signal: "test",
          obligation: "required",
          trigger: "after_mutation",
          applicability: "applicable",
          availability: "resolved",
          command: "bun test",
          commandSource: "repository_script",
          evidence: { status: "passed", executionId: "test-execution" },
          reason: "Focused tests are required.",
        }],
      },
    },
  }, "changed_unverified");

  assert.equal(
    summary,
    "Changes applied to 3 files.\nFocused tests passed.\nTypecheck could not run because this repository does not define one.\nReview the diff before shipping.",
  );
  assert.doesNotMatch(summary, /changed_unverified|changed unverified|backup|impact analysis|completed partially|(?:^|\n)not run(?:$|\n)/i);
});

test("already_satisfied says no changes are needed", () => {
  assert.equal(
    buildUserFacingExecutionSummary("completed", presentationEvidence, "already_satisfied"),
    "No changes needed. The requested state is already satisfied.\nPost-change verification was not applicable because no files changed.",
  );
});

test("validation-only unavailable remains genuinely blocked", () => {
  const summary = buildUserFacingExecutionSummary("blocked", {
    ...presentationEvidence,
    validation: { status: "not_run", cause: "TYPECHECK_UNAVAILABLE" },
  }, "blocked");
  assert.match(summary, /^Stopped because the required typecheck is unavailable/);
});

test("failed mutation remains genuinely failed", () => {
  const summary = buildUserFacingExecutionSummary("failed", {
    ...presentationEvidence,
    failedSteps: [{ name: "file_editor", reason: "The edit could not be applied" }],
  }, "failed");
  assert.match(summary, /^The run could not complete/);
  assert.match(summary, /Why it stopped: The edit could not be applied/);
});

for (const [writeAccess, behaviorMode, expected] of authorizationCases) {
  test(
    `${writeAccess} workspace access with ${behaviorMode} behavior resolves a write as ${expected}`,
    () => {
      const workspacePolicy = createDefaultWorkspaceTrustContract(
        "workspace",
        "Repo",
        { packageManager: "bun", hasPackageJson: true },
      );
      workspacePolicy.writeAccess = writeAccess;

      const decision = resolveToolAuthorization({
        toolName: "file_editor",
        args: { path: "README.md" },
        behaviorMode,
        workspacePolicy,
      });

      assert.equal(decision.decision, expected);
    },
  );
}

test("trust-blocked sandbox execution is blocked, never successful", () => {
  const blocked = execution(
    "sandbox_run",
    'Error executing tool "sandbox_run": [FORBIDDEN] Workspace Trust Contract blocks sandbox_run\n' +
      JSON.stringify({ ok: false, status: "failed", error: { code: "FORBIDDEN", message: "Workspace Trust Contract blocks sandbox_run" } }),
  );
  const result = finalizeWorkRun({
    workPlan: plan,
    stages: stages.map((item) => item.id === "validation_executed" ? stage(item.id, "blocked") : item),
    toolExecutions: [blocked],
    content: "The model says the run succeeded.",
    evidenceAttached: true,
    planningPhase: true,
    synthesisStatus: "valid",
  });

  assert.equal(result.terminalState, "blocked");
  assert.notEqual(result.terminalState, "completed");
  assert.equal(result.evidence.blockedSteps[0]?.name, "sandbox_run");
  assert.doesNotMatch(result.content, /\b(?:succeeded|successfully)\b/i);
  assert.doesNotMatch(result.content, /Work Engine verdict|planningPhase|not_applicable_for_phase/);
});

test("classifies unresolved validation as blocked with precise remediation", () => {
  const evidence = normalizeToolEvidence(
    "run_tests",
    { scope: "full-suite" },
    [
      'Error executing tool "run_tests": [DEPENDENCY_UNAVAILABLE] No command.',
      JSON.stringify({
        ok: false,
        status: "failed",
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "No command.",
          recommendedNextAction: "Run plan_validation again.",
          details: {
            cause: "TYPECHECK_UNAVAILABLE",
            requirementId: "typecheck",
          },
        },
      }),
    ].join("\n"),
  );

  assert.equal(evidence.outcome, "blocked");
  assert.equal(evidence.validationStatus, "blocked");
  assert.equal(evidence.validationCause, "TYPECHECK_UNAVAILABLE");
  assert.equal(evidence.requiredUserAction, "Run plan_validation again.");
});

test("failed tool execution without mutation is failed", () => {
  const failed = execution(
    "sandbox_run",
    'Error executing tool "sandbox_run": [EXECUTION_ERROR] command failed\n' +
      JSON.stringify({ ok: false, status: "failed", error: { code: "EXECUTION_ERROR", message: "command failed" } }),
  );
  const result = finalizeWorkRun({
    workPlan: plan,
    stages: stages.map((item) => item.id === "validation_executed" ? stage(item.id, "failed") : item),
    toolExecutions: [failed],
    content: "The run succeeded.",
    evidenceAttached: true,
    synthesisStatus: "valid",
  });

  assert.equal(result.terminalState, "failed");
  assert.equal(result.evidence.changedFiles.length, 0);
});

test("mutation followed by blocked validation is partial with the exact file", () => {
  const mutation = execution(
    "file_editor",
    "File src/example.ts successfully edited with replace_block (1 occurrence(s)). No backup file was created. Impact analysis skipped for speed.",
    { status: "success", path: "src/example.ts" },
  );
  const blocked = execution(
    "sandbox_run",
    "Error executing tool sandbox_run: [FORBIDDEN] Workspace Trust Contract blocks sandbox_run",
    { status: "failed", error: { code: "FORBIDDEN", message: "Workspace Trust Contract blocks sandbox_run" } },
  );
  const result = finalizeWorkRun({
    workPlan: plan,
    stages: stages.map((item) => item.id === "validation_executed" ? stage(item.id, "blocked") : item),
    toolExecutions: [mutation, blocked],
    content: "The patch is complete.",
    evidenceAttached: true,
    synthesisStatus: "valid",
  });

  assert.equal(result.terminalState, "partial");
  assert.deepEqual(result.evidence.changedFiles.map((file) => file.path), ["src/example.ts"]);
  assert.equal(result.evidence.changedFiles[0]?.backupCreated, false);
  assert.equal(result.evidence.changedFiles[0]?.impactAnalysis, "skipped");
});

test("missing final synthesis cannot be successful", () => {
  const result = finalizeWorkRun({
    workPlan: plan,
    stages,
    toolExecutions: [passedValidation],
    content: "Local fallback summary only.",
    evidenceAttached: true,
    synthesisStatus: "missing",
  });

  assert.equal(result.terminalState, "failed");
  assert.notEqual(result.terminalState, "completed");
  assert.doesNotMatch(result.content, /\b(?:success|succeeded|passed)\b/i);
});

test("approval-required execution waits for approval", () => {
  const approval = execution(
    "file_editor",
    "Tool file_editor requires approval before editing the repository.",
    { status: "blocked", code: "ERR_APPROVAL_REQUIRED" },
  );
  const result = finalizeWorkRun({
    workPlan: plan,
    stages: stages.map((item) => item.id === "patch_attempted" ? stage(item.id, "blocked") : item),
    toolExecutions: [approval],
    content: "I need approval before making this change.",
    evidenceAttached: true,
    synthesisStatus: "valid",
  });

  assert.equal(normalizeToolExecution(approval).outcome, "awaiting_approval");
  assert.equal(result.terminalState, "blocked");
  assert.equal(result.evidence.blockedSteps[0]?.name, "file_editor");
  assert.ok(result.evidence.requiredUserAction);
  assert.match(result.summary, /pending required action/i);
});

test("cancelled validation approval remains blocked", () => {
  const cancelled = execution(
    "sandbox_run",
    "Approval was cancelled.",
    { status: "cancelled" },
  );
  const result = finalizeWorkRun({
    workPlan: plan,
    stages: stages.map((item) => item.id === "validation_executed" ? stage(item.id, "blocked") : item),
    toolExecutions: [cancelled],
    content: "Approval was cancelled.",
    evidenceAttached: true,
    synthesisStatus: "valid",
    terminalOutcome: {
      status: "blocked",
      summary: "Approval was cancelled.",
      blocker: {
        code: "APPROVAL_DENIED",
        requestedCapability: "command.execute",
      },
    },
  });

  assert.equal(result.terminalState, "blocked");
  assert.equal(result.summary, "Approval was cancelled.");
});

test("Review write rejection stays blocked without incomplete execution bookkeeping", () => {
  const outcome = resolveRunIntentOutcome({
    behaviorMode: "review",
    intent: "patch",
  });
  assert.ok(outcome);
  const result = finalizeWorkRun({
    workPlan: plan,
    stages,
    toolExecutions: [],
    content: outcome.summary,
    evidenceAttached: true,
    planningPhase: true,
    synthesisStatus: "valid",
    terminalOutcome: outcome,
  });

  assert.equal(result.terminalState, "blocked");
  assert.equal(result.summary, outcome.summary);
  assert.doesNotMatch(
    result.content,
    /approval|changed files|validation|final synthesis|execution incomplete/i,
  );
});

test("fully successful execution is succeeded", () => {
  const mutation = execution(
    "file_editor",
    "File src/example.ts successfully edited with replace_block (1 occurrence(s)). Impact analysis completed.",
    { status: "success", path: "src/example.ts" },
  );
  const result = finalizeWorkRun({
    workPlan: plan,
    stages,
    toolExecutions: [mutation, passedValidation],
    content: "The change was applied and validated.",
    evidenceAttached: true,
    synthesisStatus: "valid",
  });

  assert.equal(result.terminalState, "completed");
  assert.equal(result.evidence.validation.status, "passed");
  assert.equal(result.evidence.synthesis.status, "valid");
});

test("model success claims cannot override failed evidence", () => {
  const result = finalizeWorkRun({
    workPlan: plan,
    stages: stages.map((item) => item.id === "validation_executed" ? stage(item.id, "failed") : item),
    toolExecutions: [execution("sandbox_run", "Error: command failed\n{\"ok\":false,\"status\":\"failed\"}")],
    content: "Verdict: success. Everything passed.",
    evidenceAttached: true,
    synthesisStatus: "valid",
  });

  assert.equal(result.terminalState, "failed");
  assert.notEqual(result.terminalState, "completed");
});

test("approved recovery does not suppress a real non-zero validation failure", () => {
  const workPlan: WorkPlan = {
    ...plan,
    validationPlan: {
      ...plan.validationPlan,
      requirements: [
        { id: "test", command: "bun test", availability: "resolved" },
        {
          id: "typecheck",
          command: null,
          availability: "unresolved",
          unavailableCause: "TYPECHECK_UNAVAILABLE",
        },
      ],
    },
  };
  const realFailure = execution(
    "sandbox_run",
    JSON.stringify({
      status: "failed",
      validationExecution: {
        executionId: "typecheck-failed",
        command: "bun x tsc --noEmit",
        processStarted: true,
        exitCode: 1,
        requirementId: "typecheck",
      },
    }),
  );
  const approvedRecovery = execution(
    "sandbox_run",
    JSON.stringify({
      status: "completed",
      validationExecution: {
        executionId: "typecheck-recovered",
        command: "bun x tsc --noEmit",
        processStarted: true,
        exitCode: 0,
        requirementId: "typecheck",
        authorization: "approved_override",
      },
    }),
  );
  const result = buildExecutionEvidence({
    workPlan,
    stages: [],
    toolExecutions: [realFailure, approvedRecovery],
    synthesisStatus: "valid",
  });

  assert.equal(result.validation.status, "failed");
  assert.equal(result.failedSteps.length, 1);
});
