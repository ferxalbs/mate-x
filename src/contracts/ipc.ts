import type { AssistantExecution, Conversation } from './chat';
import type { GitCommit, GitDiff, GitStatus } from './git';
import type { SearchMatch, WorkspaceEntry, WorkspaceSnapshot, WorkspaceSummary } from './workspace';

export interface RepoInspectorApi {
  bootstrap: () => Promise<WorkspaceSnapshot>;
  getWorkspaces: () => Promise<WorkspaceEntry[]>;
  getWorkspaceSummary: () => Promise<WorkspaceSummary>;
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
  runAssistant: (prompt: string, history: string[]) => Promise<AssistantExecution>;
  openWorkspacePath: (target: 'folder' | 'vscode' | 'terminal') => Promise<void>;
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
