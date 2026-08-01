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
  packageManagerSource: string;
  packageManagerWarnings: string[];
  framework: string;
  testRunner: string;
  testCommand: string;
  lintCommand: string;
  buildCommand: string;
  typecheckCommand: string;
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

export type ValidationCost = "cheap" | "medium" | "expensive";

export type ValidationRequirementId =
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "validation";

export type ValidationUnavailableCause =
  | "VALIDATION_COMMAND_UNRESOLVED"
  | "TYPECHECK_UNAVAILABLE"
  | "TOOLCHAIN_AMBIGUOUS";

export interface ValidationPlanCommand {
  command: string | null;
  availability: "resolved" | "unresolved";
  requirementId: ValidationRequirementId;
  source?: "repository_script" | "local_toolchain" | "native" | null;
  unavailableCause?: ValidationUnavailableCause;
  reason: string;
  estimatedCost: ValidationCost;
  expectedSignal: string;
}

export interface ValidationPlanAuthority {
  packagePath?: string;
  manager?: string | null;
  managerSource?: string | null;
  status?: "resolved" | "ambiguous" | "unavailable";
  cause?: ValidationUnavailableCause;
}

export interface ValidationPlan {
  id: string;
  objective: string;
  changedFiles: string[];
  impactedFiles: string[];
  detectedFramework?: string;
  riskLevel: "low" | "medium" | "high";
  primary: ValidationPlanCommand;
  fallback: ValidationPlanCommand;
  requirements?: ValidationPlanCommand[];
  authority?: ValidationPlanAuthority;
  fallbackTrigger: string;
  recommendations: string[];
  comments: string[];
  executionState: {
    primary: "not_run";
    fallback: "not_run";
    persistence: "not_verified";
    blockingInstruction: string;
  };
  createdAt: string;
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
  validationPlan?: ValidationPlan;
  ranAt: string;
}

export interface FailureMemory {
  id: string;
  workspaceId: string;
  command: string;
  exitCode?: number;
  framework?: string;
  failingTests: string[];
  errorSignature: string;
  stackTraceExcerpt?: string;
  affectedFiles: string[];
  attemptedFix?: string;
  retryFixed?: boolean;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
}

export type WorkspaceWriteAccess =
  | "read-only"
  | "approval-required"
  | "workspace";

export interface WorkspaceTrustContract {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  writeAccess: WorkspaceWriteAccess;
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
  activeWorkspaceId: string | null;
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  trustContract: WorkspaceTrustContract | null;
  files: string[];
  signals: SearchMatch[];
  threads: Conversation[];
  activeThreadId: string | null;
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
