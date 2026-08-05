import { app } from "electron";

import { buildEvidencePack, type ToolExecutionRecord } from "./evidence-pack";
import { generateEvidenceAttestation } from "../features/compliance/attestation";
import { attachAgentIdentity, resolveAgentRunIdentity } from "../features/compliance/agentIdentity";
import { privacyFirewall } from "./privacy/privacy-firewall-service";
import { tursoService } from "./turso-service";
import { workspaceMemoryService } from "./workspace-memory-service";
import { renderWorkingSetForPrompt, workingSetCompiler } from "./working-set-compiler";
import { buildWorkPlan, buildWorkPlanMetadata } from "./work-engine/work-engine";
import { runPrivacyPreflight } from "./work-engine/privacy-preflight";
import { appendValidationGateWarning, evaluateValidationGate } from "./work-engine/validation-gate";
import { deriveWorkStages, preventiveWarningDetail, shouldEmitPreventiveWarning } from "./work-engine/stages";
import { finalizeWorkRun } from "./work-engine/finalizer";
import { normalizeToolEvidence } from "./work-engine/execution-evidence";
import { persistWorkEngineRunArtifactSafely } from "./work-engine/run-artifact-runtime";
import { scheduleObjectiveVerification } from "./work-engine/objective-verifier";
import {
  scheduledValidationPlanMatches,
  selectSupplementalNoOpTest,
} from "./work-engine/supplemental-validation";
import { resolveRainyApiBaseUrl } from "../config/rainy";
import type { AgentOutcome, AssistantExecution, AssistantRunProgress, AssistantRunOptions, MessageArtifact, ToolEvent } from "../contracts/chat";
import type { ExecutionSynthesisStatus } from "../contracts/execution";
import type { PresentationIntent } from "../contracts/presentation";
import type { WorkPlan } from "./work-engine/types";
import type { AgentRoutingRecommendation } from "../contracts/agent-capability-profiler";
import { resolveAssistantRunOptions, resolveRunbookDefinition, toAssistantRunbookId } from "./assistant-runbooks";
import { canQueryDomain } from "./workspace-trust";
import { buildAgentCapabilityRunMetrics, recommendAgentModel } from "./agent-capability-profiler";
import { collectRepoSnapshot, getWorkspaceTrustContract } from "./repo-service/workspace";
import { buildArtifacts, buildFallbackResponse, buildWorkspaceMemoryArtifacts, executeAgentToolCall, parseDirectDeepAnalysisPipelineArgs, parseDirectSecurityPathTraceArgs, requestRainyAgenticResponse, resolveDefaultRainyRuntimeConfig } from "./repo-service/agentic-runtime";
import { buildWorkEngineArtifactSnapshot, loadCompliancePolicySources } from "./repo-service/work-engine-artifacts";
import { getRainyServiceTierOptions } from "../contracts/rainy";
import type { AgentActionEvidenceEvent } from "../contracts/sdk-orchestrator.types";
import {
  getSDKOrchestrator,
  getSDKOrchestratorReadinessError,
} from "./sdk-orchestrator-state";
import { resolveRunIntentOutcome } from "./capability-resolver";
import { policyService } from "./policy-service";
import {
  sanitizeApplicationError,
  telemetryService,
} from "./telemetry-service";
import { AgentExecutionSession } from "./run-trace/agent-execution-session";
import { collectRepositoryToolchainProfile } from "./repository-toolchain";
import {
  requestRainyChatCompletionStream,
  resolvePreferredRainyApiMode,
} from "./rainy-service";
import { sanitizeAssistantOutput } from "../lib/assistant-output";
import {
  getRepositoryStartupProgressLabel,
  getImmediateConversationalResponse,
  isRepositoryOverviewRequest,
} from "../lib/conversational-intent";
import {
  activeContractForWorkPlan,
  hasHighRiskChange,
  requiredApplicableItems,
} from "./validation-contract";

export { bootstrapWorkspaceState, getWorkspaceEntries, setActiveWorkspace, addWorkspace, removeWorkspace, saveWorkspaceSession, getWorkspaceSummary, getWorkspaceTrustContract, updateWorkspaceTrustContract, listFiles, searchInFiles, collectRepoSnapshot } from "./repo-service/workspace";
export type { RepoSnapshot } from "./repo-service/workspace";
export {
  getSDKOrchestrator,
  getSDKOrchestratorReadinessError,
  setSDKOrchestrator,
  setSDKOrchestratorInitializationError,
} from "./sdk-orchestrator-state";

interface AssistantProgressReporter {
  runId: string;
  emit: (progress: AssistantRunProgress) => void;
  signal?: AbortSignal;
}

const profilerWriteTimers = new Map<string, NodeJS.Timeout>();

function cloneArtifacts(artifacts: MessageArtifact[]) {
  return artifacts.map((artifact) => ({ ...artifact }));
}

function cloneEvents(events: ToolEvent[]) {
  return events.map((event) => ({ ...event }));
}

function getPresentationIntent(
  repositoryOverview: boolean,
  intent: WorkPlan["intent"],
): PresentationIntent {
  if (repositoryOverview) return "repository_overview";
  if (intent === "validate") return "validation";
  if (
    intent === "inspect" ||
    intent === "review_changes" ||
    intent === "security_review" ||
    intent === "trace_issue" ||
    intent === "generate_evidence"
  ) return "review";
  if (intent === "answer") return "conversation";
  return "change";
}

async function runConversationalAssistant(
  prompt: string,
  history: string[],
  workspaceId: string | undefined,
  options: AssistantRunOptions,
  progressReporter?: AssistantProgressReporter,
): Promise<AssistantExecution> {
  const createdAt = new Date().toISOString();
  const resolvedWorkspaceId = workspaceId ?? await tursoService.getActiveWorkspaceId();
  const workspaceName = (await tursoService.getWorkspaces()).find(
    (workspace) => workspace.id === resolvedWorkspaceId,
  )?.name ?? "this repository";
  const immediateResponse = getImmediateConversationalResponse(
    prompt,
    workspaceName,
  );
  let content = immediateResponse ?? "";

  if (!content) {
    const [apiKey, storedModel] = await Promise.all([
      tursoService.getApiKey(),
      tursoService.getModel(),
    ]);
    const runtimeConfig = apiKey
      ? await resolveDefaultRainyRuntimeConfig(apiKey, storedModel)
      : null;

    if (apiKey && runtimeConfig) {
      const messages = [
        {
          role: "system",
          content:
            `You are MaTE X in conversational mode for ${workspaceName}. ` +
            "Answer naturally and concisely. Do not claim to inspect repository state, use tools, change files, validate code, or create evidence unless a repository Work run actually occurred.",
        },
        ...history.slice(-12).flatMap((entry) => {
          const match = /^(user|assistant):\s*([\s\S]*)$/i.exec(entry);
          return match
            ? [{ role: match[1].toLowerCase(), content: match[2] }]
            : [];
        }),
        { role: "user", content: prompt },
      ];
      await requestRainyChatCompletionStream({
        apiKey,
        messages,
        model: runtimeConfig.model,
        capabilities: runtimeConfig.capabilities,
        maxTokens: 800,
        serviceTier: options.serviceTier,
        signal: progressReporter?.signal,
        onContentDelta(delta) {
          content += delta;
          progressReporter?.emit({
            runId: progressReporter.runId,
            status: "running",
            content: sanitizeAssistantOutput(content),
            events: [],
            artifacts: [],
          });
        },
      });
      content = sanitizeAssistantOutput(content);
    } else {
      content =
        "I can help with that once the conversational provider is configured. You can also ask me to inspect or change this repository.";
    }
  }

  return {
    suggestedTitle: history.length === 0 ? buildThreadTitle(prompt) : undefined,
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content,
      createdAt,
      events: [],
      artifacts: [],
      presentationIntent: "conversation",
      presentationEvidenceFreshness: "current_run",
    },
  };
}

export async function runAssistant(
  prompt: string,
  history: string[],
  workspaceId?: string,
  options?: AssistantRunOptions,
  progressReporter?: AssistantProgressReporter,
): Promise<AssistantExecution> {
  const startedAt = Date.now();
  const resolvedOptions = resolveAssistantRunOptions(options);
  if (resolvedOptions.pathKind === "chat_help") {
    return runConversationalAssistant(
      prompt,
      history,
      workspaceId,
      resolvedOptions,
      progressReporter,
    );
  }

  const effectiveRunId = progressReporter?.runId ?? `assistant-${Date.now()}`;
  const repositoryOverview = isRepositoryOverviewRequest(prompt, {
    hasActiveWorkspace: true,
  });
  const traceSession = new AgentExecutionSession(
    effectiveRunId,
    resolvedOptions.behaviorMode,
    resolvedOptions.engineeringTaskId ?? null,
  );
  traceSession.start();
  let traceCursor = 0;
  const events: ToolEvent[] = [
    {
      id: "step-preparing-context",
      label: getRepositoryStartupProgressLabel(prompt, true),
      detail: "",
      status: "active",
      segmentKind: "tool",
      type: "read",
      visibility: "public",
    },
  ];
  let artifacts: MessageArtifact[] = [];
  let privacyPreflight: Awaited<ReturnType<typeof runPrivacyPreflight>> | null = null;
  let content = "";
  let agentOutcome: AgentOutcome | undefined;
  let toolExecutions: ToolExecutionRecord[] = [];
  let synthesisStatus: ExecutionSynthesisStatus = "failed";
  let synthesisSummary = "No valid final synthesis was returned.";

  const emitProgress = (
    nextContent?: string,
    status: AssistantRunProgress["status"] = "running",
  ) => {
    if (!progressReporter) {
      return;
    }

    if (typeof nextContent === "string") {
      content = nextContent;
    }

    const emittedAt = new Date().toISOString();
    events.forEach((event, sequence) => {
      event.id = event.segmentId ?? event.id;
      event.segmentId ??= event.id;
      event.version = 2;
      event.runId ??= progressReporter.runId;
      event.sequence ??= sequence;
      event.timestamp ??= emittedAt;
    });
    traceSession.captureLegacyEvents(events);
    const traceEvents = traceSession.getEvents(traceCursor, 10_000);
    const delta =
      traceEvents.length > 0
        ? {
            runId: effectiveRunId,
            fromSeq: traceEvents[0].seq,
            toSeq: traceEvents.at(-1)!.seq,
            events: traceEvents,
          }
        : undefined;
    if (delta) traceCursor = delta.toSeq;

    progressReporter.emit({
      runId: progressReporter.runId,
      status,
      content,
      events: cloneEvents(events),
      delta,
      artifacts: cloneArtifacts(artifacts),
      outcome: agentOutcome,
    });
  };

  // This payload is emitted synchronously. Snapshot, toolchain, and plan work
  // all happen after the renderer has a safe public activity label.
  emitProgress();
  const snapshot = await collectRepoSnapshot(prompt, workspaceId);
  events[0].status = "done";
  events.push({
    id: "step-finding-files",
    label: "Finding relevant files",
    detail: "",
    status: "active",
    segmentKind: "tool",
    type: "search",
    visibility: "public",
  });
  emitProgress();
  const targetToolchain = await collectRepositoryToolchainProfile({
    root: snapshot.workspace.path,
    changedFiles: snapshot.statusLines.flatMap((line) => {
      const file = line.replace(/^[ MADRCU?!]{2}\s+/, "").trim();
      return file ? [file] : [];
    }),
  });
  const workingSet = await workingSetCompiler.compile({
    prompt,
    workspace: snapshot.workspace,
    gitState: snapshot.statusLines,
    selectedFiles: [],
    runMode: resolvedOptions.pathKind ?? 'full',
    promptMatches: snapshot.promptMatches,
    memoryContext: snapshot.memoryContext,
    targetToolchain,
  });
  events.at(-1)!.status = "done";
  events.push({
    id: "step-reviewing-implementation",
    label: "Reviewing the current implementation",
    detail: "",
    status: "active",
    segmentKind: "tool",
    type: "read",
    visibility: "public",
  });
  emitProgress();
  const workPlan = await buildWorkPlan({
    prompt,
    workspace: snapshot.workspace,
    gitStatus: snapshot.statusLines,
    workingSet,
    targetToolchain,
    workspacePolicy: snapshot.trustContract,
    initialInspection: { matches: snapshot.promptMatches },
    behaviorMode: resolvedOptions.behaviorMode,
  });
  if (!repositoryOverview) {
    await scheduleObjectiveVerification({
      workPlan,
      workspacePath: snapshot.workspace.path,
      workspaceId: snapshot.workspace.id,
      runId: effectiveRunId,
    });
  }
  events.at(-1)!.status = "done";
  const workStrategy = workPlan.objectiveContract?.strategy ?? "work";
  // EngineeringTask is sole workflow authority when linked.
  let engineeringTaskStatus: import("../contracts/engineering-task").EngineeringTaskStatus | null =
    null;
  if (resolvedOptions.engineeringTaskId) {
    try {
      const [
        { getEngineeringCommandBus },
        { createPhaseHandler },
        { getEngineeringRepository },
      ] = await Promise.all([
        import("./engineering/command-bus"),
        import("./engineering/phase-handler"),
        import("./engineering/repository"),
      ]);
      const repo = getEngineeringRepository();
      const bus = getEngineeringCommandBus();
      bus.setPhaseHandler(createPhaseHandler(repo));
      const task = bus.getTask(resolvedOptions.engineeringTaskId);
      engineeringTaskStatus = task?.status ?? null;
      workPlan.engineeringTaskId = resolvedOptions.engineeringTaskId;
      workPlan.lifecyclePhase = engineeringTaskStatus;
    } catch {
      engineeringTaskStatus = null;
    }
  }
  const awaitingTaskApproval = engineeringTaskStatus === "awaiting_approval";
  if (awaitingTaskApproval) {
    traceSession.transition("awaiting_approval");
  }
  const planningPhase =
    resolvedOptions.behaviorMode !== "execute" ||
    workStrategy === "inspection" ||
    workStrategy === "planning" ||
    awaitingTaskApproval;
  policyService.registerRunContext({
    runId: effectiveRunId,
    workspaceId: snapshot.workspace.id,
    workspacePath: snapshot.workspace.path,
    behaviorMode: resolvedOptions.behaviorMode,
    workStrategy,
    resolvePolicy: async () => {
      let currentTaskStatus = engineeringTaskStatus;
      if (resolvedOptions.engineeringTaskId) {
        const { getEngineeringRepository } = await import("./engineering/repository");
        currentTaskStatus =
          getEngineeringRepository().getTask(resolvedOptions.engineeringTaskId)?.status ??
          null;
      }
      return {
        workspacePolicy: await getWorkspaceTrustContract(snapshot.workspace.id),
        engineeringTaskStatus: currentTaskStatus,
      };
    },
  });
  const effectiveRunbookId = toAssistantRunbookId(workPlan.runbook);
  const runbookDefinition = resolveRunbookDefinition(effectiveRunbookId);
  const initialWorkPlanMetadata = buildWorkPlanMetadata(workPlan, "pending");
  events.push(
    {
      id: "step-work-engine",
      label: "Create WorkPlan",
      detail: JSON.stringify(initialWorkPlanMetadata),
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    },
    {
      id: "step-working-set",
      label: "Compile working set",
      detail: `Ranked ${workingSet.metadata.totalFileCount} files within a ${workingSet.metadata.tokenBudget} token budget.`,
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    },
    {
      id: "step-workspace",
      label: "Read workspace metadata",
      detail: `Resolved ${snapshot.workspace.path} on branch ${snapshot.workspace.branch}.`,
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    },
    {
      id: "step-files",
      label: "Inventory repository surface",
      detail: `Indexed ${snapshot.files.length} files and ${snapshot.statusLines.length} git changes.`,
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    },
    {
      id: "step-query",
      label: "Search prompt-linked files",
      detail:
        snapshot.promptMatches.length > 0
          ? `Found ${snapshot.promptMatches.length} repo matches connected to the request.`
          : "No direct file matches from the current prompt terms.",
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    },
    {
      id: "step-runbook",
      label: "Resolve runbook",
      detail: `Using structured runbook: ${runbookDefinition.name} from WorkPlan ${workPlan.id}.`,
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    },
  );

  try {
  const [apiKey, storedModel, appSettings] = await Promise.all([
    tursoService.getApiKey(),
    tursoService.getModel(),
    tursoService.getAppSettings(),
  ]);
  const rainyHostAllowed = canQueryDomain(
    snapshot.trustContract,
    new URL(resolveRainyApiBaseUrl()).hostname,
  );
  const runtimeConfig =
    apiKey && rainyHostAllowed
      ? repositoryOverview && storedModel?.trim()
        ? {
            model: storedModel.trim(),
            apiMode: resolvePreferredRainyApiMode(storedModel.trim()),
            capabilities: undefined,
            modelCatalogEntry: undefined,
          }
        : await resolveDefaultRainyRuntimeConfig(apiKey, storedModel)
      : null;
  const configuredModel = runtimeConfig?.model ?? null;
  if (
    runtimeConfig?.modelCatalogEntry &&
    !getRainyServiceTierOptions(runtimeConfig.modelCatalogEntry).includes(
      resolvedOptions.serviceTier ?? "standard",
    )
  ) {
    resolvedOptions.serviceTier = "standard";
  }
  const hasRainyConfig = Boolean(apiKey && configuredModel && rainyHostAllowed);
  artifacts = buildArtifacts(
    snapshot,
    hasRainyConfig,
    configuredModel,
    resolvedOptions,
  );
  privacyPreflight =
    !repositoryOverview &&
    hasRainyConfig && workPlan.privacyPlan.requireSanitization
      ? await runPrivacyPreflight(
          {
            prompt,
            workingSet: renderWorkingSetForPrompt(workingSet),
            memory: snapshot.memoryContext?.context,
            workPlan,
          },
          {
            workspaceId: snapshot.workspace.id,
            runId: progressReporter?.runId,
            inputKind: "work_engine_model_context",
          },
        )
      : null;
  if (privacyPreflight) {
    const privacyWorkPlanMetadata = buildWorkPlanMetadata(
      workPlan,
      privacyPreflight.status,
      privacyPreflight.status === "blocked" ? "blocked" : "pending",
    );
    events.push({
      id: "step-privacy-preflight",
      label: "Privacy Sentinel preflight",
      detail: `${privacyPreflight.reason} Redactions: ${privacyPreflight.redactionCount}; P0: ${privacyPreflight.p0Count}. ${JSON.stringify(privacyWorkPlanMetadata)}`,
      status: privacyPreflight.status === "blocked" ? "error" : "done",
      segmentKind: "tool",
      visibility: "technical",
    });
  }
  const createdAt = new Date().toISOString();
  let handledDirectTool = false;
  const appendSdkEvidenceEvent = (event: AgentActionEvidenceEvent) => {
    events.push({
      id: `sdk-${event.type.toLowerCase()}-${event.agentId}-${event.retryCount ?? 0}-${Date.now()}`,
      label: `SDK ${event.type.replaceAll("_", " ").toLowerCase()}`,
      detail: JSON.stringify(event),
      status:
        event.type === "AGENT_ACTION_FAILED" ||
        event.type === "AGENT_ACTION_BLOCKED" ||
        event.type === "CRITIC_LOOP_EXHAUSTED"
          ? "error"
          : event.type === "AGENT_ACTION_PENDING"
            ? "active"
            : "done",
    });
  };

  emitProgress();

  const runIntentOutcome = resolveRunIntentOutcome({
    behaviorMode: resolvedOptions.behaviorMode,
    intent: workPlan.intent,
  });
  if (runIntentOutcome) {
    agentOutcome = runIntentOutcome;
    content = runIntentOutcome.summary;
    synthesisStatus = "valid";
    synthesisSummary = runIntentOutcome.summary;
    events.push({
      id: "step-run-intent-blocked",
      label: "Request blocked",
      detail: runIntentOutcome.summary,
      status: "blocked",
      segmentKind: "tool",
      visibility: "public",
    });
    emitProgress(content);
    handledDirectTool = true;
  }

  const directDeepAnalysisArgs = handledDirectTool
    ? null
    : parseDirectDeepAnalysisPipelineArgs(prompt);
  if (directDeepAnalysisArgs) {
    const result = await executeAgentToolCall({
      toolCall: {
        id: "direct-deep-analysis-pipeline",
        name: "deep_analysis_pipeline",
        arguments: JSON.stringify(directDeepAnalysisArgs),
      },
      toolIndex: 0,
      iteration: 0,
      snapshot,
      events,
      emitProgress,
      appSettings,
      runId: effectiveRunId,
      engineeringTaskStatus,
      behaviorMode: resolvedOptions.behaviorMode,
      workStrategy,
    });

    content = result.content;
    toolExecutions = [result.toolExecution];
    synthesisStatus = "valid";
    synthesisSummary = "Direct tool response returned.";
    events.push({
      id: "step-direct-deep-analysis-pipeline",
      label: "Direct tool response",
      detail: "Ran deep_analysis_pipeline locally because the prompt explicitly requested it.",
      status: "done",
    });
    emitProgress(content);
    handledDirectTool = true;
  }

  const directSecurityTraceArgs = handledDirectTool ? null : parseDirectSecurityPathTraceArgs(prompt);
  if (directSecurityTraceArgs) {
    const result = await executeAgentToolCall({
      toolCall: {
        id: "direct-security-path-trace",
        name: "security_path_trace",
        arguments: JSON.stringify(directSecurityTraceArgs),
      },
      toolIndex: 0,
      iteration: 0,
      snapshot,
      events,
      emitProgress,
      appSettings,
      runId: effectiveRunId,
      engineeringTaskStatus,
      behaviorMode: resolvedOptions.behaviorMode,
      workStrategy,
    });

    content = result.content;
    toolExecutions = [result.toolExecution];
    synthesisStatus = "valid";
    synthesisSummary = "Direct tool response returned.";
    events.push({
      id: "step-direct-security-path-trace",
      label: "Direct tool response",
      detail: "Ran security_path_trace locally because the prompt explicitly requested it.",
      status: "done",
    });
    emitProgress(content);
    handledDirectTool = true;
  }

  if (!handledDirectTool && resolvedOptions.sdkAction) {
    const sdkOrchestrator = getSDKOrchestrator();
    if (!sdkOrchestrator) {
      throw new Error(getSDKOrchestratorReadinessError() ?? "Agent runtime is not ready.");
    }
    const sdkResult = await sdkOrchestrator.execute(resolvedOptions.sdkAction, {
      evidenceRecorder: {
        appendAgentActionEvent: async (event) => appendSdkEvidenceEvent(event),
      },
      authority: {
        behaviorMode: resolvedOptions.behaviorMode,
        workStrategy,
        workspacePolicy: snapshot.trustContract,
        engineeringTaskStatus,
      },
      runId: effectiveRunId,
      workspaceId: snapshot.workspace.id,
      workspacePath: snapshot.workspace.path,
    });
    content = typeof sdkResult.output === "string" ? sdkResult.output : JSON.stringify(sdkResult.output, null, 2);
    toolExecutions = [
      {
        toolName: `sdk:${sdkResult.agentId}`,
        args: { ...resolvedOptions.sdkAction },
        output: content,
        parsedOutput: {
          status: "success",
          summary: `SDK action ${sdkResult.actionType} completed with VTS ${sdkResult.vts}.`,
        },
        evidence: normalizeToolEvidence(
          `sdk:${sdkResult.agentId}`,
          { ...resolvedOptions.sdkAction },
          content,
          {
            status: "success",
            summary: `SDK action ${sdkResult.actionType} completed with VTS ${sdkResult.vts}.`,
          },
        ),
      },
    ];
    synthesisStatus = "valid";
    synthesisSummary = "SDK action returned a final response.";
    handledDirectTool = true;
    emitProgress(content);
  }

  if (handledDirectTool) {
    // Continue to evidence pack and memory persistence.
  } else if (apiKey && configuredModel && rainyHostAllowed && privacyPreflight?.status === "blocked") {
    content = [
      "Privacy Sentinel blocked cloud model use for this run.",
      privacyPreflight.reason,
      "Narrow context or remove raw P0 secret material before retry.",
    ].join("\n");
    events.push({
      id: "step-privacy-cloud-block",
      label: "Cloud send blocked",
      detail: privacyPreflight.reason,
      status: "error",
    });
    emitProgress(content);
  } else if (apiKey && configuredModel && rainyHostAllowed) {
    try {
      const result = await telemetryService.observe(
        "mate.provider.request",
        () => requestRainyAgenticResponse({
          apiKey,
          history,
          model: configuredModel,
          apiMode: runtimeConfig?.apiMode ?? "chat_completions",
          capabilities: runtimeConfig?.capabilities,
          modelCatalogEntry: runtimeConfig?.modelCatalogEntry,
          prompt,
          snapshot,
          workingSet,
          workPlan,
          events,
          options: resolvedOptions,
          runbookDefinition,
          emitProgress,
          appSettings,
          runId: effectiveRunId,
          signal: progressReporter?.signal,
          engineeringTaskStatus,
          workStrategy,
          planningPhase,
        }),
        {
          kind: "llm",
          attributes: {
            feature: "assistant",
            category: "generation",
            providerFamily: "rainy",
            model: configuredModel,
          },
        },
      );
      content = result.content;
      agentOutcome = result.outcome;
      toolExecutions = result.toolExecutions;
      synthesisStatus = result.synthesisStatus;
      synthesisSummary = result.synthesisSummary ?? synthesisSummary;
    } catch (error) {
      telemetryService.captureError(error, {
        operation: "mate.provider.request",
      });
      console.error(
        "Agentic loop failed:",
        sanitizeApplicationError(error),
      );
      content = buildFallbackResponse(prompt, snapshot, error);
      events.push({
        id: "step-rainy-fallback",
        label: "Rainy API fallback",
        detail:
          "The API request failed. Returning a local repo-grounded response.",
        status: "error",
      });
      emitProgress();
    }
  } else if (!apiKey) {
    content = buildFallbackResponse(prompt, snapshot);
    events.push({
      id: "step-rainy-missing",
      label: "API key not configured",
      detail: "Add your Rainy API key in Settings to enable live responses.",
      status: "error",
    });
    emitProgress();
  } else {
    content = buildFallbackResponse(prompt, snapshot);
    events.push({
      id: rainyHostAllowed
        ? "step-rainy-model-missing"
        : "step-rainy-domain-blocked",
      label: rainyHostAllowed ? "Model unavailable" : "Provider domain blocked",
      detail: rainyHostAllowed
        ? "No compatible Rainy models were found for the current API key."
        : "Workspace policy does not allow this provider connection.",
      status: "error",
    });
    emitProgress();
  }

  if (
    !repositoryOverview &&
    (workPlan.objectiveContract?.repositoryAssertions?.length ?? 0) > 0
  ) {
    const verificationProgress: ToolEvent = {
      id: "step-verifying-result",
      label: "Verifying the result",
      detail: "",
      status: "active",
      segmentKind: "tool",
      type: "validation",
      visibility: "public",
    };
    events.push(verificationProgress);
    emitProgress();
    await scheduleObjectiveVerification({
      workPlan,
      workspacePath: snapshot.workspace.path,
      workspaceId: snapshot.workspace.id,
      runId: effectiveRunId,
    });
    verificationProgress.status = "done";
    emitProgress();
    const verificationState = workPlan.objectiveContract!.actualDelta.targetState;
    events.push({
      id: `step-${workPlan.objectiveVerification!.id}`,
      label: verificationState === "satisfied"
        ? "Requested repository state verified"
        : "Requested repository state unproven",
      detail: workPlan.objectiveVerification!.assertions.map((assertion) => assertion.reason).join(" "),
      status: verificationState === "satisfied" ? "done" : "error",
      segmentKind: "tool",
      visibility: "technical",
    });
  }

  const supplementalNoOpTest = planningPhase
    ? null
    : selectSupplementalNoOpTest(workPlan, toolExecutions);
  if (supplementalNoOpTest) {
    const packageScripts = Object.fromEntries(
      workPlan.workingSet.relevantScripts.map((script) => [script.name, script.command]),
    );
    const planResult = await executeAgentToolCall({
      toolCall: {
        id: `scheduled-validation-plan-${effectiveRunId}`,
        name: "plan_validation",
        arguments: JSON.stringify({
          objective: workPlan.objectiveContract?.primaryObjective ?? prompt,
          changedFiles: [],
          impactedFiles: workPlan.workingSet.impactedFiles,
          packageScripts,
        }),
      },
      toolIndex: toolExecutions.length,
      iteration: 10_000,
      snapshot,
      events,
      emitProgress,
      appSettings,
      runId: effectiveRunId,
      engineeringTaskStatus,
      behaviorMode: resolvedOptions.behaviorMode,
      workStrategy,
      signal: progressReporter?.signal,
    });
    toolExecutions.push(planResult.toolExecution);

    if (scheduledValidationPlanMatches(
      planResult.toolExecution.parsedOutput,
      supplementalNoOpTest.command,
    )) {
      const testResult = await executeAgentToolCall({
        toolCall: {
          id: `scheduled-validation-test-${effectiveRunId}`,
          name: "run_tests",
          arguments: JSON.stringify({
            scope: supplementalNoOpTest.scope,
            plannedCommand: supplementalNoOpTest.plannedCommand,
          }),
        },
        toolIndex: toolExecutions.length,
        iteration: 10_001,
        snapshot,
        events,
        emitProgress,
        appSettings,
        runId: effectiveRunId,
        engineeringTaskStatus,
        behaviorMode: resolvedOptions.behaviorMode,
        workStrategy,
        signal: progressReporter?.signal,
      });
      toolExecutions.push(testResult.toolExecution);
    }
  }

  const finalValidationEvidence = toolExecutions.map((execution) =>
    execution.evidence ??
    normalizeToolEvidence(
      execution.toolName,
      execution.args,
      execution.output,
      execution.parsedOutput,
    ),
  );
  const actualMutationForValidation = finalValidationEvidence.some(
    (evidence) => evidence.changedFiles.length > 0,
  );
  const primaryValidationEvidence = finalValidationEvidence.find(
    (evidence) => evidence.validationStatus && evidence.validationRequirementId === "test",
  );
  const primaryStatus = primaryValidationEvidence?.validationStatus === "passed"
    ? "passed"
    : primaryValidationEvidence?.validationStatus === "failed"
      ? "failed"
      : undefined;
  const activeValidationContract = activeContractForWorkPlan(workPlan, {
    phase: "final",
    actualMutation: actualMutationForValidation,
    objectiveAlreadySatisfied: false,
    validationIsPrimaryObjective: workPlan.objectiveContract?.validationIsPrimaryObjective ?? false,
    highRiskChange: actualMutationForValidation && hasHighRiskChange(
      finalValidationEvidence.flatMap((evidence) => evidence.changedFiles.map((file) => file.path)),
    ),
    primaryStatus,
    evidence: finalValidationEvidence,
  });
  if (requiredApplicableItems(activeValidationContract).length > 0 && !planningPhase) {
    traceSession.transition("verifying");
  }
  const validationGate = evaluateValidationGate(workPlan, toolExecutions, content, {
    planningPhase,
  });
  content = appendValidationGateWarning(content, validationGate);
  if (!planningPhase && shouldEmitPreventiveWarning(workPlan, toolExecutions)) {
    events.push({
      id: "step-preventive-guard-warning",
      label: "Preventive Guard warning",
      detail: preventiveWarningDetail(workPlan),
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    });
  }
  const noPatchNeeded =
    workPlan.intent !== "patch" &&
    !toolExecutions.some((execution) =>
      /(?:file_editor|auto_patch|mutation|patch|edit)/i.test(execution.toolName),
    );
  const workStages = deriveWorkStages({
    workPlan,
    events,
    toolExecutions,
    privacyBlocked: privacyPreflight?.status === "blocked",
    evidenceAttached: false,
    noPatchNeeded,
    planningPhase,
  });
  const finalWorkPlanMetadata = buildWorkPlanMetadata(
    workPlan,
    privacyPreflight?.status ?? "pending",
    validationGate.allowed ? "completed" : "blocked",
  );
  events.push({
    id: "step-work-engine-final",
    label: "WorkPlan final gate",
    detail: JSON.stringify({
      ...finalWorkPlanMetadata,
      stages: workStages,
      planningPhase,
      engineeringTaskId: resolvedOptions.engineeringTaskId ?? null,
    }),
    status: validationGate.allowed ? "done" : "error",
    segmentKind: "tool",
    visibility: "technical",
  });

  // Stable taskId generated early and tied to the runId (when provided by caller).
  // This makes the .mate-x/evidence/<taskId> dir predictable, survives chat reloads/history,
  // and enables true standalone pack listing/browsing independent of message objects.
  const taskId = `task-${effectiveRunId}`;
  const baseEvidencePack = await buildEvidencePack({
    workspacePath: snapshot.workspace.path,
    events,
    content,
    toolExecutions,
    workPlan,
    trustContract: snapshot.trustContract,
    // Note: buildEvidencePack now internally wraps computeVerifiedTaskScore for crash resilience.
    // Attestation generation below is best-effort in surrounding try (see catch in this flow).
    runbookId: effectiveRunbookId,
    initialStatusLines: snapshot.statusLines,
  });
  const agentIdentity = await resolveAgentRunIdentity({
    workspacePath: snapshot.workspace.path,
    policySources: await loadCompliancePolicySources(snapshot.workspace.path),
  });
  const identityEvidencePack = attachAgentIdentity(baseEvidencePack, agentIdentity);
  let evidencePack = identityEvidencePack;
  const evidenceStages = deriveWorkStages({
    workPlan,
    events,
    toolExecutions,
    privacyBlocked: privacyPreflight?.status === "blocked",
    evidenceAttached: true,
    noPatchNeeded,
    planningPhase,
  });
  const evidenceFinalization = finalizeWorkRun({
    workPlan,
    stages: evidenceStages,
    toolExecutions,
    content,
    evidenceAttached: true,
    planningPhase,
    awaitingApproval: awaitingTaskApproval,
    terminalOutcome: agentOutcome,
    synthesisStatus,
    synthesisSummary,
  });
  content = evidenceFinalization.content;
  const executionOutcome = enrichExecutionOutcome({
    terminalState: evidenceFinalization.terminalState,
    completionKind: evidenceFinalization.completionKind,
    evidence: evidenceFinalization.evidence,
    summary: evidenceFinalization.summary,
  }, agentOutcome, workPlan);
  const requiredValidationIncomplete =
    (evidenceFinalization.evidence.validation.contract?.items.some(
      (item) =>
        (item.obligation === "required" || item.obligation === "fallback") &&
        item.applicability === "applicable",
    ) ?? false) &&
    evidenceFinalization.evidence.validation.status !== "passed";
  evidencePack = {
    ...evidencePack,
    status:
      evidenceFinalization.terminalState === "completed"
        ? "complete"
        : evidenceFinalization.terminalState === "partial"
          ? "partial"
          : evidenceFinalization.terminalState === "failed"
            ? "failed"
            : "blocked",
    executionOutcome,
    verifiedTaskScore: evidencePack.verifiedTaskScore
      ? {
          ...evidencePack.verifiedTaskScore,
          signals: evidencePack.verifiedTaskScore.signals.map((signal) =>
            requiredValidationIncomplete && signal.id === "validation_passed"
              ? {
                  ...signal,
                  satisfied: false,
                  evidence:
                    evidenceFinalization.evidence.validation.cause ??
                    "All required validation requirements did not pass.",
                }
              : signal,
          ),
          status:
            evidenceFinalization.terminalState === "completed"
              ? evidencePack.verifiedTaskScore.status
              : evidenceFinalization.terminalState === "partial"
                ? "partially_verified"
                : "failed",
          missingEvidence:
            evidenceFinalization.terminalState === "completed"
              ? evidencePack.verifiedTaskScore.missingEvidence
              : Array.from(
                  new Set([
                    ...evidencePack.verifiedTaskScore.missingEvidence,
                    ...(requiredValidationIncomplete ? ["Validation passed"] : []),
                    evidenceFinalization.summary,
                  ]),
                ),
        }
      : undefined,
    verdict: {
      ...evidencePack.verdict,
      label:
        evidenceFinalization.terminalState === "completed"
          ? "Completed"
          : evidenceFinalization.terminalState === "partial"
            ? "Completed partially"
            : evidenceFinalization.terminalState === "blocked"
                ? "Blocked"
                : "Run failed",
      summary: evidenceFinalization.summary,
    },
  };
  agentOutcome ??= {
    status:
      evidenceFinalization.terminalState === "blocked"
        ? "blocked"
        : evidenceFinalization.terminalState === "failed"
          ? "failed"
          : "completed",
    summary: evidenceFinalization.summary,
    ...(evidenceFinalization.terminalState === "blocked"
      ? {
          blocker: {
            code: "ACTION_NOT_ALLOWED" as const,
            requestedCapability: "workspace",
          },
        }
      : evidenceFinalization.terminalState === "failed"
        ? {}
        : {
            changes: evidencePack.filesModified,
            validation: evidencePack.testsRun,
          }),
  } as AgentOutcome;
  const attestationResult = await generateEvidenceAttestation({
    evidencePack,
    workspacePath: snapshot.workspace.path,
    taskId,
    policyApplied: effectiveRunbookId,
    agentIdentity,
    privacyScan: async (payload) => {
      const scan = await privacyFirewall.scanTextSafe(payload);
      const hasSecrets = scan.spans.some(
        (span) =>
          span.risk === "p0" ||
          span.label === "secret" ||
          span.label === "repo_secret",
      );
      return {
        hasSecrets,
        reason: hasSecrets
          ? "Privacy Firewall detected secret material in Evidence Pack payload."
          : undefined,
      };
    },
  });
  evidencePack = attestationResult.evidencePack;
  events.push({
    id: "step-work-engine-evidence",
    label: "WorkPlan evidence gate",
    segmentKind: "tool",
    visibility: "technical",
    detail: JSON.stringify({
      stages: evidenceStages,
      verdict: evidenceFinalization.verdict,
      planningPhase,
    }),
    status: ["partial", "blocked", "failed", "awaiting_approval"].includes(
      evidenceFinalization.verdict,
    )
      ? "error"
      : "done",
  });
  const artifactResult = await persistWorkEngineRunArtifactSafely({
    appDataRoot: app.getPath("userData"),
    runId: effectiveRunId,
    workspaceId: snapshot.workspace.id,
    model: configuredModel ? { provider: "rainy", id: configuredModel } : undefined,
    snapshot: buildWorkEngineArtifactSnapshot({
      prompt,
      workspace: snapshot.workspace,
      statusLines: snapshot.statusLines,
      workPlan,
      privacyPreflight,
    }),
    workPlan,
    stages: evidenceStages,
    finalVerdict: evidenceFinalization.verdict,
    executionOutcome,
    toolEvents: events,
    evidenceAttached: true,
    downgradedClaims: evidenceFinalization.warnings,
  });
  if (artifactResult.ok) {
    events.push({
      id: "step-work-engine-artifact",
      label: "Persist Work Engine artifact",
      detail: `Persisted sanitized Work Engine run artifact at ${artifactResult.artifactPath}.`,
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    });
  } else {
    events.push({
      id: "step-work-engine-artifact-missing",
      label: "Persist Work Engine artifact",
      detail: `Artifact persistence failed: ${artifactResult.error}`,
      status: "error",
      segmentKind: "tool",
      visibility: "technical",
    });
  }
  if (configuredModel) {
    scheduleProfilerWrite(
      `${snapshot.workspace.id}:${configuredModel}:${createdAt}`,
      buildAgentCapabilityRunMetrics({
        model: configuredModel,
        workspaceId: snapshot.workspace.id,
        prompt,
        content,
        events,
        toolExecutions,
        evidencePack,
        startedAt,
        completedAt: createdAt,
      }),
    );
  }
  const memoryProposals = await workspaceMemoryService.summarizeRun(
    snapshot.workspace.id,
    snapshot.workspace.path,
    {
      prompt,
      response: content,
      toolNames: toolExecutions.map((execution) => execution.toolName),
      touchedPaths: evidencePack.touchedPaths ?? [],
      completedAt: createdAt,
    },
  );
  const finalArtifacts = [
    ...artifacts,
    ...buildWorkspaceMemoryArtifacts(memoryProposals),
  ];
  traceSession.complete(executionOutcome);
  emitProgress(content, "completed");

  return {
    suggestedTitle: history.length === 0 ? buildThreadTitle(prompt) : undefined,
    executionOutcome,
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content,
      createdAt,
      events,
      artifacts: finalArtifacts,
      presentationIntent: getPresentationIntent(repositoryOverview, workPlan.intent),
      presentationEvidenceFreshness: "current_run",
      evidencePack,
      executionOutcome,
      outcome: agentOutcome,
      workingSet,
    },
  };
  } catch (error) {
    const recoveryReason = "The execution runtime stopped before final synthesis.";
    events.push({
      id: "step-agent-runtime-recovery",
      label: "Execution stopped",
      detail:
        error instanceof Error
          ? `Runtime recovery: ${error.message}`
          : "Runtime recovery: execution stopped before final synthesis.",
      status: "error",
      segmentKind: "tool",
      visibility: "technical",
    });
    const recoveryToolExecution: ToolExecutionRecord = {
      toolName: "agent_runtime",
      args: {},
      output: recoveryReason,
      parsedOutput: { status: "failed" },
      evidence: normalizeToolEvidence(
        "agent_runtime",
        {},
        recoveryReason,
        { status: "failed" },
      ),
    };
    const recoveryToolExecutions = [...toolExecutions, recoveryToolExecution];
    const failureStages = deriveWorkStages({
      workPlan,
      events,
      toolExecutions: recoveryToolExecutions,
      privacyBlocked: privacyPreflight?.status === "blocked",
      evidenceAttached: false,
      noPatchNeeded: false,
      planningPhase,
    });
    const recoveryFinalization = finalizeWorkRun({
      workPlan,
      stages: failureStages,
      toolExecutions: recoveryToolExecutions,
      content: content || "The run stopped before a final synthesis was available.",
      evidenceAttached: false,
      planningPhase,
      awaitingApproval: awaitingTaskApproval,
      terminalOutcome: agentOutcome,
      synthesisStatus: "failed",
      synthesisSummary: recoveryReason,
    });
    const recoveryOutcome = enrichExecutionOutcome({
      terminalState: recoveryFinalization.terminalState,
      completionKind: recoveryFinalization.completionKind,
      evidence: recoveryFinalization.evidence,
      summary: recoveryFinalization.summary,
    }, agentOutcome, workPlan);
    traceSession.complete(recoveryOutcome);
    await persistWorkEngineRunArtifactSafely({
      appDataRoot: app.getPath("userData"),
      runId: effectiveRunId,
      workspaceId: snapshot.workspace.id,
      snapshot: buildWorkEngineArtifactSnapshot({
        prompt,
        workspace: snapshot.workspace,
        statusLines: snapshot.statusLines,
        workPlan,
        privacyPreflight,
      }),
      workPlan,
      stages: failureStages,
      finalVerdict: recoveryFinalization.verdict,
      executionOutcome: recoveryOutcome,
      toolEvents: events,
      evidenceAttached: false,
      downgradedClaims: recoveryFinalization.warnings,
    });
    return {
      suggestedTitle: history.length === 0 ? buildThreadTitle(prompt) : undefined,
      executionOutcome: recoveryOutcome,
      message: {
        id: `assistant-recovered-${Date.now()}`,
        role: "assistant",
        content: recoveryFinalization.content,
        createdAt: new Date().toISOString(),
        events,
        artifacts,
        presentationIntent: getPresentationIntent(repositoryOverview, workPlan.intent),
        presentationEvidenceFreshness: "current_run",
        executionOutcome: recoveryOutcome,
        outcome: {
          status: "failed",
          summary: recoveryFinalization.summary,
          diagnostic: {
            code: "AGENT_RUNTIME_FAILED",
            message: recoveryReason,
          },
        },
        workingSet,
      },
    };
  } finally {
    policyService.closeRun(effectiveRunId);
  }
}

function enrichExecutionOutcome(
  outcome: import("../contracts/execution").ExecutionOutcome,
  agentOutcome?: AgentOutcome,
  workPlan?: WorkPlan,
): import("../contracts/execution").ExecutionOutcome {
  const changedFiles = outcome.evidence.changedFiles;
  const validationState = outcome.evidence.validation.status;
  const hasChanges = changedFiles.length > 0;
  const validationPassed = validationState === "passed";
  const worktreeHealth = hasChanges
    ? validationPassed
      ? "changed_verified" as const
      : "changed_unverified" as const
    : (workPlan?.workingSet.changedFiles.length ?? 0) > 0
      ? "preexisting_changes" as const
      : "unchanged" as const;
  const primaryCause =
    outcome.terminalState !== "completed" && agentOutcome && agentOutcome.status !== "completed"
      ? {
          code:
            agentOutcome.status === "blocked"
              ? agentOutcome.blocker.code
              : agentOutcome.status === "failed"
                ? agentOutcome.diagnostic?.code ?? "AGENT_FAILED"
                : "APPROVAL_REQUIRED",
          summary: agentOutcome.summary,
          source:
            agentOutcome.status === "blocked" ||
            agentOutcome.status === "needs_approval"
              ? "policy" as const
              : "runtime" as const,
        }
      : outcome.evidence.validation.cause
        ? {
            code: outcome.evidence.validation.cause,
            summary:
              outcome.evidence.validation.cause === "TOOLCHAIN_AMBIGUOUS"
                ? "Target repository toolchain metadata is ambiguous."
                : outcome.evidence.validation.cause === "TYPECHECK_UNAVAILABLE"
                ? "Required typecheck is unavailable in this repository."
                : "Required validation command is unresolved.",
            source: "validation" as const,
          }
        : null;
  const nextActions: import("../contracts/execution").CanonicalAction[] = [];
  if (hasChanges && !validationPassed) {
    nextActions.push({
      id: "retry-validation",
      type: "retry_validation",
      label: "Retry required validation",
    });
    nextActions.push({
      id: "inspect-diff",
      type: "inspect_diff",
      label: "Inspect workspace changes",
    });
  }
  if (agentOutcome?.status === "blocked") {
    nextActions.push({
      id: "review-workspace-policy",
      type: "review_workspace_policy",
      label: "Review workspace policy",
    });
  }
  return {
    ...outcome,
    primaryCause,
    worktreeHealth,
    validationState,
    files: changedFiles.map((file) => ({
      path: file.path,
      operation: file.operation,
      verification: validationPassed ? "verified" : "pending",
    })),
    recovery: [],
    nextActions,
  };
}

function scheduleProfilerWrite(
  key: string,
  run: ReturnType<typeof buildAgentCapabilityRunMetrics>,
) {
  const existing = profilerWriteTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    profilerWriteTimers.delete(key);
    Promise.resolve()
      .then(() => tursoService.recordAgentCapabilityRun(run))
      .catch((error) => {
        console.debug("Agent Capability Profiler write failed:", error);
      });
  }, 500);

  profilerWriteTimers.set(key, timer);
}

export async function getAgentRoutingRecommendation(
  task: string,
  workspaceId?: string,
): Promise<AgentRoutingRecommendation> {
  const snapshot = await collectRepoSnapshot(task, workspaceId);
  const [profiles, currentModel, appSettings] = await Promise.all([
    tursoService.listAgentCapabilityProfiles(snapshot.workspace.id),
    tursoService.getModel(),
    tursoService.getAppSettings(),
  ]);

  return recommendAgentModel({
    task,
    profiles,
    currentModel,
    autoSwitchAllowed: appSettings.agentProfilerAutoSwitch,
  });
}

function buildThreadTitle(prompt: string) {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 42) {
    return collapsed;
  }
  return `${collapsed.slice(0, 39).trimEnd()}...`;
}
