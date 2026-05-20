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
import { deriveWorkStages } from "./work-engine/stages";
import { finalizeWorkRun } from "./work-engine/finalizer";
import { persistWorkEngineRunArtifactSafely } from "./work-engine/run-artifact-runtime";
import type { AssistantExecution, AssistantRunProgress, AssistantRunOptions, MessageArtifact, ToolEvent } from "../contracts/chat";
import type { AgentRoutingRecommendation } from "../contracts/agent-capability-profiler";
import { resolveAssistantRunOptions, resolveRunbookDefinition, toAssistantRunbookId } from "./assistant-runbooks";
import { canQueryDomain } from "./workspace-trust";
import { buildAgentCapabilityRunMetrics, recommendAgentModel } from "./agent-capability-profiler";
import { collectRepoSnapshot } from "./repo-service/workspace";
import { buildArtifacts, buildFallbackResponse, buildWorkspaceMemoryArtifacts, executeAgentToolCall, parseDirectDeepAnalysisPipelineArgs, parseDirectSecurityPathTraceArgs, requestRainyAgenticResponse, resolveDefaultRainyRuntimeConfig } from "./repo-service/agentic-runtime";
import { buildWorkEngineArtifactSnapshot, loadCompliancePolicySources } from "./repo-service/work-engine-artifacts";

export { bootstrapWorkspaceState, getWorkspaceEntries, setActiveWorkspace, addWorkspace, removeWorkspace, saveWorkspaceSession, getWorkspaceSummary, getWorkspaceTrustContract, updateWorkspaceTrustContract, listFiles, searchInFiles, collectRepoSnapshot } from "./repo-service/workspace";
export type { RepoSnapshot } from "./repo-service/workspace";

interface AssistantProgressReporter {
  runId: string;
  emit: (progress: AssistantRunProgress) => void;
}

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
  const workingSet = await workingSetCompiler.compile({
    prompt,
    workspace: snapshot.workspace,
    gitState: snapshot.statusLines,
    selectedFiles: [],
    runMode: resolvedOptions.mode,
    promptMatches: snapshot.promptMatches,
    memoryContext: snapshot.memoryContext,
  });
  const workPlan = await buildWorkPlan({
    prompt,
    workspace: snapshot.workspace,
    gitStatus: snapshot.statusLines,
    workingSet,
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
    },
    {
      id: "step-working-set",
      label: "Compile working set",
      detail: `Ranked ${workingSet.metadata.totalFileCount} files within a ${workingSet.metadata.tokenBudget} token budget.`,
      status: "done",
    },
    {
      id: "step-workspace",
      label: "Read workspace metadata",
      detail: `Resolved ${snapshot.workspace.path} on branch ${snapshot.workspace.branch}.`,
      status: "done",
    },
    {
      id: "step-files",
      label: "Inventory repository surface",
      detail: `Indexed ${snapshot.files.length} files and ${snapshot.statusLines.length} git changes.`,
      status: "done",
    },
    {
      id: "step-query",
      label: "Search prompt-linked files",
      detail:
        snapshot.promptMatches.length > 0
          ? `Found ${snapshot.promptMatches.length} repo matches connected to the request.`
          : "No direct file matches from the current prompt terms.",
      status: "done",
    },
    {
      id: "step-runbook",
      label: "Resolve runbook",
      detail: `Using structured runbook: ${runbookDefinition.name} from WorkPlan ${workPlan.id}.`,
      status: "done",
    },
  ];

  try {
  const [apiKey, storedModel, appSettings] = await Promise.all([
    tursoService.getApiKey(),
    tursoService.getModel(),
    tursoService.getAppSettings(),
  ]);
  const rainyHostAllowed = canQueryDomain(
    snapshot.trustContract,
    "rainy-api-v3-us-179843975974.us-east4.run.app",
  );
  const runtimeConfig =
    apiKey && rainyHostAllowed
      ? await resolveDefaultRainyRuntimeConfig(apiKey, storedModel)
      : null;
  const configuredModel = runtimeConfig?.model ?? null;
  const hasRainyConfig = Boolean(apiKey && configuredModel && rainyHostAllowed);
  const artifacts = buildArtifacts(
    snapshot,
    hasRainyConfig,
    configuredModel,
    resolvedOptions,
  );
  const privacyPreflight =
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
    });
  }
  const createdAt = new Date().toISOString();
  let thought = "";
  let content = "";
  let toolExecutions: ToolExecutionRecord[] = [];
  let handledDirectTool = false;

  const emitProgress = (nextContent?: string, nextThought?: string) => {
    if (!progressReporter) {
      return;
    }

    if (typeof nextThought === "string") {
      thought = nextThought;
    }

    if (typeof nextContent === "string") {
      content = nextContent;
    }

    progressReporter.emit({
      runId: progressReporter.runId,
      status: "running",
      content,
      thought: thought || undefined,
      events: cloneEvents(events),
      artifacts: cloneArtifacts(artifacts),
    });
  };

  emitProgress();

  const directDeepAnalysisArgs = parseDirectDeepAnalysisPipelineArgs(prompt);
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
      runId: progressReporter?.runId ?? `assistant-${Date.now()}`,
    });

    content = result.content;
    toolExecutions = [result.toolExecution];
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
      runId: progressReporter?.runId ?? `assistant-${Date.now()}`,
    });

    content = result.content;
    toolExecutions = [result.toolExecution];
    events.push({
      id: "step-direct-security-path-trace",
      label: "Direct tool response",
      detail: "Ran security_path_trace locally because the prompt explicitly requested it.",
      status: "done",
    });
    emitProgress(content);
    handledDirectTool = true;
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
        runId: progressReporter?.runId ?? `assistant-${Date.now()}`,
      });
      thought =
        "thought" in result && typeof result.thought === "string"
          ? result.thought
          : thought;
      content = result.content;
      toolExecutions = result.toolExecutions;
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
        : "The active Workspace Trust Contract does not allow the Rainy API domain.",
      status: "error",
    });
    emitProgress();
  }

  const validationGate = evaluateValidationGate(workPlan, toolExecutions, content);
  content = appendValidationGateWarning(content, validationGate);
  const noPatchNeeded = /\b(no patch|patch not needed|no code change|read-only)\b/i.test(content);
  const workStages = deriveWorkStages({
    workPlan,
    events,
    toolExecutions,
    privacyBlocked: privacyPreflight?.status === "blocked",
    evidenceAttached: false,
    noPatchNeeded,
  });
  const finalWorkPlanMetadata = buildWorkPlanMetadata(
    workPlan,
    privacyPreflight?.status ?? "pending",
    validationGate.allowed ? "completed" : "blocked",
  );
  events.push({
    id: "step-work-engine-final",
    label: "WorkPlan final gate",
    detail: JSON.stringify({ ...finalWorkPlanMetadata, stages: workStages }),
    status: validationGate.allowed ? "done" : "error",
  });

  const taskId = `task-${Date.now()}`;
  const baseEvidencePack = await buildEvidencePack({
    workspacePath: snapshot.workspace.path,
    events,
    content,
    toolExecutions,
    runbookId: resolvedOptions.runbookId,
    initialStatusLines: snapshot.statusLines,
  });
  const agentIdentity = await resolveAgentRunIdentity({
    workspacePath: snapshot.workspace.path,
    policySources: await loadCompliancePolicySources(snapshot.workspace.path),
  });
  const identityEvidencePack = attachAgentIdentity(baseEvidencePack, agentIdentity);
  const { evidencePack } = await generateEvidenceAttestation({
    evidencePack: identityEvidencePack,
    workspacePath: snapshot.workspace.path,
    taskId,
    policyApplied: resolvedOptions.runbookId ?? "workspace-trust-contract",
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
  const evidenceStages = deriveWorkStages({
    workPlan,
    events,
    toolExecutions,
    privacyBlocked: privacyPreflight?.status === "blocked",
    evidenceAttached: true,
    noPatchNeeded,
  });
  const evidenceFinalization = finalizeWorkRun({
    workPlan,
    stages: evidenceStages,
    toolExecutions,
    content,
    evidenceAttached: true,
  });
  content = evidenceFinalization.content;
  events.push({
    id: "step-work-engine-evidence",
    label: "WorkPlan evidence gate",
    detail: JSON.stringify({ stages: evidenceStages, verdict: evidenceFinalization.verdict }),
    status: evidenceFinalization.verdict === "success" ? "done" : "error",
  });
  const artifactResult = await persistWorkEngineRunArtifactSafely({
    appDataRoot: app.getPath("userData"),
    runId: progressReporter?.runId ?? taskId,
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
    });
  } else {
    events.push({
      id: "step-work-engine-artifact-missing",
      label: "Persist Work Engine artifact",
      detail: `Artifact persistence failed: ${artifactResult.error}`,
      status: "error",
    });
  }
  if (configuredModel) {
    await tursoService.recordAgentCapabilityRun(
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
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content,
      thought: thought || undefined,
      createdAt,
      events,
      artifacts: finalArtifacts,
      evidencePack,
      workingSet,
    },
  };
  } catch (error) {
    const failureStages = deriveWorkStages({
      workPlan,
      events,
      toolExecutions: [],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: false,
    });
    await persistWorkEngineRunArtifactSafely({
      appDataRoot: app.getPath("userData"),
      runId: progressReporter?.runId ?? `assistant-failed-${Date.now()}`,
      workspaceId: snapshot.workspace.id,
      snapshot: buildWorkEngineArtifactSnapshot({
        prompt,
        workspace: snapshot.workspace,
        statusLines: snapshot.statusLines,
        workPlan,
        privacyPreflight: null,
      }),
      workPlan,
      stages: failureStages,
      finalVerdict: "failed",
      toolEvents: events,
      evidenceAttached: false,
      downgradedClaims: ["Run failed after WorkPlan creation before final response."],
    });
    throw error;
  }
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
