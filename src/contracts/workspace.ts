import type { Conversation } from "./chat";

export type WorkspaceStatus = "ready" | "indexing" | "offline";

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
  health?: WorkspaceHealthProfile;
  facts: RepoFact[];
}

export interface WorkspaceHealthProfile {
  stack: string[];
  packageManager: string;
  framework: string;
  testRunner: string;
  testCommand: string;
  lintCommand: string;
  buildCommand: string;
  gitDirtyState: string;
  dependencyWarningCount: number;
  secretWarningCount: number;
  recommendedNextAction: string;
  updatedAt: string;
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

export type WorkspaceTrustAutonomy =
  | "plan-only"
  | "approval-required"
  | "trusted-patch"
  | "unrestricted";

export interface WorkspaceTrustContract {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  autonomy: WorkspaceTrustAutonomy;
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowedCommands: string[];
  allowedDomains: string[];
  allowedSecrets: string[];
  allowedActions: string[];
  blockedActions: string[];
  updatedAt: string;
}

export interface WorkspaceSnapshot {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary;
  trustContract: WorkspaceTrustContract;
  files: string[];
  signals: SearchMatch[];
  threads: Conversation[];
  activeThreadId: string;
}

export type WorkspaceMemoryFileKind = "memory" | "guardrails" | "workstate";

export interface WorkspaceMemoryFile {
  kind: WorkspaceMemoryFileKind;
  filename: "MEMORY.md" | "GUARDRAILS.md" | "WORKSTATE.md";
  title: string;
  description: string;
  content: string;
  updatedAt: string;
}

export interface WorkspaceMemoryStatus {
  workspaceId: string;
  memoryWorkspaceId: string;
  repoPath: string;
  storagePath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  files: WorkspaceMemoryFile[];
}

export interface WorkspaceMemoryBootstrapContext {
  workspaceId: string;
  storagePath: string;
  context: string;
}

export interface WorkspaceMemoryProposedUpdate {
  kind: WorkspaceMemoryFileKind;
  filename: WorkspaceMemoryFile["filename"];
  title: string;
  content: string;
  createdAt: string;
}

export interface WorkspaceMemoryRunSummary {
  prompt: string;
  response: string;
  toolNames: string[];
  touchedPaths: string[];
  completedAt: string;
}
