import { test } from "bun:test";
import assert from "node:assert/strict";

import type { ToolExecutionRecord } from "../evidence-pack";
import { finalizeWorkRun } from "./finalizer";
import type { WorkStage } from "./stages";
import type { WorkPlan } from "./types";

const basePlan: WorkPlan = {
  id: "work-plan-test",
  intent: "security_review",
  risk: "high",
  objective: "Review auth changes.",
  runbook: "audit_reproduce_remediate",
  workingSet: {
    primaryFiles: [],
    relatedFiles: [],
    relatedTests: [],
    changedFiles: [],
    impactedFiles: [],
    entrypoints: [],
    sensitiveSurfaces: [{ kind: "auth", files: ["src/auth.ts"], reason: "Auth boundary." }],
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
    requireSanitization: true,
    blockIfP0Unsanitized: true,
    includeRepoContext: true,
    includeToolOutput: true,
    reason: "Privacy Sentinel active.",
  },
  preventivePlan: {
    enabled: true,
    riskAreas: ["auth"],
    recommendedControls: ["Preserve deny-by-default authorization and explicit role checks."],
    requiredChecks: [],
    strictness: "warn",
    reason: "Preventive Guard enabled.",
  },
  evidencePlan: {
    required: true,
    expectedArtifacts: ["files inspected"],
    requiredClaims: ["runtime evidence source"],
  },
  stopConditions: [],
};

const stages: WorkStage[] = [
  { id: "context_compiled", status: "passed", source: "deterministic", reason: "", relatedToolEventIds: [] },
  { id: "security_proof_checked", status: "pending", source: "deterministic", reason: "", relatedToolEventIds: [] },
  { id: "privacy_preflight_passed", status: "passed", source: "deterministic", reason: "", relatedToolEventIds: [] },
  { id: "evidence_attached", status: "passed", source: "runtime", reason: "", relatedToolEventIds: [] },
];

test("candidate-level security review without proof and tools is partial", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [],
    content: "Candidate auth risks found. No confirmed exploitability.",
    evidenceAttached: true,
  });

  assert.equal(result.verdict, "partial");
  assert.match(result.warnings.join("\n"), /Security proof was not run/);
  assert.match(result.warnings.join("\n"), /No repository tool evidence was captured/);
});

test("strong auth risk wording without proof downgrades verdict and wording", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [],
    content: [
      "Redis Dependency for Security: logout is strictly tied to Redis availability.",
      "Rate limiting scope could leave the system vulnerable to brute-force or resource exhaustion attacks.",
      "Database placeholder is a high-severity concern.",
    ].join("\n"),
    evidenceAttached: true,
  });

  assert.equal(result.verdict, "partial");
  assert.match(result.content, /potentially exposed/);
  assert.match(result.content, /automated-abuse candidate/);
  assert.match(result.content, /resource-exhaustion candidate/);
  assert.match(result.content, /severity-unproven/);
  assert.match(result.warnings.join("\n"), /Confirmed (?:vulnerability|security claim) wording unsupported by security proof stage/);
});

test("finalizer replaces prior Work Engine verdict instead of duplicating", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [],
    content: "Candidate auth risks found.\n\nWork Engine verdict: partial.",
    evidenceAttached: true,
  });

  assert.equal(result.content.match(/Work Engine verdict:/g)?.length ?? 0, 0);
  assert.match(result.content, /required verification is incomplete/i);
  assert.doesNotMatch(result.content, /Completed partially/);
  assert.equal(result.terminalState, "partial");
});

test("partial mutation outcome keeps execution truth instead of blocker prose", () => {
  const changedFileExecution = {
    toolName: "file_editor",
    args: { path: "src/service.ts" },
    output: "File changed.",
    evidence: {
      toolName: "file_editor",
      outcome: "completed" as const,
      summary: "Changed src/service.ts",
      changedFiles: [
        {
          path: "src/service.ts",
          operation: "modified" as const,
          backupCreated: false,
          impactAnalysis: "none" as const,
        },
      ],
    },
  };
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [changedFileExecution],
    content: "The edit was applied before validation was blocked.",
    evidenceAttached: true,
    terminalOutcome: {
      status: "blocked",
      summary: "Requested search path is outside policy.",
      blocker: {
        code: "WORKSPACE_SCOPE",
        requestedCapability: "workspace.read",
      },
    },
  });

  assert.equal(result.terminalState, "partial");
  assert.doesNotMatch(result.summary, /outside policy/);
  assert.match(result.summary, /Changes applied/);
  assert.match(result.summary, /required check could not run/i);
});

test("preparatory answer without tool evidence cannot be success", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages: stages.map((stage) =>
      stage.id === "security_proof_checked"
        ? { ...stage, status: "skipped" as const, reason: "Candidate-level only." }
        : stage,
    ),
    toolExecutions: [],
    content:
      "I will begin by inspecting the current repository state and identifying the specific files involved in the authentication changes. First, I'll examine the git status and recent changes.",
    evidenceAttached: true,
  });

  assert.equal(result.verdict, "partial");
  assert.match(result.warnings.join("\n"), /progress plan instead of a final repo-grounded answer/);
  assert.match(result.warnings.join("\n"), /No repository tool evidence was captured/);
});

test("typed provider failure replaces contradictory model prose", () => {
  const result = finalizeWorkRun({
    workPlan: {
      ...basePlan,
      intent: "patch",
      runbook: "patch_test_verify",
      validationPlan: {
        required: true,
        primaryCommand: "bun run typecheck",
        fallbackCommand: null,
        reason: "Patch requires validation.",
      },
    },
    stages,
    toolExecutions: [],
    content:
      "Completed partially. Validation not required. Migration incomplete.",
    evidenceAttached: true,
    terminalOutcome: {
      status: "failed",
      summary: "The selected model cannot use required repository tools.",
      diagnostic: {
        code: "MODEL_TOOLS_UNAVAILABLE",
        message: "Required tools were rejected.",
      },
      remediation: {
        type: "select_model",
        label: "Choose another model",
      },
    },
    synthesisStatus: "failed",
  });

  assert.equal(result.terminalState, "failed");
  assert.equal(
    result.content,
    "The selected model cannot use required repository tools.",
  );
  assert.equal(result.summary, result.content);
});

test("Privacy Sentinel placeholders are not treated as source evidence", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [
      { toolName: "read", args: { path: "src/auth.ts" }, output: "redacted snippet" } as ToolExecutionRecord,
    ],
    content: [
      "The presence of [WORKSPACE_IDENTITY] strongly suggests templated code.",
      "Next step: Replace the [WORKSPACE_IDENTITY] placeholders with actual parameterized queries.",
      "Verdict: UNSAFE due to severity unproven SQL Injection Risk in templated code.",
    ].join("\n"),
    evidenceAttached: true,
  });

  assert.equal(result.verdict, "partial");
  assert.match(result.content, /Privacy Sentinel redaction token \[WORKSPACE_IDENTITY\] only shows/);
  assert.match(result.content, /Do not treat Privacy Sentinel redaction tokens as raw source values/);
  assert.match(result.warnings.join("\n"), /Privacy Sentinel placeholder was treated as source evidence/);
});
