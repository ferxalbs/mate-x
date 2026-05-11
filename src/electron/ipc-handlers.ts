import { spawn } from "node:child_process";
import { BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

import type { AssistantRunOptions, EvidencePack } from "../contracts/chat";
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
  getAgentRoutingRecommendation,
  listFiles,
  removeWorkspace,
  runAssistant,
  saveWorkspaceSession,
  searchInFiles,
  setActiveWorkspace,
  updateWorkspaceTrustContract,
} from "./repo-service";
import {
  RAINY_REPO_EMBEDDING_MODELS,
  listRainyModels,
  validateRainyEmbeddingModelSelection,
  validateRainyModelSelection,
} from "./rainy-service";
import {
  repoGraphService,
  resolveActiveWorkspaceForRepoGraph,
} from "./repo-graph-service";
import { tursoService } from "./turso-service";
import { workspaceMemoryService } from "./workspace-memory-service";
import { checkForUpdates } from "./updater";
import { privacyFirewall } from "./privacy/privacy-firewall-service";
import { generateComplianceExport } from "../features/compliance/complianceExport";

const ASSISTANT_PROGRESS_IPC_FLUSH_MS = 80;
const ASSISTANT_PROGRESS_TERMINAL_STATUSES = new Set(["completed", "failed"]);

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
  ipcMain.handle("app:check-updates", async () => checkForUpdates(true));
  ipcMain.handle("privacy:scan-text", async (_event, text: string) =>
    privacyFirewall.scanTextSafe(String(text ?? "")),
  );
  ipcMain.handle("privacy:get-model-status", async () =>
    privacyFirewall.getModelStatus(),
  );
  ipcMain.handle("privacy:download-model", async (event) =>
    privacyFirewall.downloadModel((progress) => {
      event.sender.send("privacy:model-download-progress", progress);
    }),
  );
  ipcMain.handle("privacy:clear-vault", async () =>
    privacyFirewall.clearVault(),
  );

  ipcMain.handle("repo:bootstrap", async () => bootstrapWorkspaceState());
  ipcMain.handle(
    "repo:generate-compliance-report",
    async (_event, evidencePack: EvidencePack) => {
      const workspace = await resolveActiveWorkspace();
      return generateComplianceExport({
        evidencePack,
        workspacePath: workspace.path,
        userId: workspace.id,
        policyApplied: "workspace-trust-contract",
      });
    },
  );
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
    async (_event, target: string) => {
      const validTargets = new Set(["folder", "vscode", "terminal"]);
      if (!validTargets.has(target)) {
        throw new Error(`Invalid target: ${target}. Must be one of: folder, vscode, terminal.`);
      }

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

      if (target === "terminal") {
        if (process.platform === "darwin") {
          const terminal = spawn("open", ["-a", "Terminal", workspacePath], {
            detached: true,
            stdio: "ignore",
          });
          terminal.on("error", (error) => {
            console.error("Failed to open Terminal:", error);
          });
          terminal.unref();
          return;
        }

        if (process.platform === "win32") {
          const terminal = spawn("cmd.exe", ["/K"], {
            cwd: workspacePath,
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          });
          terminal.on("error", (error) => {
            console.error("Failed to open Command Prompt:", error);
          });
          terminal.unref();
          return;
        }

        await shell.openPath(workspacePath);
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
    "repo:get-agent-capability-profiles",
    async (_event, workspaceId?: string) =>
      tursoService.listAgentCapabilityProfiles(workspaceId),
  );
  ipcMain.handle(
    "repo:get-agent-routing-recommendation",
    async (_event, task: string, workspaceId?: string) =>
      getAgentRoutingRecommendation(task, workspaceId),
  );
  ipcMain.handle(
    "repo:run-assistant",
    async (
      event,
      prompt: string,
      history: string[],
      options?: AssistantRunOptions,
      runId?: string,
    ) => {
      let pendingProgress: {
        runId: string;
        status: string;
        content: string;
        thought?: string;
        events?: Array<{ id?: string; status?: string }>;
        artifacts?: unknown[];
      } | null = null;
      let progressFlushTimer: ReturnType<typeof setTimeout> | null = null;
      let lastProgressSignature = "";

      const flushProgress = () => {
        if (progressFlushTimer) {
          clearTimeout(progressFlushTimer);
          progressFlushTimer = null;
        }

        if (!pendingProgress || event.sender.isDestroyed()) {
          pendingProgress = null;
          return;
        }

        event.sender.send("repo:assistant-progress", pendingProgress);
        pendingProgress = null;
      };

      const emitProgress = (
        progress: NonNullable<Parameters<typeof runAssistant>[4]>["emit"] extends (
          value: infer T,
        ) => void
          ? T
          : never,
      ) => {
        const lastEvent = progress.events?.at(-1);
        const signature = [
          progress.runId,
          progress.status,
          progress.content,
          progress.thought ?? "",
          progress.events?.length ?? 0,
          lastEvent?.id ?? "",
          lastEvent?.status ?? "",
          progress.artifacts?.length ?? 0,
        ].join("\u001f");

        if (signature === lastProgressSignature) {
          return;
        }

        lastProgressSignature = signature;
        pendingProgress = progress;

        if (ASSISTANT_PROGRESS_TERMINAL_STATUSES.has(progress.status)) {
          flushProgress();
          return;
        }

        progressFlushTimer ??= setTimeout(
          flushProgress,
          ASSISTANT_PROGRESS_IPC_FLUSH_MS,
        );
      };

      try {
        return await runAssistant(
        prompt,
        history,
        undefined,
        options,
        runId
          ? {
              runId,
              emit: emitProgress,
            }
          : undefined,
        );
      } finally {
        flushProgress();
      }
    },
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
  ipcMain.handle("settings:list-embedding-models", async () => [
    ...RAINY_REPO_EMBEDDING_MODELS,
  ]);
  ipcMain.handle("settings:get-embedding-model", async () =>
    tursoService.getEmbeddingModel(),
  );
  ipcMain.handle("settings:set-embedding-model", async (_event, model: string) => {
    validateRainyEmbeddingModelSelection(model);
    await tursoService.setEmbeddingModel(model);
    try {
      const workspace = await resolveActiveWorkspaceForRepoGraph();
      await repoGraphService.refreshWorkspace(
        workspace,
        (progress) => {
          if (!_event.sender.isDestroyed()) {
            _event.sender.send("repo-graph:embedding-progress", progress);
          }
        },
        true,
      );
    } catch (error) {
      console.warn("RepoGraph embedding reindex after model change failed:", error);
    }
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
