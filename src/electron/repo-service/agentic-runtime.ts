import type { ToolExecutionRecord } from "../evidence-pack";
import { repoGraphService } from "../repo-graph-service";
import { failureMemoryEngine } from "../failure-memory-engine";
import { renderWorkingSetForPrompt } from "../working-set-compiler";
import { renderWorkPlanForPrompt } from "../work-engine/work-engine";
import { renderFailureMemoryInstruction } from "../work-engine/failure-memory-gate";
import type { WorkPlan, WorkRunbook } from "../work-engine/types";
import type { AgentOutcome, AssistantRunbookDefinition, AssistantRunOptions, ToolEvent } from "../../contracts/chat";
import type { ExecutionSynthesisStatus } from "../../contracts/execution";
import type { RainyApiMode, RainyModelCapabilities, RainyModelCatalogEntry } from "../../contracts/rainy";
import { supportsTools } from "../../lib/rainy-model-capabilities";
import { MATE_AGENT_SYSTEM_PROMPT } from "../../config/mate-agent";
import { behaviorInstruction } from "../../contracts/behavior-mode";
import type { AppSettings } from "../../contracts/settings";
import type { RepoSnapshot } from "./workspace";

// Import modular items
import { buildAgentRuntimeConfig } from "./agentic-runtime/config";
import { appendAttachmentContext } from "./agentic-runtime/helpers";
import { requestRainyResponsesAgenticResponse } from "./agentic-runtime/responses-runner";
import { requestRainyChatAgenticResponse } from "./agentic-runtime/chat-runner";

// Re-exports for absolute backward-compatibility
export * from "./agentic-runtime/types";
export * from "./agentic-runtime/config";
export * from "./agentic-runtime/helpers";
export * from "./agentic-runtime/tool-executor";
export * from "./agentic-runtime/synthesis";
export * from "./agentic-runtime/critic";
export * from "./agentic-runtime/chat-runner";
export * from "./agentic-runtime/responses-runner";

/** Runbook-conditional playbooks keep the system prompt smaller for simple tasks. */
function buildRunbookPlaybookSection(runbook: WorkRunbook): string {
  const sections: string[] = [];

  sections.push(`Fast search/read playbook:
- Use rg before read when you need exact symbols, text, imports, config keys, or error strings. Prefer path/paths and include to keep search scoped.
- Use rg maxResults and maxOutputChars for broad terms; raise them only after narrowing. Use contextLines 1-3 for nearby evidence.
- Use read_many after rg when you need several files or line ranges. Prefer one read_many call over many read calls.
- Avoid ls/tree/find for code discovery when rg, RepoGraph, glob, or read_many can answer faster.`);

  if (
    runbook === "audit_reproduce_remediate" ||
    runbook === "scan_contain_report" ||
    runbook === "trace_source_to_sink"
  ) {
    sections.push(`Security tool playbook:
- For secret exposure, call secret_scan first. Keep evidence redacted; use source_map_analyzer for built bundles/maps and client env leakage.
- For broad repo triage, use attack_surface_scan or deep_analysis_pipeline, then candidate_revalidator before calling a finding confirmed.
- For exploitability, use security_path_trace for source-to-sink proof; use flow_trace only for narrow named variable/term tracing.
- For auth, secret, rate-limit, session, token, Redis revocation, or availability claims, call candidate_revalidator or security_path_trace before wording like vulnerable, high-severity, exploit, or disables. Without proof, say candidate/potential.
- When evidence contains Privacy Sentinel placeholders, base conclusions on surrounding syntax and tool evidence only.
- For container configs, use container_audit. For dependency CVEs, use cve_audit. For ReDoS, use redos_analyzer.`);
  }

  if (
    runbook === "patch_test_verify" ||
    runbook === "validate_only" ||
    runbook === "audit_reproduce_remediate"
  ) {
    sections.push(`Validation playbook:
- Before running validation for code changes, create a validation plan with plan_validation. plan_validation only plans; never report PROVEN/GO from it alone.
- When a validation plan exists, use it; do not choose commands ad hoc. After run_tests, call verify_validation_persistence before claiming persistence.
- Before retrying a failed command/validation/patch, call find_similar_failures unless known failures already match. After new failures call record_failure; after a retry clears a failure call record_resolution.
Sandbox timeout facts:
- sandbox_run accepts timeoutSeconds 30, 45, 60, 120, or 240 plus grace; do not claim a fixed 20s wrapper kills sandbox_run without current code evidence.`);
  }

  if (
    runbook === "patch_test_verify" ||
    runbook === "audit_reproduce_remediate"
  ) {
    sections.push(`Reproduction harness contract:
- Before patching suspicious behavior, attempt the smallest useful reproduction first.
- Prefer non-invasive checks: existing test, validation run, minimal script, HTTP/browser, then static proof.
- Do not invent temp paths, commands, exit codes, or pre/post outcomes. Only report a command when a tool result exists for that exact command.
- If sandbox_run executed, do not say runtime was blocked.`);
  }

  if (runbook === "review_classify_summarize") {
    sections.push(`Review playbook:
- Stay read-only: inspect git diff/status and needed file context, classify risk, then stop.
- Do not call plan_validation, run_tests, sandbox_run, evidence_pack, or patch tools for a pure current-change review.
- For clean git status and zero diff churn, stop after git status/diff evidence.`);
  }

  return sections.join("\n");
}

export function buildAgentSystemPrompt(input: {
  options: AssistantRunOptions;
  snapshot: RepoSnapshot;
  runtimeExecutionIntent: boolean;
  workingSet: string;
  workPlan: string;
  playbook: string;
  gitStatus: string;
  matches: string;
  memory: string;
  failureMemoryContext: string;
  repoGraphSummary: string;
}): string {
  return `${MATE_AGENT_SYSTEM_PROMPT}

Behavior: ${behaviorInstruction(input.options.behaviorMode)}
Workspace: ${input.snapshot.workspace.name} (${input.snapshot.workspace.path})
Branch: ${input.snapshot.workspace.branch}
Stack: ${input.snapshot.workspace.stack.join(", ") || "unknown"}
Execution requested: ${input.runtimeExecutionIntent ? "yes" : "no"}

Use only advertised tools. Authorization failures are application states; never explain their implementation.
Continue from tool results without repeating prior drafts. Stop when evidence is sufficient.
Repository writes and commands affect real workspace state. Validate changes before claiming completion.
Privacy placeholders such as [PRIVATE_FILE_PATH] and [SECRET_*] are redactions, not repository text.

Working set:
${input.workingSet}

Work plan:
${input.workPlan}

Git status:
${input.gitStatus || "(clean)"}

Prompt matches:
${input.matches || "(none)"}

Workspace memory:
${input.memory || "(none)"}

${input.failureMemoryContext}

Repository graph:
${input.repoGraphSummary}

${input.playbook}`;
}

export async function requestRainyAgenticResponse({
  apiKey,
  history,
  model,
  apiMode,
  capabilities,
  modelCatalogEntry,
  prompt,
  snapshot,
  workingSet,
  workPlan,
  events,
  options,
  runbookDefinition,
  emitProgress,
  appSettings,
  runId,
  signal,
  engineeringTaskStatus,
  planningPhase,
}: {
  apiKey: string;
  history: string[];
  model: string;
  apiMode: RainyApiMode;
  capabilities?: RainyModelCapabilities;
  modelCatalogEntry?: RainyModelCatalogEntry;
  prompt: string;
  snapshot: RepoSnapshot;
  workingSet: import("../../contracts/working-set").WorkingSet;
  workPlan: WorkPlan;
  events: ToolEvent[];
  options: AssistantRunOptions;
  runbookDefinition: AssistantRunbookDefinition;
  emitProgress: (content?: string) => void;
  appSettings: AppSettings;
  runId: string;
  signal?: AbortSignal;
  engineeringTaskStatus?: import("../../contracts/engineering-task").EngineeringTaskStatus | null;
  planningPhase?: boolean;
}): Promise<{
  toolExecutions: ToolExecutionRecord[];
  content: string;
  synthesisStatus: ExecutionSynthesisStatus;
  synthesisSummary?: string;
  outcome?: AgentOutcome;
}> {
  void runbookDefinition;
  const runtime = buildAgentRuntimeConfig(options, prompt);
  if (runtime.executionIntent && !supportsTools(capabilities)) {
    events.push({
      id: "step-model-tools-unsupported",
      label: "Model tools unsupported",
      detail:
        `Model ${model} does not advertise tool-calling support in the Rainy catalog. ` +
        "This task requires repository tools for patching or validation, so MaTE X will not treat this run as verified.",
      status: "error",
    });
    emitProgress();

    return {
      toolExecutions: [],
      synthesisStatus: "failed",
      synthesisSummary: "The configured model does not support the required repository tools.",
      content:
        `Model ${model} cannot run repository tools for this task. ` +
        "Choose a model with tool-calling support, then retry patch/validation.",
    };
  }
  const matches = snapshot.promptMatches
    .slice(0, 12)
    .map((match) => `${match.file}:${match.line} ${match.text}`)
    .join("\n");
  const gitStatus = snapshot.statusLines.slice(0, 40).join("\n");
  const repoGraphSummary = await repoGraphService.getPromptSummary(
    snapshot.workspace,
  );
  const similarFailures = await failureMemoryEngine.findSimilarFailures({
    workspaceId: snapshot.workspace.id,
    output: prompt,
    limit: 1,
  });
  const failureMemoryContext = [
    failureMemoryEngine.renderPromptSection(similarFailures),
    renderFailureMemoryInstruction(similarFailures),
  ].filter(Boolean).join("\n\n");

  const systemPrompt = buildAgentSystemPrompt({
    options,
    snapshot,
    runtimeExecutionIntent: runtime.executionIntent,
    workingSet: renderWorkingSetForPrompt(workingSet),
    workPlan: renderWorkPlanForPrompt(workPlan),
    playbook: buildRunbookPlaybookSection(workPlan.runbook),
    gitStatus,
    matches,
    memory: snapshot.memoryContext?.context ?? "",
    failureMemoryContext,
    repoGraphSummary,
  });
  const promptWithAttachments = appendAttachmentContext(prompt, options.attachments);
  const serviceTier = options.serviceTier;

  // The capability resolver advertises only tools available to this mode.
  if (apiMode === "responses") {
    return requestRainyResponsesAgenticResponse({
      apiKey,
      history,
      model,
      prompt: promptWithAttachments,
      runtime,
      options,
      systemPrompt,
      snapshot,
      events,
      emitProgress,
      appSettings,
      runId,
      serviceTier,
      signal,
      engineeringTaskStatus,
      planningPhase,
    });
  }

  return requestRainyChatAgenticResponse({
    apiKey,
    history,
    model,
    capabilities,
    modelCatalogEntry,
    prompt,
    runtime,
    options,
    systemPrompt,
    snapshot,
    events,
    emitProgress,
    appSettings,
    runId,
    serviceTier,
    signal,
    engineeringTaskStatus,
    planningPhase,
  });
}
