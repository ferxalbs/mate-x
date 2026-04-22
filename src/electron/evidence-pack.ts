import { GitService } from "./git-service";
import { extractEvidenceFinalization } from "./evidence-finalization";

import type { EvidencePack, ToolEvent } from "../contracts/chat";

export interface ToolExecutionRecord {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
  parsedOutput?: Record<string, unknown>;
}

function summarizeToolOutput(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Tool returned no textual output.";
  }

  return normalized.length <= 180
    ? normalized
    : `${normalized.slice(0, 177).trimEnd()}...`;
}

function classifyEvidenceStatus(events: ToolEvent[]): EvidencePack["status"] {
  const hasBlockingStep = events.some(
    (event) =>
      event.id === "step-rainy-missing" ||
      event.id === "step-rainy-model-missing" ||
      event.id === "step-rainy-domain-blocked",
  );
  if (hasBlockingStep) {
    return "blocked";
  }

  const hasErrors = events.some((event) => event.status === "error");
  if (hasErrors) {
    return "partial";
  }

  const finished = events.some((event) => event.label === "Response complete");
  return finished ? "complete" : "failed";
}

function extractSummaryFromContent(content: string) {
  const cleaned = content
    .replace(/<!-- mate-trace:.*? -->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "Run finished without a model-authored summary.";
  }

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  return firstSentence.length <= 180
    ? firstSentence
    : `${firstSentence.slice(0, 177).trimEnd()}...`;
}

function buildVerdict(
  status: EvidencePack["status"],
  content: string,
  finalization: ReturnType<typeof extractEvidenceFinalization>,
): EvidencePack["verdict"] {
  const confidence = finalization.confidence;

  if (status === "blocked") {
    return {
      label: finalization.verdictLabel ?? "Blocked by configuration",
      summary: finalization.verdictSummary ??
        "The run was limited by missing provider configuration or trust policy.",
      confidence: confidence ?? "high",
    };
  }

  if (status === "partial") {
    return {
      label: finalization.verdictLabel ?? "Completed with issues",
      summary: finalization.verdictSummary ?? extractSummaryFromContent(content),
      confidence: confidence ?? "medium",
    };
  }

  if (status === "failed") {
    return {
      label: finalization.verdictLabel ?? "Run failed",
      summary: finalization.verdictSummary ?? extractSummaryFromContent(content),
      confidence: confidence ?? "low",
    };
  }

  return {
    label: finalization.verdictLabel ?? "Completed",
    summary: finalization.verdictSummary ?? extractSummaryFromContent(content),
    confidence: confidence ?? "high",
  };
}

function deriveWarnings(events: ToolEvent[]) {
  return events
    .filter((event) => event.status === "error")
    .map((event) => `${event.label}: ${event.detail}`)
    .slice(0, 6);
}

export async function buildEvidencePack(params: {
  workspacePath: string;
  events: ToolEvent[];
  content: string;
  toolExecutions: ToolExecutionRecord[];
}): Promise<EvidencePack> {
  const { workspacePath, events, content, toolExecutions } = params;
  const status = classifyEvidenceStatus(events);
  const finalization = extractEvidenceFinalization(content);
  const verdict = buildVerdict(status, content, finalization);
  const runtimeWarnings = deriveWarnings(events);
  const warnings = Array.from(
    new Set([...(finalization.warnings ?? []), ...runtimeWarnings]),
  ).slice(0, 6);

  const toolUsageCount = new Map<string, number>();
  for (const execution of toolExecutions) {
    toolUsageCount.set(
      execution.toolName,
      (toolUsageCount.get(execution.toolName) ?? 0) + 1,
    );
  }

  const commandsExecuted = toolExecutions.map((execution) => ({
    command: `${execution.toolName} ${JSON.stringify(execution.args)}`,
    exitCode:
      typeof execution.parsedOutput?.exitCode === "number"
        ? execution.parsedOutput.exitCode
        : undefined,
    summary:
      typeof execution.parsedOutput?.summary === "string"
        ? execution.parsedOutput.summary
        : summarizeToolOutput(execution.output),
  }));

  const testsRun = toolExecutions
    .filter((execution) => execution.toolName === "run_tests")
    .map((execution) => {
      const parsedStatus = execution.parsedOutput?.status;
      const statusValue =
        parsedStatus === "success"
          ? "passed"
          : parsedStatus === "failed"
            ? "failed"
            : "unknown";

      return {
        name:
          typeof execution.args.scope === "string"
            ? `run_tests (${execution.args.scope})`
            : "run_tests",
        status: statusValue as "passed" | "failed" | "unknown",
        summary:
          typeof execution.parsedOutput?.summary === "string"
            ? execution.parsedOutput.summary
            : summarizeToolOutput(execution.output),
      };
    });

  const gitStatus = await new GitService(workspacePath).getStatusSafe();
  const filesModified = (gitStatus?.files ?? []).map((file) => {
    const path = file.path;
    const changeCode = `${file.index}${file.working_dir}`;
    let changeType: "modified" | "created" | "deleted" | "renamed" = "modified";
    if (changeCode.includes("A")) changeType = "created";
    if (changeCode.includes("D")) changeType = "deleted";
    if (changeCode.includes("R")) changeType = "renamed";
    return {
      path,
      changeType,
      diffSummary: `Git status ${changeCode || "??"}`,
    };
  });

  return {
    status,
    verdict,
    filesModified,
    commandsExecuted,
    toolsUsed: Array.from(toolUsageCount.entries()).map(([name, count]) => ({
      name,
      count,
    })),
    testsRun,
    warnings: warnings.length > 0 ? warnings : undefined,
    unresolvedRisks: (finalization.unresolvedRisks?.length ?? 0) > 0
      ? finalization.unresolvedRisks
      : warnings.length > 0
        ? ["One or more tool steps failed; review warnings before trusting results."]
        : undefined,
    recommendation: finalization.recommendation,
    touchedPaths: filesModified.map((file) => file.path),
    generatedAt: new Date().toISOString(),
  };
}
