import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

import { buildEvidencePack, type ToolExecutionRecord } from "./evidence-pack";
import { GitService } from "./git-service";
import { policyService } from "./policy-service";
import {
  buildResponsesMessageInput,
  extractResponseThought,
  extractResponseFunctionCalls,
  listRainyModels,
  requestRainyChatCompletion,
  requestRainyChatCompletionStream,
  requestRainyResponsesCompletion,
  resolvePreferredRainyApiMode,
} from "./rainy-service";
import { toolService } from "./tool-service";
import { tursoService } from "./turso-service";
import { repoGraphService } from "./repo-graph-service";
import {
  renderWorkingSetForPrompt,
  workingSetCompiler,
} from "./working-set-compiler";
import { workspaceMemoryService } from "./workspace-memory-service";
import { createTokenEstimator } from "./token-estimator";
import type {
  AssistantExecution,
  AssistantRunbookDefinition,
  AssistantRunbookId,
  AssistantRunProgress,
  AssistantRunOptions,
  Conversation,
  MessageArtifact,
  ToolEvent,
} from "../contracts/chat";
import type { RainyApiMode } from "../contracts/rainy";
import type {
  SearchMatch,
  WorkspaceMemoryBootstrapContext,
  WorkspaceMemoryProposedUpdate,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceSummary,
  WorkspaceTrustContract,
} from "../contracts/workspace";
import {
  MATE_AGENT_PROMPT_STOP_WORDS,
  MATE_AGENT_SYSTEM_PROMPT,
} from "../config/mate-agent";
import {
  canQueryDomain,
  renderTrustContractForPrompt,
} from "./workspace-trust";
import type { AppSettings } from "../contracts/settings";

const execFileAsync = promisify(execFile);

export interface RepoSnapshot {
  workspace: WorkspaceSummary;
  trustContract: WorkspaceTrustContract;
  files: string[];
  packageJson: string | null;
  statusLines: string[];
  promptMatches: SearchMatch[];
  memoryContext?: WorkspaceMemoryBootstrapContext;
}

interface AgentRuntimeConfig {
  maxIterations: number;
  minToolRounds: number;
  maxToolCalls: number;
  requireToolingFirst: boolean;
  executionIntent: boolean;
}

interface AssistantProgressReporter {
  runId: string;
  emit: (progress: AssistantRunProgress) => void;
}

interface AgentToolCall {
  id: string;
  name: string;
  arguments?: string;
}

const DEFAULT_ASSISTANT_OPTIONS: AssistantRunOptions = {
  reasoning: "high",
  mode: "build",
  access: "full",
  runbookId: "patch_test_verify",
};
const RUNBOOK_DEFINITIONS: Record<
  AssistantRunbookId,
  AssistantRunbookDefinition
> = {
  patch_test_verify: {
    id: "patch_test_verify",
    name: "Patch -> Test -> Verify",
    objective:
      "Deliver safe code change with explicit patch, test outcome, and verification evidence.",
    mandatoryStages: [
      {
        id: "patch",
        name: "Patch",
        required: true,
        description:
          "Define target files and apply minimal scoped code changes.",
      },
      {
        id: "test",
        name: "Test",
        required: true,
        description:
          "Run relevant checks and record concrete pass/fail or blocked status.",
      },
      {
        id: "verify",
        name: "Verify",
        required: true,
        description:
          "Confirm behavior, summarize residual risk, and map outcomes to user request.",
      },
    ],
    requiredChecks: [
      "Show exactly what changed.",
      "Run at least one relevant validation command or explain blockage.",
      "State whether requested behavior is now satisfied.",
    ],
    successCriteria: [
      "Patch stage complete with touched files listed.",
      "Test stage complete with command and outcome.",
      "Verify stage complete with confidence and unresolved risks.",
    ],
    stopConditions: [
      "Safety or trust-contract policy prevents required action.",
      "Test failure indicates regression or uncertain outcome.",
      "Insufficient repository evidence to complete verification.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
  audit_reproduce_remediate: {
    id: "audit_reproduce_remediate",
    name: "Audit -> Reproduce -> Remediate",
    objective:
      "Audit suspicious behavior, reproduce issue deterministically, then remediate with evidence.",
    mandatoryStages: [
      {
        id: "audit",
        name: "Audit",
        required: true,
        description:
          "Inspect relevant code paths, configs, and signals to identify risk surface.",
      },
      {
        id: "reproduce",
        name: "Reproduce",
        required: true,
        description:
          "Provide deterministic reproduction steps and expected/actual behavior.",
      },
      {
        id: "remediate",
        name: "Remediate",
        required: true,
        description:
          "Apply mitigation or fix, then confirm risk reduction and side effects.",
      },
    ],
    requiredChecks: [
      "List impacted component or file boundaries.",
      "Include exact reproduction command or procedure.",
      "State remediation scope and potential regressions.",
    ],
    successCriteria: [
      "Audit stage identifies root cause or narrowed hypothesis.",
      "Reproduction stage is repeatable.",
      "Remediation stage includes validation result.",
    ],
    stopConditions: [
      "Unable to reproduce despite complete inputs.",
      "Remediation introduces unacceptable security or stability risk.",
      "Required environment or permissions unavailable.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
  review_classify_summarize: {
    id: "review_classify_summarize",
    name: "Review -> Classify -> Summarize",
    objective:
      "Review findings, classify by severity/impact, and summarize actionable outcomes.",
    mandatoryStages: [
      {
        id: "review",
        name: "Review",
        required: true,
        description:
          "Inspect relevant artifacts and collect concrete findings with references.",
      },
      {
        id: "classify",
        name: "Classify",
        required: true,
        description:
          "Rank findings by severity, exploitability, and confidence.",
      },
      {
        id: "summarize",
        name: "Summarize",
        required: true,
        description:
          "Deliver concise executive and technical summary with next actions.",
      },
    ],
    requiredChecks: [
      "Every finding includes evidence or rationale.",
      "Classification uses explicit severity labels.",
      "Summary includes top risks and remediation priority.",
    ],
    successCriteria: [
      "No unclassified critical finding remains.",
      "Classification rationale is consistent.",
      "Summary supports immediate decision-making.",
    ],
    stopConditions: [
      "Evidence insufficient to classify with confidence.",
      "Source artifacts missing or corrupted.",
      "Requested scope conflicts with trust policy.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
  scan_contain_report: {
    id: "scan_contain_report",
    name: "Scan -> Contain -> Report",
    objective:
      "Scan for active threats, contain blast radius, and report status with traceable evidence.",
    mandatoryStages: [
      {
        id: "scan",
        name: "Scan",
        required: true,
        description:
          "Identify indicators of compromise, exposure, or policy violations.",
      },
      {
        id: "contain",
        name: "Contain",
        required: true,
        description:
          "Apply immediate controls to reduce spread and protect critical assets.",
      },
      {
        id: "report",
        name: "Report",
        required: true,
        description:
          "Communicate incident status, impact, and remaining risks to stakeholders.",
      },
    ],
    requiredChecks: [
      "Document indicators and scan scope.",
      "Describe containment action and residual exposure.",
      "Include incident timeline and owner handoff notes.",
    ],
    successCriteria: [
      "Scan evidence captures current threat state.",
      "Containment materially reduces exposure.",
      "Report includes clear recommendations and open risks.",
    ],
    stopConditions: [
      "Containment action could cause broader outage without approval.",
      "Insufficient privileges to apply controls.",
      "Threat state unknown due to missing telemetry.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
};
const TOOL_BATCH_MAX_CONCURRENCY = 6;
const TOOL_EXECUTION_TIMEOUT_MS = 20_000;
const MAX_TOOL_OUTPUT_CHARS = 80_000;

export async function bootstrapWorkspaceState(): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  return buildWorkspaceSnapshot(activeWorkspaceId);
}

export async function getWorkspaceEntries(): Promise<WorkspaceEntry[]> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  return tursoService.getWorkspaces();
}

export async function setActiveWorkspace(
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new Error("Workspace not found.");
  }

  await tursoService.setActiveWorkspaceId(workspaceId);
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (workspace) {
    await tursoService.upsertWorkspace(workspace.path, true);
  }
  return buildWorkspaceSnapshot(workspaceId);
}

export async function addWorkspace(
  workspacePath: string,
): Promise<WorkspaceSnapshot> {
  await access(workspacePath);
  const workspaceId = await tursoService.upsertWorkspace(workspacePath, true);
  return buildWorkspaceSnapshot(workspaceId);
}

export async function removeWorkspace(
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  await tursoService.removeWorkspace(workspaceId);
  const remaining = await tursoService.getWorkspaces();

  if (remaining.length === 0) {
    const seededWorkspaceId = await tursoService.upsertWorkspace(
      process.cwd(),
      true,
    );
    return buildWorkspaceSnapshot(seededWorkspaceId);
  }

  const activeWorkspaceId =
    (await tursoService.getActiveWorkspaceId()) ?? remaining[0].id;
  return buildWorkspaceSnapshot(activeWorkspaceId);
}

export async function saveWorkspaceSession(
  workspaceId: string,
  threads: Conversation[],
  activeThreadId: string,
) {
  await tursoService.saveWorkspaceSession(workspaceId, threads, activeThreadId);
}

export async function getWorkspaceSummary(
  workspaceId?: string,
): Promise<WorkspaceSummary> {
  const workspace = await resolveWorkspace(workspaceId);
  return buildWorkspaceSummary(workspace);
}

export async function getWorkspaceTrustContract(
  workspaceId?: string,
): Promise<WorkspaceTrustContract> {
  const workspace = await resolveWorkspace(workspaceId);
  return tursoService.getWorkspaceTrustContract(workspace.id);
}

export async function updateWorkspaceTrustContract(
  contract: WorkspaceTrustContract,
): Promise<WorkspaceTrustContract> {
  const workspace = await resolveWorkspace(contract.workspaceId);
  return tursoService.setWorkspaceTrustContract(workspace.id, contract);
}

export async function listFiles(
  limit = 120,
  workspaceId?: string,
): Promise<string[]> {
  const workspace = await resolveWorkspace(workspaceId);
  return listWorkspaceFiles(workspace.path, limit);
}

export async function searchInFiles(
  query: string,
  limit = 20,
  workspaceId?: string,
): Promise<SearchMatch[]> {
  const workspace = await resolveWorkspace(workspaceId);
  return searchWorkspaceFiles(workspace.path, query, limit);
}

export async function collectRepoSnapshot(
  prompt: string,
  workspaceId?: string,
): Promise<RepoSnapshot> {
  const workspace = await resolveWorkspace(workspaceId);
  const promptPattern = buildPromptPattern(prompt);
  const [
    summary,
    trustContract,
    files,
    packageJson,
    status,
    promptMatches,
    memoryContext,
  ] =
    await Promise.all([
      buildWorkspaceSummary(workspace),
      tursoService.getWorkspaceTrustContract(workspace.id),
      listWorkspaceFiles(workspace.path, 200),
      readFileMaybe(workspace.path, "package.json"),
      new GitService(workspace.path).getStatus(),
      promptPattern
        ? searchWorkspaceFiles(workspace.path, promptPattern, 16)
        : Promise.resolve([]),
      workspaceMemoryService.getBootstrapContext(workspace.id, workspace.path),
    ]);

  return {
    workspace: summary,
    trustContract,
    files,
    packageJson,
    statusLines: status.files.map(
      (f) => `${f.index}${f.working_dir} ${f.path}`,
    ),
    promptMatches,
    memoryContext,
  };
}

export async function runAssistant(
  prompt: string,
  history: string[],
  workspaceId?: string,
  options?: AssistantRunOptions,
  progressReporter?: AssistantProgressReporter,
): Promise<AssistantExecution> {
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
  const runbookDefinition = resolveRunbookDefinition(
    resolvedOptions.runbookId ?? "patch_test_verify",
  );
  const events: ToolEvent[] = [
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
      detail: `Using structured runbook: ${runbookDefinition.name}.`,
      status: "done",
    },
  ];

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
  const createdAt = new Date().toISOString();
  let thought = "";
  let content = "";
  let toolExecutions: ToolExecutionRecord[] = [];

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

  if (apiKey && configuredModel && rainyHostAllowed) {
    try {
      const result = await requestRainyAgenticResponse({
        apiKey,
        history,
        model: configuredModel,
        apiMode: runtimeConfig?.apiMode ?? "chat_completions",
        prompt,
        snapshot,
        workingSet,
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

  const evidencePack = await buildEvidencePack({
    workspacePath: snapshot.workspace.path,
    events,
    content,
    toolExecutions,
    runbookId: resolvedOptions.runbookId,
  });
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
}

async function buildWorkspaceSnapshot(
  activeWorkspaceId: string | null,
): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  const resolvedWorkspaceId =
    activeWorkspaceId ?? (await tursoService.getActiveWorkspaceId());

  if (!resolvedWorkspaceId) {
    throw new Error("No workspace is available.");
  }

  const workspace = await resolveWorkspace(resolvedWorkspaceId, workspaces);
  const [summary, trustContract, files, signals, session] = await Promise.all([
    buildWorkspaceSummary(workspace),
    tursoService.getWorkspaceTrustContract(workspace.id),
    listWorkspaceFiles(workspace.path, 18),
    searchWorkspaceFiles(
      workspace.path,
      "OpenAI|ipc|thread|sidebar|composer",
      10,
    ),
    tursoService.getWorkspaceSession(workspace.id),
    workspaceMemoryService.getStatus(workspace.id, workspace.path),
  ]);

  return {
    activeWorkspaceId: workspace.id,
    workspaces,
    workspace: summary,
    trustContract,
    files,
    signals,
    threads: session.threads,
    activeThreadId: session.activeThreadId,
  };
}

async function resolveWorkspace(
  workspaceId?: string,
  cachedWorkspaces?: WorkspaceEntry[],
): Promise<WorkspaceEntry> {
  const workspaces = cachedWorkspaces ?? (await tursoService.getWorkspaces());
  const resolvedId =
    workspaceId ??
    (await tursoService.getActiveWorkspaceId()) ??
    workspaces[0]?.id;
  const workspace = workspaces.find((entry) => entry.id === resolvedId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  return workspace;
}

async function buildWorkspaceSummary(
  workspace: WorkspaceEntry,
): Promise<WorkspaceSummary> {
  const [status, files, packageJson] = await Promise.all([
    new GitService(workspace.path).getStatusSafe(),
    listWorkspaceFiles(workspace.path, 180),
    readFileMaybe(workspace.path, "package.json"),
  ]);

  const stack = deriveStack(files, packageJson);
  const dirtyCount = status?.files.length ?? 0;
  const apiKey = await tursoService.getApiKey();

  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    branch: status?.current || "not-a-repo",
    status: "ready",
    stack,
    facts: [
      {
        label: "Package manager",
        value: packageJson?.includes('"bun') ? "bun" : "unknown",
      },
      { label: "Tracked files", value: String(files.length) },
      {
        label: "Git changes",
        value: dirtyCount > 0 ? `${dirtyCount} pending` : "clean",
      },
      {
        label: "IPC",
        value: files.some((file) => file.includes("preload"))
          ? "present"
          : "missing",
      },
      {
        label: "AI provider",
        value: apiKey ? "Rainy API connected" : "Rainy API incomplete",
      },
    ],
  };
}

async function listWorkspaceFiles(
  workspacePath: string,
  limit = 120,
): Promise<string[]> {
  const { stdout } = await execFileAsync("rg", ["--files", "."], {
    cwd: workspacePath,
  });

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function searchWorkspaceFiles(
  workspacePath: string,
  query: string,
  limit = 20,
): Promise<SearchMatch[]> {
  if (!query.trim()) {
    return [];
  }

  const args = ["-n", "--no-heading", "--color", "never", "-S", query, "."];

  try {
    const { stdout } = await execFileAsync("rg", args, { cwd: workspacePath });

    return stdout
      .split("\n")
      .map((line) => parseSearchLine(line))
      .filter((match): match is SearchMatch => match !== null)
      .slice(0, limit);
  } catch (error) {
    const failed = error as { stdout?: string; code?: number };

    if (failed.code === 1 && !failed.stdout) {
      return [];
    }

    if (failed.stdout) {
      return failed.stdout
        .split("\n")
        .map((line) => parseSearchLine(line))
        .filter((match): match is SearchMatch => match !== null)
        .slice(0, limit);
    }

    throw error;
  }
}

async function readFileMaybe(workspacePath: string, relativePath: string) {
  try {
    const { stdout } = await execFileAsync("cat", [relativePath], {
      cwd: workspacePath,
    });
    return stdout;
  } catch {
    return null;
  }
}

function deriveStack(files: string[], packageJson: string | null) {
  const stack = new Set<string>();

  if (files.some((file) => file.endsWith("src/main.ts"))) stack.add("Electron");
  if (packageJson?.includes('"react"')) stack.add("React");
  if (packageJson?.includes('"@tanstack/react-router"'))
    stack.add("TanStack Router");
  if (packageJson?.includes('"tailwindcss"')) stack.add("Tailwind CSS v4");
  if (packageJson?.includes('"zustand"')) stack.add("Zustand");
  if (packageJson?.includes('"@base-ui/react"')) stack.add("Base UI");

  return Array.from(stack);
}

function parseSearchLine(line: string): SearchMatch | null {
  const match = line.match(/^(.+?):(\d+):(.*)$/);

  if (!match) {
    return null;
  }

  return {
    file: match[1],
    line: Number(match[2]),
    text: match[3].trim(),
  };
}

function buildThreadTitle(prompt: string) {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 42) {
    return collapsed;
  }
  return `${collapsed.slice(0, 39).trimEnd()}...`;
}

function buildPromptPattern(prompt: string) {
  const terms = Array.from(
    new Set(
      prompt
        .toLowerCase()
        .match(/[a-z0-9_-]{4,}/g)
        ?.filter((term) => !MATE_AGENT_PROMPT_STOP_WORDS.has(term))
        .slice(0, 6) ?? [],
    ),
  );

  return terms.length > 0 ? terms.join("|") : "";
}

function resolveAssistantRunOptions(
  options?: AssistantRunOptions,
): AssistantRunOptions {
  return {
    reasoning:
      options?.reasoning === "low" || options?.reasoning === "max"
        ? options.reasoning
        : DEFAULT_ASSISTANT_OPTIONS.reasoning,
    mode:
      options?.mode === "plan" ? options.mode : DEFAULT_ASSISTANT_OPTIONS.mode,
    access:
      options?.access === "approval"
        ? options.access
        : DEFAULT_ASSISTANT_OPTIONS.access,
    runbookId: resolveRunbookId(options?.runbookId),
  };
}

function resolveRunbookId(runbookId?: AssistantRunbookId): AssistantRunbookId {
  return runbookId && RUNBOOK_DEFINITIONS[runbookId]
    ? runbookId
    : (DEFAULT_ASSISTANT_OPTIONS.runbookId ?? "patch_test_verify");
}

function resolveRunbookDefinition(
  runbookId: AssistantRunbookId,
): AssistantRunbookDefinition {
  return RUNBOOK_DEFINITIONS[runbookId];
}

function renderRunbookForPrompt(runbook: AssistantRunbookDefinition): string {
  const mandatoryStages = runbook.mandatoryStages
    .map(
      (stage, index) =>
        `${index + 1}. ${stage.name} (${stage.required ? "required" : "optional"}) - ${stage.description}`,
    )
    .join("\n");
  const requiredChecks = runbook.requiredChecks
    .map((check, index) => `${index + 1}. ${check}`)
    .join("\n");
  const successCriteria = runbook.successCriteria
    .map((criterion, index) => `${index + 1}. ${criterion}`)
    .join("\n");
  const stopConditions = runbook.stopConditions
    .map((condition, index) => `${index + 1}. ${condition}`)
    .join("\n");
  const finalEvidenceFormat = runbook.finalEvidenceFormat
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");

  return [
    `Runbook: ${runbook.name}`,
    `Objective: ${runbook.objective}`,
    "Mandatory stages:",
    mandatoryStages,
    "Required checks:",
    requiredChecks,
    "Success criteria:",
    successCriteria,
    "Stop conditions:",
    stopConditions,
    "Final evidence format:",
    finalEvidenceFormat,
  ].join("\n");
}

function buildAgentRuntimeConfig(
  options: AssistantRunOptions,
  prompt = "",
): AgentRuntimeConfig {
  const executionIntent =
    options.mode === "build" && isExecutionIntentPrompt(prompt);
  const requireToolingFirst = executionIntent;
  const minToolRounds = executionIntent ? 1 : 0;

  switch (options.reasoning) {
    case "low":
      return {
        maxIterations: options.mode === "plan" ? 5 : 6,
        minToolRounds,
        maxToolCalls: 20,
        requireToolingFirst,
        executionIntent,
      };
    case "max":
      return {
        maxIterations: options.mode === "plan" ? 10 : 12,
        minToolRounds,
        maxToolCalls: 200,
        requireToolingFirst,
        executionIntent,
      };
    default:
      return {
        maxIterations: options.mode === "plan" ? 8 : 9,
        minToolRounds,
        maxToolCalls: 100,
        requireToolingFirst,
        executionIntent,
      };
  }
}

function isExecutionIntentPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return [
    /\b(run|rerun|retry|continue|execute|apply|update|install|fix|verify|test|commit|push)\b/,
    /\b(reintenta|intenta|continua|continúa|ejecuta|aplica|actualiza|instala|arregla|verifica|prueba)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function summarizeCheckpoint(content: unknown) {
  const collapsed = normalizeAssistantText(content).replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }

  return collapsed.length <= 220
    ? collapsed
    : `${collapsed.slice(0, 217).trimEnd()}...`;
}

function summarizeToolOutput(content: unknown) {
  const normalized = normalizeAssistantText(content)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Tool returned no textual output.";
  }

  return normalized.length <= 180
    ? normalized
    : `${normalized.slice(0, 177).trimEnd()}...`;
}

function normalizeAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function buildNoContentFinalResponse(params: {
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
}) {
  const recentEvents = params.events
    .slice(-3)
    .map((event) => `- ${event.label}: ${event.detail}`);

  return [
    "The run completed, but the model returned no final synthesis.",
    "",
    `Summary: ${params.iterations} pass(es), ${params.toolRounds} tool round(s), ${params.totalToolCalls} tool call(s).`,
    "",
    "Last steps:",
    ...(recentEvents.length > 0 ? recentEvents : ["- No events captured."]),
  ].join("\n");
}

async function attemptFinalChatSynthesis({
  apiKey,
  model,
  messages,
  iterations,
  toolRounds,
  totalToolCalls,
  events,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  messages: any[];
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
  emitProgress: () => void;
}) {
  const eventId = "step-agent-final-synthesis";
  events.push({
    id: eventId,
    label: "Final synthesis",
    detail:
      "Tool loop ended without a clear final answer. Requesting one final synthesis.",
    status: "active",
  });
  emitProgress();

  messages.push({
    role: "user",
    content:
      "Provide the final answer now using the collected tool evidence. Do not call tools. Return only the final synthesis.",
  });

  try {
    const response = await requestRainyChatCompletion({
      apiKey,
      messages,
      model,
      toolChoice: "none",
    });
    const finalMessage = response.choices[0]?.message;
    if (finalMessage) {
      messages.push(finalMessage);
    }

    const finalText = normalizeAssistantText(finalMessage?.content).trim();
    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "done";
      event.detail = finalText
        ? "Final synthesis generated."
        : `No text returned. Ending after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`;
    }
    emitProgress();

    return finalText;
  } catch (error) {
    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "error";
      event.detail =
        error instanceof Error
          ? error.message
          : "Failed to generate final synthesis.";
    }
    emitProgress();
    return "";
  }
}

async function attemptFinalResponsesSynthesis({
  apiKey,
  model,
  previousResponseId,
  iterations,
  toolRounds,
  totalToolCalls,
  events,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  previousResponseId?: string;
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
  emitProgress: () => void;
}) {
  const eventId = "step-agent-final-synthesis";
  events.push({
    id: eventId,
    label: "Final synthesis",
    detail:
      "Tool loop ended without a clear final answer. Requesting one final synthesis.",
    status: "active",
  });
  emitProgress();

  try {
    const response = await requestRainyResponsesCompletion({
      apiKey,
      model,
      previousResponseId,
      toolChoice: "none",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Provide the final answer now using the collected tool evidence. Do not call tools. Return only the final synthesis.",
            },
          ],
        },
      ],
    });
    const finalText = normalizeAssistantText(response.output_text).trim();

    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "done";
      event.detail = finalText
        ? "Final synthesis generated."
        : `No text returned. Ending after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`;
    }
    emitProgress();

    return finalText;
  } catch (error) {
    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "error";
      event.detail =
        error instanceof Error
          ? error.message
          : "Failed to generate final synthesis.";
    }
    emitProgress();
    return "";
  }
}

function buildHistoryMessages(
  history: string[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.flatMap((entry) => {
    const match = entry.match(/^(user|assistant):\s*/i);
    if (!match) {
      const collapsed = entry.trim();
      return collapsed ? [{ role: "user" as const, content: collapsed }] : [];
    }

    const role: "user" | "assistant" =
      match[1].toLowerCase() === "assistant" ? "assistant" : "user";
    const content = entry.slice(match[0].length).trim();

    return content ? [{ role, content }] : [];
  });
}

function cloneArtifacts(artifacts: MessageArtifact[]) {
  return artifacts.map((artifact) => ({ ...artifact }));
}

function cloneEvents(events: ToolEvent[]) {
  return events.map((event) => ({ ...event }));
}

function buildArtifacts(
  snapshot: RepoSnapshot,
  providerReady: boolean,
  configuredModel: string | null,
  options: AssistantRunOptions,
): MessageArtifact[] {
  return [
    {
      id: "artifact-provider",
      label: "Provider",
      value: providerReady ? "Rainy API v3" : "Local fallback",
      tone: providerReady ? "success" : "warning",
    },
    {
      id: "artifact-model",
      label: "Model",
      value: providerReady
        ? (configuredModel ?? "unknown")
        : (configuredModel ?? "not configured"),
    },
    {
      id: "artifact-mode",
      label: "Mode",
      value: options.mode,
    },
    {
      id: "artifact-reasoning",
      label: "Reasoning",
      value: options.reasoning,
    },
    {
      id: "artifact-runbook",
      label: "Runbook",
      value: options.runbookId ?? "patch_test_verify",
      tone: "success",
    },
    {
      id: "artifact-access",
      label: "Contract",
      value: `${snapshot.trustContract.name} v${snapshot.trustContract.version}`,
      tone: "success",
    },
    {
      id: "artifact-autonomy",
      label: "Autonomy",
      value: snapshot.trustContract.autonomy,
    },
    {
      id: "artifact-branch",
      label: "Branch",
      value: snapshot.workspace.branch,
    },
    {
      id: "artifact-files",
      label: "Files indexed",
      value: String(snapshot.files.length),
    },
  ];
}

function buildWorkspaceMemoryArtifacts(
  proposals: WorkspaceMemoryProposedUpdate[],
): MessageArtifact[] {
  const proposedTargets = proposals
    .map((proposal) => proposal.filename)
    .join(", ");

  return [
    {
      id: "artifact-workspace-memory-workstate",
      label: "Workspace memory",
      value: "WORKSTATE.md updated",
      tone: "success",
    },
    {
      id: "artifact-workspace-memory-proposals",
      label: "Memory proposals",
      value: proposedTargets || "none",
      tone: proposals.length > 0 ? "warning" : "default",
    },
  ];
}

function buildFallbackResponse(
  prompt: string,
  snapshot: RepoSnapshot,
  error?: unknown,
) {
  const matches =
    snapshot.promptMatches.length > 0
      ? snapshot.promptMatches
          .slice(0, 4)
          .map((match) => `- ${match.file}:${match.line} ${match.text}`)
          .join("\n")
      : "- No prompt-linked file matches were found.";

  const gitLines =
    snapshot.statusLines.length > 0
      ? snapshot.statusLines
          .slice(0, 6)
          .map((line) => `- ${line}`)
          .join("\n")
      : "- Working tree clean.";

  const errorLine =
    error instanceof Error ? `\n\nRainy API error: ${error.message}` : "";

  return [
    `Request: ${prompt}`,
    "",
    `Workspace: ${snapshot.workspace.name}`,
    `Path: ${snapshot.workspace.path}`,
    `Branch: ${snapshot.workspace.branch}`,
    "",
    "Relevant matches:",
    matches,
    "",
    "Git status:",
    gitLines,
    "",
    "Next move: inspect the matched files and update the active workspace flow before making changes.",
    errorLine,
  ].join("\n");
}

function truncateToolOutput(content: string) {
  if (content.length <= MAX_TOOL_OUTPUT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... (truncated ${content.length - MAX_TOOL_OUTPUT_CHARS} characters)`;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    );

    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const safeConcurrency = Math.max(
    1,
    Math.min(concurrency, values.length || 1),
  );
  const results = new Array<R>(values.length);
  let currentIndex = 0;

  async function runWorker() {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;

      if (index >= values.length) {
        return;
      }

      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));

  return results;
}

async function executeAgentToolCall({
  toolCall,
  toolIndex,
  iteration,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
}: {
  toolCall: AgentToolCall;
  toolIndex: number;
  iteration: number;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: () => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const toolName = toolCall.name;
  const eventId = `tool-${iteration}-${toolIndex}-${toolName}`;
  const rawArguments = toolCall.arguments;
  let toolArgs: Record<string, unknown>;

  try {
    toolArgs = rawArguments ? JSON.parse(rawArguments) : {};
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Invalid tool arguments.";
    events.push({
      id: eventId,
      label: `Failed ${toolName}`,
      detail: reason,
      status: "error",
    });
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool argument parsing failed for ${toolName}: ${reason}`,
      toolExecution: {
        toolName,
        args: {},
        output: `Tool argument parsing failed for ${toolName}: ${reason}`,
      } satisfies ToolExecutionRecord,
    };
  }

  const policyStop = policyService.evaluateToolCall({
    runId,
    workspacePath: snapshot.workspace.path,
    toolName,
    args: toolArgs,
    contract: snapshot.trustContract,
  });
  const toolPolicy = policyService.classifyToolCall({
    workspacePath: snapshot.workspace.path,
    toolName,
    args: toolArgs,
    contract: snapshot.trustContract,
  });

  if (policyStop) {
    events.push({
      id: eventId,
      label: policyStop.title,
      detail: `${policyStop.explanation} Policy: ${policyStop.policyId}.`,
      status: "error",
      policy: toolPolicy,
    });
    emitProgress();

    const resolvedStop = await policyService.waitForResolution(policyStop.id);
    const toolEvent = events.find((event) => event.id === eventId);
    if (resolvedStop.resolution?.action !== "approve_once") {
      const declinedMessage = `Policy stop ${policyStop.id} was ${resolvedStop.resolution?.action ?? "declined"}. Continue with allowed safer alternatives; do not execute ${toolName}.`;
      if (toolEvent) {
        toolEvent.status = "done";
        toolEvent.detail = declinedMessage;
      }
      policyService.markStopCompleted(policyStop.id);
      emitProgress();

      return {
        toolCallId: toolCall.id,
        content: declinedMessage,
        toolExecution: {
          toolName,
          args: toolArgs,
          output: declinedMessage,
          parsedOutput: {
            policyStop: resolvedStop,
            status: "declined",
          },
        } satisfies ToolExecutionRecord,
      };
    }

    policyService.markStopResumed(policyStop.id);
    if (toolEvent) {
      toolEvent.label = `Executing approved ${toolName}`;
      toolEvent.detail = `Approval received for policy stop ${policyStop.id}.`;
      toolEvent.status = "active";
    }
    emitProgress();
  }

  if (!policyStop) {
    events.push({
      id: eventId,
      label: `Executing ${toolName}`,
      detail: `Running ${toolName} with arguments: ${JSON.stringify(toolArgs)}`,
      status: "active",
      policy: toolPolicy,
    });
    emitProgress();
  }

  try {
    const result = await withTimeout(
      toolService.callTool(toolName, toolArgs, {
        workspacePath: snapshot.workspace.path,
        trustContract: snapshot.trustContract,
        settings: appSettings,
      }),
      TOOL_EXECUTION_TIMEOUT_MS,
      `Tool ${toolName} timed out after ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s.`,
    );

    const normalizedResult = truncateToolOutput(String(result ?? ""));
    const parsedOutput = parseJsonObject(normalizedResult);
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = "done";
      toolEvent.detail = summarizeToolOutput(normalizedResult);
    }
    if (policyStop) {
      policyService.markStopCompleted(policyStop.id);
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: normalizedResult,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: normalizedResult,
        parsedOutput: parsedOutput ?? undefined,
      } satisfies ToolExecutionRecord,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Tool ${toolName} failed.`;
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = "error";
      toolEvent.detail = message;
    }
    if (policyStop) {
      policyService.markStopFailed(policyStop.id);
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool ${toolName} failed: ${message}`,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: `Tool ${toolName} failed: ${message}`,
      } satisfies ToolExecutionRecord,
    };
  }
}

async function requestRainyAgenticResponse({
  apiKey,
  history,
  model,
  apiMode,
  prompt,
  snapshot,
  workingSet,
  events,
  options,
  runbookDefinition,
  emitProgress,
  appSettings,
  runId,
}: {
  apiKey: string;
  history: string[];
  model: string;
  apiMode: RainyApiMode;
  prompt: string;
  snapshot: RepoSnapshot;
  workingSet: import("../contracts/working-set").WorkingSet;
  events: ToolEvent[];
  options: AssistantRunOptions;
  runbookDefinition: AssistantRunbookDefinition;
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const runtime = buildAgentRuntimeConfig(options, prompt);
  const matches = snapshot.promptMatches
    .slice(0, 12)
    .map((match) => `${match.file}:${match.line} ${match.text}`)
    .join("\n");
  const gitStatus = snapshot.statusLines.slice(0, 40).join("\n");
  const repoGraphSummary = await repoGraphService.getPromptSummary(snapshot.workspace);

  const systemPrompt = `${MATE_AGENT_SYSTEM_PROMPT}

Workspace: ${snapshot.workspace.name}
Path: ${snapshot.workspace.path}
Branch: ${snapshot.workspace.branch}
Stack: ${snapshot.workspace.stack.join(", ") || "unknown"}
Operating mode: ${options.mode}
Reasoning level: ${options.reasoning}
Filesystem access policy: ${options.access}
Execution intent detected: ${runtime.executionIntent ? "yes - at least one tool-backed pass is required before the final answer" : "no"}

${renderTrustContractForPrompt(snapshot.trustContract)}

Runtime truth and permissions:
- Current workspace path is the real project root: ${snapshot.workspace.path}
- Treat package-manager mutations, generated files, lockfiles, git operations, and source edits as real workspace effects when a tool is allowed to run them.
- The sandbox_run tool time-limits a child process and pins test-like env vars; it does not create a disposable copy of the repository and must not be described as changing only a fake project.
- If a tool returns a Workspace Trust Contract block, the product can surface approval. State what was blocked and continue with permitted alternatives if approval is declined.
- When contract autonomy is ${snapshot.trustContract.autonomy}, allowed actions are: ${snapshot.trustContract.allowedActions.join(", ") || "none"}.
- Blocked actions are: ${snapshot.trustContract.blockedActions.join(", ") || "none"}.
- Do not ask the user to run a command manually unless MaTE X lacks a permitted or approvable path to perform it.

Working Set:
${renderWorkingSetForPrompt(workingSet)}

Working set discipline:
- Treat the working set as the authoritative starting context for this run.
- Do not read primary target files just to restate that they are relevant; first use the ranked paths, git diff snippets, recent failures, and relevant scripts already supplied.
- If the objective is a failing validation command, run the narrow validation command before reading files unless the working set already contains the exact error.
- If the narrow validation command exits 0, treat the reported failure as resolved or unreproduced. Do not claim pending type errors, mismatches, or failures without a nonzero command result or exact diagnostic text.
- Inspect files only when the working set, graph context, diffs, or command output identifies a concrete unresolved question.
- Prefer Repo Intelligence Graph tools over grep or broad file listing when selecting any additional files.

Git status:
${gitStatus || "(clean)"}

Prompt-linked matches:
${matches || "(none)"}

Workspace memory:
${snapshot.memoryContext?.context || "(none)"}

Repo Intelligence Graph:
${repoGraphSummary}

You are running in an agent loop, not a single reply.
First, use the working set, workspace metadata, git status, prompt-linked matches, and conversation history already provided here.
Before broad file search, use Repo Intelligence Graph APIs for entrypoints, impacted files, tests, import chains, IPC surface, env usage, and dependency surface when they fit the task.
Before running validation for code changes, create a validation plan with plan_validation using the task objective, changed files, RepoGraph impacted files, package scripts, detected framework, and previous failure context already available. plan_validation only plans and its executionState is not_run/not_verified; never report primary run, fallback run, persistence, PROVEN, GO, production-ready, or validation complete from plan_validation alone. When a validation plan exists, use it; do not choose validation commands ad hoc. If run_tests returns nextRequiredAction, perform it before finalizing. After run_tests, call verify_validation_persistence before claiming the plan was persisted with a run or validation is complete.
If that context is enough for the user's request, answer directly without calling tools.
If more evidence is needed, first emit a brief assistant progress update explaining what you will inspect, then call the smallest useful set of tools, then continue from the tool results.
Prefer one focused tool batch over broad exploration. Do not call tools just to satisfy the loop.
Stop investigating once you can give a grounded answer. Do not continue until the tool budget unless the user explicitly asks for exhaustive analysis.
If a tool fails or access is blocked, adapt to the available context and explain the limitation once.
In your final answer, include these explicit headings when applicable: "Verdict:", "Verdict summary:", "Confidence:", "Warnings:", "Unresolved risks:", and "Final recommendation:".
When you need to search for something, use the 'rg' tool first.

Structured runbook contract (must follow):
${renderRunbookForPrompt(runbookDefinition)}`;

  if (apiMode === "responses") {
    return requestRainyResponsesAgenticResponse({
      apiKey,
      model,
      prompt,
      history,
      runtime,
      systemPrompt,
      snapshot,
      events,
      emitProgress,
      appSettings,
      runId,
    });
  }

  return requestRainyChatAgenticResponse({
    apiKey,
    model,
    prompt,
    history,
    runtime,
    systemPrompt,
    snapshot,
    events,
    emitProgress,
    appSettings,
    runId,
  });
}

async function requestRainyChatAgenticResponse({
  apiKey,
  history,
  model,
  prompt,
  runtime,
  systemPrompt,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
}: {
  apiKey: string;
  history: string[];
  model: string;
  prompt: string;
  runtime: AgentRuntimeConfig;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const historyMessages = buildHistoryMessages(history);
  let messages: any[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: prompt },
  ];
  const chatTools = toolService.getChatToolDefinitions();
  const tokenEstimator = createTokenEstimator(model);
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let lastNonEmptyAssistantText = "";
  const toolExecutions: ToolExecutionRecord[] = [];

  const { applyContextCompressionChat } = await import("./context-compression");

  while (iterations < runtime.maxIterations) {
    iterations++;

    events.push({
      id: `step-agent-loop-${iterations}`,
      label: `Agent pass ${iterations}`,
      detail:
        iterations === 1
          ? "Starting the chat-completions tool loop."
          : `Continuing agent loop after ${toolRounds} tool round(s).`,
      status: "active",
    });
    emitProgress();

    messages = await applyContextCompressionChat(
      messages,
      tokenEstimator,
      apiKey,
      model,
      events,
      emitProgress,
    );

    let streamedPassText = "";
    const responseMessage = await requestRainyChatCompletionStream({
      apiKey,
      messages,
      model,
      tools: chatTools,
      toolChoice:
        runtime.requireToolingFirst &&
        toolRounds < runtime.minToolRounds &&
        totalToolCalls < runtime.maxToolCalls
          ? "required"
          : undefined,
      onContentDelta: (delta) => {
        streamedPassText += delta;
        emitProgress(
          lastNonEmptyAssistantText
            ? `${lastNonEmptyAssistantText}\n\n${streamedPassText}`
            : streamedPassText,
        );
      },
    });

    messages.push(responseMessage);
    const toolCalls = responseMessage.tool_calls
      ?.filter((toolCall) => toolCall.type === "function")
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      }));

    const responseText = normalizeAssistantText(responseMessage.content);
    if (responseText.trim()) {
      lastNonEmptyAssistantText +=
        (lastNonEmptyAssistantText ? "\n\n" : "") + responseText;
      emitProgress(lastNonEmptyAssistantText);
    }

    const loopEvent = events.find(
      (event) => event.id === `step-agent-loop-${iterations}`,
    );
    const checkpoint = summarizeCheckpoint(responseText);
    if (loopEvent) {
      loopEvent.status = "done";
      loopEvent.detail = checkpoint
        ? `Checkpoint: ${checkpoint}`
        : `Pass ${iterations} completed.`;
      emitProgress();
    }

    if (!toolCalls || toolCalls.length === 0) {
      if (
        toolRounds < runtime.minToolRounds &&
        iterations < runtime.maxIterations &&
        totalToolCalls < runtime.maxToolCalls
      ) {
        events.push({
          id: `step-agent-nudge-${iterations}`,
          label: "Continue investigation",
          detail:
            runtime.executionIntent
              ? "Model produced text for an execution request without running a tool. Requesting the required tool-backed pass."
              : "Model tried to conclude early. Requesting another tool-backed pass.",
          status: "done",
        });
        emitProgress();

        messages.push({
          role: "user",
          content:
            runtime.executionIntent
              ? "The user asked you to perform an action. Do not answer with only text. Call the smallest appropriate tool now, then continue from the result."
              : "Continue investigating with repository tools before answering. Gather more evidence, then conclude.",
        });
        continue;
      }

      events.push({
        id: `step-agent-done-${iterations}`,
        label: "Response complete",
        detail: `Agent finished after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`,
        status: "done",
      });
      emitProgress();

      const forcedFinalText = responseText.trim()
        ? ""
        : await attemptFinalChatSynthesis({
            apiKey,
            model,
            messages,
            iterations,
            toolRounds,
            totalToolCalls,
            events,
            emitProgress,
          });

      const finalContentText = forcedFinalText
        ? lastNonEmptyAssistantText
          ? `${lastNonEmptyAssistantText}\n\n${forcedFinalText}`
          : forcedFinalText
        : lastNonEmptyAssistantText;

      return {
        toolExecutions,
        content:
          finalContentText ||
          buildNoContentFinalResponse({
            iterations,
            toolRounds,
            totalToolCalls,
            events,
          }),
      };
    }

    toolRounds++;
    const remainingBudget = runtime.maxToolCalls - totalToolCalls;
    const executableToolCalls = toolCalls.slice(
      0,
      Math.max(remainingBudget, 0),
    );

    if (executableToolCalls.length === 0) {
      messages.push({
        role: "user",
        content:
          "Tool budget is exhausted. Synthesize the evidence you already collected and conclude.",
      });
      continue;
    }

    events.push({
      id: `step-tool-batch-${iterations}`,
      label: `Tool batch ${toolRounds}`,
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent, with a ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s timeout each.`,
      status: "done",
    });
    // Insert markers for the current batch of tool calls
    for (let i = 0; i < executableToolCalls.length; i++) {
      const toolCall = executableToolCalls[i];
      const eventId = `tool-${iterations}-${i}-${toolCall.name}`;
      lastNonEmptyAssistantText += `\n\n<!-- mate-trace:${eventId} -->`;
    }

    emitProgress(lastNonEmptyAssistantText);

    const toolResults = await mapWithConcurrency(
      executableToolCalls,
      TOOL_BATCH_MAX_CONCURRENCY,
      (toolCall, toolIndex) =>
        executeAgentToolCall({
          toolCall,
          toolIndex,
          iteration: iterations,
          snapshot,
          events,
          emitProgress,
          appSettings,
          runId,
        }),
    );

    totalToolCalls += toolResults.length;
    toolExecutions.push(...toolResults.map((result) => result.toolExecution));

    for (const result of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: result.content,
      });
    }

    if (totalToolCalls >= runtime.maxToolCalls) {
      events.push({
        id: `step-budget-${iterations}`,
        label: "Tool budget reached",
        detail: `Collected ${totalToolCalls} tool call(s). Asking the model to conclude from the evidence.`,
        status: "done",
      });
      emitProgress();

      messages.push({
        role: "user",
        content:
          "You have enough evidence. Stop calling tools and provide the final answer grounded in the collected outputs.",
      });
    }
  }

  const forcedFinalText = await attemptFinalChatSynthesis({
    apiKey,
    model,
    messages,
    iterations,
    toolRounds,
    totalToolCalls,
    events,
    emitProgress,
  });

  const finalContentText = forcedFinalText
    ? lastNonEmptyAssistantText
      ? `${lastNonEmptyAssistantText}\n\n${forcedFinalText}`
      : forcedFinalText
    : lastNonEmptyAssistantText;

  return {
    toolExecutions,
    content:
      finalContentText ||
      buildNoContentFinalResponse({
        iterations,
        toolRounds,
        totalToolCalls,
        events,
      }),
  };
}

async function requestRainyResponsesAgenticResponse({
  apiKey,
  history,
  model,
  prompt,
  runtime,
  systemPrompt,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
}: {
  apiKey: string;
  history: string[];
  model: string;
  prompt: string;
  runtime: AgentRuntimeConfig;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const initialInput = buildResponsesMessageInput([
    ...buildHistoryMessages(history),
    { role: "user", content: prompt },
  ]);
  const responseTools = toolService.getResponsesToolDefinitions();
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let previousResponseId: string | undefined;
  let nextInput = initialInput;
  let lastContent = "";
  let lastThought = "";
  const toolExecutions: ToolExecutionRecord[] = [];

  while (iterations < runtime.maxIterations) {
    iterations++;

    events.push({
      id: `step-agent-loop-${iterations}`,
      label: `Agent pass ${iterations}`,
      detail:
        iterations === 1
          ? "Starting the responses tool loop."
          : `Continuing agent loop after ${toolRounds} tool round(s).`,
      status: "active",
    });
    emitProgress();

    const response = await requestRainyResponsesCompletion({
      apiKey,
      model,
      instructions: iterations === 1 ? systemPrompt : undefined,
      input: nextInput,
      previousResponseId,
      tools: responseTools,
      toolChoice:
        runtime.requireToolingFirst &&
        toolRounds < runtime.minToolRounds &&
        totalToolCalls < runtime.maxToolCalls
          ? "required"
          : totalToolCalls >= runtime.maxToolCalls
            ? "none"
            : "auto",
    });

    previousResponseId = response.id;
    const responseText = response.output_text || "";
    if (responseText.trim()) {
      lastContent += (lastContent ? "\n\n" : "") + responseText;
    }
    lastThought = extractResponseThought(response) || lastThought;
    emitProgress(lastContent, lastThought);

    const loopEvent = events.find(
      (event) => event.id === `step-agent-loop-${iterations}`,
    );
    const checkpoint = summarizeCheckpoint(response.output_text);
    if (loopEvent) {
      loopEvent.status = "done";
      loopEvent.detail = checkpoint
        ? `Checkpoint: ${checkpoint}`
        : `Pass ${iterations} completed.`;
      emitProgress();
    }

    const toolCalls = extractResponseFunctionCalls(response).map(
      (toolCall) => ({
        id: toolCall.call_id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }),
    );

    if (toolCalls.length === 0) {
      if (
        toolRounds < runtime.minToolRounds &&
        iterations < runtime.maxIterations &&
        totalToolCalls < runtime.maxToolCalls
      ) {
        events.push({
          id: `step-agent-nudge-${iterations}`,
          label: "Continue investigation",
          detail:
            runtime.executionIntent
              ? "Model produced text for an execution request without running a tool. Requesting the required tool-backed pass."
              : "Model tried to conclude early. Requesting another tool-backed pass.",
          status: "done",
        });
        emitProgress();

        nextInput = [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: runtime.executionIntent
                  ? "The user asked you to perform an action. Do not answer with only text. Call the smallest appropriate tool now, then continue from the result."
                  : "Continue investigating with repository tools before answering. Gather more evidence, then conclude.",
              },
            ],
          },
        ];
        continue;
      }

      events.push({
        id: `step-agent-done-${iterations}`,
        label: "Response complete",
        detail: `Agent finished after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`,
        status: "done",
      });
      emitProgress();

      const forcedFinalText = response.output_text?.trim()
        ? ""
        : await attemptFinalResponsesSynthesis({
            apiKey,
            model,
            previousResponseId,
            iterations,
            toolRounds,
            totalToolCalls,
            events,
            emitProgress,
          });

      const finalContentText = forcedFinalText
        ? lastContent
          ? `${lastContent}\n\n${forcedFinalText}`
          : forcedFinalText
        : lastContent;

      return {
        thought: lastThought,
        toolExecutions,
        content:
          finalContentText ||
          "The model completed the tool loop without returning text.",
      };
    }

    toolRounds++;
    const remainingBudget = runtime.maxToolCalls - totalToolCalls;
    const executableToolCalls = toolCalls.slice(
      0,
      Math.max(remainingBudget, 0),
    );

    if (executableToolCalls.length === 0) {
      nextInput = [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Tool budget is exhausted. Synthesize the evidence you already collected and conclude.",
            },
          ],
        },
      ];
      continue;
    }

    events.push({
      id: `step-tool-batch-${iterations}`,
      label: `Tool batch ${toolRounds}`,
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent, with a ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s timeout each.`,
      status: "done",
    });
    // Insert markers for the current batch of tool calls
    for (let i = 0; i < executableToolCalls.length; i++) {
      const toolCall = executableToolCalls[i];
      const eventId = `tool-${iterations}-${i}-${toolCall.name}`;
      lastContent += `\n\n<!-- mate-trace:${eventId} -->`;
    }

    emitProgress(lastContent);

    const toolResults = await mapWithConcurrency(
      executableToolCalls,
      TOOL_BATCH_MAX_CONCURRENCY,
      (toolCall, toolIndex) =>
        executeAgentToolCall({
          toolCall,
          toolIndex,
          iteration: iterations,
          snapshot,
          events,
          emitProgress,
          appSettings,
          runId,
        }),
    );

    totalToolCalls += toolResults.length;
    toolExecutions.push(...toolResults.map((result) => result.toolExecution));
    nextInput = toolResults.map((result) => ({
      type: "function_call_output" as const,
      call_id: result.toolCallId,
      output: result.content,
    }));

    if (totalToolCalls >= runtime.maxToolCalls) {
      nextInput.push({
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "You have enough evidence. Stop calling tools and provide the final answer grounded in the collected outputs.",
          },
        ],
      });

      events.push({
        id: `step-budget-${iterations}`,
        label: "Tool budget reached",
        detail: `Collected ${totalToolCalls} tool call(s). Asking the model to conclude from the evidence.`,
        status: "done",
      });
      emitProgress();
    }
  }

  const forcedFinalText = await attemptFinalResponsesSynthesis({
    apiKey,
    model,
    previousResponseId,
    iterations,
    toolRounds,
    totalToolCalls,
    events,
    emitProgress,
  });

  const finalContentText = forcedFinalText
    ? lastContent
      ? `${lastContent}\n\n${forcedFinalText}`
      : forcedFinalText
    : lastContent;

  return {
    thought: lastThought,
    toolExecutions,
    content:
      finalContentText ||
      "Maximum agent iterations reached without a final response.",
  };
}

async function resolveDefaultRainyRuntimeConfig(
  apiKey: string,
  preferredStoredModel: string | null,
): Promise<{
  model: string;
  apiMode: "chat_completions" | "responses";
} | null> {
  const preferredModels = [
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4-pro",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "anthropic/claude-sonnet-4.6",
  ];

  try {
    const catalog = await listRainyModels({ apiKey });
    if (catalog.length === 0) {
      return null;
    }

    const normalizedStoredModel = preferredStoredModel?.trim() ?? "";
    const pickApiMode = (modelId: string): "chat_completions" | "responses" =>
      resolvePreferredRainyApiMode(
        modelId,
        catalog.find((item) => item.id === modelId),
      );

    if (
      normalizedStoredModel &&
      catalog.some((entry) => entry.id === normalizedStoredModel)
    ) {
      return {
        model: normalizedStoredModel,
        apiMode: pickApiMode(normalizedStoredModel),
      };
    }

    for (const preferredModel of preferredModels) {
      if (catalog.some((entry) => entry.id === preferredModel)) {
        return {
          model: preferredModel,
          apiMode: pickApiMode(preferredModel),
        };
      }
    }

    const fallbackModel = catalog[0]?.id;
    if (!fallbackModel) {
      return null;
    }

    return {
      model: fallbackModel,
      apiMode: pickApiMode(fallbackModel),
    };
  } catch {
    return null;
  }
}
