import { test } from "bun:test";
import assert from "node:assert/strict";

import type { ToolExecutionRecord } from "../evidence-pack";
import {
  resolveRunIntentOutcome,
  resolveToolAuthorization,
} from "../capability-resolver";
import { createDefaultWorkspaceTrustContract } from "../workspace-trust";
import { finalizeWorkRun } from "./finalizer";
import { normalizeToolExecution } from "./execution-evidence";
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
