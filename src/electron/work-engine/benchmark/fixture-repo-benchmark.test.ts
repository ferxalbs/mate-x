import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import type { ToolExecutionRecord } from "../../evidence-pack";
import { classifyWorkIntent } from "../intent";
import { finalizeWorkRun } from "../finalizer";
import { buildPrivacyPreflightResult } from "../privacy-preflight-core";
import { resolveWorkRunbook } from "../runbook-resolver";
import type { WorkStage } from "../stages";
import type { WorkPlan, WorkRunbook } from "../types";
import { runWorkEngineBenchmark } from "./benchmark-runner";
import { formatWorkEngineBenchmarkSummary } from "./benchmark-summary-reporter";
import { loadFixtureRepo } from "./fixture-loader";

const execFileAsync = promisify(execFile);

interface FixtureScenario {
  fixture: string;
  prompt: string;
  expectedRunbook: WorkRunbook;
  expectedVerdict: ReturnType<typeof finalizeWorkRun>["verdict"];
  finalAnswer: string;
  commands?: Array<{ script: string; stage: "validation_executed" | "validation_planned" }>;
  stages?: Partial<Record<WorkStage["id"], WorkStage["status"]>>;
  risk?: WorkPlan["risk"];
  fallbackCommand?: string | null;
  evidenceAttached?: boolean;
  toolExecutions?: ToolExecutionRecord[];
}

const scenarios: FixtureScenario[] = [
  {
    fixture: "clean-typescript-lib",
    prompt: "review current changes",
    expectedRunbook: "review_classify_summarize",
    expectedVerdict: "success",
    finalAnswer: "Reviewed current changes. No proven issue.",
    commands: [{ script: "test", stage: "validation_executed" }],
    stages: { validation_planned: "skipped", evidence_attached: "skipped" },
    evidenceAttached: false,
  },
  {
    fixture: "clean-typescript-lib",
    prompt: "what does this library do?",
    expectedRunbook: "inspect_explain",
    expectedVerdict: "success",
    finalAnswer: "It exports a small add function.",
    stages: { validation_planned: "skipped", validation_executed: "skipped", evidence_attached: "skipped" },
    evidenceAttached: false,
  },
  {
    fixture: "vulnerable-command-exec",
    prompt: "trace user input to shell execution",
    expectedRunbook: "trace_source_to_sink",
    expectedVerdict: "success",
    finalAnswer: "Confirmed issue with source, path, sink, weak mitigation, and exploitability evidence.",
    stages: { security_proof_checked: "passed", evidence_attached: "passed" },
    toolExecutions: [
      tool("security_path_trace", "source=query.host path=route->runLookup sink=exec mitigation=missing allowlist exploitability=user controls host"),
      tool("evidence_pack", "runtime trace evidence"),
    ],
  },
  {
    fixture: "vulnerable-command-exec",
    prompt: "is RCE confirmed here?",
    expectedRunbook: "audit_reproduce_remediate",
    expectedVerdict: "partial",
    finalAnswer: "RCE confirmed.",
    stages: { security_proof_checked: "pending", evidence_attached: "passed" },
    toolExecutions: [tool("attack_surface_scan", "candidate command execution")],
  },
  {
    fixture: "env-secret-leak",
    prompt: "generate evidence pack for env leak",
    expectedRunbook: "evidence_only",
    expectedVerdict: "blocked",
    finalAnswer: "Evidence attached.",
    stages: { privacy_preflight_passed: "blocked", evidence_attached: "pending" },
    evidenceAttached: false,
  },
  {
    fixture: "env-secret-leak",
    prompt: "what sensitive data is protected?",
    expectedRunbook: "inspect_explain",
    expectedVerdict: "success",
    finalAnswer: "Sensitive value was redacted before context use.",
    stages: {
      validation_planned: "skipped",
      validation_executed: "skipped",
      privacy_preflight_passed: "passed",
      evidence_attached: "skipped",
    },
    evidenceAttached: false,
  },
  {
    fixture: "patch-validation-fail",
    prompt: "fix the failing test",
    expectedRunbook: "patch_test_verify",
    expectedVerdict: "failed",
    finalAnswer: "fixed",
    commands: [{ script: "test", stage: "validation_executed" }],
    stages: { validation_planned: "passed", evidence_attached: "passed" },
    toolExecutions: [tool("file_editor", "patched src/math.ts")],
  },
  {
    fixture: "patch-validation-fail",
    prompt: "run tests",
    expectedRunbook: "validate_only",
    expectedVerdict: "failed",
    finalAnswer: "validated",
    commands: [{ script: "test", stage: "validation_executed" }],
    stages: { validation_planned: "passed" },
  },
  {
    fixture: "high-risk-package-change",
    prompt: "update dependency",
    expectedRunbook: "patch_test_verify",
    expectedVerdict: "needs_validation",
    finalAnswer: "safe to merge",
    risk: "high",
    fallbackCommand: "bun run build",
    commands: [{ script: "test", stage: "validation_executed" }],
    stages: { validation_planned: "passed", evidence_attached: "passed" },
    toolExecutions: [tool("file_editor", "package.json changed"), tool("verify_validation_persistence", "persisted")],
  },
  {
    fixture: "high-risk-package-change",
    prompt: "update dependency with full validation",
    expectedRunbook: "patch_test_verify",
    expectedVerdict: "success",
    finalAnswer: "Patched and validated.",
    risk: "high",
    fallbackCommand: "bun run build",
    commands: [
      { script: "test", stage: "validation_executed" },
      { script: "build", stage: "validation_executed" },
    ],
    stages: { validation_planned: "passed", evidence_attached: "passed" },
    toolExecutions: [tool("file_editor", "package.json changed"), tool("verify_validation_persistence", "persisted")],
  },
];

describe("Work Engine Fixture Repo Benchmark v1", () => {
  test("fixture scenarios produce deterministic verdicts", async () => {
    const results = [];
    for (const scenario of scenarios) {
      const result = await runFixtureScenario(scenario);
      results.push(result);
      assert.equal(result.passed, true, JSON.stringify(result, null, 2));
    }

    console.log(formatSummary(results));
    console.log(
      formatWorkEngineBenchmarkSummary({
        deterministicSummary: runWorkEngineBenchmark().summary,
        adversarialTestCount: 41,
        fixtureScenarioCount: results.length,
        categoriesCovered: [
          "patch_validation",
          "security",
          "evidence",
          "privacy",
          "failure_memory",
          "intent_runbook",
          "fixture_repo",
        ],
        failedScenarioIds: results
          .filter((result) => !result.passed)
          .map((result) => `${result.fixture}:${result.prompt}`),
      }),
    );
    assert.equal(new Set(results.map((result) => result.fixture)).size >= 5, true);
    assert.equal(results.length >= 10, true);
  });
});

async function runFixtureScenario(scenario: FixtureScenario) {
  const fixture = await loadFixtureRepo(scenario.fixture);
  try {
    const files = await listFixtureFiles(fixture.workspacePath);
    const commandExecutions: ToolExecutionRecord[] = [];
    const commandStageStatus: Partial<Record<WorkStage["id"], WorkStage["status"]>> = {};
    for (const command of scenario.commands ?? []) {
      const execution = await runScript(fixture.workspacePath, command.script);
      commandExecutions.push(execution);
      commandStageStatus[command.stage] = /failed|timed out|error/i.test(execution.output) ? "failed" : "passed";
    }
    const privacyStatus = scenario.stages?.privacy_preflight_passed ?? (scenario.fixture === "env-secret-leak" ? privacyDecisionStatus() : "passed");
    const workPlan = makeWorkPlan(scenario, files);
    const stages = makeStages({
      ...commandStageStatus,
      ...scenario.stages,
      privacy_preflight_passed: privacyStatus,
    });
    const finalization = finalizeWorkRun({
      workPlan,
      stages,
      toolExecutions: [...(scenario.toolExecutions ?? []), ...commandExecutions],
      content: scenario.finalAnswer,
      evidenceAttached: scenario.evidenceAttached ?? true,
    });
    const passed =
      workPlan.runbook === scenario.expectedRunbook &&
      finalization.verdict === scenario.expectedVerdict &&
      !rawSecretLeaked(scenario, finalization.content);

    return {
      fixture: scenario.fixture,
      prompt: scenario.prompt,
      expectedRunbook: scenario.expectedRunbook,
      expectedVerdict: scenario.expectedVerdict,
      observedVerdict: finalization.verdict,
      passed,
      missingStages: stages
        .filter((stage) => ["pending", "failed", "blocked"].includes(stage.status))
        .map((stage) => stage.id),
    };
  } finally {
    await fixture.cleanup();
  }
}

async function runScript(workspacePath: string, script: string): Promise<ToolExecutionRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const result = await execFileAsync("bun", ["run", script], {
      cwd: workspacePath,
      signal: controller.signal,
      timeout: 5000,
      env: { ...process.env, BUN_CONFIG_NO_INSTALL: "1" },
    });
    return tool("run_tests", `${result.stdout}\n${result.stderr}`, { command: `bun run ${script}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return tool("run_tests", `failed: ${message}`, { command: `bun run ${script}` });
  } finally {
    clearTimeout(timeout);
  }
}

async function listFixtureFiles(workspacePath: string) {
  const result: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(workspacePath, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        result.push(relative);
      }
    }
  }
  await walk(workspacePath);
  return result;
}

function makeWorkPlan(scenario: FixtureScenario, files: string[]): WorkPlan {
  const intent = classifyWorkIntent(scenario.prompt);
  const runbook = resolveWorkRunbook(intent, scenario.risk ?? "medium");
  return {
    id: `fixture-plan-${scenario.fixture}`,
    intent,
    risk: scenario.risk ?? "medium",
    objective: scenario.prompt,
    runbook,
    workingSet: {
      primaryFiles: files.filter((file) => file.startsWith("src/")),
      relatedFiles: [],
      relatedTests: files.filter((file) => file.includes("test")),
      changedFiles: scenario.fixture === "high-risk-package-change" ? ["package.json"] : [],
      impactedFiles: [],
      entrypoints: files.filter((file) => file.endsWith("server.ts") || file.endsWith("index.ts")),
      sensitiveSurfaces: scenario.fixture === "env-secret-leak" ? [{ kind: "env", files: [".env", "src/index.ts"], reason: "Reads and exposes env value." }] : [],
      relevantScripts: [
        { name: "test", command: "bun run test", reason: "fixture script" },
        { name: "build", command: "bun run build", reason: "fixture script" },
      ],
      knownFailures: scenario.fixture === "patch-validation-fail" ? [{ signature: "multiply fails", command: "bun run test", status: "open", lastSeenAt: "2026-05-15T00:00:00.000Z" }] : [],
    },
    validationPlan: {
      required: runbook === "patch_test_verify" || runbook === "validate_only",
      primaryCommand: "bun run test",
      fallbackCommand: scenario.fallbackCommand ?? null,
      reason: "fixture benchmark",
    },
    privacyPlan: {
      requireSanitization: scenario.fixture === "env-secret-leak",
      blockIfP0Unsanitized: true,
      includeRepoContext: true,
      includeToolOutput: true,
      reason: "fixture benchmark",
    },
    evidencePlan: {
      required: ["patch_test_verify", "audit_reproduce_remediate", "trace_source_to_sink", "validate_only", "evidence_only"].includes(runbook),
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
      id === "privacy_preflight_passed" ||
      id === "evidence_attached"
        ? "passed"
        : "skipped"),
    source: "runtime",
    reason: "fixture benchmark",
    relatedToolEventIds: [],
  }));
}

function privacyDecisionStatus() {
  const decision = buildPrivacyPreflightResult({
    blocked: true,
    reason: "Privacy Firewall outbound assertion failed.",
    totalSpans: 1,
    p0Count: 1,
  });
  return decision.status === "blocked" ? "blocked" : "passed";
}

function rawSecretLeaked(scenario: FixtureScenario, content: string) {
  return scenario.fixture === "env-secret-leak" && /ra-1234567890abcdef1234567890abcdef/.test(content);
}

function tool(toolName: string, output: string, args: Record<string, unknown> = {}): ToolExecutionRecord {
  return { toolName, args, output };
}

function formatSummary(results: Awaited<ReturnType<typeof runFixtureScenario>>[]) {
  return [
    "Work Engine Fixture Repo Benchmark v1",
    ...results.map(
      (result) =>
        `${result.passed ? "PASS" : "FAIL"} ${result.fixture} | ${result.prompt} | ${result.expectedRunbook} | expected=${result.expectedVerdict} observed=${result.observedVerdict} | missing=${result.missingStages.join(",") || "none"}`,
    ),
  ].join("\n");
}
