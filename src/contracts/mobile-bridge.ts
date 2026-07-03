import type { AssistantExecution, AssistantRunOptions, AssistantRunProgress } from "./chat";
import type { GitDiff, GitStatus } from "./git";
import type { PolicyStop, ResolvePolicyStopRequest } from "./policy";
import type { WorkspaceEntry, WorkspaceSummary } from "./workspace";

export const MOBILE_BRIDGE_PROTOCOL_VERSION = 1;

export type MobileBridgePairingState = "idle" | "pairing" | "awaiting_approval";
export type MobileBridgeSessionState = "active" | "revoked" | "expired";

export interface MobileBridgePairingPayload {
  version: typeof MOBILE_BRIDGE_PROTOCOL_VERSION;
  host: string;
  port: number;
  pairingId: string;
  desktopPublicKey: string;
  pairingSecret: string;
  expiresAt: string;
}

export interface MobileBridgeStatus {
  enabled: boolean;
  running: boolean;
  host: string | null;
  port: number | null;
  pairingState: MobileBridgePairingState;
  pairingExpiresAt: string | null;
  activeSessionCount: number;
  requireApproval: boolean;
  privateLanOnly: boolean;
}

export interface MobileBridgeDeviceSession {
  id: string;
  deviceName: string;
  devicePublicKey: string;
  permissions: MobileBridgePermissions;
  state: MobileBridgeSessionState;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface MobileBridgePermissions {
  canRunAssistant: boolean;
  canResolvePolicyStops: boolean;
  canReadGit: boolean;
  canWriteGit: boolean;
  canPush: boolean;
}

export interface MobileBridgeCommandEnvelope<T = unknown> {
  id: string;
  type: MobileBridgeCommandType;
  sessionId: string;
  sequence: number;
  payload: T;
}

export type MobileBridgeCommandType =
  | "bridge:get-status"
  | "workspace:list"
  | "workspace:get-active-summary"
  | "git:get-status"
  | "git:get-diff"
  | "assistant:run"
  | "policy:list-stops"
  | "policy:resolve-stop"
  | "git:stage"
  | "git:commit"
  | "git:push";

export interface MobileBridgeCommandResponse<T = unknown> {
  id: string;
  ok: boolean;
  payload?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface MobileAssistantRunRequest {
  prompt: string;
  history?: string[];
  workspaceId?: string;
  runId?: string;
  options?: AssistantRunOptions;
}

export type MobileAssistantRunResult = AssistantExecution;
export type MobileAssistantProgressEvent = AssistantRunProgress;

export interface MobileWorkspaceSummary {
  id: string;
  name: string;
  branch: string;
  status: WorkspaceSummary["status"];
  stack: string[];
  facts: WorkspaceSummary["facts"];
}

export interface MobileWorkspaceEntry {
  id: WorkspaceEntry["id"];
  name: WorkspaceEntry["name"];
  lastOpenedAt: WorkspaceEntry["lastOpenedAt"];
}

export interface MobileGitReadOnlySummary {
  status?: GitStatus;
  diff?: GitDiff;
}

export interface MobilePolicyApprovalRequest extends ResolvePolicyStopRequest {}
export type MobilePolicyStop = PolicyStop;

export interface MobilePairingApproval {
  pairingId: string;
  deviceName: string;
  devicePublicKey: string;
  approved: boolean;
}

export interface MobilePendingPairingRequest {
  pairingId: string;
  deviceName: string;
  deviceFingerprint: string;
  expiresAt: string;
}

export const MOBILE_BRIDGE_COMMAND_TYPES: readonly MobileBridgeCommandType[] = [
  "bridge:get-status",
  "workspace:list",
  "workspace:get-active-summary",
  "git:get-status",
  "git:get-diff",
  "assistant:run",
  "policy:list-stops",
  "policy:resolve-stop",
  "git:stage",
  "git:commit",
  "git:push",
] as const;
