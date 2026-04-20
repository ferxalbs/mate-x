import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

import { GitService } from "./git-service";
import {
  buildResponsesMessageInput,
  extractResponseFunctionCalls,
  listRainyModels,
  requestRainyChatCompletion,
  requestRainyResponsesCompletion,
  resolvePreferredRainyApiMode,
} from "./rainy-service";
import { toolService } from "./tool-service";
import { tursoService } from "./turso-service";
import { createTokenEstimator } from "./token-estimator";
import type {
  AssistantExecution,
  AssistantRunProgress,
  AssistantRunOptions,
  Conversation,
  MessageArtifact,
  ToolEvent,
} from "../contracts/chat";
import type { RainyApiMode } from "../contracts/rainy";
import type {
  SearchMatch,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "../contracts/workspace";
import {
  MATE_AGENT_PROMPT_STOP_WORDS,
  MATE_AGENT_SYSTEM_PROMPT,
} from "../config/mate-agent";

const execFileAsync = promisify(execFile);

export interface RepoSnapshot {
  workspace: WorkspaceSummary;
  files: string[];
  packageJson: string | null;
  statusLines: string[];
  promptMatches: SearchMatch[];
}

interface AgentRuntimeConfig {
  maxIterations: number;
  minToolRounds: number;
  maxToolCalls: number;
  requireToolingFirst: boolean;
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
  const [summary, files, packageJson, status, promptMatches] =
    await Promise.all([
      buildWorkspaceSummary(workspace),
      listWorkspaceFiles(workspace.path, 200),
      readFileMaybe(workspace.path, "package.json"),
      new GitService(workspace.path).getStatus(),
      promptPattern
        ? searchWorkspaceFiles(workspace.path, promptPattern, 16)
        : Promise.resolve([]),
    ]);

  return {
    workspace: summary,
    files,
    packageJson,
    statusLines: status.files.map(
      (f) => `${f.index}${f.working_dir} ${f.path}`,
    ),
    promptMatches,
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
  const events: ToolEvent[] = [
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
  ];

  const [apiKey, storedModel] = await Promise.all([
    tursoService.getApiKey(),
    tursoService.getModel(),
  ]);
  const runtimeConfig = apiKey
    ? await resolveDefaultRainyRuntimeConfig(apiKey, storedModel)
    : null;
  const configuredModel = runtimeConfig?.model ?? null;

  const hasRainyConfig = Boolean(apiKey && configuredModel);
  const artifacts = buildArtifacts(
    snapshot,
    hasRainyConfig,
    configuredModel,
    resolvedOptions,
  );
  const createdAt = new Date().toISOString();
  let content: string;
  const emitProgress = () => {
    if (!progressReporter) {
      return;
    }

    progressReporter.emit({
      runId: progressReporter.runId,
      status: "running",
      content: renderInlineProgress(events, resolvedOptions.mode),
      events: cloneEvents(events),
      artifacts: cloneArtifacts(artifacts),
    });
  };

  emitProgress();

  if (apiKey && configuredModel) {
    try {
      const result = await requestRainyAgenticResponse({
        apiKey,
        history,
        model: configuredModel,
        apiMode: runtimeConfig?.apiMode ?? "chat_completions",
        prompt,
        snapshot,
        events,
        options: resolvedOptions,
        emitProgress,
      });
      content = result.content;
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
      id: "step-rainy-model-missing",
      label: "Model unavailable",
      detail: "No compatible Rainy models were found for the current API key.",
      status: "error",
    });
    emitProgress();
  }

  return {
    suggestedTitle: history.length === 0 ? buildThreadTitle(prompt) : undefined,
    message: {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content,
      createdAt,
      events,
      artifacts,
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
  const [summary, files, signals, session] = await Promise.all([
    buildWorkspaceSummary(workspace),
    listWorkspaceFiles(workspace.path, 18),
    searchWorkspaceFiles(
      workspace.path,
      "OpenAI|ipc|thread|sidebar|composer",
      10,
    ),
    tursoService.getWorkspaceSession(workspace.id),
  ]);

  return {
    activeWorkspaceId: workspace.id,
    workspaces,
    workspace: summary,
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
  };
}

function buildAgentRuntimeConfig(
  options: AssistantRunOptions,
): AgentRuntimeConfig {
  switch (options.reasoning) {
    case "low":
      return {
        maxIterations: options.mode === "plan" ? 5 : 6,
        minToolRounds: 1,
        maxToolCalls: 6,
        requireToolingFirst: true,
      };
    case "max":
      return {
        maxIterations: options.mode === "plan" ? 10 : 12,
        minToolRounds: 3,
        maxToolCalls: 24,
        requireToolingFirst: true,
      };
    default:
      return {
        maxIterations: options.mode === "plan" ? 8 : 9,
        minToolRounds: 2,
        maxToolCalls: 14,
        requireToolingFirst: true,
      };
  }
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

function describeProgressPhase(
  label: string | undefined,
  mode: AssistantRunOptions["mode"],
) {
  if (!label) {
    return mode === "plan"
      ? "Planning the investigation and preparing the next tool-backed pass."
      : "Reviewing the repository and collecting evidence before answering.";
  }

  if (label.startsWith("Agent pass")) {
    return "Inspecting the repository and pushing the model through another investigation pass.";
  }

  if (label.startsWith("Tool batch")) {
    return "Running a batch of repository tools to gather more concrete evidence.";
  }

  if (label.startsWith("Executing ")) {
    return "Working through repository evidence now and folding tool results back into the loop.";
  }

  if (label === "Continue investigation") {
    return "The model tried to stop early, so the loop is forcing another evidence-gathering pass.";
  }

  if (label === "Tool budget reached") {
    return "Enough tool evidence is collected. Preparing the final repo-grounded response.";
  }

  if (label === "Response complete") {
    return "Finalizing the answer from the evidence already collected.";
  }

  return "Reviewing the repository and keeping the tool loop moving.";
}

function formatProgressEvent(event: ToolEvent) {
  const prefix =
    event.status === "active"
      ? "Running"
      : event.status === "error"
        ? "Issue"
        : "Done";
  const shortDetail =
    event.detail.length <= 180
      ? event.detail
      : `${event.detail.slice(0, 177).trimEnd()}...`;

  return `• ${prefix} ${event.label}: ${shortDetail}`;
}

function renderInlineProgress(
  events: ToolEvent[],
  mode: AssistantRunOptions["mode"],
) {
  const currentEvent =
    [...events].reverse().find((event) => event.status === "active") ??
    events.at(-1);
  const visibleEvents = events.slice(-6);
  const intro = describeProgressPhase(currentEvent?.label, mode);

  if (visibleEvents.length === 0) {
    return intro;
  }

  return `${intro}\n\n${visibleEvents.map(formatProgressEvent).join("\n")}`;
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
      id: "artifact-access",
      label: "Access",
      value: options.access,
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
}: {
  toolCall: AgentToolCall;
  toolIndex: number;
  iteration: number;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: () => void;
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
    };
  }

  events.push({
    id: eventId,
    label: `Executing ${toolName}`,
    detail: `Running ${toolName} with arguments: ${JSON.stringify(toolArgs)}`,
    status: "active",
  });
  emitProgress();

  try {
    const result = await withTimeout(
      toolService.callTool(toolName, toolArgs, {
        workspacePath: snapshot.workspace.path,
      }),
      TOOL_EXECUTION_TIMEOUT_MS,
      `Tool ${toolName} timed out after ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s.`,
    );

    const normalizedResult = truncateToolOutput(String(result ?? ""));
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = "done";
      toolEvent.detail = summarizeToolOutput(normalizedResult);
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: normalizedResult,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Tool ${toolName} failed.`;
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = "error";
      toolEvent.detail = message;
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool ${toolName} failed: ${message}`,
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
  events,
  options,
  emitProgress,
}: {
  apiKey: string;
  history: string[];
  model: string;
  apiMode: RainyApiMode;
  prompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  options: AssistantRunOptions;
  emitProgress: () => void;
}) {
  const runtime = buildAgentRuntimeConfig(options);
  const files = snapshot.files.slice(0, 80).join("\n");
  const matches = snapshot.promptMatches
    .slice(0, 12)
    .map((match) => `${match.file}:${match.line} ${match.text}`)
    .join("\n");
  const gitStatus = snapshot.statusLines.slice(0, 40).join("\n");

  const systemPrompt = `${MATE_AGENT_SYSTEM_PROMPT}

Workspace: ${snapshot.workspace.name}
Path: ${snapshot.workspace.path}
Branch: ${snapshot.workspace.branch}
Stack: ${snapshot.workspace.stack.join(", ") || "unknown"}
Operating mode: ${options.mode}
Reasoning level: ${options.reasoning}
Filesystem access policy: ${options.access}

Files:
${files || "(none)"}

Git status:
${gitStatus || "(clean)"}

Prompt-linked matches:
${matches || "(none)"}

You are running in an agent loop, not a single reply.
Use the repository tools aggressively before concluding. Prefer multiple tool calls in the same turn whenever they are independent.
Do not stop after a shallow pass. Keep investigating until you have enough evidence or you hit the tool budget.
If you include pre-tool reasoning, keep it short and action-oriented. The final answer must synthesize concrete evidence from the repo.
When you need to search for something, use the 'rg' tool first.
If a tool fails, adapt and continue.`;

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
}: {
  apiKey: string;
  history: string[];
  model: string;
  prompt: string;
  runtime: AgentRuntimeConfig;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: () => void;
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
      emitProgress
    );

    const response = await requestRainyChatCompletion({
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
    });

    const responseMessage = response.choices[0]?.message;
    if (!responseMessage) {
      throw new Error("Empty response from Rainy API.");
    }

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
      lastNonEmptyAssistantText = responseText;
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
            "Model tried to conclude early. Requesting another tool-backed pass.",
          status: "done",
        });
        emitProgress();

        messages.push({
          role: "user",
          content:
            "Continue investigating with repository tools before answering. Gather more evidence, then conclude.",
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

      return {
        content:
          responseText.trim() ||
          forcedFinalText ||
          lastNonEmptyAssistantText ||
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
    emitProgress();

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
        }),
    );

    totalToolCalls += toolResults.length;

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

  return {
    content:
      forcedFinalText ||
      lastNonEmptyAssistantText ||
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
}: {
  apiKey: string;
  history: string[];
  model: string;
  prompt: string;
  runtime: AgentRuntimeConfig;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: () => void;
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
    lastContent = response.output_text || lastContent;

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
            "Model tried to conclude early. Requesting another tool-backed pass.",
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
                text: "Continue investigating with repository tools before answering. Gather more evidence, then conclude.",
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

      return {
        content:
          response.output_text ||
          forcedFinalText ||
          lastContent ||
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
    emitProgress();

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
        }),
    );

    totalToolCalls += toolResults.length;
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

  return {
    content:
      forcedFinalText ||
      lastContent ||
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
