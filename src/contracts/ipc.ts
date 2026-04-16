import type { AssistantExecution } from './chat';
import type { GitCommit, GitDiff, GitStatus } from './git';
import type { SearchMatch, WorkspaceSummary } from './workspace';

export interface RepoInspectorApi {
  getWorkspaceSummary: () => Promise<WorkspaceSummary>;
  listFiles: (limit?: number) => Promise<string[]>;
  searchInFiles: (query: string, limit?: number) => Promise<SearchMatch[]>;
  runAssistant: (prompt: string, history: string[]) => Promise<AssistantExecution>;
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
