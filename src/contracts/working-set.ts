export interface WorkingSetFile {
  path: string;
  score: number;
  reasons: string[];
}

export interface WorkingSetSnippet {
  path: string;
  content: string;
  tokenEstimate: number;
}

export interface WorkingSetScript {
  name: string;
  command: string;
  score: number;
  reasons: string[];
}

export interface WorkingSetFailure {
  command: string;
  status?: string;
  exitCode?: number;
  summary?: string;
  failingTests?: string[];
  ranAt: string;
}

export interface WorkingSetMetadata {
  id: string;
  workspaceId: string;
  compiledAt: string;
  tokenBudget: number;
  tokenEstimate: number;
  runMode: string;
  primaryFileCount: number;
  totalFileCount: number;
  truncated: boolean;
}

export interface WorkingSet {
  metadata: WorkingSetMetadata;
  objective: string;
  primaryTargetFiles: WorkingSetFile[];
  directlyImportedFiles: WorkingSetFile[];
  directlyImportingFiles: WorkingSetFile[];
  relatedTests: WorkingSetFile[];
  relevantPackageScripts: WorkingSetScript[];
  gitDiffSnippets: WorkingSetSnippet[];
  relatedContractsTypes: WorkingSetFile[];
  recentFailureContext: WorkingSetFailure[];
  workspacePlaybookNotes: string[];
}
