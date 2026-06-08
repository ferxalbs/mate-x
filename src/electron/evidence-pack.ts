import { GitService } from "./git-service";
import { extractEvidenceFinalization } from "./evidence-finalization";
import { computeVerifiedTaskScore } from "./verified-task-score";
import { policyService } from "./policy-service";

import type { EvidencePack, EvidencePackReproduction, ToolEvent } from "../contracts/chat";
import type { WorkspaceTrustContract } from "../contracts/workspace";

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
      summary:
        finalization.verdictSummary ??
        "The run was limited by missing provider configuration or trust policy.",
      confidence: confidence ?? "high",
    };
  }

  if (status === "partial") {
    return {
      label: finalization.verdictLabel ?? "Completed with issues",
      summary:
        finalization.verdictSummary ?? extractSummaryFromContent(content),
      confidence: confidence ?? "medium",
    };
  }

  if (status === "failed") {
    return {
      label: finalization.verdictLabel ?? "Run failed",
      summary:
        finalization.verdictSummary ?? extractSummaryFromContent(content),
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
  trustContract?: WorkspaceTrustContract | null;
  runbookId?: string;
  initialStatusLines?: string[];
}): Promise<EvidencePack> {
  const {
    workspacePath,
    events,
    content,
    toolExecutions,
    trustContract,
    runbookId,
    initialStatusLines,
  } = params;
  const status = classifyEvidenceStatus(events);
  const finalization = extractEvidenceFinalization(content);
  const verdict = buildVerdict(status, content, finalization);
  const runtimeWarnings = deriveWarnings(events);
  let warnings = Array.from(
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
  const initialDirtyPaths = new Set(
    (initialStatusLines ?? []).map((line) => line.slice(3).trim()),
  );
  const toolTouchedPaths = new Set(extractToolTouchedPaths(toolExecutions));
  const filesModified = (gitStatus?.files ?? [])
    .filter(
      (file) =>
        !initialDirtyPaths.has(file.path) || toolTouchedPaths.has(file.path),
    )
    .map((file) => {
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

  // === Derive machine evidence first (ground truth), fall back to LLM narrative only for gaps ===
  // This demotes brittle heading parsing (extractEvidenceFinalization) from being the source of
  // structured pack fields. The LLM verdict/recommendation text remains valuable as human narrative.
  const runtimeReproduction = deriveRuntimeReproduction(toolExecutions, events);
  const reproduction = runtimeReproduction ?? finalization.reproduction;

  const runtimeUnresolved = deriveRuntimeUnresolvedRisks(toolExecutions, events, warnings);
  const unresolvedRisks =
    (finalization.unresolvedRisks?.length ?? 0) > 0
      ? finalization.unresolvedRisks
      : runtimeUnresolved.length > 0
        ? runtimeUnresolved
        : warnings.length > 0
          ? [
              "One or more tool steps failed; review warnings before trusting results.",
            ]
          : undefined;
  let verifiedTaskScore: ReturnType<typeof computeVerifiedTaskScore>;
  try {
    verifiedTaskScore = computeVerifiedTaskScore({
      workspacePath,
      evidenceStatus: status,
      filesModified,
      toolExecutions,
      reproduction,
      warnings,
      unresolvedRisks,
    });
  } catch (err) {
    // Resilience: never let scoring (or path checks inside it) crash evidence pack generation.
    // Partial packs with low score + warning are still useful and can be attested/exported.
    const msg = err instanceof Error ? err.message : String(err);
    warnings = [...(warnings || []), `verified task score computation failed: ${msg}`];
    verifiedTaskScore = {
      score: 0,
      status: "unverified",
      missingEvidence: ["scoring failed (see warnings)"],
      signals: [],
      generatedAt: new Date().toISOString(),
    } as ReturnType<typeof computeVerifiedTaskScore>;
  }

  return {
    status,
    governanceMode: trustContract?.autonomy === "unrestricted" ? "unrestricted" : "governed",
    verdict,
    verifiedTaskScore,
    filesModified,
    commandsExecuted,
    toolsUsed: Array.from(toolUsageCount.entries()).map(([name, count]) => ({
      name,
      count,
    })),
    testsRun,
    reproduction,
    stages: deriveRuntimeStages(events, runbookId) ?? (finalization.stages?.length ? finalization.stages : undefined),
    checks: deriveRuntimeChecks(toolExecutions, events, runbookId) ?? (finalization.checks?.length ? finalization.checks : undefined),
    policyStops: policyService
      .listStops()
      .filter((stop) => stop.workspacePath === workspacePath)
      .map((stop) => ({
        id: stop.id,
        kind: stop.attemptedAction.kind,
        policyId: stop.policyId,
        title: stop.title,
        status: stop.status,
        target: stop.attemptedAction.target,
        command: stop.attemptedAction.command,
        metadata: stop.attemptedAction.metadata,
        resolution: stop.resolution
          ? {
              action: stop.resolution.action,
              resolvedAt: stop.resolution.resolvedAt,
            }
          : undefined,
      })),
    stopConditionTriggered: finalization.stopConditionTriggered,
    warnings: warnings.length > 0 ? warnings : undefined,
    unresolvedRisks,
    recommendation: finalization.recommendation,
    touchedPaths: filesModified.map((file) => file.path),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Extract candidate file paths that the agent intentionally touched via edit/patch/write tools.
 * This is used as a "rescue set" so that filesModified (sourced from real git status) is not
 * incorrectly filtered out just because the path was in the pre-run dirty status.
 *
 * Design goals (addressing the "always 0 files / src/ bias" problem):
 * - Layout-agnostic: no hard-coded "src/" or "app/" prefixes. Works for root-level sources,
 *   packages/, lib/, app/, tests/, etc.
 * - Multi-source: reads both raw args (the common case) and parsedOutput (when tools return
 *   structured success metadata). Future tool improvements in the executor will automatically
 *   feed better data here.
 * - Defensive: ignores obvious non-repo noise (node_modules, .git, build artifacts, URLs, .mate-x internal).
 */
function extractToolTouchedPaths(toolExecutions: ToolExecutionRecord[]): string[] {
  const knownPatchTools = new Set([
    "file_editor",
    "auto_patch",
    "apply_patch",
    "str_replace_editor",
    "edit_file",
    "write_file",
    "replace_range",
    "insert_before",
    "insert_after",
  ]);

  const candidates = new Set<string>();

  for (const execution of toolExecutions) {
    const name = execution.toolName;
    const isPatchish =
      knownPatchTools.has(name) ||
      /edit|patch|write|replace/i.test(name);

    if (!isPatchish) continue;

    // 1. Top-level args (most edit tools put the primary target path or paths here)
    for (const v of Object.values(execution.args)) {
      if (typeof v === "string") addIfPlausibleRepoPath(candidates, v);
      else if (Array.isArray(v)) {
        for (const item of v) if (typeof item === "string") addIfPlausibleRepoPath(candidates, item);
      }
    }

    // 2. parsedOutput — tools that succeed often return { path, filesModified, modified, ... }
    const po = execution.parsedOutput;
    if (po && typeof po === "object") {
      const keys = ["path", "file", "target", "modified", "files", "touched", "changed", "filesModified"];
      for (const k of keys) {
        const val = (po as Record<string, unknown>)[k];
        if (typeof val === "string") addIfPlausibleRepoPath(candidates, val);
        else if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string") addIfPlausibleRepoPath(candidates, item);
            else if (item && typeof item === "object" && typeof (item as any).path === "string") {
              addIfPlausibleRepoPath(candidates, (item as any).path);
            }
          }
        }
      }
    }
  }

  return [...candidates];
}

function addIfPlausibleRepoPath(set: Set<string>, raw: string) {
  if (!raw || typeof raw !== "string") return;
  let p = raw.trim();
  if (!p || p.length > 400) return;

  // Drop obvious non-path / non-repo values
  if (/^(https?:|data:|file:|node:|blob:)/i.test(p)) return;
  if (p.startsWith("node_modules/") || p.includes("/node_modules/")) return;
  if (p.startsWith(".git/") || p.includes("/.git/")) return;
  if (p.startsWith(".mate-x/") || p.includes("/.mate-x/")) return;
  if (/^(dist|build|out|target|coverage|\.next|\.vite|tmp|temp|__pycache__)\//.test(p)) return;

  // Must look like a repo file path
  const hasSep = p.includes("/");
  const hasExt = /\.[A-Za-z0-9]{1,6}$/.test(p);
  if (!hasSep && !hasExt) return;

  // Normalize
  p = p.replace(/^\.\//, "");

  set.add(p);
}

// === Runtime evidence derivation (preferred over pure text parsing for machine fields) ===

function deriveRuntimeReproduction(
  toolExecutions: ToolExecutionRecord[],
  _events: ToolEvent[],
): EvidencePack["reproduction"] | undefined {
  // Look for explicit validation executions that succeeded or failed as repro evidence.
  const val = toolExecutions.find(
    (e) => e.toolName === "run_tests" || e.toolName === "sandbox_run" || /sandbox|test/i.test(e.toolName),
  );
  if (!val) return undefined;

  const po = (val.parsedOutput ?? {}) as Record<string, unknown>;
  const statusRaw = (po.status ?? po.outcome ?? "").toString().toLowerCase();
  let status: EvidencePackReproduction["status"] = "unknown";
  if (statusRaw.includes("pass") || statusRaw === "success" || (typeof po.exitCode === "number" && po.exitCode === 0)) status = "created";
  if (statusRaw.includes("fail") || (typeof po.exitCode === "number" && po.exitCode !== 0)) status = "existing";

  return {
    type: "validation_run",
    status,
    prePatchOutcome: status === "existing" ? "failed" : undefined,
    postPatchOutcome: status === "created" ? "passed" : undefined,
    command: typeof val.args.command === "string" ? val.args.command : val.toolName,
    summary: typeof po.summary === "string" ? po.summary : undefined,
  };
}

function deriveRuntimeUnresolvedRisks(
  toolExecutions: ToolExecutionRecord[],
  events: ToolEvent[],
  runtimeWarnings: string[],
): string[] {
  const risks: string[] = [];
  const errorEvents = events.filter((e) => e.status === "error");
  if (errorEvents.length > 0) {
    risks.push(`${errorEvents.length} tool step(s) errored during the run.`);
  }
  const failedProof = toolExecutions.filter((e) =>
    (e.parsedOutput as any)?.evidenceType && (e.parsedOutput as any)?.status === "failed",
  );
  if (failedProof.length > 0) {
    risks.push("One or more proof steps (trace/revalidator/probe) did not confirm the hypothesized issue.");
  }
  if (runtimeWarnings.length > 2) {
    risks.push("Multiple warnings were raised; review the Evidence Pack warnings for details.");
  }
  return risks.slice(0, 4);
}

function deriveRuntimeStages(events: ToolEvent[], runbookId?: string): EvidencePack["stages"] | undefined {
  // Pull from the work-engine step events that are already emitted by repo-service.
  const workSteps = events.filter((e) => e.id?.startsWith("step-work-engine") || /WorkPlan|stage/i.test(e.label || ""));
  if (workSteps.length === 0 && !runbookId) return undefined;

  const stages: NonNullable<EvidencePack["stages"]> = workSteps.slice(0, 6).map((e, idx) => ({
    id: e.id || `stage-${idx}`,
    name: e.label || "Work stage",
    status: e.status === "done" ? "completed" : e.status === "error" ? "failed" : "unknown",
    summary: e.detail ? String(e.detail).slice(0, 120) : undefined,
  }));

  if (stages.length === 0 && runbookId) {
    stages.push({
      id: runbookId,
      name: runbookId,
      status: "unknown",
      summary: "Runbook selected; detailed stage telemetry in work engine events.",
    });
  }
  return stages.length ? stages : undefined;
}

function deriveRuntimeChecks(
  toolExecutions: ToolExecutionRecord[],
  events: ToolEvent[],
  runbookId?: string,
): EvidencePack["checks"] | undefined {
  const checks: NonNullable<EvidencePack["checks"]> = [];

  const validations = toolExecutions.filter((e) => e.toolName === "run_tests" || e.toolName === "sandbox_run");
  for (const v of validations.slice(0, 4)) {
    const po = (v.parsedOutput ?? {}) as any;
    const st = po.status === "success" || (typeof po.exitCode === "number" && po.exitCode === 0) ? "passed" : "failed";
    checks.push({
      name: typeof v.args.scope === "string" ? `validation:${v.args.scope}` : v.toolName,
      status: st,
      summary: po.summary || (po.exitCode != null ? `exit=${po.exitCode}` : undefined),
    });
  }

  // If we had explicit "Checks:" from the model and runtime found nothing, the caller will fall back.
  if (checks.length === 0 && runbookId) {
    checks.push({
      name: `runbook:${runbookId}`,
      status: "unknown",
      summary: "Runtime checks derived from tool executions; see commandsExecuted for details.",
    });
  }

  return checks.length ? checks : undefined;
}

// (end of helpers)
