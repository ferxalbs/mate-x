import type { Conversation } from './chat';

export type WorkspaceStatus = 'ready' | 'indexing' | 'offline';

export interface RepoFact {
  label: string;
  value: string;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  branch: string;
  status: WorkspaceStatus;
  stack: string[];
  facts: RepoFact[];
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export interface WorkspaceProfile {
  workspaceId: string;
  packageManager?: string;
  testFramework?: string;
  testCommand?: string;
  lintCommand?: string;
  buildCommand?: string;
  typecheckCommand?: string;
  shell?: string;
  flags?: string;
  updatedAt: string;
}

export interface ValidationRun {
  id: string;
  workspaceId: string;
  command: string;
  scope?: string;
  exitCode?: number;
  status?: string;
  outputSummary?: string;
  failingTests?: string[];
  ranAt: string;
}

export interface WorkspaceSnapshot {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary;
  files: string[];
  signals: SearchMatch[];
  threads: Conversation[];
  activeThreadId: string;
}
