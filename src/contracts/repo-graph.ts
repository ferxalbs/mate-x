export type RepoGraphNodeKind =
  | "file"
  | "export"
  | "script"
  | "command"
  | "env_var"
  | "ipc_channel"
  | "dependency"
  | "function"
  | "entrypoint"
  | "config"
  | "manifest"
  | "test";

export type RepoGraphEdgeKind =
  | "imports"
  | "exports"
  | "tests"
  | "runs"
  | "has_purpose"
  | "uses_env"
  | "ipc_calls"
  | "ipc_handles"
  | "delegates_to"
  | "runtime_depends_on"
  | "depends_on"
  | "entrypoint_for"
  | "impacts";

export interface RepoGraphNode {
  id: string;
  workspaceId: string;
  kind: RepoGraphNodeKind;
  key: string;
  label: string;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

export interface RepoGraphEdge {
  id: string;
  workspaceId: string;
  kind: RepoGraphEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

export interface RepoGraphSnapshot {
  workspaceId: string;
  indexedAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface RepoGraphEntrypoint {
  file: string;
  reason: string;
}

export interface RepoGraphImpactedFile {
  file: string;
  reason: string;
  distance: number;
  group?: string;
  hiddenCount?: number;
}

export interface RepoGraphImportChain {
  from: string;
  to: string;
  chain: string[];
}

export interface RepoGraphIpcSurface {
  channel: string;
  callers: string[];
  callees: string[];
}

export interface RepoGraphEnvUsage {
  variable: string;
  files: string[];
}

export interface RepoGraphDependencySurface {
  manifest: string;
  dependency: string;
  files: string[];
}

export interface RepoGraphSemanticProfile {
  file: string;
  role: string;
  language: string;
  runtime: string[];
  symbols: string[];
  imports: string[];
  ipcChannels: string[];
  envVars: string[];
  dependencies: string[];
  riskTags: string[];
  trustBoundaries: string[];
  confidence: number;
  summary: string;
}

export interface RepoGraphSemanticSearchResult {
  file: string;
  score: number;
  reason: string;
  role: string;
  matchedFields: string[];
  confidence: number;
  relatedFiles: string[];
  readRecommendation: string;
}

export interface RepoGraphArchitectureSummary {
  entrypoints: RepoGraphEntrypoint[];
  roles: Record<string, number>;
  riskTags: Record<string, number>;
  ipcChannels: string[];
  envVars: string[];
  dependencies: string[];
}

export interface RepoGraphChangeDetection {
  changedFiles: string[];
  removedFiles: string[];
  unchangedFiles: string[];
}

export interface RepoGraphEmbeddingProgress {
  workspaceId: string;
  model: string;
  indexed: number;
  total: number;
  percent: number;
  state: "indexing" | "ready" | "failed";
}

export interface RepoGraphApi {
  refresh: () => Promise<RepoGraphSnapshot>;
  getEntrypoints: () => Promise<RepoGraphEntrypoint[]>;
  getImpactedFiles: (files: string[]) => Promise<RepoGraphImpactedFile[]>;
  getTestsForFile: (file: string) => Promise<string[]>;
  getImportChain: (from: string, to: string) => Promise<RepoGraphImportChain | null>;
  getIpcSurface: () => Promise<RepoGraphIpcSurface[]>;
  getEnvUsage: (variable?: string) => Promise<RepoGraphEnvUsage[]>;
  getDependencySurface: () => Promise<RepoGraphDependencySurface[]>;
  semanticSearch: (query: string, limit?: number, role?: string, risk?: string) => Promise<RepoGraphSemanticSearchResult[]>;
  getSemanticProfile: (file: string) => Promise<RepoGraphSemanticProfile | null>;
  getArchitectureSummary: () => Promise<RepoGraphArchitectureSummary>;
  detectChanges: (files?: string[]) => Promise<RepoGraphChangeDetection>;
  onEmbeddingProgress: (listener: (progress: RepoGraphEmbeddingProgress) => void) => () => void;
}
