import type { ToolExecutionRecord } from "../../evidence-pack";
import type { WorkStage } from "../stages";
import type { WorkPlan } from "../types";
import type { WorkEngineBenchmarkScenario } from "./benchmark-types";

const STAGE_IDS: WorkStage["id"][] = [
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

export function buildBenchmarkScenarios(): WorkEngineBenchmarkScenario[] {
  return [
    scenario({
      id: "patch-no-validation",
      category: "patch_validation",
      prompt: "fix this bug",
      runbook: "patch_test_verify",
      finalAnswer: "should be fixed",
      stages: stages({
        validation_executed: "pending",
        evidence_attached: "passed",
      }),
      verdictExpected: "needs_validation",
      expectedDowngrades: ["may be patched, validation pending"],
      expectValidationAccepted: false,
    }),
    scenario({
      id: "patch-failed-validation",
      category: "patch_validation",
      prompt: "fix this bug",
      runbook: "patch_test_verify",
      finalAnswer: "tests appear fine",
      stages: stages({
        validation_planned: "passed",
        validation_executed: "failed",
        evidence_attached: "passed",
      }),
      toolExecutions: [tool("run_tests", "failed")],
      verdictExpected: "failed",
      expectValidationAccepted: false,
    }),
    scenario({
      id: "patch-high-risk-fallback-missing",
      category: "patch_validation",
      prompt: "fix auth bug",
      runbook: "patch_test_verify",
      risk: "high",
      fallbackCommand: "bun run typecheck",
      finalAnswer: "patch is correct",
      stages: stages({
        validation_planned: "passed",
        validation_executed: "passed",
        evidence_attached: "passed",
      }),
      toolExecutions: [
        tool("run_tests", "bun test passed"),
        tool("verify_validation_persistence", "persisted"),
      ],
      verdictExpected: "needs_validation",
      expectValidationAccepted: false,
    }),
    scenario({
      id: "patch-primary-fallback-pass",
      category: "patch_validation",
      prompt: "fix auth bug",
      runbook: "patch_test_verify",
      risk: "high",
      fallbackCommand: "bun run typecheck",
      finalAnswer: "Patched and validated.",
      stages: stages({
        validation_planned: "passed",
        validation_executed: "passed",
        evidence_attached: "passed",
      }),
      toolExecutions: [
        tool("run_tests", "bun test passed"),
        tool("sandbox_run", "bun run typecheck passed", {
          command: "bun run typecheck",
        }),
        tool("verify_validation_persistence", "persisted"),
      ],
      verdictExpected: "success",
    }),
    scenario({
      id: "no-patch-needed-inspected",
      category: "patch_validation",
      prompt: "inspect this behavior",
      runbook: "inspect_explain",
      finalAnswer: "No patch needed. Read-only inspection.",
      stages: stages({
        patch_attempted: "skipped",
        validation_planned: "skipped",
        validation_executed: "skipped",
        evidence_attached: "skipped",
      }),
      verdictExpected: "success",
      expectEvidenceAccepted: false,
      expectValidationAccepted: false,
    }),
    scenario({
      id: "security-rce-no-proof",
      category: "security",
      prompt: "is this RCE vulnerable?",
      runbook: "audit_reproduce_remediate",
      finalAnswer: "RCE confirmed.",
      stages: stages({
        security_proof_checked: "pending",
        evidence_attached: "passed",
      }),
      verdictExpected: "partial",
      expectedDowngrades: ["potential code execution candidate"],
      expectSecurityProofAccepted: false,
    }),
    scenario({
      id: "security-ssrf-proof",
      category: "security",
      prompt: "check SSRF risk",
      runbook: "audit_reproduce_remediate",
      finalAnswer:
        "Confirmed issue with source, sink, mitigation, and exploitability evidence.",
      stages: stages({
        security_proof_checked: "passed",
        evidence_attached: "passed",
      }),
      toolExecutions: [
        tool(
          "security_path_trace",
          "source path sink mitigation exploitability",
        ),
        tool("candidate_revalidator", "confirmed"),
      ],
      verdictExpected: "success",
      expectSecurityProofAccepted: true,
    }),
    scenario({
      id: "security-high-severity-no-exploitability",
      category: "security",
      prompt: "review security risk",
      runbook: "audit_reproduce_remediate",
      finalAnswer: "high severity auth bypass",
      stages: stages({
        security_proof_checked: "pending",
        evidence_attached: "passed",
      }),
      verdictExpected: "partial",
      expectedDowngrades: [
        "severity unproven",
        "potential auth bypass candidate",
      ],
      expectSecurityProofAccepted: false,
    }),
    scenario({
      id: "security-scan-only",
      category: "security",
      prompt: "security scan",
      runbook: "audit_reproduce_remediate",
      finalAnswer: "secret leak critical",
      stages: stages({
        security_proof_checked: "pending",
        evidence_attached: "passed",
      }),
      toolExecutions: [tool("attack_surface_scan", "candidate")],
      verdictExpected: "partial",
      expectSecurityProofAccepted: false,
    }),
    scenario({
      id: "trace-missing-sink",
      category: "security",
      prompt: "trace input to shell exec",
      runbook: "trace_source_to_sink",
      finalAnswer: "source-to-sink confirmed",
      stages: stages({
        security_proof_checked: "pending",
        evidence_attached: "skipped",
      }),
      verdictExpected: "partial",
      expectSecurityProofAccepted: false,
    }),
    scenario({
      id: "evidence-prose-no-artifact",
      category: "evidence",
      prompt: "generate evidence pack",
      runbook: "evidence_only",
      finalAnswer: "Evidence attached: commands run.",
      stages: stages({ evidence_attached: "pending" }),
      evidenceAttached: false,
      verdictExpected: "needs_evidence",
      expectEvidenceAccepted: false,
    }),
    scenario({
      id: "evidence-pack-missing-validation",
      category: "evidence",
      prompt: "generate evidence pack",
      runbook: "patch_test_verify",
      finalAnswer: "Evidence attached.",
      stages: stages({
        validation_executed: "pending",
        evidence_attached: "passed",
      }),
      evidenceAttached: true,
      verdictExpected: "needs_validation",
      expectValidationAccepted: false,
    }),
    scenario({
      id: "evidence-pack-runtime-events",
      category: "evidence",
      prompt: "generate evidence pack",
      runbook: "evidence_only",
      finalAnswer: "Evidence Pack attached from runtime events.",
      stages: stages({ evidence_attached: "passed" }),
      toolExecutions: [tool("evidence_pack", "runtime evidence pack")],
      evidenceAttached: true,
      verdictExpected: "success",
    }),
    scenario({
      id: "privacy-strict-p0-block",
      category: "privacy",
      prompt: "inspect repo",
      runbook: "answer_from_context",
      finalAnswer: "complete",
      stages: stages({ privacy_preflight_passed: "blocked" }),
      verdictExpected: "blocked",
      expectPrivacyAccepted: false,
    }),
    scenario({
      id: "privacy-sanitized-p0-pass",
      category: "privacy",
      prompt: "what is this path?",
      runbook: "answer_from_context",
      finalAnswer: "Answer from sanitized context.",
      stages: stages({ privacy_preflight_passed: "passed" }),
      verdictExpected: "success",
      expectPrivacyAccepted: true,
    }),
    scenario({
      id: "privacy-unavailable",
      category: "privacy",
      prompt: "what is this path?",
      runbook: "answer_from_context",
      finalAnswer: "Answer from context.",
      stages: stages({ privacy_preflight_passed: "pending" }),
      verdictExpected: "partial",
      expectPrivacyAccepted: false,
    }),
    scenario({
      id: "privacy-no-repo-context",
      category: "privacy",
      prompt: "hello",
      runbook: "answer_from_context",
      finalAnswer: "Answer without repo context.",
      stages: stages({ privacy_preflight_passed: "skipped" }),
      verdictExpected: "success",
      expectPrivacyAccepted: true,
    }),
    scenario({
      id: "failure-memory-missing",
      category: "failure_memory",
      prompt: "retry failed tests",
      runbook: "validate_only",
      finalAnswer: "validated",
      stages: stages({
        failure_memory_checked: "pending",
        validation_planned: "passed",
        validation_executed: "failed",
      }),
      toolExecutions: [tool("run_tests", "failed")],
      verdictExpected: "failed",
      expectValidationAccepted: false,
    }),
    scenario({
      id: "failure-memory-new-hypothesis",
      category: "failure_memory",
      prompt: "retry failed tests with new hypothesis",
      runbook: "validate_only",
      finalAnswer: "Validated after new hypothesis.",
      stages: stages({
        failure_memory_checked: "passed",
        validation_planned: "passed",
        validation_executed: "passed",
      }),
      toolExecutions: [
        tool("find_similar_failures", "known failure"),
        tool("run_tests", "passed"),
        tool("verify_validation_persistence", "persisted"),
      ],
      verdictExpected: "success",
    }),
    scenario({
      id: "failure-memory-resolution",
      category: "failure_memory",
      prompt: "rerun fixed test",
      runbook: "validate_only",
      finalAnswer: "resolved",
      stages: stages({
        failure_memory_checked: "passed",
        validation_planned: "passed",
        validation_executed: "passed",
      }),
      toolExecutions: [
        tool("find_similar_failures", "known failure"),
        tool("run_tests", "passed"),
        tool("record_resolution", "resolved"),
        tool("verify_validation_persistence", "persisted"),
      ],
      verdictExpected: "success",
    }),
    scenario({
      id: "intent-fix",
      category: "intent_runbook",
      prompt: "fix this bug",
      runbook: "patch_test_verify",
      finalAnswer: "patched with validation pending",
      stages: stages({ validation_executed: "pending" }),
      verdictExpected: "needs_validation",
    }),
    scenario({
      id: "intent-review",
      category: "intent_runbook",
      prompt: "review current changes",
      runbook: "review_classify_summarize",
      finalAnswer: "reviewed current changes",
      verdictExpected: "success",
    }),
    scenario({
      id: "intent-trace",
      category: "intent_runbook",
      prompt: "trace input to shell exec",
      runbook: "trace_source_to_sink",
      finalAnswer: "trace complete",
      stages: stages({ security_proof_checked: "pending" }),
      verdictExpected: "partial",
    }),
    scenario({
      id: "intent-run-tests",
      category: "intent_runbook",
      prompt: "run tests",
      runbook: "validate_only",
      finalAnswer: "validated",
      stages: stages({
        validation_planned: "passed",
        validation_executed: "pending",
      }),
      verdictExpected: "needs_validation",
    }),
    scenario({
      id: "intent-evidence",
      category: "intent_runbook",
      prompt: "generate evidence pack",
      runbook: "evidence_only",
      finalAnswer: "evidence complete",
      stages: stages({ evidence_attached: "pending" }),
      evidenceAttached: false,
      verdictExpected: "needs_evidence",
    }),
  ];
}

function scenario(input: {
  id: string;
  name?: string;
  category: WorkEngineBenchmarkScenario["category"];
  prompt: string;
  runbook: WorkPlan["runbook"];
  risk?: WorkPlan["risk"];
  fallbackCommand?: string | null;
  finalAnswer: string;
  stages?: WorkStage[];
  toolExecutions?: ToolExecutionRecord[];
  evidenceAttached?: boolean;
  verdictExpected: WorkEngineBenchmarkScenario["verdictExpected"];
  expectedDowngrades?: string[];
  expectEvidenceAccepted?: boolean;
  expectValidationAccepted?: boolean;
  expectSecurityProofAccepted?: boolean;
  expectPrivacyAccepted?: boolean;
}): WorkEngineBenchmarkScenario {
  const intentExpected = expectedIntent(input.prompt);
  const workPlan = makeWorkPlan(
    input.runbook,
    input.prompt,
    input.risk,
    input.fallbackCommand,
  );
  return {
    id: input.id,
    name: input.name ?? input.id.replace(/-/g, " "),
    category: input.category,
    prompt: input.prompt,
    workPlan,
    stages: input.stages ?? stages({}),
    toolExecutions: input.toolExecutions ?? [],
    finalAnswer: input.finalAnswer,
    evidenceAttached: input.evidenceAttached ?? true,
    intentExpected,
    runbookExpected: input.runbook,
    verdictExpected: input.verdictExpected,
    expectedDowngrades: input.expectedDowngrades,
    expectEvidenceAccepted: input.expectEvidenceAccepted,
    expectValidationAccepted: input.expectValidationAccepted,
    expectSecurityProofAccepted: input.expectSecurityProofAccepted,
    expectPrivacyAccepted: input.expectPrivacyAccepted,
  };
}

function makeWorkPlan(
  runbook: WorkPlan["runbook"],
  prompt: string,
  risk: WorkPlan["risk"] = "medium",
  fallbackCommand: string | null = null,
): WorkPlan {
  return {
    id: `work-plan-${runbook}`,
    intent: expectedIntent(prompt),
    risk,
    objective: prompt,
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
      fallbackCommand,
      reason: "benchmark",
    },
    privacyPlan: {
      requireSanitization:
        runbook !== "answer_from_context" || prompt !== "hello",
      blockIfP0Unsanitized: true,
      includeRepoContext: prompt !== "hello",
      includeToolOutput: runbook !== "answer_from_context",
      reason: "benchmark",
    },
    evidencePlan: {
      required: [
        "patch_test_verify",
        "audit_reproduce_remediate",
        "validate_only",
        "evidence_only",
      ].includes(runbook),
      expectedArtifacts: [],
      requiredClaims: [],
    },
    stopConditions: [],
  };
}

function stages(
  overrides: Partial<Record<WorkStage["id"], WorkStage["status"]>>,
): WorkStage[] {
  return STAGE_IDS.map((id) => ({
    id,
    status:
      overrides[id] ??
      (id === "context_compiled" ||
      id === "files_inspected" ||
      id === "patch_attempted" ||
      id === "validation_planned" ||
      id === "validation_executed" ||
      id === "failure_memory_checked" ||
      id === "privacy_preflight_passed" ||
      id === "evidence_attached"
        ? "passed"
        : "skipped"),
    source: "runtime",
    reason: "benchmark",
    relatedToolEventIds: [],
  }));
}

function tool(
  toolName: string,
  output: string,
  args: Record<string, unknown> = {},
): ToolExecutionRecord {
  return { toolName, args, output };
}

function expectedIntent(prompt: string): WorkPlan["intent"] {
  if (/review current changes/i.test(prompt)) return "review_changes";
  if (/trace/i.test(prompt)) return "trace_issue";
  if (/run tests/i.test(prompt)) return "validate";
  if (/evidence/i.test(prompt)) return "generate_evidence";
  if (/fix/i.test(prompt)) return "patch";
  if (/security|vulnerable|ssrf|rce/i.test(prompt)) return "security_review";
  if (/what|inspect/i.test(prompt)) return "inspect";
  return "answer";
}
