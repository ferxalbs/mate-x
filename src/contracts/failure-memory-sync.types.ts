import type { FailureMemory } from "./workspace";

export interface FailureMemorySyncConfig {
  syncIntervalMinutes?: number;
  maxRecordsPerSync?: number;
  maxTotalRecords?: number;
  prefix?: string;
}

export interface FailureMemoryRepository {
  list(workspaceId: string, limit: number): Promise<FailureMemory[]>;
  upsert(records: FailureMemory[]): Promise<void>;
}

export interface FailureMemorySyncStateStore {
  getLastSyncAt(workspaceId: string): Promise<string | null>;
  setLastSyncAt(workspaceId: string, timestamp: string): Promise<void>;
}

export interface FailureMemorySyncOptions {
  workspaceId: string;
  repository: FailureMemoryRepository;
  stateStore: FailureMemorySyncStateStore;
  config?: FailureMemorySyncConfig;
  now?: () => Date;
}

export interface FailureMemoryDeltaDocument {
  schemaVersion: 1;
  workspaceId: string;
  createdAt: string;
  records: FailureMemory[];
}

export interface FailureMemoryWorkspaceExport {
  schemaVersion: 1;
  workspaceId: string;
  exportedAt: string;
  records: FailureMemory[];
}

export interface FailureMemorySyncResult {
  uploadedRecords: number;
  downloadedRecords: number;
  mergedRecords: number;
  lastSyncAt: string;
}
