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
import { RAINY_API_BASE_URL } from "../config/rainy";
import type { AgentOutcome, AssistantExecution, AssistantRunProgress, AssistantRunOptions, MessageArtifact, ToolEvent } from "../contracts/chat";
import type { ExecutionSynthesisStatus } from "../contracts/execution";
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
const RAINY_API_HOSTNAME = new URL(RAINY_API_BASE_URL).hostname;

function cloneArtifacts(artifacts: MessageArtifact[]) {
  return artifacts.map((artifact) => ({ ...artifact }));
}

function cloneEvents(events: ToolEvent[]) {
  return events.map((event) => ({ ...event }));
}

export async function runAssistant(
  prompt: string,
  history: string[],
  workspaceId?: string,
  options?: AssistantRunOptions,
  progressReporter?: AssistantProgressReporter,
): Promise<AssistantExecution> {
  const startedAt = Date.now();
  const snapshot = await collectRepoSnapshot(prompt, workspaceId);
  const resolvedOptions = resolveAssistantRunOptions(options);
  const effectiveRunId = progressReporter?.runId ?? `assistant-${Date.now()}`;
  const workingSet = await workingSetCompiler.compile({
    prompt,
    workspace: snapshot.workspace,
    gitState: snapshot.statusLines,
    selectedFiles: [],
    runMode: resolvedOptions.pathKind ?? 'full',
    promptMatches: snapshot.promptMatches,
    memoryContext: snapshot.memoryContext,
  });
  const workPlan = await buildWorkPlan({
    prompt,
    workspace: snapshot.workspace,
    gitStatus: snapshot.statusLines,
    workingSet,
  });
  // EngineeringTask is sole workflow authority when linked.
  let engineeringTaskStatus: import("../contracts/engineering-task").EngineeringTaskStatus | null =
    null;
  if (resolvedOptions.engineeringTaskId) {
    try {
      const { getEngineeringCommandBus } = await import("./engineering/command-bus");
      const { createPhaseHandler } = await import("./engineering/phase-handler");
      const { getEngineeringRepository } = await import("./engineering/repository");
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
  const { isPreApprovalStatus } = await import("../contracts/engineering-phase-result");
  const awaitingTaskApproval = Boolean(
    engineeringTaskStatus && isPreApprovalStatus(engineeringTaskStatus),
  );
  const planningPhase =
    resolvedOptions.behaviorMode !== "execute" ||
    awaitingTaskApproval;
  policyService.registerRunContext({
    runId: effectiveRunId,
    workspaceId: snapshot.workspace.id,
    workspacePath: snapshot.workspace.path,
    behaviorMode: resolvedOptions.behaviorMode,
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
  const runbookDefinition = resolveRunbookDefinition(
    resolvedOptions.runbookId ?? toAssistantRunbookId(workPlan.runbook),
  );
  const initialWorkPlanMetadata = buildWorkPlanMetadata(workPlan, "pending");
  const events: ToolEvent[] = [
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
  ];
  let artifacts: MessageArtifact[] = [];
  let privacyPreflight: Awaited<ReturnType<typeof runPrivacyPreflight>> | null = null;
  let content = "";
  let agentOutcome: AgentOutcome | undefined;
  let toolExecutions: ToolExecutionRecord[] = [];
  let synthesisStatus: ExecutionSynthesisStatus = "failed";
  let synthesisSummary = "No valid final synthesis was returned.";

  try {
  const [apiKey, storedModel, appSettings] = await Promise.all([
    tursoService.getApiKey(),
    tursoService.getModel(),
    tursoService.getAppSettings(),
  ]);
  const rainyHostAllowed = canQueryDomain(
    snapshot.trustContract,
    RAINY_API_HOSTNAME,
  );
  const runtimeConfig =
    apiKey && rainyHostAllowed
      ? await resolveDefaultRainyRuntimeConfig(apiKey, storedModel)
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

  const emitProgress = (nextContent?: string) => {
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

    progressReporter.emit({
      runId: progressReporter.runId,
      status: "running",
      content,
      events: cloneEvents(events),
      artifacts: cloneArtifacts(artifacts),
      outcome: agentOutcome,
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
      const result = await requestRainyAgenticResponse({
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
        planningPhase,
      });
      content = result.content;
      agentOutcome = result.outcome;
      toolExecutions = result.toolExecutions;
      synthesisStatus = result.synthesisStatus;
      synthesisSummary = result.synthesisSummary ?? synthesisSummary;
    } catch (error) {
      console.error("Agentic loop failed:", error);
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
  const noPatchNeeded = /\b(no patch|patch not needed|no code change|read-only)\b/i.test(content);
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
    trustContract: snapshot.trustContract,
    // Note: buildEvidencePack now internally wraps computeVerifiedTaskScore for crash resilience.
    // Attestation generation below is best-effort in surrounding try (see catch in this flow).
    runbookId: resolvedOptions.runbookId,
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
  if (agentOutcome?.status === "blocked" || agentOutcome?.status === "failed") {
    content = agentOutcome.summary;
  }
  const executionOutcome = {
    terminalState: evidenceFinalization.terminalState,
    evidence: evidenceFinalization.evidence,
    summary: evidenceFinalization.summary,
  };
  evidencePack = {
    ...evidencePack,
    status:
      evidenceFinalization.terminalState === "succeeded"
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
          status:
            evidenceFinalization.terminalState === "succeeded"
              ? evidencePack.verifiedTaskScore.status
              : evidenceFinalization.terminalState === "partial"
                ? "partially_verified"
                : "failed",
          missingEvidence:
            evidenceFinalization.terminalState === "succeeded"
              ? evidencePack.verifiedTaskScore.missingEvidence
              : Array.from(
                  new Set([
                    ...evidencePack.verifiedTaskScore.missingEvidence,
                    evidenceFinalization.summary,
                  ]),
                ),
        }
      : undefined,
    verdict: {
      ...evidencePack.verdict,
      label:
        evidenceFinalization.terminalState === "succeeded"
          ? "Completed"
          : evidenceFinalization.terminalState === "partial"
            ? "Completed partially"
            : evidenceFinalization.terminalState === "awaiting_approval"
              ? "Approval required"
              : evidenceFinalization.terminalState === "blocked"
                ? "Blocked"
                : "Run failed",
      summary: evidenceFinalization.summary,
    },
  };
  agentOutcome ??= {
    status:
      evidenceFinalization.terminalState === "blocked" ||
      evidenceFinalization.terminalState === "awaiting_approval"
        ? "blocked"
        : evidenceFinalization.terminalState === "failed"
          ? "failed"
          : "completed",
    summary: evidenceFinalization.summary,
    ...(evidenceFinalization.terminalState === "blocked" ||
    evidenceFinalization.terminalState === "awaiting_approval"
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
    policyApplied: resolvedOptions.runbookId ?? "workspace-policy-v2",
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
    const recoveryOutcome = {
      terminalState: recoveryFinalization.terminalState,
      evidence: recoveryFinalization.evidence,
      summary: recoveryFinalization.summary,
    };
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
