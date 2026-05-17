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
  | "privacy_preflight_passed"
  | "evidence_attached";

export type WorkStageStatus = "pending" | "passed" | "skipped" | "failed" | "blocked";
export type WorkStageSource = "runtime" | "deterministic" | "model_claim";

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
}): WorkStage[] {
  const stages = createInitialWorkStages();
  pass(stages, "context_compiled", "deterministic", "WorkPlan and working set compiled.", ["step-work-engine", "step-working-set"]);

  const toolNames = new Set(input.toolExecutions.map((execution) => execution.toolName));
  const eventIdsByTool = buildEventIdsByTool(input.events);

  if (hasAny(toolNames, FILE_INSPECTION_TOOLS) || input.workPlan.workingSet.primaryFiles.length > 0) {
    pass(stages, "files_inspected", "runtime", "Relevant file context exists from working set or inspection tool.", idsFor(eventIdsByTool, FILE_INSPECTION_TOOLS));
  }

  if (hasAny(toolNames, PATCH_TOOLS)) {
    pass(stages, "patch_attempted", "runtime", "Patch/edit tool ran.", idsFor(eventIdsByTool, PATCH_TOOLS));
  } else if (input.noPatchNeeded) {
    skip(stages, "patch_attempted", "deterministic", "Run explicitly concluded no patch was needed.");
  }

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

  if (hasAny(toolNames, FAILURE_MEMORY_TOOLS) || input.workPlan.workingSet.knownFailures.length > 0) {
    pass(stages, "failure_memory_checked", "runtime", "Failure memory checked or injected from working set.", idsFor(eventIdsByTool, FAILURE_MEMORY_TOOLS));
  }

  if (input.workPlan.runbook !== "audit_reproduce_remediate" && input.workPlan.runbook !== "trace_source_to_sink") {
    skip(stages, "security_proof_checked", "deterministic", "Security proof not required for this runbook.");
  } else if (hasAny(toolNames, SECURITY_PROOF_TOOLS)) {
    pass(stages, "security_proof_checked", "runtime", "Security proof/revalidation tool ran.", idsFor(eventIdsByTool, SECURITY_PROOF_TOOLS));
  }

  if (input.privacyBlocked) {
    block(stages, "privacy_preflight_passed", "deterministic", "Privacy Sentinel blocked outbound context.");
  } else {
    pass(stages, "privacy_preflight_passed", "deterministic", "Privacy preflight did not block this run.", ["step-privacy-preflight"]);
  }

  if (input.evidenceAttached || hasAny(toolNames, EVIDENCE_TOOLS)) {
    pass(stages, "evidence_attached", "runtime", "Evidence Pack attached or evidence tool ran.", idsFor(eventIdsByTool, EVIDENCE_TOOLS));
  }

  return stages;
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

function toolFailed(output: unknown) {
  return /(?:^|\b)(failed|error|exit code [1-9]|not ok|blocked)\b/i.test(String(output ?? ""));
}
