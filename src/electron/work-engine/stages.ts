import type { ToolExecutionRecord } from "../evidence-pack";
import type { ToolEvent } from "../../contracts/chat";
import type { WorkPlan } from "./types";

export type WorkStageId =
  | "context_compiled"
  | "files_inspected"
  | "patch_attempted"
  | "validation_planned"
  | "validation_executed"
  | "failure_memory_checked"
  | "security_proof_checked"
  | "preventive_risk_classified"
  | "preventive_controls_planned"
  | "preventive_validation_warned"
  | "privacy_preflight_passed"
  | "evidence_attached";

export type WorkStageStatus =
  | "pending"
  | "passed"
  | "skipped"
  | "failed"
  | "blocked"
  /** Pre-execution: patch/validation evidence is not required for this phase. */
  | "not_applicable_for_phase";
export type WorkStageSource = "runtime" | "deterministic" | "model_claim" | "phase";

export interface WorkStage {
  id: WorkStageId;
  status: WorkStageStatus;
  source: WorkStageSource;
  reason: string;
  relatedToolEventIds: string[];
}

const STAGE_IDS: WorkStageId[] = [
  "context_compiled",
  "files_inspected",
  "patch_attempted",
  "validation_planned",
  "validation_executed",
  "failure_memory_checked",
  "security_proof_checked",
  "preventive_risk_classified",
  "preventive_controls_planned",
  "preventive_validation_warned",
  "privacy_preflight_passed",
  "evidence_attached",
];

const FILE_INSPECTION_TOOLS = new Set(["read", "read_many", "rg", "ast_grep", "repo_graph"]);
const PATCH_TOOLS = new Set(["file_editor", "mutation"]);
const VALIDATION_PLAN_TOOLS = new Set(["plan_validation"]);
const VALIDATION_EXEC_TOOLS = new Set(["run_tests", "sandbox_run"]);
const FAILURE_MEMORY_TOOLS = new Set(["find_similar_failures"]);
const SECURITY_PROOF_TOOLS = new Set(["security_path_trace", "candidate_revalidator"]);
const EVIDENCE_TOOLS = new Set(["evidence_pack"]);

export function createInitialWorkStages(): WorkStage[] {
  return STAGE_IDS.map((id) => ({
    id,
    status: "pending",
    source: "deterministic",
    reason: "Awaiting runtime evidence.",
    relatedToolEventIds: [],
  }));
}

export function deriveWorkStages(input: {
  workPlan: WorkPlan;
  events: ToolEvent[];
  toolExecutions: ToolExecutionRecord[];
  privacyBlocked: boolean;
  evidenceAttached: boolean;
  noPatchNeeded: boolean;
  /** When true, patch/validation stages are N/A — not skipped/waived/failed. */
  planningPhase?: boolean;
}): WorkStage[] {
  const stages = createInitialWorkStages();
  pass(stages, "context_compiled", "deterministic", "WorkPlan and working set compiled.", ["step-work-engine", "step-working-set"]);

  const toolNames = new Set(input.toolExecutions.map((execution) => execution.toolName));
  const eventIdsByTool = buildEventIdsByTool(input.events);
  const planningPhase = Boolean(input.planningPhase);

  if (hasAny(toolNames, FILE_INSPECTION_TOOLS) || input.workPlan.workingSet.primaryFiles.length > 0) {
    pass(stages, "files_inspected", "runtime", "Relevant file context exists from working set or inspection tool.", idsFor(eventIdsByTool, FILE_INSPECTION_TOOLS));
  }

  if (planningPhase) {
    set(
      stages,
      "patch_attempted",
      "not_applicable_for_phase",
      "phase",
      "Patch evidence is not applicable before plan approval.",
      [],
    );
    set(
      stages,
      "validation_planned",
      "not_applicable_for_phase",
      "phase",
      "Validation planning is not applicable before execution.",
      [],
    );
    set(
      stages,
      "validation_executed",
      "not_applicable_for_phase",
      "phase",
      "Validation execution is not applicable before execution.",
      [],
    );
  } else if (hasAny(toolNames, PATCH_TOOLS)) {
    pass(stages, "patch_attempted", "runtime", "Patch/edit tool ran.", idsFor(eventIdsByTool, PATCH_TOOLS));
  } else if (input.noPatchNeeded) {
    skip(stages, "patch_attempted", "deterministic", "Run explicitly concluded no patch was needed.");
  }

  if (!planningPhase) {
  if (hasAny(toolNames, VALIDATION_PLAN_TOOLS)) {
    pass(stages, "validation_planned", "runtime", "Validation plan tool ran.", idsFor(eventIdsByTool, VALIDATION_PLAN_TOOLS));
  } else if (!input.workPlan.validationPlan.required) {
    skip(stages, "validation_planned", "deterministic", "Validation not required for this WorkPlan.");
  }

  if (hasAny(toolNames, VALIDATION_EXEC_TOOLS)) {
    const failed = input.toolExecutions.some(
      (execution) => VALIDATION_EXEC_TOOLS.has(execution.toolName) && toolFailed(execution.output),
    );
    set(stages, "validation_executed", failed ? "failed" : "passed", "runtime", failed ? "Validation command failed." : "Validation command ran.", idsFor(eventIdsByTool, VALIDATION_EXEC_TOOLS));
  } else if (!input.workPlan.validationPlan.required) {
    skip(stages, "validation_executed", "deterministic", "Validation not required for this WorkPlan.");
  } else if (input.privacyBlocked) {
    block(stages, "validation_executed", "deterministic", "Cloud context was blocked before validation orchestration.");
  }
  }

  if (hasAny(toolNames, FAILURE_MEMORY_TOOLS) || input.workPlan.workingSet.knownFailures.length > 0) {
    pass(stages, "failure_memory_checked", "runtime", "Failure memory checked or injected from working set.", idsFor(eventIdsByTool, FAILURE_MEMORY_TOOLS));
  }

  if (input.workPlan.runbook !== "audit_reproduce_remediate" && input.workPlan.runbook !== "trace_source_to_sink") {
    skip(stages, "security_proof_checked", "deterministic", "Security proof not required for this runbook.");
  } else if (hasAny(toolNames, SECURITY_PROOF_TOOLS)) {
    pass(stages, "security_proof_checked", "runtime", "Security proof/revalidation tool ran.", idsFor(eventIdsByTool, SECURITY_PROOF_TOOLS));
  }

  derivePreventiveStages(stages, input.workPlan, toolNames, eventIdsByTool);

  if (input.privacyBlocked) {
    block(stages, "privacy_preflight_passed", "deterministic", "Privacy Sentinel blocked outbound context.");
  } else {
    pass(stages, "privacy_preflight_passed", "deterministic", "Privacy preflight did not block this run.", ["step-privacy-preflight"]);
  }

  if (input.evidenceAttached || hasAny(toolNames, EVIDENCE_TOOLS)) {
    pass(stages, "evidence_attached", "runtime", "Evidence Pack attached or evidence tool ran.", idsFor(eventIdsByTool, EVIDENCE_TOOLS));
  } else if (!input.workPlan.evidencePlan.required) {
    skip(stages, "evidence_attached", "deterministic", "No evidence artifact required for read-only review with no changes.");
  }

  return stages;
}

export function shouldEmitPreventiveWarning(workPlan: WorkPlan, toolExecutions: ToolExecutionRecord[]) {
  if (!workPlan.preventivePlan.enabled || workPlan.preventivePlan.strictness !== "warn") return false;
  if (workPlan.workingSet.sensitiveSurfaces.length === 0 && workPlan.preventivePlan.riskAreas.length === 0) return false;
  const toolNames = new Set(toolExecutions.map((execution) => execution.toolName));
  const hasValidation = hasAny(toolNames, VALIDATION_EXEC_TOOLS);
  const needsSecurityProof = workPlan.runbook === "audit_reproduce_remediate" || workPlan.runbook === "trace_source_to_sink";
  const hasSecurityProof = hasAny(toolNames, SECURITY_PROOF_TOOLS);
  return !hasValidation || (needsSecurityProof && !hasSecurityProof);
}

export function preventiveWarningDetail(workPlan: WorkPlan) {
  const checks = workPlan.preventivePlan.requiredChecks.length > 0
    ? workPlan.preventivePlan.requiredChecks.join(" ")
    : "Review secure defaults before final confidence claims.";
  return `Preventive Guard warning only: sensitive or high-risk workflow lacks full validation/proof evidence. ${checks}`;
}

function derivePreventiveStages(
  stages: WorkStage[],
  workPlan: WorkPlan,
  toolNames: Set<string>,
  eventIdsByTool: Map<string, string[]>,
) {
  if (!workPlan.preventivePlan.enabled) {
    skip(stages, "preventive_risk_classified", "deterministic", workPlan.preventivePlan.reason);
    skip(stages, "preventive_controls_planned", "deterministic", "Preventive Guard disabled for low-risk workflow.");
    skip(stages, "preventive_validation_warned", "deterministic", "Preventive Guard warning not needed.");
    return;
  }

  pass(
    stages,
    "preventive_risk_classified",
    "deterministic",
    `Preventive risk areas: ${workPlan.preventivePlan.riskAreas.join(", ") || "unknown"}.`,
  );

  if (workPlan.preventivePlan.recommendedControls.length > 0) {
    pass(stages, "preventive_controls_planned", "deterministic", "Preventive controls planned.");
  } else {
    skip(stages, "preventive_controls_planned", "deterministic", "No specific preventive controls identified.");
  }

  const hasValidation = hasAny(toolNames, VALIDATION_EXEC_TOOLS);
  const needsSecurityProof = workPlan.runbook === "audit_reproduce_remediate" || workPlan.runbook === "trace_source_to_sink";
  const hasSecurityProof = hasAny(toolNames, SECURITY_PROOF_TOOLS);
  if (hasValidation && (!needsSecurityProof || hasSecurityProof)) {
    pass(
      stages,
      "preventive_validation_warned",
      "runtime",
      "Preventive validation/proof evidence exists.",
      [...idsFor(eventIdsByTool, VALIDATION_EXEC_TOOLS), ...idsFor(eventIdsByTool, SECURITY_PROOF_TOOLS)],
    );
  } else {
    skip(stages, "preventive_validation_warned", "deterministic", "Warning-only: missing validation or proof evidence must be surfaced, not blocked.");
  }
}

function set(stages: WorkStage[], id: WorkStageId, status: WorkStageStatus, source: WorkStageSource, reason: string, relatedToolEventIds: string[] = []) {
  const stage = stages.find((item) => item.id === id);
  if (!stage) return;
  stage.status = status;
  stage.source = source;
  stage.reason = reason;
  stage.relatedToolEventIds = relatedToolEventIds;
}

function pass(stages: WorkStage[], id: WorkStageId, source: WorkStageSource, reason: string, relatedToolEventIds: string[] = []) {
  set(stages, id, "passed", source, reason, relatedToolEventIds);
}

function skip(stages: WorkStage[], id: WorkStageId, source: WorkStageSource, reason: string) {
  set(stages, id, "skipped", source, reason);
}

function block(stages: WorkStage[], id: WorkStageId, source: WorkStageSource, reason: string) {
  set(stages, id, "blocked", source, reason);
}

function hasAny(toolNames: Set<string>, expected: Set<string>) {
  return [...expected].some((tool) => toolNames.has(tool));
}

function buildEventIdsByTool(events: ToolEvent[]) {
  const result = new Map<string, string[]>();
  for (const event of events) {
    const match = event.id.match(/^tool-\d+-\d+-(.+)$/);
    if (!match) continue;
    const ids = result.get(match[1]) ?? [];
    ids.push(event.id);
    result.set(match[1], ids);
  }
  return result;
}

function idsFor(eventIdsByTool: Map<string, string[]>, tools: Set<string>) {
  return [...tools].flatMap((tool) => eventIdsByTool.get(tool) ?? []);
}

/**
 * Strips the "Known similar failure" preamble that sandbox_run prepends so
 * it never poisons Status/Exit-code detection or the fallback regex.
 * The preamble ends at the first blank line that precedes the structured report.
 */
function stripSandboxPreamble(text: string): string {
  // The structured report always starts with "Sandbox Report:"
  const reportStart = text.indexOf("Sandbox Report:");
  return reportStart > 0 ? text.slice(reportStart) : text;
}

function toolFailed(output: unknown) {
  const raw = String(output ?? "");
  // Strip priorWarning preamble so structured-report lines are unambiguous.
  const text = stripSandboxPreamble(raw);

  // Structured sandbox report: Status line takes priority.
  const sandboxStatus = text.match(/^Status:\s*(PASSED|READY|FAILED|TIMED_OUT|START_FAILED|TERMINATED)$/im)?.[1];
  if (sandboxStatus) {
    return sandboxStatus !== "PASSED" && sandboxStatus !== "READY";
  }

  // Structured sandbox report: explicit exit code.
  const sandboxExitCode = text.match(/^Exit code:\s*(-?\d+)$/im)?.[1];
  if (sandboxExitCode) {
    return Number(sandboxExitCode) !== 0;
  }

  // JSON-returning tools (non-sandbox).
  try {
    const parsed = JSON.parse(text) as { status?: unknown; exitCode?: unknown; error?: unknown; verdict?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return true;
    }
    if (typeof parsed.exitCode === "number") {
      return parsed.exitCode !== 0;
    }
    if (parsed.status === "success" || parsed.status === "passed" || parsed.status === "ready") {
      return false;
    }
    if (parsed.status === "failed" || parsed.status === "blocked" || parsed.status === "timed_out") {
      return true;
    }
    // verdict field (some tools emit this instead of status).
    if (parsed.verdict === "success" || parsed.verdict === "passed") {
      return false;
    }
    if (parsed.verdict === "failed" || parsed.verdict === "blocked") {
      return true;
    }
  } catch {
    // Fall through to legacy text heuristic for unstructured tools.
  }

  // Fallback heuristic on the preamble-stripped text.
  // Use \bfailed\b (verb) — does NOT match the noun "failure".
  return /(?:^|\b)(failed|error|exit code [1-9]|not ok|blocked)\b/i.test(text);
}
