import type {
  AssistantExecution,
  AssistantRunOptions,
  AssistantRunProgress,
  Conversation,
} from "./chat";
import type { GitCommit, GitDiff, GitStatus } from "./git";
import type {
  AgentFirewallDecision,
  BenchmarkSnapshot,
  ThreatGraphSnapshot,
} from "./frontier";
import type {
  GitHubChangedFile,
  GitHubCheckSummary,
  GitHubIntegrationResult,
  GitHubIntegrationStatus,
  GitHubLocalEvidence,
  GitHubPullRequestSummary,
  GitHubRepositoryRef,
} from "./github-integration";
import type {
  PolicyRunState,
  PolicyStop,
  ResolvePolicyStopRequest,
} from "./policy";
import type { RainyModelCatalogEntry, RainyModelLaunch } from "./rainy";
import type { PrivacyApi } from "./privacy";
import type { RepoGraphApi } from "./repo-graph";
import type { AppSettings } from "./settings";
import type {
  MobileBridgeDeviceSession,
  MobilePendingPairingRequest,
  MobileBridgePairingPayload,
  MobileBridgeStatus,
} from "./mobile-bridge";
import type {
  AgentCapabilityProfile,
  AgentRoutingRecommendation,
} from "./agent-capability-profiler";
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
  getThreatGraph: () => Promise<ThreatGraphSnapshot>;
  getAgentCapabilityProfiles: (
    workspaceId?: string,
  ) => Promise<AgentCapabilityProfile[]>;
  getAgentRoutingRecommendation: (
    task: string,
    workspaceId?: string,
  ) => Promise<AgentRoutingRecommendation>;
  runAssistant: (
    prompt: string,
    history: string[],
    options?: AssistantRunOptions,
    runId?: string,
  ) => Promise<AssistantExecution>;
  cancelAssistant: (runId: string) => Promise<boolean>;
  generateComplianceReport: (
    request: { taskId: string },
  ) => Promise<ComplianceExportResult>;
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
  graph: RepoGraphApi;
}

export interface PerformanceApi {
  getSnapshot: () => Promise<BenchmarkSnapshot>;
  runBenchmark: () => Promise<BenchmarkSnapshot>;
}

export interface AgentFirewallApi {
  listDecisions: () => Promise<AgentFirewallDecision[]>;
  evaluateCommand: (command: string) => Promise<AgentFirewallDecision>;
}

export interface ComplianceExportResult {
  status: "ready" | "blocked" | "partial";
  blockingReasons: string[];
  zipPath: string;
  manifestPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  generatedAt: string;
  deliveredTo: string[];
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

export interface GitHubIntegrationApi {
  detectGitHubRemote: (workspacePath?: string) => Promise<GitHubIntegrationResult<GitHubRepositoryRef>>;
  getCurrentBranch: (workspacePath?: string) => Promise<GitHubIntegrationResult<string>>;
  getLocalDiff: (workspacePath?: string) => Promise<GitHubIntegrationResult<string>>;
  getChangedFiles: (workspacePath?: string) => Promise<GitHubIntegrationResult<GitHubChangedFile[]>>;
  collectLocalEvidence: (workspacePath?: string) => Promise<GitHubIntegrationResult<GitHubLocalEvidence>>;
  getIntegrationStatus: (workspacePath?: string) => Promise<GitHubIntegrationStatus>;
  getPullRequestForBranch: () => Promise<GitHubIntegrationResult<GitHubPullRequestSummary>>;
  getPullRequestFiles: () => Promise<GitHubIntegrationResult<GitHubChangedFile[]>>;
  getPullRequestChecks: () => Promise<GitHubIntegrationResult<GitHubCheckSummary[]>>;
}

export interface ApiKeyStatus {
  configured: boolean;
  prefix?: string;
  updatedAt?: string;
}

export interface SettingsApi {
  getApiKeyStatus: () => Promise<ApiKeyStatus>;
  setApiKey: (apiKey: string) => Promise<void>;
  listModels: (forceRefresh?: boolean) => Promise<RainyModelCatalogEntry[]>;
  listModelLaunches: (forceRefresh?: boolean) => Promise<RainyModelLaunch[]>;
  getModel: () => Promise<string | null>;
  setModel: (model: string) => Promise<void>;
  listEmbeddingModels: () => Promise<
    Array<{
      id: string;
      label: string;
      dimensions: number;
      contextLength: number;
    }>
  >;
  getEmbeddingModel: () => Promise<string | null>;
  setEmbeddingModel: (model: string) => Promise<void>;
  getAppSettings: () => Promise<AppSettings>;
  updateAppSettings: (settings: AppSettings) => Promise<AppSettings>;
}

export interface PolicyApi {
  listStops: (runId?: string) => Promise<PolicyStop[]>;
  getRunState: (runId: string) => Promise<PolicyRunState>;
  resolveStop: (request: ResolvePolicyStopRequest) => Promise<PolicyStop>;
}

export interface MobileBridgeApi {
  startPairing: () => Promise<MobileBridgePairingPayload>;
  stopPairing: () => Promise<MobileBridgeStatus>;
  getStatus: () => Promise<MobileBridgeStatus>;
  getPendingPairing: () => Promise<MobilePendingPairingRequest | null>;
  approvePendingPairing: (approved: boolean) => Promise<MobileBridgeDeviceSession | null>;
  listDevices: () => Promise<MobileBridgeDeviceSession[]>;
  revokeDevice: (deviceId: string) => Promise<MobileBridgeDeviceSession[]>;
}

export interface UiApi {
  showChatContextMenu: (threadId: string) => Promise<void>;
  onRenameThread: (listener: (threadId: string) => void) => () => void;
  onArchiveThread: (listener: (threadId: string) => void) => () => void;
  onDeleteThread: (listener: (threadId: string) => void) => () => void;
  copyToClipboard: (text: string) => Promise<void>;
}

export type { PrivacyApi };
