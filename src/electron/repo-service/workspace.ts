import { execFile } from "node:child_process";
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { promisify } from "node:util";

import { GitService } from "../git-service";
import { tursoService } from "../turso-service";
import { workspaceMemoryService } from "../workspace-memory-service";
import { repoGraphService } from "../repo-graph-service";
import { ripgrepPath } from "../rg-binary";
import type { Conversation } from "../../contracts/chat";
import type { SearchMatch, WorkspaceMemoryBootstrapContext, WorkspaceEntry, WorkspaceSnapshot, WorkspaceSummary, WorkspaceTrustContract } from "../../contracts/workspace";
import { MATE_AGENT_PROMPT_STOP_WORDS } from "../../config/mate-agent";

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

export async function bootstrapWorkspaceState(): Promise<WorkspaceSnapshot> {
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  return buildWorkspaceSnapshot(activeWorkspaceId);
}

export async function getWorkspaceEntries(): Promise<WorkspaceEntry[]> {
  return getValidWorkspaces();
}

export async function setActiveWorkspace(
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const workspaces = await getValidWorkspaces();
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
  const workspace = (await tursoService.getWorkspaces()).find(
    (entry) => entry.id === workspaceId,
  );
  if (workspace) {
    repoGraphService.forgetWorkspace(workspace.id);
    await workspaceMemoryService.clearWorkspaceMemory(workspace.id, workspace.path);
  }

  await tursoService.removeWorkspace(workspaceId);
  const remaining = await getValidWorkspaces();

  if (remaining.length === 0) {
    return buildEmptyWorkspaceSnapshot();
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
  ] = await Promise.all([
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

async function buildWorkspaceSnapshot(
  activeWorkspaceId: string | null,
): Promise<WorkspaceSnapshot> {
  const workspaces = await getValidWorkspaces();
  if (workspaces.length === 0) {
    return buildEmptyWorkspaceSnapshot();
  }
  const resolvedWorkspaceId =
    activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId)
      ? activeWorkspaceId
      : null;

  if (!resolvedWorkspaceId) {
    throw new Error('No active workspace. Add or select a repository to analyze.');
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

function buildEmptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    activeWorkspaceId: null,
    workspaces: [],
    workspace: null,
    trustContract: null,
    files: [],
    signals: [],
    threads: [],
    activeThreadId: null,
  };
}

async function getValidWorkspaces(): Promise<WorkspaceEntry[]> {
  const workspaces = await tursoService.getWorkspaces();
  const valid: WorkspaceEntry[] = [];

  for (const workspace of workspaces) {
    if (await isValidWorkspacePath(workspace.path)) {
      valid.push(workspace);
      continue;
    }

    await tursoService.removeWorkspace(workspace.id);
  }

  return valid;
}

async function isValidWorkspacePath(workspacePath: string) {
  if (!workspacePath || path.parse(workspacePath).root === workspacePath) {
    return false;
  }

  try {
    await access(workspacePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkspace(
  workspaceId?: string,
  cachedWorkspaces?: WorkspaceEntry[],
): Promise<WorkspaceEntry> {
  const workspaces = cachedWorkspaces ?? (await tursoService.getWorkspaces());
  const resolvedId =
    workspaceId ?? (await tursoService.getActiveWorkspaceId());
  if (!resolvedId) {
    throw new Error('No active workspace. Add or select a repository to analyze.');
  }
  const workspace = workspaces.find((entry) => entry.id === resolvedId);

  if (!workspace) {
    throw new Error('Workspace not found. The active workspace may have been removed.');
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
  try {
    const { stdout } = await execFileAsync(ripgrepPath, ["--files", "."], {
      cwd: workspacePath,
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limit);
  } catch (error) {
    if (!isMissingExecutable(error)) {
      throw error;
    }

    return listWorkspaceFilesFallback(workspacePath, limit);
  }
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
    const { stdout } = await execFileAsync(ripgrepPath, args, { cwd: workspacePath });

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

    if (!isMissingExecutable(error)) {
      throw error;
    }

    return searchWorkspaceFilesFallback(workspacePath, query, limit);
  }
}

async function readFileMaybe(workspacePath: string, relativePath: string) {
  try {
    return await readFile(path.join(workspacePath, relativePath), "utf8");
  } catch {
    return null;
  }
}

const FALLBACK_IGNORED_DIRS = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

async function listWorkspaceFilesFallback(
  workspacePath: string,
  limit: number,
): Promise<string[]> {
  const files: string[] = [];
  const queue = ["."];

  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()!;
    const entries = await readdir(path.join(workspacePath, current), {
      withFileTypes: true,
    }).catch((): Dirent[] => []);

    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isSymbolicLink()) continue;

      const relativePath = current === "." ? entry.name : path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!FALLBACK_IGNORED_DIRS.has(entry.name)) {
          queue.push(relativePath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  return files;
}

async function searchWorkspaceFilesFallback(
  workspacePath: string,
  query: string,
  limit: number,
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const files = await listWorkspaceFilesFallback(workspacePath, 500);

  for (const file of files) {
    if (matches.length >= limit) break;
    const content = await readFileMaybe(workspacePath, file);
    if (!content || content.includes("\u0000")) continue;

    content.split(/\r?\n/).some((line, index) => {
      if (line.includes(query)) {
        matches.push({ file, line: index + 1, text: line.trim() });
      }
      return matches.length >= limit;
    });
  }

  return matches;
}

function isMissingExecutable(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
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
