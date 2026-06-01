import type { MaTeXStorageAdapterOptions, FilesSdkFactory } from "./storage-adapter.types";
import type { FailureMemoryRepository, FailureMemorySyncStateStore } from "./failure-memory-sync.types";
import type {
  AgentAction,
  AgentSdkClient,
  SDKOrchestratorEvidenceRecorder,
  SDKOrchestratorFailureMemory,
  SDKOrchestratorPrivacySentinel,
} from "./sdk-orchestrator.types";

export interface CreateMaTeXStackDependencies {
  workspaceId: string;
  storage: Omit<MaTeXStorageAdapterOptions, "workspaceId" | "backend"> & {
    factory?: FilesSdkFactory;
  };
  failureMemory: {
    repository: FailureMemoryRepository;
    stateStore: FailureMemorySyncStateStore;
  };
  sdk: {
    codexClient: AgentSdkClient;
    cursorClient: AgentSdkClient;
    antigravityClient: AgentSdkClient;
    privacySentinel: SDKOrchestratorPrivacySentinel;
    evidenceRecorder: SDKOrchestratorEvidenceRecorder;
    failureMemory: SDKOrchestratorFailureMemory;
    confirmHighImpact(action: AgentAction): Promise<boolean>;
  };
}
