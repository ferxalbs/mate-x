import type {
  AssistantExecution,
  AssistantRunOptions,
  AssistantRunProgress,
  Conversation,
} from "./chat";
import type { GitCommit, GitDiff, GitStatus } from "./git";
import type {
  PolicyRunState,
  PolicyStop,
  ResolvePolicyStopRequest,
} from "./policy";
import type { RainyModelCatalogEntry } from "./rainy";
import type { AppSettings } from "./settings";
import type {
  SearchMatch,
  WorkspaceEntry,
  WorkspaceMemoryBootstrapContext,
  WorkspaceMemoryFileKind,
  WorkspaceMemoryStatus,
  WorkspaceSnapshot,
  WorkspaceSummary,
  WorkspaceTrustContract,
} from "./workspace";

export interface RepoInspectorApi {
  bootstrap: () => Promise<WorkspaceSnapshot>;
  getWorkspaces: () => Promise<WorkspaceEntry[]>;
  getWorkspaceSummary: () => Promise<WorkspaceSummary>;
  getWorkspaceTrustContract: (
    workspaceId?: string,
  ) => Promise<WorkspaceTrustContract>;
  updateWorkspaceTrustContract: (
    contract: WorkspaceTrustContract,
  ) => Promise<WorkspaceTrustContract>;
  getWorkspaceMemoryStatus: () => Promise<WorkspaceMemoryStatus>;
  writeWorkspaceMemoryFile: (
    kind: WorkspaceMemoryFileKind,
    content: string,
  ) => Promise<WorkspaceMemoryStatus>;
  resetWorkspaceMemoryFile: (
    kind: WorkspaceMemoryFileKind,
  ) => Promise<WorkspaceMemoryStatus>;
  revealWorkspaceMemoryFolder: () => Promise<void>;
  getWorkspaceMemoryBootstrapContext: () => Promise<WorkspaceMemoryBootstrapContext>;
  openWorkspacePicker: () => Promise<WorkspaceSnapshot | null>;
  setActiveWorkspace: (workspaceId: string) => Promise<WorkspaceSnapshot>;
  removeWorkspace: (workspaceId: string) => Promise<WorkspaceSnapshot>;
  saveWorkspaceSession: (
    workspaceId: string,
    threads: Conversation[],
    activeThreadId: string,
  ) => Promise<void>;
  listFiles: (limit?: number) => Promise<string[]>;
  searchInFiles: (query: string, limit?: number) => Promise<SearchMatch[]>;
  runAssistant: (
    prompt: string,
    history: string[],
    options?: AssistantRunOptions,
    runId?: string,
  ) => Promise<AssistantExecution>;
  onAssistantProgress: (
    listener: (progress: AssistantRunProgress) => void,
  ) => () => void;
  onTestStreamChunk: (
    listener: (chunk: {
      workspaceId: string;
      timestamp: number;
      chunk: string;
    }) => void,
  ) => () => void;
  openWorkspacePath: (
    target: "folder" | "vscode" | "terminal",
  ) => Promise<void>;
}

export interface GitApi {
  getStatus: () => Promise<GitStatus>;
  getLog: (limit?: number) => Promise<GitCommit[]>;
  stageFiles: (files: string[]) => Promise<void>;
  unstageFiles: (files: string[]) => Promise<void>;
  commit: (message: string) => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  getDiff: () => Promise<GitDiff>;
}

export interface SettingsApi {
  getApiKey: () => Promise<string | null>;
  setApiKey: (apiKey: string) => Promise<void>;
  listModels: (forceRefresh?: boolean) => Promise<RainyModelCatalogEntry[]>;
  getModel: () => Promise<string | null>;
  setModel: (model: string) => Promise<void>;
  getAppSettings: () => Promise<AppSettings>;
  updateAppSettings: (settings: AppSettings) => Promise<AppSettings>;
}

export interface PolicyApi {
  listStops: (runId?: string) => Promise<PolicyStop[]>;
  getRunState: (runId: string) => Promise<PolicyRunState>;
  resolveStop: (request: ResolvePolicyStopRequest) => Promise<PolicyStop>;
}

export interface UiApi {
  showChatContextMenu: (threadId: string) => Promise<void>;
  onRenameThread: (listener: (threadId: string) => void) => () => void;
  onArchiveThread: (listener: (threadId: string) => void) => () => void;
  onDeleteThread: (listener: (threadId: string) => void) => () => void;
}
