import fs from "node:fs";
import path from "node:path";

import type {
  EvidencePack,
  VerifiedTaskScore,
  VerifiedTaskScoreSignal,
} from "../contracts/chat";
import type { ToolExecutionRecord } from "./evidence-pack";

type SignalId = VerifiedTaskScoreSignal["id"];

interface ScoreInput {
  workspacePath: string;
  evidenceStatus: EvidencePack["status"];
  filesModified: NonNullable<EvidencePack["filesModified"]>;
  toolExecutions: ToolExecutionRecord[];
  reproduction?: EvidencePack["reproduction"];
  warnings?: string[];
  unresolvedRisks?: string[];
}

const weights: Record<SignalId, number> = {
  target_files_identified: 8,
  relevant_files_inspected: 10,
  patch_applied: 12,
  validation_command_selected: 8,
  validation_command_executed: 12,
  validation_passed: 16,
  reproduction_exists: 10,
  failure_context_recorded: 6,
  unresolved_risks_absent: 8,
  claimed_files_exist: 5,
  claimed_commands_ran: 5,
};

const labels: Record<SignalId, string> = {
  target_files_identified: "Target files identified",
  relevant_files_inspected: "Relevant files inspected",
  patch_applied: "Patch applied",
  validation_command_selected: "Validation command selected",
  validation_command_executed: "Validation command executed",
  validation_passed: "Validation passed",
  reproduction_exists: "Reproduction exists",
  failure_context_recorded: "Failure context recorded",
  unresolved_risks_absent: "No unresolved risks",
  claimed_files_exist: "Claimed files exist",
  claimed_commands_ran: "Claimed commands ran",
};

const fileInspectionTools = new Set(["read", "read_file", "grep_search", "file_search", "rg", "read_many"]);
const patchTools = new Set([
  "file_editor",
  "auto_patch",
  "apply_patch",
  "str_replace_editor",
  "edit_file",
  "write_file",
  "replace_range",
]);
const validationSelectionTools = new Set(["plan_validation", "detect_workspace_capabilities"]);
const validationExecutionTools = new Set(["run_tests", "sandbox_run"]);
const failureContextTools = new Set(["find_similar_failures", "record_failure"]);
const proofTools = new Set([
  "security_path_trace",
  "candidate_revalidator",
  "browser_prober",
  "deep_analysis_pipeline",
]);

export function computeVerifiedTaskScore(input: ScoreInput): VerifiedTaskScore {
  const inspectedPaths = extractInspectedPaths(input.toolExecutions);
  const modifiedPaths = input.filesModified.map((file) => file.path);
  const commandRecords = input.toolExecutions.map((execution) =>
    executionCommandText(execution),
  );
  const reproductionCommand = input.reproduction?.command?.trim();
  const reproductionLocation = input.reproduction?.location?.trim();

  const claimedFiles = [
    ...modifiedPaths,
    ...(reproductionLocation ? [reproductionLocation] : []),
  ].filter((value) => !value.includes("\n"));

  const claimedFilesExist =
    claimedFiles.length === 0 ||
    claimedFiles.every((claim) => pathExists(input.workspacePath, claim));

  const claimedCommandsRan =
    !reproductionCommand ||
    commandRecords.some((command) => command.includes(reproductionCommand));

  const validationExecutions = input.toolExecutions.filter((execution) =>
    validationExecutionTools.has(execution.toolName),
  );

  const hasProofSignal = input.toolExecutions.some(
    (execution) =>
      proofTools.has(execution.toolName) ||
      (execution.parsedOutput as any)?.hasStructuredEvidence === true ||
      (execution.parsedOutput as any)?.evidenceType,
  );

  const signals: VerifiedTaskScoreSignal[] = [
    signal(
      "target_files_identified",
      modifiedPaths.length > 0 || inspectedPaths.length > 0 || hasProofSignal,
      summarizeList(modifiedPaths.length > 0 ? modifiedPaths : inspectedPaths),
    ),
    signal(
      "relevant_files_inspected",
      inspectedPaths.length > 0 || hasProofSignal,
      summarizeList(inspectedPaths),
    ),
    signal(
      "patch_applied",
      input.filesModified.length > 0 ||
        input.toolExecutions.some((execution) => patchTools.has(execution.toolName)) ||
        (input.toolExecutions.some((e) => (e.parsedOutput as any)?.hasStructuredEvidence) && modifiedPaths.length > 0),
      summarizeList(modifiedPaths),
    ),
    signal(
      "validation_command_selected",
      input.toolExecutions.some((execution) =>
        validationSelectionTools.has(execution.toolName),
      ),
      summarizeToolNames(input.toolExecutions, validationSelectionTools),
    ),
    signal(
      "validation_command_executed",
      validationExecutions.length > 0,
      summarizeToolNames(validationExecutions, validationExecutionTools),
    ),
    signal(
      "validation_passed",
      validationExecutions.length > 0 &&
        validationExecutions.every((execution) => executionPassed(execution)),
      summarizeValidation(validationExecutions),
    ),
    signal(
      "reproduction_exists",
      Boolean(input.reproduction),
      input.reproduction
        ? `${input.reproduction.type}:${input.reproduction.status}`
        : undefined,
    ),
    signal(
      "failure_context_recorded",
      input.toolExecutions.some((execution) =>
        failureContextTools.has(execution.toolName),
      ) || (input.warnings?.length ?? 0) > 0,
      summarizeToolNames(input.toolExecutions, failureContextTools),
    ),
    signal(
      "unresolved_risks_absent",
      (input.unresolvedRisks?.length ?? 0) === 0,
      input.unresolvedRisks?.slice(0, 2).join("; "),
    ),
    signal("claimed_files_exist", claimedFilesExist, summarizeList(claimedFiles)),
    signal(
      "claimed_commands_ran",
      claimedCommandsRan,
      reproductionCommand,
    ),
  ];

  const score = Math.round(
    signals.reduce(
      (total, item) => total + (item.satisfied ? item.weight : 0),
      0,
    ),
  );
  const hasFailedRun =
    input.evidenceStatus === "failed" ||
    input.evidenceStatus === "blocked";

  // Note: failed validation executions now only affect the "validation_passed" signal (lowers numeric)
  // rather than forcing overall "failed" status. This allows diagnostic/review runs (that may
  // intentionally surface failing repros or skip validation) to receive partial/verified status
  // based on inspection + grounding signals instead of always landing at low "failed" scores.
  //
  // Audit / read-only / proof-heavy runs (no patch this session) are now explicitly supported:
  // - hasProofSignal (from enriched tool records: security_path_trace, candidate_revalidator,
  //   browser_prober, hasStructuredEvidence) boosts "target_files_identified" and "relevant_files_inspected".
  // - A solid review that classified surface, obtained proof, executed validation, and left few
  //   unresolved risks can reach "partially_verified" (or even "verified" at high inspection+proof density)
  //   even with 0 filesModified. This makes Evidence Packs useful and honest for the common case
  //   of "I reviewed and understood the real risks" without forcing a patch every time.

  return {
    score,
    status: statusForScore(score, hasFailedRun),
    missingEvidence: signals
      .filter((item) => !item.satisfied)
      .map((item) => item.label),
    signals,
    generatedAt: new Date().toISOString(),
  };
}

function signal(
  id: SignalId,
  satisfied: boolean,
  evidence?: string,
): VerifiedTaskScoreSignal {
  return {
    id,
    label: labels[id],
    satisfied,
    weight: weights[id],
    evidence,
  };
}

function statusForScore(
  score: number,
  hasFailedRun: boolean,
): VerifiedTaskScore["status"] {
  if (hasFailedRun) return "failed";
  if (score >= 85) return "verified";
  if (score >= 45) return "partially_verified";
  return "unverified";
}

function extractInspectedPaths(toolExecutions: ToolExecutionRecord[]) {
  // Generalized for real-world repos (not just "src/" layout) and security review workflows.
  // Any fileInspectionTool (or common search/read variants) that produced a string arg
  // containing path separators or extensions now counts as inspection. This prevents
  // chronic low scores (16/18) for diagnostic runs on typical codebases (app/, lib/, packages/, root files).
  return [
    ...new Set(
      toolExecutions
        .filter((execution) =>
          fileInspectionTools.has(execution.toolName) ||
          /read|grep|search|file|inspect/i.test(execution.toolName),
        )
        .flatMap((execution) => Object.values(execution.args))
        .filter((value): value is string => typeof value === "string")
        .filter((value) => /[\\/.]/.test(value) || /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(value.trim())),
    ),
  ];
}

function executionCommandText(execution: ToolExecutionRecord) {
  const command =
    typeof execution.args.command === "string"
      ? execution.args.command
      : `${execution.toolName} ${JSON.stringify(execution.args)}`;
  return command.trim();
}

function executionPassed(execution: ToolExecutionRecord) {
  if (typeof execution.parsedOutput?.exitCode === "number") {
    return execution.parsedOutput.exitCode === 0;
  }
  if (execution.parsedOutput?.status === "success") {
    return true;
  }
  if (execution.parsedOutput?.status === "failed") {
    return false;
  }
  return /\b(exitCode["']?\s*:\s*0|exit code:?\s*0|passed|success)\b/i.test(
    execution.output,
  );
}

function pathExists(workspacePath: string, claim: string) {
  try {
    const normalized = claim.replace(/:\d+(:\d+)?$/, "");
    const absolute = path.isAbsolute(normalized)
      ? normalized
      : path.join(workspacePath, normalized);
    return fs.existsSync(absolute);
  } catch {
    // Defensive: wrong workspacePath (old bug) or bad claim should not crash scoring / pack gen.
    return false;
  }
}

function summarizeList(values: string[]) {
  if (values.length === 0) return undefined;
  return values.slice(0, 4).join(", ");
}

function summarizeToolNames(
  executions: ToolExecutionRecord[],
  accepted: Set<string>,
) {
  const names = executions
    .filter((execution) => accepted.has(execution.toolName))
    .map((execution) => execution.toolName);
  return summarizeList([...new Set(names)]);
}

function summarizeValidation(executions: ToolExecutionRecord[]) {
  if (executions.length === 0) return undefined;
  return executions
    .map((execution) => `${execution.toolName}:${executionPassed(execution) ? "passed" : "failed"}`)
    .join(", ");
}
