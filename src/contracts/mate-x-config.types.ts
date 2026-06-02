import type { MaTeXStorageAdapterOptions, FilesSdkFactory } from "./storage-adapter.types";
import type { FailureMemoryRepository, FailureMemorySyncStateStore } from "./failure-memory-sync.types";
import type {
  AgentAction,
  AgentId,
  AgentSdkClient,
  SDKOrchestratorEvidenceRecorder,
  SDKOrchestratorFailureMemory,
  SDKOrchestratorPrivacySentinel,
} from "./sdk-orchestrator.types";

export interface MaTeXConfig {
  storage: {
    backend: "r2" | "s3" | "gcs" | "azure" | "supabase" | "vercel" | "local";
    bucket: string;
    region?: string;
    credentials: Record<string, unknown>;
    credentialsEnv?: Record<string, string>;
    evidencePacks: {
      prefix: string;
      retentionDays: number;
    };
  };
  orchestration: {
    defaultAgent: AgentId;
    criticLoop: {
      minVTS: number;
      maxRetries: number;
    };
    routing: {
      autoRoute: boolean;
      routingWindowSize: number;
    };
  };
  privacy: {
    blockOnDetection: boolean;
    scanBeforeUpload: boolean;
    scanBeforeAgentCall: boolean;
  };
  failureMemory: {
    syncIntervalMinutes: number;
    maxRecordsPerSync: number;
    maxTotalRecords: number;
  };
}

export interface CreateMaTeXStackDependencies {
  workspaceId?: string;
  storage?: Omit<MaTeXStorageAdapterOptions, "workspaceId" | "backend" | "files"> & {
    files?: MaTeXStorageAdapterOptions["files"];
    factory?: FilesSdkFactory;
  };
  failureMemory?: {
    repository: FailureMemoryRepository;
    stateStore: FailureMemorySyncStateStore;
  };
  sdk?: {
    codexClient?: AgentSdkClient;
    cursorClient?: AgentSdkClient;
    antigravityClient?: AgentSdkClient;
    privacySentinel?: SDKOrchestratorPrivacySentinel;
    evidenceRecorder?: SDKOrchestratorEvidenceRecorder;
    failureMemory?: SDKOrchestratorFailureMemory;
    confirmHighImpact?: (action: AgentAction) => Promise<boolean>;
  };
}
