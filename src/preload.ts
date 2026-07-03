import { contextBridge, ipcRenderer } from "electron";
import "./electron/preload/index";

import type {
  GitApi,
  GitHubIntegrationApi,
  PolicyApi,
  PrivacyApi,
  RepoInspectorApi,
  SettingsApi,
  UiApi,
  MobileBridgeApi,
} from "./contracts/ipc";

const ASSISTANT_PROGRESS_CHANNEL = "repo:assistant-progress";

const uiApi: UiApi = {
  showChatContextMenu: (threadId) =>
    ipcRenderer.invoke("ui:show-chat-context-menu", threadId),
  onRenameThread: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, threadId: string) =>
      listener(threadId);
    ipcRenderer.on("chat:rename-thread", handler);
    return () => ipcRenderer.removeListener("chat:rename-thread", handler);
  },
  onArchiveThread: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, threadId: string) =>
      listener(threadId);
    ipcRenderer.on("chat:archive-thread", handler);
    return () => ipcRenderer.removeListener("chat:archive-thread", handler);
  },
  onDeleteThread: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, threadId: string) =>
      listener(threadId);
    ipcRenderer.on("chat:delete-thread", handler);
    return () => ipcRenderer.removeListener("chat:delete-thread", handler);
  },
  copyToClipboard: (text) =>
    ipcRenderer.invoke("ui:copy-to-clipboard", text),
};

const repoApi: RepoInspectorApi = {
  bootstrap: () => ipcRenderer.invoke("repo:bootstrap"),
  getWorkspaces: () => ipcRenderer.invoke("repo:get-workspaces"),
  getWorkspaceSummary: () => ipcRenderer.invoke("repo:get-workspace-summary"),
  getWorkspaceTrustContract: (workspaceId) =>
    ipcRenderer.invoke("repo:get-workspace-trust-contract", workspaceId),
  updateWorkspaceTrustContract: (contract) =>
    ipcRenderer.invoke("repo:update-workspace-trust-contract", contract),
  getWorkspaceMemoryStatus: () =>
    ipcRenderer.invoke("repo:get-workspace-memory-status"),
  writeWorkspaceMemoryFile: (kind, content) =>
    ipcRenderer.invoke("repo:write-workspace-memory-file", kind, content),
  resetWorkspaceMemoryFile: (kind) =>
    ipcRenderer.invoke("repo:reset-workspace-memory-file", kind),
  revealWorkspaceMemoryFolder: () =>
    ipcRenderer.invoke("repo:reveal-workspace-memory-folder"),
  getWorkspaceMemoryBootstrapContext: () =>
    ipcRenderer.invoke("repo:get-workspace-memory-bootstrap-context"),
  openWorkspacePicker: () => ipcRenderer.invoke("repo:open-workspace-picker"),
  setActiveWorkspace: (workspaceId) =>
    ipcRenderer.invoke("repo:set-active-workspace", workspaceId),
  removeWorkspace: (workspaceId) =>
    ipcRenderer.invoke("repo:remove-workspace", workspaceId),
  saveWorkspaceSession: (workspaceId, threads, activeThreadId) =>
    ipcRenderer.invoke(
      "repo:save-workspace-session",
      workspaceId,
      threads,
      activeThreadId,
    ),
  listFiles: (limit) => ipcRenderer.invoke("repo:list-files", limit),
  searchInFiles: (query, limit) =>
    ipcRenderer.invoke("repo:search", query, limit),
  getAgentCapabilityProfiles: (workspaceId) =>
    ipcRenderer.invoke("repo:get-agent-capability-profiles", workspaceId),
  getAgentRoutingRecommendation: (task, workspaceId) =>
    ipcRenderer.invoke("repo:get-agent-routing-recommendation", task, workspaceId),
  runAssistant: (prompt, history, options, runId) =>
    ipcRenderer.invoke("repo:run-assistant", prompt, history, options, runId),
  generateComplianceReport: (evidencePack) =>
    ipcRenderer.invoke("repo:generate-compliance-report", evidencePack),
  onAssistantProgress: (listener) => {
    const handleProgress = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => {
      listener(progress);
    };

    ipcRenderer.on(ASSISTANT_PROGRESS_CHANNEL, handleProgress);

    return () => {
      ipcRenderer.removeListener(ASSISTANT_PROGRESS_CHANNEL, handleProgress);
    };
  },
  onTestStreamChunk: (listener) => {
    const channel = "test-stream-chunk";
    const handler = (
      _event: Electron.IpcRendererEvent,
      chunk: Parameters<typeof listener>[0],
    ) => {
      listener(chunk);
    };

    ipcRenderer.on(channel, handler);

    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  openWorkspacePath: (target) =>
    ipcRenderer.invoke("repo:open-workspace-path", target),
  graph: {
    refresh: () => ipcRenderer.invoke("repo-graph:refresh"),
    getEntrypoints: () => ipcRenderer.invoke("repo-graph:get-entrypoints"),
    getImpactedFiles: (files) =>
      ipcRenderer.invoke("repo-graph:get-impacted-files", files),
    getTestsForFile: (file) =>
      ipcRenderer.invoke("repo-graph:get-tests-for-file", file),
    getImportChain: (from, to) =>
      ipcRenderer.invoke("repo-graph:get-import-chain", from, to),
    getIpcSurface: () => ipcRenderer.invoke("repo-graph:get-ipc-surface"),
    getEnvUsage: (variable) =>
      ipcRenderer.invoke("repo-graph:get-env-usage", variable),
    getDependencySurface: () =>
      ipcRenderer.invoke("repo-graph:get-dependency-surface"),
    onEmbeddingProgress: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: Parameters<typeof listener>[0],
      ) => listener(progress);
      ipcRenderer.on("repo-graph:embedding-progress", handler);
      return () => ipcRenderer.removeListener("repo-graph:embedding-progress", handler);
    },
  },
};

const gitApi: GitApi = {
  getStatus: () => ipcRenderer.invoke("git:status"),
  getLog: (limit) => ipcRenderer.invoke("git:log", limit),
  stageFiles: (files) => ipcRenderer.invoke("git:stage-files", files),
  unstageFiles: (files) => ipcRenderer.invoke("git:unstage", files),
  commit: (message) => ipcRenderer.invoke("git:commit", message),
  push: () => ipcRenderer.invoke("git:push"),
  pull: () => ipcRenderer.invoke("git:pull"),
  getDiff: () => ipcRenderer.invoke("git:diff"),
};

const settingsApi: SettingsApi = {
  getApiKeyStatus: () => ipcRenderer.invoke("settings:get-api-key-status"),
  setApiKey: (apiKey) => ipcRenderer.invoke("settings:set-api-key", apiKey),
  listModels: (forceRefresh) =>
    ipcRenderer.invoke("settings:list-models", forceRefresh),
  getModel: () => ipcRenderer.invoke("settings:get-model"),
  setModel: (model) => ipcRenderer.invoke("settings:set-model", model),
  listEmbeddingModels: () => ipcRenderer.invoke("settings:list-embedding-models"),
  getEmbeddingModel: () => ipcRenderer.invoke("settings:get-embedding-model"),
  setEmbeddingModel: (model) =>
    ipcRenderer.invoke("settings:set-embedding-model", model),
  getAppSettings: () => ipcRenderer.invoke("settings:get-app-settings"),
  updateAppSettings: (settings) =>
    ipcRenderer.invoke("settings:update-app-settings", settings),
};

const githubApi: GitHubIntegrationApi = {
  detectGitHubRemote: (workspacePath) => ipcRenderer.invoke("github:detect-remote", workspacePath),
  getCurrentBranch: (workspacePath) => ipcRenderer.invoke("github:get-current-branch", workspacePath),
  getLocalDiff: (workspacePath) => ipcRenderer.invoke("github:get-local-diff", workspacePath),
  getChangedFiles: (workspacePath) => ipcRenderer.invoke("github:get-changed-files", workspacePath),
  collectLocalEvidence: (workspacePath) => ipcRenderer.invoke("github:collect-local-evidence", workspacePath),
  getIntegrationStatus: (workspacePath) => ipcRenderer.invoke("github:get-status", workspacePath),
  getPullRequestForBranch: () => ipcRenderer.invoke("github:get-pr-for-branch"),
  getPullRequestFiles: () => ipcRenderer.invoke("github:get-pr-files"),
  getPullRequestChecks: () => ipcRenderer.invoke("github:get-pr-checks"),
};


const policyApi: PolicyApi = {
  listStops: (runId) => ipcRenderer.invoke("policy:list-stops", runId),
  getRunState: (runId) => ipcRenderer.invoke("policy:get-run-state", runId),
  resolveStop: (request) => ipcRenderer.invoke("policy:resolve-stop", request),
};

const privacyApi: PrivacyApi = {
  scanText: (text) => ipcRenderer.invoke("privacy:scan-text", text),
  getModelStatus: () => ipcRenderer.invoke("privacy:get-model-status"),
  downloadModel: () => ipcRenderer.invoke("privacy:download-model"),
  onModelDownloadProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => {
      callback(progress);
    };
    ipcRenderer.on("privacy:model-download-progress", listener);
    return () => {
      ipcRenderer.removeListener("privacy:model-download-progress", listener);
    };
  },
  clearVault: () => ipcRenderer.invoke("privacy:clear-vault"),
};

const mobileApi: MobileBridgeApi = {
  startPairing: () => ipcRenderer.invoke("mobile:start-pairing"),
  stopPairing: () => ipcRenderer.invoke("mobile:stop-pairing"),
  getStatus: () => ipcRenderer.invoke("mobile:get-status"),
  listDevices: () => ipcRenderer.invoke("mobile:list-devices"),
  revokeDevice: (deviceId) => ipcRenderer.invoke("mobile:revoke-device", deviceId),
};

contextBridge.exposeInMainWorld("mate", {
  repo: repoApi,
  git: gitApi,
  settings: settingsApi,
  github: githubApi,
  proof: undefined,
  policy: policyApi,
  privacy: privacyApi,
  mobile: mobileApi,
  ui: uiApi,
});
