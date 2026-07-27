import type {
  ExecutionChangedFile,
  ExecutionEvidence,
  ExecutionSynthesisStatus,
  ExecutionTerminalState,
  NormalizedToolEvidence,
} from "../../contracts/execution";
import type { ToolExecutionRecord } from "../evidence-pack";
import type { WorkPlan } from "./types";
import type { WorkStage } from "./stages";

const PATCH_TOOL_RE = /edit|patch|write|replace|mutation/i;
const VALIDATION_TOOL_RE = /^(run_tests|sandbox_run)$/i;

export function normalizeToolEvidence(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
  parsedOutput?: Record<string, unknown>,
): NormalizedToolEvidence {
  const structured = parseTrailingObject(output) ?? parsedOutput ?? {};
  const error = asRecord(structured.error);
  const code = String(error?.code ?? structured.code ?? "").toUpperCase();
  const status = String(structured.status ?? structured.outcome ?? "").toLowerCase();
  const sandboxStatus = output.match(/\bStatus:\s*(PASSED|READY|FAILED|TIMED_OUT|START_FAILED|TERMINATED)\b/i)?.[1]?.toLowerCase();
  const sandboxExitCode = Number(output.match(/\bExit code:\s*(-?\d+)\b/i)?.[1]);
  const summary = compactSummary(
    typeof structured.summary === "string" ? structured.summary : output,
  );
  const approvalRequired =
    code === "ERR_APPROVAL_REQUIRED" ||
    status === "awaiting_approval" ||
    /approval required|requires approval|needs approval|policy stop .*pending|awaiting approval/i.test(output);
  const trustBlocked =
    !approvalRequired &&
    (code === "FORBIDDEN" ||
      status === "blocked" ||
      /workspace trust contract blocks|provider domain blocked|path must remain|policy stop .*declined|policy .*rejected/i.test(output));
  const failed =
    !trustBlocked &&
    !approvalRequired &&
    (structured.ok === false ||
      ["failed", "error", "cancelled", "declined", "timeout"].includes(status) ||
      ["failed", "timed_out", "start_failed", "terminated"].includes(sandboxStatus ?? "") ||
      (Number.isFinite(sandboxExitCode) && sandboxExitCode !== 0) ||
      /^(error\b|tool .+ failed\b|invalid arguments\b|timed? out\b|cancelled\b|canceled\b)/i.test(output.trim()) ||
      /\b(exit code [1-9]\d*|not ok)\b/i.test(output));
  const outcome = trustBlocked
    ? "blocked"
    : approvalRequired
      ? "awaiting_approval"
      : failed
        ? "failed"
        : "completed";

  const validationPassed =
    status === "success" ||
    status === "completed" ||
    sandboxStatus === "passed" ||
    sandboxStatus === "ready" ||
    Number(structured.exitCode) === 0 ||
    sandboxExitCode === 0 ||
    /\b(?:all\s+)?(?:tests?|checks?|validation)\s+(?:have\s+)?passed\b|\bexit(?:ed)?\s+(?:successfully|with\s+code\s+0)\b/i.test(output);
  const validationStatus = VALIDATION_TOOL_RE.test(toolName)
    ? outcome === "completed" && validationPassed
      ? "passed"
      : outcome === "completed" || outcome === "failed"
        ? "failed"
        : "not_run"
    : undefined;

  return {
    toolName,
    outcome,
    summary,
    reason:
      trustBlocked || approvalRequired || failed
        ? compactSummary(
            typeof error?.message === "string" ? error.message : output,
          )
        : undefined,
    changedFiles:
      outcome === "completed" && PATCH_TOOL_RE.test(toolName)
        ? extractChangedFiles(args, structured, output)
        : [],
    validationStatus,
    requiredUserAction:
      trustBlocked || approvalRequired
        ? typeof error?.recommendedNextAction === "string"
          ? error.recommendedNextAction
          : approvalRequired
            ? "Approve the requested action, or retry with a read-only alternative."
            : "Review workspace trust and retry after the required access is available."
        : undefined,
  };
}

export function normalizeToolExecution(
  execution: ToolExecutionRecord,
): NormalizedToolEvidence {
  return (
    execution.evidence ??
    normalizeToolEvidence(
      execution.toolName,
      execution.args ?? {},
      execution.output,
      execution.parsedOutput,
    )
  );
}

export function buildExecutionEvidence(input: {
  workPlan: WorkPlan;
  stages: WorkStage[];
  toolExecutions: ToolExecutionRecord[];
  synthesisStatus: ExecutionSynthesisStatus;
  synthesisSummary?: string;
}): ExecutionEvidence {
  const normalized = input.toolExecutions.map(normalizeToolExecution);
  const completedSteps = normalized
    .filter((item) => item.outcome === "completed")
    .map((item) => item.toolName);
  const failedSteps = normalized
    .filter((item) => item.outcome === "failed")
    .map((item) => ({
      name: item.toolName,
      reason: item.reason ?? item.summary,
    }));
  const blockedSteps = normalized
    .filter(
      (item) => item.outcome === "blocked" || item.outcome === "awaiting_approval",
    )
    .map((item) => ({
      name: item.toolName,
      reason: item.reason ?? item.summary,
    }));
  const changedFiles = dedupeChangedFiles(normalized.flatMap((item) => item.changedFiles));
  const validationEvidence = normalized.filter((item) => item.validationStatus);
  const validationStage = input.stages.find((stage) => stage.id === "validation_executed");
  const validationStatus = validationEvidence.some((item) => item.validationStatus === "failed") || validationStage?.status === "failed"
    ? "failed"
    : validationEvidence.some((item) => item.validationStatus === "passed") || validationStage?.status === "passed"
      ? "passed"
      : input.workPlan.validationPlan.required
        ? "not_run"
        : "not_required";
  const requiredUserAction = normalized.find((item) => item.requiredUserAction)?.requiredUserAction;

  return {
    completedSteps,
    failedSteps,
    blockedSteps,
    changedFiles,
    validation: {
      status: validationStatus,
      summary: validationStage?.reason,
    },
    synthesis: {
      status: input.synthesisStatus,
      summary: input.synthesisSummary,
    },
    requiredUserAction,
  };
}

export function resolveExecutionTerminalState(input: {
  workPlan: WorkPlan;
  evidence: ExecutionEvidence;
  stages: WorkStage[];
  evidenceAttached: boolean;
  awaitingApproval?: boolean;
  incompleteEvidence?: boolean;
  preparatoryOnly?: boolean;
}): ExecutionTerminalState {
  const hasMutation = input.evidence.changedFiles.length > 0;
  const hasApprovalPending = input.evidence.blockedSteps.some((step) =>
    /approval|policy/i.test(step.reason),
  );
  const hasTrustBlock = input.evidence.blockedSteps.some((step) =>
    /trust|forbidden|permission|access/i.test(step.reason),
  );
  const hasBlockedStep = input.evidence.blockedSteps.length > 0;
  const hasFailedStep = input.evidence.failedSteps.length > 0;
  const validationFailed = input.evidence.validation.status === "failed";
  const validationMissing =
    input.workPlan.validationPlan.required &&
    input.evidence.validation.status === "not_run";
  const synthesisMissing = input.evidence.synthesis.status !== "valid";
  const missingRequiredStage = input.stages.some(
    (stage) =>
      stage.status === "pending" ||
      stage.status === "failed" ||
      stage.status === "blocked",
  );

  if (hasMutation && (validationFailed || validationMissing || synthesisMissing || hasFailedStep || hasBlockedStep)) {
    return "partial";
  }
  if (hasTrustBlock) return "blocked";
  if (hasApprovalPending || input.awaitingApproval) return "awaiting_approval";
  if (hasBlockedStep) return "blocked";
  if (hasFailedStep || validationFailed) return "failed";
  if (input.incompleteEvidence || input.preparatoryOnly || missingRequiredStage) return "partial";
  if (synthesisMissing) return "failed";
  if (input.workPlan.evidencePlan.required && !input.evidenceAttached) return "failed";
  return "succeeded";
}

export function buildUserFacingExecutionSummary(
  outcome: ExecutionTerminalState,
  evidence: ExecutionEvidence,
): string {
  const lines: string[] = [];
  if (outcome === "succeeded") {
    lines.push("Completed successfully.");
  } else if (outcome === "partial") {
    lines.push("Completed partially; review the remaining work before relying on the result.");
  } else if (outcome === "awaiting_approval") {
    lines.push("Waiting for approval before continuing.");
  } else if (outcome === "blocked") {
    lines.push("Stopped because required access is unavailable.");
  } else {
    lines.push("The run could not complete.");
  }

  if (evidence.changedFiles.length > 0) {
    lines.push(
      `Changed files: ${evidence.changedFiles
        .map(
          (file) =>
            `${file.path} (backup ${file.backupCreated ? "created" : "not created"}; impact analysis ${file.impactAnalysis})`,
        )
        .join(", ")}.`,
    );
  } else {
    lines.push("Changed files: none confirmed.");
  }
  const notRun = [
    evidence.validation.status === "not_run" ? "validation" : "",
    evidence.synthesis.status !== "valid" ? "final synthesis" : "",
  ].filter(Boolean);
  if (notRun.length > 0) lines.push(`Not run or incomplete: ${notRun.join(" and ")}.`);
  const reason = evidence.failedSteps[0]?.reason ?? evidence.blockedSteps[0]?.reason;
  if (reason) lines.push(`Why it stopped: ${sanitizeUserReason(reason)}.`);
  if (evidence.requiredUserAction) lines.push(`Next action: ${sanitizeUserReason(evidence.requiredUserAction)}.`);
  return lines.join("\n");
}

function parseTrailingObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.lastIndexOf("\n{") + 1).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractChangedFiles(
  args: Record<string, unknown>,
  structured: Record<string, unknown>,
  output: string,
): ExecutionChangedFile[] {
  const paths = new Set<string>();
  for (const value of [args.path, args.file, structured.path, structured.file]) {
    if (typeof value === "string" && looksLikeRepoPath(value)) paths.add(value.trim());
  }
  const files = structured.filesModified ?? structured.changedFiles ?? structured.files;
  if (Array.isArray(files)) {
    for (const value of files) {
      const path = typeof value === "string" ? value : asRecord(value)?.path;
      if (typeof path === "string" && looksLikeRepoPath(path)) paths.add(path.trim());
    }
  }
  const outputPath = output.match(/\b(?:File|Path):\s*([^\s:]+(?:\/[^\s:]+)*)/i)?.[1];
  if (outputPath && looksLikeRepoPath(outputPath)) paths.add(outputPath);
  for (const match of output.matchAll(/\b((?:src|app|pages|lib|server|api|electron|contracts|tests?)\/[A-Za-z0-9._/-]+)/g)) {
    if (looksLikeRepoPath(match[1])) paths.add(match[1]);
  }
  const impact = /impact analysis skipped/i.test(output)
    ? "skipped"
    : /impact analysis/i.test(output)
      ? "full"
      : "none";
  const backupCreated = !/no backup|without a backup/i.test(output) && /backup file was created|backup created/i.test(output);
  return [...paths].map((path) => ({
    path,
    operation: "modified",
    backupCreated,
    impactAnalysis: impact,
  }));
}

function dedupeChangedFiles(files: ExecutionChangedFile[]) {
  const byPath = new Map<string, ExecutionChangedFile>();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function looksLikeRepoPath(value: string) {
  return value.length < 400 && !/^(https?:|data:|file:|node:)/i.test(value) &&
    !value.includes("node_modules") && /[/.]/.test(value);
}

function compactSummary(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217).trimEnd()}...`;
}

function sanitizeUserReason(value: string) {
  return compactSummary(value)
    .replace(/\[(?:[A-Z][A-Z_]+)\]/g, "")
    .replace(/\b(?:WorkPlan|planningPhase|step-[\w-]+|ERR_[A-Z_]+)\b/gi, "required execution step")
    .replace(/\s*\{[^{}]*\}\s*$/, "")
    .trim();
}
