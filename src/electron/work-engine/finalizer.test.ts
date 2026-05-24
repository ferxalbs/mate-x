import test from "node:test";
import assert from "node:assert/strict";

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

test("candidate-level security review without proof is warning-only", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [],
    content: "Candidate auth risks found. No confirmed exploitability.",
    evidenceAttached: true,
  });

  assert.equal(result.verdict, "success");
  assert.match(result.content, /Security proof was not run/);
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
  assert.match(result.content, /Confirmed vulnerability wording unsupported by security proof stage/);
});

test("finalizer replaces prior Work Engine verdict instead of duplicating", () => {
  const result = finalizeWorkRun({
    workPlan: basePlan,
    stages,
    toolExecutions: [],
    content: "Candidate auth risks found.\n\nWork Engine verdict: partial.",
    evidenceAttached: true,
  });

  assert.equal(result.content.match(/Work Engine verdict:/g)?.length, 1);
  assert.match(result.content, /Work Engine verdict: success\./);
});
