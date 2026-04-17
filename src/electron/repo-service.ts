import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

import { GitService } from "./git-service";
import { listRainyModels, requestRainyChatCompletion } from "./rainy-service";
import { toolService } from "./tool-service";
import { tursoService } from "./turso-service";
import type {
  AssistantExecution,
  Conversation,
  MessageArtifact,
  ToolEvent,
} from "../contracts/chat";
import type {
  SearchMatch,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "../contracts/workspace";
import { MATE_AGENT_PROMPT_STOP_WORDS } from "../config/mate-agent";

const execFileAsync = promisify(execFile);

export interface RepoSnapshot {
  workspace: WorkspaceSummary;
  files: string[];
  packageJson: string | null;
  statusLines: string[];
  promptMatches: SearchMatch[];
}

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
): Promise<AssistantExecution> {
  const snapshot = await collectRepoSnapshot(prompt, workspaceId);
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
  const artifacts = buildArtifacts(snapshot, hasRainyConfig, configuredModel);
  const createdAt = new Date().toISOString();
  let content: string;

  if (apiKey && configuredModel) {
    try {
      const result = await requestRainyAgenticResponse({
        apiKey,
        history,
        model: configuredModel,
        prompt,
        snapshot,
        events,
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
    }
  } else if (!apiKey) {
    content = buildFallbackResponse(prompt, snapshot);
    events.push({
      id: "step-rainy-missing",
      label: "API key not configured",
      detail: "Add your Rainy API key in Settings to enable live responses.",
      status: "error",
    });
  } else {
    content = buildFallbackResponse(prompt, snapshot);
    events.push({
      id: "step-rainy-model-missing",
      label: "Model unavailable",
      detail: "No compatible Rainy models were found for the current API key.",
      status: "error",
    });
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

function buildArtifacts(
  snapshot: RepoSnapshot,
  providerReady: boolean,
  configuredModel: string | null,
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

async function requestRainyAgenticResponse({
  apiKey,
  history,
  model,
  prompt,
  snapshot,
  events,
}: {
  apiKey: string;
  history: string[];
  model: string;
  prompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
}) {
  const files = snapshot.files.slice(0, 80).join("\n");
  const matches = snapshot.promptMatches
    .slice(0, 12)
    .map((match) => `${match.file}:${match.line} ${match.text}`)
    .join("\n");
  const gitStatus = snapshot.statusLines.slice(0, 40).join("\n");

  const systemPrompt = `Workspace: ${snapshot.workspace.name}
Path: ${snapshot.workspace.path}
Branch: ${snapshot.workspace.branch}
Stack: ${snapshot.workspace.stack.join(", ") || "unknown"}

Files:
${files || "(none)"}

Git status:
${gitStatus || "(clean)"}

Prompt-linked matches:
${matches || "(none)"}

You are an expert software engineer and security reviewer. You have access to tools to analyze the repository.
When you need to search for something, use the 'rg' tool.
Be thorough and precise. Always explain your reasoning before taking actions.`;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: h,
    })),
    { role: "user", content: prompt },
  ];

  const tools = toolService.getToolDefinitions();
  const maxIterations = 8;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const response = await requestRainyChatCompletion({
      apiKey,
      messages,
      model,
      tools,
    });

    const responseMessage = response.choices[0]?.message;
    if (!responseMessage) {
      throw new Error("Empty response from Rainy API.");
    }

    messages.push(responseMessage);

    if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
      events.push({
        id: `step-agent-done-${iterations}`,
        label: "Response complete",
        detail: `Agent finished after ${iterations} iteration(s).`,
        status: "done",
      });
      return { content: responseMessage.content || "" };
    }

    // Handle tool calls
    for (const toolCall of responseMessage.tool_calls) {
      if (toolCall.type !== "function") continue;
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      const eventId = `tool-${toolName}-${Date.now()}`;
      events.push({
        id: eventId,
        label: `Executing ${toolName}`,
        detail: `Running ${toolName} with arguments: ${JSON.stringify(toolArgs)}`,
        status: "active",
      });

      const result = await toolService.callTool(toolName, toolArgs, {
        workspacePath: snapshot.workspace.path,
      });

      events.forEach((e) => {
        if (e.id === eventId) {
          e.status = "done";
          e.detail = `Tool ${toolName} finished successfully.`;
        }
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return {
    content:
      messages[messages.length - 1]?.content ||
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
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4",
    "openai/gpt-5.3-chat",
    "anthropic/claude-sonnet-4.6",
  ];

  try {
    const catalog = await listRainyModels({ apiKey });
    if (catalog.length === 0) {
      return null;
    }

    const normalizedStoredModel = preferredStoredModel?.trim() ?? "";

    const pickApiMode = (modelId: string): "chat_completions" | "responses" => {
      const entry = catalog.find((item) => item.id === modelId);
      if (!entry) {
        return "responses";
      }

      if (entry.preferredApiMode) {
        return entry.preferredApiMode;
      }

      if (entry.supportedApiModes.includes("responses")) {
        return "responses";
      }

      return "chat_completions";
    };

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
