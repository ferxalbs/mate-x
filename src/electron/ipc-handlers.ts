import { BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

import type { AssistantRunOptions } from "../contracts/chat";
import type { ResolvePolicyStopRequest } from "../contracts/policy";
import type { AppSettings } from "../contracts/settings";
import type { WorkspaceMemoryFileKind } from "../contracts/workspace";
import { GitService } from "./git-service";
import { policyService } from "./policy-service";
import {
  addWorkspace,
  bootstrapWorkspaceState,
  getWorkspaceEntries,
  getWorkspaceSummary,
  getWorkspaceTrustContract,
  listFiles,
  removeWorkspace,
  runAssistant,
  saveWorkspaceSession,
  searchInFiles,
  setActiveWorkspace,
  updateWorkspaceTrustContract,
} from "./repo-service";
import { listRainyModels, validateRainyModelSelection } from "./rainy-service";
import {
  repoGraphService,
  resolveActiveWorkspaceForRepoGraph,
} from "./repo-graph-service";
import { tursoService } from "./turso-service";
import { workspaceMemoryService } from "./workspace-memory-service";

function normalizeRainyApiKey(apiKey: string) {
  const trimmedApiKey = apiKey.trim();

  if (
    !trimmedApiKey.startsWith("ra-") &&
    !trimmedApiKey.startsWith("rk_live_")
  ) {
    throw new Error('Rainy API key must start with "ra-" or "rk_live_".');
  }

  return trimmedApiKey;
}

async function resolveActiveWorkspacePath() {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0];

  if (!activeWorkspace) {
    throw new Error("No active workspace available.");
  }

  return activeWorkspace.path;
}

async function resolveActiveWorkspace() {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0];

  if (!activeWorkspace) {
    throw new Error("No active workspace available.");
  }

  return activeWorkspace;
}

async function resolveGitService() {
  const workspacePath = await resolveActiveWorkspacePath();
  return new GitService(workspacePath);
}

export function registerIpcHandlers() {
  ipcMain.handle("repo:bootstrap", async () => bootstrapWorkspaceState());
  ipcMain.handle("repo:get-workspaces", async () => getWorkspaceEntries());
  ipcMain.handle("repo:get-workspace-summary", async () =>
    getWorkspaceSummary(),
  );
  ipcMain.handle(
    "repo:get-workspace-trust-contract",
    async (_event, workspaceId?: string) =>
      getWorkspaceTrustContract(workspaceId),
  );
  ipcMain.handle(
    "repo:update-workspace-trust-contract",
    async (_event, contract) => updateWorkspaceTrustContract(contract),
  );
  ipcMain.handle("repo:get-workspace-memory-status", async () => {
    const workspace = await resolveActiveWorkspace();
    return workspaceMemoryService.getStatus(workspace.id, workspace.path);
  });
  ipcMain.handle(
    "repo:write-workspace-memory-file",
    async (_event, kind: WorkspaceMemoryFileKind, content: string) => {
      const workspace = await resolveActiveWorkspace();
      return workspaceMemoryService.writeFile(workspace.id, workspace.path, kind, content);
    },
  );
  ipcMain.handle(
    "repo:reset-workspace-memory-file",
    async (_event, kind: WorkspaceMemoryFileKind) => {
      const workspace = await resolveActiveWorkspace();
      return workspaceMemoryService.resetFile(workspace.id, workspace.path, kind);
    },
  );
  ipcMain.handle("repo:reveal-workspace-memory-folder", async () => {
    const workspace = await resolveActiveWorkspace();
    return workspaceMemoryService.revealFolder(workspace.id, workspace.path);
  });
  ipcMain.handle("repo:get-workspace-memory-bootstrap-context", async () => {
    const workspace = await resolveActiveWorkspace();
    return workspaceMemoryService.getBootstrapContext(workspace.id, workspace.path);
  });
  ipcMain.handle(
    "repo:set-active-workspace",
    async (_event, workspaceId: string) => {
      const snapshot = await setActiveWorkspace(workspaceId);
      const workspace = await resolveActiveWorkspace();
      void repoGraphService.ensureWorkspaceGraph(workspace);
      return snapshot;
    },
  );
  ipcMain.handle("repo:remove-workspace", async (_event, workspaceId: string) =>
    removeWorkspace(workspaceId),
  );
  ipcMain.handle(
    "repo:save-workspace-session",
    async (_event, workspaceId: string, threads, activeThreadId: string) =>
      saveWorkspaceSession(workspaceId, threads, activeThreadId),
  );
  ipcMain.handle("repo:open-workspace-picker", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return addWorkspace(result.filePaths[0]);
  });
  ipcMain.handle(
    "repo:open-workspace-path",
    async (_event, target: "folder" | "vscode" | "terminal") => {
      const workspacePath = await resolveActiveWorkspacePath();
      const encodedWorkspacePath = encodeURI(workspacePath);

      if (target === "folder") {
        await shell.openPath(workspacePath);
        return;
      }

      if (target === "vscode") {
        await shell.openExternal(`vscode://file/${encodedWorkspacePath}`);
        return;
      }

      if (process.platform === "darwin") {
        await shell.openExternal(`file://${encodedWorkspacePath}`);
        return;
      }

      await shell.openPath(workspacePath);
    },
  );
  ipcMain.handle("repo:list-files", async (_event, limit?: number) =>
    listFiles(limit),
  );
  ipcMain.handle("repo:search", async (_event, query: string, limit?: number) =>
    searchInFiles(query, limit),
  );
  ipcMain.handle(
    "repo:run-assistant",
    async (
      event,
      prompt: string,
      history: string[],
      options?: AssistantRunOptions,
      runId?: string,
    ) =>
      runAssistant(
        prompt,
        history,
        undefined,
        options,
        runId
          ? {
              runId,
              emit: (progress) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send("repo:assistant-progress", progress);
                }
              },
            }
          : undefined,
      ),
  );

  ipcMain.handle("repo-graph:refresh", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.refreshWorkspace(workspace);
  });
  ipcMain.handle("repo-graph:get-entrypoints", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getEntrypoints(workspace);
  });
  ipcMain.handle("repo-graph:get-impacted-files", async (_event, files: string[]) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getImpactedFiles(workspace, Array.isArray(files) ? files : []);
  });
  ipcMain.handle("repo-graph:get-tests-for-file", async (_event, file: string) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getTestsForFile(workspace, String(file ?? ""));
  });
  ipcMain.handle("repo-graph:get-import-chain", async (_event, from: string, to: string) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getImportChain(workspace, String(from ?? ""), String(to ?? ""));
  });
  ipcMain.handle("repo-graph:get-ipc-surface", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getIpcSurface(workspace);
  });
  ipcMain.handle("repo-graph:get-env-usage", async (_event, variable?: string) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getEnvUsage(workspace, variable?.trim() || undefined);
  });
  ipcMain.handle("repo-graph:get-dependency-surface", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getDependencySurface(workspace);
  });

  ipcMain.handle("git:status", async () => {
    const workspace = await resolveActiveWorkspace();
    const status = await (await resolveGitService()).getStatus();
    void repoGraphService.noteGitStatusChanged(workspace);
    return status;
  });
  ipcMain.handle("git:log", async (_event, limit?: number) =>
    (await resolveGitService()).getLog(limit),
  );
  ipcMain.handle("git:stage-files", async (_event, files: string[]) =>
    (await resolveGitService()).stageFiles(files),
  );
  ipcMain.handle("git:commit", async (_event, message: string) =>
    (await resolveGitService()).commit(message),
  );
  ipcMain.handle("git:push", async () => (await resolveGitService()).push());
  ipcMain.handle("git:pull", async () => (await resolveGitService()).pull());
  ipcMain.handle("git:diff", async () => (await resolveGitService()).getDiff());
  ipcMain.handle("git:unstage", async (_event, files: string[]) =>
    (await resolveGitService()).unstageFiles(files),
  );

  // ── Policy Stops ────────────────────────────────────────────────────────
  ipcMain.handle("policy:list-stops", async (_event, runId?: string) =>
    policyService.listStops(runId),
  );
  ipcMain.handle("policy:get-run-state", async (_event, runId: string) => {
    if (typeof runId !== "string" || !runId.trim()) {
      throw new Error("Policy run id is required.");
    }

    return policyService.getRunState(runId);
  });
  ipcMain.handle(
    "policy:resolve-stop",
    async (_event, request: ResolvePolicyStopRequest) =>
      policyService.resolveStop(request),
  );

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle("settings:get-api-key", async () => tursoService.getApiKey());
  ipcMain.handle("settings:set-api-key", async (_event, apiKey: string) =>
    tursoService.setApiKey(normalizeRainyApiKey(apiKey)),
  );
  ipcMain.handle(
    "settings:list-models",
    async (_event, forceRefresh?: boolean) =>
      listRainyModels({ apiKey: await tursoService.getApiKey(), forceRefresh }),
  );
  ipcMain.handle("settings:get-model", async () => tursoService.getModel());
  ipcMain.handle("settings:set-model", async (_event, model: string) => {
    const apiKey = await tursoService.getApiKey();
    await validateRainyModelSelection({ apiKey, model });
    await tursoService.setModel(model);
  });
  ipcMain.handle("settings:get-app-settings", async () =>
    tursoService.getAppSettings(),
  );
  ipcMain.handle(
    "settings:update-app-settings",
    async (_event, settings: AppSettings) =>
      tursoService.updateAppSettings(settings),
  );

  // ── UI ───────────────────────────────────────────────────────────────────
  ipcMain.handle(
    "ui:show-chat-context-menu",
    async (event, threadId: string) => {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: "Rename",
          click: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat:rename-thread", threadId);
            }
          },
        },
        {
          label: "Archive",
          click: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat:archive-thread", threadId);
            }
          },
        },
        { type: "separator" },
        {
          label: "Delete",
          click: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat:delete-thread", threadId);
            }
          },
        },
      ];

      const menu = Menu.buildFromTemplate(template);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        menu.popup({ window });
      }
    },
  );
}
