export type StorageBackendType = "s3" | "r2" | "gcs" | "azure" | "supabase" | "vercel" | "local";

export type StorageOperationType = "upload" | "download" | "delete" | "list" | "sync" | "overwrite";

export type StorageEventStatus = "success" | "failure" | "blocked";

export type StorageEventType = "STORAGE_OPERATION" | "BLOCKED_UPLOAD";

export interface StorageBackendConfig {
  backend: StorageBackendType;
  bucket?: string;
  region?: string;
  credentials?: Record<string, unknown>;
}

export interface StorageEvent {
  type: StorageEventType;
  operation: StorageOperationType;
  path: string;
  sizeBytes: number;
  durationMs: number;
  status: StorageEventStatus;
  timestamp: string;
  backendType: StorageBackendType;
  errorCode?: string;
  errorMessage?: string;
  secretCategories?: string[];
}

export interface StorageListItem {
  key: string;
  size?: number;
  updatedAt?: string;
  url?: string;
}

export interface StorageListOptions {
  prefix?: string;
  limit?: number;
}

export interface StorageUploadOptions {
  overwrite?: boolean;
  contentType?: string;
  metadata?: Record<string, string>;
  allowHighImpact?: boolean;
}

export interface StorageDownloadOptions {
  as?: "bytes" | "text";
}

export interface StorageOperationResult {
  key: string;
  url?: string;
  sizeBytes: number;
}

export interface StoragePrivacyScanResult {
  hasSecrets: boolean;
  categories: string[];
}

export interface StoragePrivacySentinel {
  scan(content: string | Uint8Array): Promise<StoragePrivacyScanResult>;
}

export interface StorageEvidenceRecorder {
  appendStorageEvent(event: StorageEvent): Promise<void>;
}

export interface StorageFailureMemory {
  recordFailure(input: {
    workspaceId: string;
    command: string;
    output?: string;
    errorSignature: string;
    stackTraceExcerpt?: string;
  }): Promise<unknown>;
}

export interface StorageApprovalGate {
  requireApproval(input: {
    operation: "deleteFile" | "overwriteFile";
    path: string;
    reason: string;
    allowHighImpact?: boolean;
  }): Promise<void>;
}

export interface StorageAgentProfiler {
  recordStorageOperation(input: {
    backendType: StorageBackendType;
    operation: StorageOperationType;
    durationMs: number;
    success: boolean;
  }): void | Promise<void>;
}

export interface StorageRateLimiter {
  check(input: {
    operation: StorageOperationType;
    workspaceId: string;
    path: string;
  }): boolean | Promise<boolean>;
}

export interface FilesSdkClient {
  upload(key: string, body: string | Uint8Array | ArrayBuffer | Blob, options?: Record<string, unknown>): Promise<unknown>;
  download(key: string, options?: Record<string, unknown>): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(options?: Record<string, unknown>): Promise<unknown>;
}

export interface FilesSdkFactory {
  create(config: StorageBackendConfig, hooks: FilesSdkHooks): Promise<FilesSdkClient>;
}

export interface FilesSdkHooks {
  onAction?(event: { type: string; status: string; durationMs: number }): void | Promise<void>;
  onError?(event: { type: string; error: unknown }): void | Promise<void>;
}

export interface MaTeXStorageAdapterOptions {
  workspaceId: string;
  backend: StorageBackendConfig;
  files: FilesSdkClient;
  privacySentinel: StoragePrivacySentinel;
  evidenceRecorder: StorageEvidenceRecorder;
  failureMemory: StorageFailureMemory;
  approvalGate: StorageApprovalGate;
  rateLimiter: StorageRateLimiter;
  agentProfiler?: StorageAgentProfiler;
  now?: () => Date;
}
