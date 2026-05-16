import { finalizeWorkRun } from "../finalizer";
import type { WorkStage } from "../stages";
import type {
  WorkEngineBenchmarkResult,
  WorkEngineBenchmarkScenario,
  WorkEngineBenchmarkSummary,
} from "./benchmark-types";

export function evaluateScenario(scenario: WorkEngineBenchmarkScenario): WorkEngineBenchmarkResult {
  const finalization = finalizeWorkRun({
    workPlan: scenario.workPlan,
    stages: scenario.stages,
    toolExecutions: scenario.toolExecutions,
    content: scenario.finalAnswer,
    evidenceAttached: scenario.evidenceAttached,
  });
  const observed = {
    intent: scenario.workPlan.intent,
    runbook: scenario.workPlan.runbook,
    verdict: finalization.verdict,
    downgradedClaims: collectDowngrades(scenario.finalAnswer, finalization.content, scenario.expectedDowngrades),
    requiredStagesMissing: collectMissingStages(scenario.stages),
    evidenceAccepted: stageAccepted(scenario.stages, "evidence_attached") && scenario.evidenceAttached,
    validationAccepted:
      stageAccepted(scenario.stages, "validation_executed") &&
      !validationFailed(scenario) &&
      !fallbackMissing(scenario),
    securityProofAccepted: stageAccepted(scenario.stages, "security_proof_checked"),
    privacyAccepted: stageAccepted(scenario.stages, "privacy_preflight_passed", true),
  };

  const failures: string[] = [];
  if (observed.intent !== scenario.intentExpected) failures.push(`intent ${observed.intent} !== ${scenario.intentExpected}`);
  if (observed.runbook !== scenario.runbookExpected) failures.push(`runbook ${observed.runbook} !== ${scenario.runbookExpected}`);
  if (observed.verdict !== scenario.verdictExpected) failures.push(`verdict ${observed.verdict} !== ${scenario.verdictExpected}`);
  for (const expected of scenario.expectedDowngrades ?? []) {
    if (!finalization.content.includes(expected)) failures.push(`missing downgrade: ${expected}`);
  }
  if (typeof scenario.expectEvidenceAccepted === "boolean" && observed.evidenceAccepted !== scenario.expectEvidenceAccepted) {
    failures.push(`evidenceAccepted ${observed.evidenceAccepted} !== ${scenario.expectEvidenceAccepted}`);
  }
  if (typeof scenario.expectValidationAccepted === "boolean" && observed.validationAccepted !== scenario.expectValidationAccepted) {
    failures.push(`validationAccepted ${observed.validationAccepted} !== ${scenario.expectValidationAccepted}`);
  }
  if (typeof scenario.expectSecurityProofAccepted === "boolean" && observed.securityProofAccepted !== scenario.expectSecurityProofAccepted) {
    failures.push(`securityProofAccepted ${observed.securityProofAccepted} !== ${scenario.expectSecurityProofAccepted}`);
  }
  if (typeof scenario.expectPrivacyAccepted === "boolean" && observed.privacyAccepted !== scenario.expectPrivacyAccepted) {
    failures.push(`privacyAccepted ${observed.privacyAccepted} !== ${scenario.expectPrivacyAccepted}`);
  }
  addRegressionFailures(scenario, finalization.content, observed, failures);

  return {
    id: scenario.id,
    name: scenario.name,
    intentExpected: scenario.intentExpected,
    runbookExpected: scenario.runbookExpected,
    verdictExpected: scenario.verdictExpected,
    passed: failures.length === 0,
    failures,
    observed,
  };
}

export function summarizeBenchmark(
  scenarios: WorkEngineBenchmarkScenario[],
  results: WorkEngineBenchmarkResult[],
): WorkEngineBenchmarkSummary {
  const byCategory: WorkEngineBenchmarkSummary["byCategory"] = {};
  for (const scenario of scenarios) {
    const bucket = byCategory[scenario.category] ?? { total: 0, passed: 0, passRate: 0 };
    bucket.total += 1;
    if (results.find((result) => result.id === scenario.id)?.passed) bucket.passed += 1;
    bucket.passRate = bucket.total === 0 ? 0 : bucket.passed / bucket.total;
    byCategory[scenario.category] = bucket;
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    byCategory,
  };
}

function collectDowngrades(original: string, finalContent: string, expected?: string[]) {
  const downgraded: string[] = [];
  for (const text of expected ?? []) {
    if (finalContent.includes(text)) downgraded.push(text);
  }
  if (original !== finalContent && downgraded.length === 0) {
    downgraded.push("final answer changed");
  }
  return downgraded;
}

function collectMissingStages(stages: WorkStage[]) {
  return stages
    .filter((stage) => stage.status === "pending" || stage.status === "failed" || stage.status === "blocked")
    .map((stage) => stage.id);
}

function stageAccepted(stages: WorkStage[], id: WorkStage["id"], allowSkipped = false) {
  const stage = stages.find((item) => item.id === id);
  if (!stage) return false;
  if (stage.source === "model_claim") return false;
  return stage.status === "passed" || (allowSkipped && stage.status === "skipped");
}

function validationFailed(scenario: WorkEngineBenchmarkScenario) {
  return scenario.toolExecutions.some((execution) =>
    ["run_tests", "sandbox_run"].includes(execution.toolName) &&
    /failed|timed out|no validation profile|error/i.test(execution.output),
  );
}

function addRegressionFailures(
  scenario: WorkEngineBenchmarkScenario,
  finalContent: string,
  observed: WorkEngineBenchmarkResult["observed"],
  failures: string[],
) {
  if (scenario.id.includes("fallback-missing") && observed.verdict === "success") {
    failures.push("high-risk fallback bypass returned success");
  }
  if (scenario.stages.some((stage) => stage.source === "model_claim" && stage.status === "passed") && observed.verdict === "success") {
    failures.push("model_claim stage satisfied hard runtime requirement");
  }
  if (/confirmed vulnerability|RCE confirmed|source-to-sink confirmed/i.test(finalContent) && !observed.securityProofAccepted) {
    failures.push("unsupported vulnerability wording survived without proof");
  }
  if (/Evidence attached/i.test(scenario.finalAnswer) && !scenario.evidenceAttached && observed.evidenceAccepted) {
    failures.push("evidence prose satisfied evidence");
  }
  const answerText = finalContent.split(/\nWarnings:\n/)[0] ?? finalContent;
  if (validationFailed(scenario) && /\b(passed|ready)\b/i.test(answerText) && !/\bnot (?:yet )?ready\b/i.test(answerText)) {
    failures.push("validation failure allowed pass/ready wording");
  }
  if (validationFailed(scenario) && /\bvalidated\b/i.test(answerText) && !/\bnot yet validated\b/i.test(answerText)) {
    failures.push("validation failure allowed pass/ready wording");
  }
}

function fallbackMissing(scenario: WorkEngineBenchmarkScenario) {
  const fallback = scenario.workPlan.validationPlan.fallbackCommand;
  if (scenario.workPlan.risk !== "high" || !fallback) return false;
  return !scenario.toolExecutions.some((execution) => {
    const haystack = `${JSON.stringify(execution.args)}\n${execution.output}`;
    return haystack.includes(fallback);
  });
}
