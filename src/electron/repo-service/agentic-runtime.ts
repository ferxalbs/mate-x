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
import { behaviorInstruction, behaviorSystemContract, type BehaviorMode } from "../../contracts/behavior-mode";
import type { WorkStrategy } from "../../contracts/work-objective";
import type { AppSettings } from "../../contracts/settings";
import type { RepoSnapshot } from "./workspace";

// Import modular items
import { buildAgentRuntimeConfig } from "./agentic-runtime/config";
import { appendAttachmentContext } from "./agentic-runtime/helpers";
import { requestRainyResponsesAgenticResponse } from "./agentic-runtime/responses-runner";
import { requestRainyChatAgenticResponse } from "./agentic-runtime/chat-runner";
import { createModelToolsUnavailableResult } from "./agentic-runtime/model-tools-unavailable";
import { buildValidationAuthoritySection } from "./agentic-runtime/prompt-contract";

// Re-exports for absolute backward-compatibility
export * from "./agentic-runtime/types";
export * from "./agentic-runtime/config";
export * from "./agentic-runtime/helpers";
export * from "./agentic-runtime/tool-executor";
export * from "./agentic-runtime/synthesis";
export * from "./agentic-runtime/critic";
export * from "./agentic-runtime/chat-runner";
export * from "./agentic-runtime/responses-runner";
export { buildValidationAuthoritySection } from "./agentic-runtime/prompt-contract";

/** Runbook-conditional playbooks keep the system prompt smaller for simple tasks. */
function buildRunbookPlaybookSection(
  runbook: WorkRunbook,
  behaviorMode: BehaviorMode,
  workStrategy: WorkStrategy = "work",
): string {
  const sections: string[] = [];

  sections.push(`Repository inspection:
- Use rg for exact symbols, imports, config keys, and error strings; scope by path and result limits.
- Use read_many for the smallest relevant set of files. Stop expanding once evidence is sufficient.`);

  if (behaviorMode === "review" || workStrategy === "inspection") {
    sections.push(`Review contract:
- Inspect only. Produce evidence-backed findings, impact, and confidence.
- Do not edit files, run commands, or describe unperformed work as execution.`);
    return sections.join("\n");
  }

  if (behaviorMode === "plan" || workStrategy === "planning") {
    sections.push(`Plan contract:
- Investigate read-only, resolve implementation decisions, and return ordered steps, affected areas, validation, and risks.
- Do not edit files or run commands.`);
    return sections.join("\n");
  }

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
    sections.push(`Execute validation:
- Create a validation plan with plan_validation, run the relevant advertised checks, and verify persistence before claiming success.
- Treat the plan's resolved command and requirement ID as an exact allow-list. Do not edit, paraphrase, or replace a command because a host executable happens to exist.
- An unresolved requirement is a hard stop: do not call bunx, npx, pnpm dlx, yarn dlx, npm exec, bun x, bare tsc, or an invented fallback without the explicit approval path.
- A successful diagnostic or one passing requirement never satisfies another required requirement.
- Report the exact typed result: passed, failed, or blocked by policy. Never infer validation from prose.`);
  }

  if (
    runbook === "patch_test_verify" ||
    runbook === "audit_reproduce_remediate"
  ) {
    sections.push(`Execute patch sequence:
- Establish the smallest useful reproduction or static proof.
- Read the relevant files, apply scoped edits with file_editor, search for remaining obsolete patterns, then validate.
- Do not invent paths, commands, exit codes, or pre/post outcomes.`);
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
  workStrategy?: WorkStrategy;
}): string {
  return `${MATE_AGENT_SYSTEM_PROMPT}

Behavior: ${behaviorInstruction(input.options.behaviorMode)}
Mode contract:
${behaviorSystemContract(input.options.behaviorMode)}
Workspace: ${input.snapshot.workspace.name} (${input.snapshot.workspace.path})
Branch: ${input.snapshot.workspace.branch}
Stack: ${input.snapshot.workspace.stack.join(", ") || "unknown"}
Execution requested: ${input.runtimeExecutionIntent ? "yes" : "no"}
Canonical Work strategy: ${input.workStrategy ?? "work"}

Use only advertised tools. Authorization failures are application states; never explain their implementation.
Continue from tool results without repeating prior drafts. Stop when evidence is sufficient.
Repository writes and commands affect real workspace state. Validate changes before claiming completion.
Privacy placeholders such as [PRIVATE_FILE_PATH] and [SECRET_*] are redactions, not repository text.

${buildValidationAuthoritySection(input.workPlan, input.options.behaviorMode)}

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
  workStrategy,
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
  workStrategy?: WorkStrategy;
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
      visibility: "technical",
    });
    emitProgress();

    return createModelToolsUnavailableResult([]);
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
    playbook: buildRunbookPlaybookSection(
      workPlan.runbook,
      options.behaviorMode,
      workStrategy ?? workPlan.objectiveContract?.strategy ?? "work",
    ),
    gitStatus,
    matches,
    memory: snapshot.memoryContext?.context ?? "",
    failureMemoryContext,
    repoGraphSummary,
    workStrategy: workStrategy ?? workPlan.objectiveContract?.strategy,
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
      workStrategy: workStrategy ?? workPlan.objectiveContract?.strategy,
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
    workStrategy: workStrategy ?? workPlan.objectiveContract?.strategy,
    planningPhase,
  });
}
