import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";

import type { AssistantRunOptions, Conversation, EvidencePack } from "../contracts/chat";
import type {
  AgentFirewallDecision,
  AgentFirewallMode,
  BenchmarkSnapshot,
  PerformanceMetric,
  PowerRunPolicy,
  ThreatGraphEdge,
  ThreatGraphNode,
} from "../contracts/frontier";
import type { ResolvePolicyStopRequest } from "../contracts/policy";
import type { AppSettings } from "../contracts/settings";
import type { WorkspaceMemoryFileKind, WorkspaceTrustContract } from "../contracts/workspace";
import { GitService } from "./git-service";
import { policyService } from "./policy-service";
import {
  addWorkspace,
  bootstrapWorkspaceState,
  getWorkspaceEntries,
  getWorkspaceSummary,
  getWorkspaceTrustContract,
  getAgentRoutingRecommendation,
  listFiles,
  removeWorkspace,
  runAssistant,
  saveWorkspaceSession,
  searchInFiles,
  setActiveWorkspace,
  updateWorkspaceTrustContract,
  collectRepoSnapshot,
} from "./repo-service";
import {
  RAINY_REPO_EMBEDDING_MODELS,
  listRainyModels,
  validateRainyEmbeddingModelSelection,
  validateRainyModelSelection,
} from "./rainy-service";
import {
  repoGraphService,
  resolveActiveWorkspaceForRepoGraph,
} from "./repo-graph-service";
import { tursoService } from "./turso-service";
import { workspaceMemoryService } from "./workspace-memory-service";
import { checkForUpdates } from "./updater";
import { privacyFirewall } from "./privacy/privacy-firewall-service";
import {
  collectGitHubLocalEvidence,
  detectGitHubRemote,
  getChangedFiles,
  getCurrentBranch,
  getIntegrationStatus,
  getLocalDiff,
  getPullRequestChecks,
  getPullRequestFiles,
  getPullRequestForBranch,
} from "./github-integration-service";
import {
  generateComplianceExport,
  verifyComplianceZipForDelivery,
  sanitizeComplianceTaskId,
} from "../features/compliance/complianceExport";
import { canonicalJson, sha256Hex } from "../features/compliance/attestation";
import { getStack } from "./main-stack";
import { mobileBridgeService } from "./mobile-bridge-service";

const ASSISTANT_PROGRESS_IPC_FLUSH_MS = 80;
const ASSISTANT_PROGRESS_TERMINAL_STATUSES = new Set(["completed", "failed"]);
const MAX_IPC_TEXT_LENGTH = 200_000;
const MAX_IPC_ARRAY_LENGTH = 500;
const WORKSPACE_MEMORY_FILE_KINDS = new Set<WorkspaceMemoryFileKind>(["memory", "guardrails", "workstate"]);
const POLICY_STOP_ACTIONS = new Set(["approve_once", "expand_scope", "abort", "safer_alternative"]);
const TRUST_AUTONOMY_VALUES = new Set(["plan-only", "approval-required", "trusted-patch", "unrestricted"]);
const APP_SETTING_KEYS = new Set([
  "appearance",
  "theme",
  "blurEnabled",
  "timeFormat",
  "agentTraceVersion",
  "agentTraceV2InlineEvents",
  "diffLineWrapping",
  "assistantOutput",
  "compactMode",
  "floatingInput",
  "archiveConfirmation",
  "deleteConfirmation",
  "agentProfilerAutoSwitch",
  "privacyFirewallEnabled",
  "privacyMode",
  "privacyUseOnnxModel",
  "privacyUseRegex",
  "privacyBlockP0CloudSend",
  "privacyPlaceholderStyle",
  "privacyMinModelConfidence",
  "privacyShowPreviewBeforeCloudSend",
  "codexIntegrationEnabled",
  "antigravityIntegrationEnabled",
  "cursorIntegrationEnabled",
  "githubIntegrationEnabled",
  "preferredAgentIntegration",
  "mobileCompanionEnabled",
  "mobileCompanionRequireApproval",
  "mobileCompanionAllowGitWrite",
  "mobileCompanionAllowPush",
  "mobileCompanionSessionTtlHours",
  "mobileCompanionPrivateLanOnly",
  "powerMode",
  "agentFirewallMode",
  "supermemoryApiKey",
  "onboardingCompleted",
]);
const frontierStartedAt = Date.now();
const frontierPerformanceMetrics: PerformanceMetric[] = [];
const frontierFirewallDecisions: AgentFirewallDecision[] = [];

function assertPlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unknownKeys.join(", ")}.`);
  }
}

function requireBoundedString(value: unknown, label: string, maxLength = MAX_IPC_TEXT_LENGTH) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters.`);
  }
  return value;
}

function optionalBoundedString(value: unknown, label: string, maxLength = 2_000) {
  if (value === undefined || value === null) return undefined;
  return requireBoundedString(value, label, maxLength);
}

function requireStringArray(value: unknown, label: string, maxItemLength = 2_000) {
  if (!Array.isArray(value) || value.length > MAX_IPC_ARRAY_LENGTH) {
    throw new Error(`${label} must be an array with at most ${MAX_IPC_ARRAY_LENGTH} entries.`);
  }

  return value.map((item, index) => requireBoundedString(item, `${label}[${index}]`, maxItemLength));
}

function assertSafeRelativePath(value: string, label: string) {
  const normalized = value.replaceAll("\\", "/").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  ) {
    throw new Error(`${label} must be a safe workspace-relative path.`);
  }
  return normalized;
}

function optionalWorkspaceId(value: unknown) {
  const id = optionalBoundedString(value, "workspaceId", 200);
  if (id !== undefined && !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error("workspaceId is malformed.");
  }
  return id;
}

function requireWorkspaceId(value: unknown) {
  const id = optionalWorkspaceId(value);
  if (!id) {
    throw new Error("workspaceId is required.");
  }
  return id;
}

function validateLimit(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be an integer between 1 and 500.");
  }
  return limit;
}

function recordPerformanceMetric(metric: Omit<PerformanceMetric, "id" | "recordedAt" | "status">) {
  const status =
    typeof metric.budget === "number" && metric.value > metric.budget * 1.25
      ? "fail"
      : typeof metric.budget === "number" && metric.value > metric.budget
        ? "warn"
        : "pass";
  const recorded: PerformanceMetric = {
    ...metric,
    id: `metric-${Date.now()}-${frontierPerformanceMetrics.length}`,
    status,
    recordedAt: new Date().toISOString(),
  };
  frontierPerformanceMetrics.push(recorded);
  if (frontierPerformanceMetrics.length > 200) {
    frontierPerformanceMetrics.splice(0, frontierPerformanceMetrics.length - 200);
  }
  return recorded;
}

async function resolvePowerRunPolicy(): Promise<PowerRunPolicy> {
  const settings = await tursoService.getAppSettings();
  if (settings.powerMode === "max") {
    return {
      mode: "max",
      keepAwake: true,
      blockerType: "prevent-app-suspension",
      reason: "Maximum throughput mode keeps long validations from app suspension.",
    };
  }
  if (settings.powerMode === "balanced") {
    return {
      mode: "balanced",
      keepAwake: false,
      blockerType: "none",
      reason: "Balanced mode avoids power blockers until an interactive run explicitly asks.",
    };
  }
  return {
    mode: "efficient",
    keepAwake: false,
    blockerType: "none",
    reason: "Efficient mode keeps power blockers off by default.",
  };
}

function classifyAgentCommand(command: string, mode: AgentFirewallMode): AgentFirewallDecision {
  const reasons: string[] = [];
  if (/\b(curl|wget|irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(command)) {
    reasons.push("Network fetch command can pull unseen runtime payloads.");
  }
  if (/\b(bash|sh|zsh|powershell|cmd\.exe|python|node|ruby|perl)\b/i.test(command) && /https?:\/\//i.test(command)) {
    reasons.push("Remote script execution pattern.");
  }
  if (/\b(nslookup|dig|Resolve-DnsName)\b/i.test(command)) {
    reasons.push("DNS lookup can hide payload or command configuration.");
  }
  if (/\b(rm\s+-rf|del\s+\/[sq]|Remove-Item\b.*-Recurse|format\s+[a-z]:)\b/i.test(command)) {
    reasons.push("Destructive filesystem command.");
  }
  if (/\b(npm|pnpm|yarn|bun|pip|pipx|cargo|gem|go)\b/i.test(command) && /\b(install|add|i)\b/i.test(command)) {
    reasons.push("Package installation can trigger lifecycle scripts.");
  }
  if (/\b(AWS_|GITHUB_TOKEN|RAINY|OPENAI|ANTHROPIC|\.env|ssh|keychain)\b/i.test(command)) {
    reasons.push("Command references credentials or secret-bearing material.");
  }

  const risk: AgentFirewallDecision["risk"] =
    reasons.some((reason) => /Destructive|Remote script/.test(reason))
      ? "critical"
      : reasons.length > 1
        ? "high"
        : reasons.length === 1
          ? "medium"
          : "low";
  const decision: AgentFirewallDecision["decision"] =
    mode === "audit-only" || risk === "low"
      ? "allow"
      : mode === "strict" && (risk === "high" || risk === "critical")
        ? "block"
        : "require-approval";

  return {
    id: `firewall-${Date.now()}-${frontierFirewallDecisions.length}`,
    command,
    decision,
    mode,
    risk,
    reasons: reasons.length ? reasons : ["No high-risk command pattern detected."],
    recordedAt: new Date().toISOString(),
  };
}

async function buildBenchmarkSnapshot(): Promise<BenchmarkSnapshot> {
  const memory = process.getProcessMemoryInfo
    ? await process.getProcessMemoryInfo()
    : null;
  recordPerformanceMetric({
    kind: "startup",
    name: "main_process_uptime",
    value: Date.now() - frontierStartedAt,
    unit: "ms",
  });
  if (memory) {
    const memoryBytes =
      "privateBytes" in memory && typeof memory.privateBytes === "number"
        ? memory.privateBytes
        : memory.private * 1024;
    recordPerformanceMetric({
      kind: "memory",
      name: "main_process_private_memory",
      value: memoryBytes,
      unit: "bytes",
      budget: 512 * 1024 * 1024,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    metrics: frontierPerformanceMetrics.slice(-50),
    powerPolicy: await resolvePowerRunPolicy(),
  };
}

function sourceRoleForPath(file: string): ThreatGraphNode["sourceRole"] {
  const lower = file.toLowerCase();
  if (/\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|test|tests)\//.test(lower)) return "test";
  if (/(^|\/)(docs?|readme|examples?|fixtures?)\//.test(lower) || /\.(md|mdx|rst)$/.test(lower)) return "docs";
  if (/(^|\/)(dist|out|coverage|generated)\//.test(lower)) return "generated";
  return "active";
}

async function buildThreatGraphSnapshot() {
  const workspace = await resolveActiveWorkspaceForRepoGraph();
  const [entrypoints, ipcSurface, envUsage, dependencySurface] = await Promise.all([
    repoGraphService.getEntrypoints(workspace),
    repoGraphService.getIpcSurface(workspace),
    repoGraphService.getEnvUsage(workspace),
    repoGraphService.getDependencySurface(workspace),
  ]);
  const nodes: ThreatGraphNode[] = [
    { id: "workspace", kind: "workspace", label: workspace.name, sourceRole: "active", confidence: 1 },
  ];
  const edges: ThreatGraphEdge[] = [];
  const addNode = (node: ThreatGraphNode) => {
    if (!nodes.some((existing) => existing.id === node.id)) nodes.push(node);
  };
  const addEdge = (edge: ThreatGraphEdge) => {
    if (!edges.some((existing) => existing.id === edge.id)) edges.push(edge);
  };

  for (const item of entrypoints.slice(0, 80) as Array<{ file?: string; path?: string; kind?: string }>) {
    const file = String(item.file ?? item.path ?? "");
    if (!file) continue;
    const id = `entrypoint:${file}`;
    addNode({ id, kind: "entrypoint", label: file, sourceRole: sourceRoleForPath(file), confidence: 0.8 });
    addEdge({ id: `workspace->${id}`, from: "workspace", to: id, kind: "exposes", confidence: 0.7 });
  }
  for (const item of ipcSurface.slice(0, 80) as Array<{ channel?: string; file?: string }>) {
    const channel = String(item.channel ?? "");
    if (!channel) continue;
    const id = `ipc:${channel}`;
    addNode({ id, kind: "ipc", label: channel, sourceRole: sourceRoleForPath(String(item.file ?? "")), confidence: 0.85 });
    addEdge({ id: `workspace->${id}`, from: "workspace", to: id, kind: "invokes", confidence: 0.8 });
  }
  for (const item of envUsage.slice(0, 80) as Array<{ variable?: string; name?: string; file?: string }>) {
    const variable = String(item.variable ?? item.name ?? "");
    if (!variable) continue;
    const id = `env:${variable}`;
    addNode({ id, kind: "env", label: variable, sourceRole: sourceRoleForPath(String(item.file ?? "")), confidence: 0.75 });
    addEdge({ id: `workspace->${id}`, from: "workspace", to: id, kind: "reads", confidence: 0.7 });
  }
  for (const item of dependencySurface.slice(0, 80) as Array<{ name?: string; packageName?: string }>) {
    const dependency = String(item.name ?? item.packageName ?? "");
    if (!dependency) continue;
    const id = `dependency:${dependency}`;
    addNode({ id, kind: "dependency", label: dependency, sourceRole: "active", confidence: 0.65 });
    addEdge({ id: `workspace->${id}`, from: "workspace", to: id, kind: "depends-on", confidence: 0.65 });
  }

  return { generatedAt: new Date().toISOString(), nodes, edges };
}

function validateWorkspaceMemoryKind(kind: unknown): WorkspaceMemoryFileKind {
  if (typeof kind !== "string" || !WORKSPACE_MEMORY_FILE_KINDS.has(kind as WorkspaceMemoryFileKind)) {
    throw new Error("Invalid workspace memory file kind.");
  }

  return kind as WorkspaceMemoryFileKind;
}

function validateConversationSnapshot(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_IPC_ARRAY_LENGTH) {
    throw new Error(`threads must be an array with at most ${MAX_IPC_ARRAY_LENGTH} entries.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 2_000_000) {
    throw new Error("threads payload is too large.");
  }
  return value as Conversation[];
}

function validateWorkspaceTrustContract(contract: unknown): WorkspaceTrustContract {
  const record = assertPlainRecord(contract, "Workspace Trust Contract");
  assertKnownKeys(record, new Set([
    "id",
    "workspaceId",
    "name",
    "version",
    "autonomy",
    "allowedPaths",
    "forbiddenPaths",
    "allowedCommands",
    "allowedDomains",
    "allowedSecrets",
    "allowedActions",
    "blockedActions",
    "updatedAt",
  ]), "Workspace Trust Contract");

  const allowedActions = requireStringArray(record.allowedActions, "allowedActions", 80);
  const blockedActions = requireStringArray(record.blockedActions, "blockedActions", 80);
  for (const action of [...allowedActions, ...blockedActions]) {
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(action)) {
      throw new Error(`Malformed trust-contract action: ${action}.`);
    }
  }

  const allowedPaths = requireStringArray(record.allowedPaths, "allowedPaths").map((path) =>
    path === "." ? path : assertSafeRelativePath(path, "allowedPaths"),
  );
  const forbiddenPaths = requireStringArray(record.forbiddenPaths, "forbiddenPaths").map((path) =>
    assertSafeRelativePath(path, "forbiddenPaths"),
  );
  const autonomy = requireBoundedString(record.autonomy, "autonomy", 40);
  if (!TRUST_AUTONOMY_VALUES.has(autonomy)) {
    throw new Error("Unsupported trust-contract autonomy.");
  }

  return {
    id: requireBoundedString(record.id, "id", 200),
    workspaceId: requireBoundedString(record.workspaceId, "workspaceId", 200),
    name: requireBoundedString(record.name, "name", 200),
    version: Number.isInteger(record.version) && Number(record.version) > 0 ? Number(record.version) : 1,
    autonomy: autonomy as WorkspaceTrustContract["autonomy"],
    allowedPaths,
    forbiddenPaths,
    allowedCommands: requireStringArray(record.allowedCommands, "allowedCommands"),
    allowedDomains: requireStringArray(record.allowedDomains, "allowedDomains", 255),
    allowedSecrets: requireStringArray(record.allowedSecrets, "allowedSecrets", 255),
    allowedActions,
    blockedActions,
    updatedAt: requireBoundedString(record.updatedAt, "updatedAt", 80),
  };
}

function validateAppSettings(settings: unknown): AppSettings {
  const record = assertPlainRecord(settings, "App settings");
  assertKnownKeys(record, APP_SETTING_KEYS, "App settings");
  return record as unknown as AppSettings;
}

function validateAssistantOptions(options: unknown): AssistantRunOptions | undefined {
  if (options === undefined || options === null) return undefined;
  const record = assertPlainRecord(options, "Assistant options");
  assertKnownKeys(record, new Set([
    "reasoningEnabled",
    "reasoning",
    "mode",
    "access",
    "serviceTier",
    "runbookId",
    "attachments",
  ]), "Assistant options");

  if (record.attachments !== undefined) {
    if (!Array.isArray(record.attachments) || record.attachments.length > 12) {
      throw new Error("Assistant attachments must contain at most 12 items.");
    }
    for (const [index, attachment] of record.attachments.entries()) {
      const item = assertPlainRecord(attachment, `attachments[${index}]`);
      assertKnownKeys(item, new Set(["id", "name", "mimeType", "size", "kind", "dataUrl", "text"]), `attachments[${index}]`);
      requireBoundedString(item.id, `attachments[${index}].id`, 200);
      requireBoundedString(item.name, `attachments[${index}].name`, 500);
      requireBoundedString(item.mimeType, `attachments[${index}].mimeType`, 200);
      optionalBoundedString(item.dataUrl, `attachments[${index}].dataUrl`, 10_000_000);
      optionalBoundedString(item.text, `attachments[${index}].text`, MAX_IPC_TEXT_LENGTH);
    }
  }
  if (
    record.access !== undefined &&
    record.access !== "approval" &&
    record.access !== "full"
  ) {
    throw new Error('Assistant options access must be "approval" or "full".');
  }

  return record as unknown as AssistantRunOptions;
}

function validateEvidencePack(value: unknown): EvidencePack {
  const record = assertPlainRecord(value, "Evidence Pack");
  if (!["complete", "partial", "blocked", "failed"].includes(String(record.status))) {
    throw new Error("Evidence Pack status is invalid.");
  }
  assertPlainRecord(record.verdict, "Evidence Pack verdict");
  requireBoundedString(record.generatedAt, "Evidence Pack generatedAt", 80);
  const serialized = JSON.stringify(record);
  if (serialized.length > 2_000_000) {
    throw new Error("Evidence Pack payload is too large.");
  }
  return record as unknown as EvidencePack;
}

function validateComplianceExportRequest(value: unknown) {
  const record = assertPlainRecord(value, "Compliance export request");
  assertKnownKeys(record, new Set(["taskId"]), "Compliance export request");
  const taskId = requireBoundedString(record.taskId, "taskId", 128);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) {
    throw new Error("taskId is malformed.");
  }
  return { taskId };
}

async function loadVerifiedEvidencePackForExport(workspacePath: string, taskId: string) {
  const evidenceDirectory = resolve(workspacePath, ".mate-x", "evidence", taskId);
  const evidencePackPath = resolve(evidenceDirectory, "evidence-pack.json");
  const attestationPath = resolve(evidenceDirectory, "attestation.intoto.json");
  const evidencePack = validateEvidencePack(JSON.parse(await readFile(evidencePackPath, "utf8")));
  const attestation = JSON.parse(await readFile(attestationPath, "utf8")) as {
    statement?: { subject?: Array<{ name?: string; digest?: { sha256?: string } }> };
  };
  const expectedDigest = attestation.statement?.subject?.find(
    (subject) => subject.name === "evidence-pack.json",
  )?.digest?.sha256;
  const actualDigest = sha256Hex(canonicalJson(evidencePack));
  if (!expectedDigest || expectedDigest !== actualDigest) {
    throw new Error("Evidence Pack digest does not match signed attestation.");
  }

  const scan = await privacyFirewall.scanTextSafe(canonicalJson(evidencePack));
  if (scan.spans.some((span) => span.risk === "p0" || span.label === "secret" || span.label === "repo_secret")) {
    throw new Error("Privacy Firewall blocked compliance export because Evidence Pack contains secret material.");
  }

  return evidencePack;
}

/**
 * List local compliance Evidence Packs for a workspace by scanning the on-disk
 * .mate-x/evidence/<taskId> directories. Authoritative source for standalone browsing.
 * Returns lightweight metadata (no full tool outputs) + attestation status.
 */
async function listLocalEvidencePacks(workspaceId?: string) {
  const id = optionalWorkspaceId(workspaceId);
  // Use collect with dummy prompt; it resolves the workspace path without full agent run.
  const snapshot = await collectRepoSnapshot("list-evidence-packs", id);
  const evidenceRoot = resolve(snapshot.workspace.path, ".mate-x", "evidence");
  try {
    const dirents = await readdir(evidenceRoot, { withFileTypes: true });
    const packs: Array<{
      taskId: string;
      status: string;
      generatedAt?: string;
      verdict?: { label: string; summary: string };
      verifiedTaskScore?: { score: number; status: string };
      attestationStatus: "signed" | "failed" | "missing" | "blocked";
      filesModifiedCount: number;
    }> = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const taskId = dirent.name;
      if (!/^[A-Za-z0-9._-]+$/.test(taskId)) continue;
      try {
        const packPath = resolve(evidenceRoot, taskId, "evidence-pack.json");
        const attPath = resolve(evidenceRoot, taskId, "attestation.intoto.json");
        const packRaw = await readFile(packPath, "utf8");
        const pack = JSON.parse(packRaw);
        let attestationStatus: "signed" | "failed" | "missing" | "blocked" = "missing";
        try {
          const attRaw = await readFile(attPath, "utf8");
          const att = JSON.parse(attRaw);
          const expectedDigest = att.statement?.subject?.find(
            (s: any) => s.name === "evidence-pack.json",
          )?.digest?.sha256;
          const actualDigest = sha256Hex(canonicalJson(pack));
          if (pack.attestation?.status === "blocked") {
            attestationStatus = "blocked";
          } else {
            attestationStatus = expectedDigest && expectedDigest === actualDigest ? "signed" : "failed";
          }
        } catch {
          attestationStatus = "missing";
        }
        packs.push({
          taskId,
          status: pack.status,
          generatedAt: pack.generatedAt,
          verdict: pack.verdict,
          verifiedTaskScore: pack.verifiedTaskScore,
          attestationStatus,
          filesModifiedCount: (pack.filesModified ?? []).length,
        });
      } catch {
        // Corrupt or partial dir; skip silently for list robustness.
      }
    }
    return packs.sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
  } catch {
    return [];
  }
}

function validateResolvePolicyStopRequest(request: unknown): ResolvePolicyStopRequest {
  const record = assertPlainRecord(request, "Policy stop resolution request");
  assertKnownKeys(record, new Set(["stopId", "action", "scopeExpansion"]), "Policy stop resolution request");
  const action = requireBoundedString(record.action, "action", 80);
  if (!POLICY_STOP_ACTIONS.has(action)) {
    throw new Error("Invalid policy stop resolution action.");
  }
  let scopeExpansion: ResolvePolicyStopRequest["scopeExpansion"];
  if (record.scopeExpansion !== undefined) {
    const scope = assertPlainRecord(record.scopeExpansion, "scopeExpansion");
    assertKnownKeys(scope, new Set(["kind", "value", "expires"]), "scopeExpansion");
    const kind = requireBoundedString(scope.kind, "scopeExpansion.kind", 40);
    const expires = requireBoundedString(scope.expires, "scopeExpansion.expires", 40);
    if (!["path", "command", "network"].includes(kind) || !["once", "run"].includes(expires)) {
      throw new Error("Invalid policy scope expansion.");
    }
    scopeExpansion = {
      kind: kind as NonNullable<ResolvePolicyStopRequest["scopeExpansion"]>["kind"],
      value: requireBoundedString(scope.value, "scopeExpansion.value", 2_000),
      expires: expires as NonNullable<ResolvePolicyStopRequest["scopeExpansion"]>["expires"],
    };
  }
  return {
    stopId: requireBoundedString(record.stopId, "stopId", 200),
    action: action as ResolvePolicyStopRequest["action"],
    scopeExpansion,
  };
}

function normalizeRainyApiKey(apiKey: string) {
  const trimmedApiKey = apiKey.trim();

  if (
    !trimmedApiKey.startsWith("ra-") &&
    !trimmedApiKey.startsWith("rk_live_")
  ) {
    throw new Error('Rainy API key must start with "ra-" or "rk_live_".');
  }

  return trimmedApiKey;
}

function appleScriptString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function vscodeFileUri(value: string) {
  const fileUrl = pathToFileURL(value);
  const workspacePath = fileUrl.host
    ? `/${fileUrl.host}${fileUrl.pathname}`
    : fileUrl.pathname;

  return `vscode://file${workspacePath}`;
}

async function resolveActiveWorkspacePath() {
  const activeWorkspace = await resolveActiveWorkspace();
  return activeWorkspace.path;
}

async function resolveActiveWorkspace() {
  const workspaces = await tursoService.getWorkspaces();
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  if (!activeWorkspaceId) {
    throw new Error('No active workspace. Add or select a repository to analyze.');
  }
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  if (!activeWorkspace) {
    throw new Error('Active workspace not found (it may have been removed).');
  }

  return activeWorkspace;
}

async function resolveGitService() {
  const workspacePath = await resolveActiveWorkspacePath();
  return new GitService(workspacePath);
}

export function registerIpcHandlers() {
  ipcMain.handle("app:check-updates", async () => checkForUpdates(true));
  ipcMain.handle("privacy:scan-text", async (_event, text: string) => {
    if (typeof text !== "string") {
      throw new Error("privacy scan text must be a string.");
    }
    if (text.length > MAX_IPC_TEXT_LENGTH) {
      throw new Error(`privacy scan text exceeds ${MAX_IPC_TEXT_LENGTH} characters.`);
    }
    return privacyFirewall.scanTextSafe(text);
  });
  ipcMain.handle("privacy:get-model-status", async () =>
    privacyFirewall.getModelStatus(),
  );
  ipcMain.handle("privacy:download-model", async (event) =>
    privacyFirewall.downloadModel((progress) => {
      event.sender.send("privacy:model-download-progress", progress);
    }),
  );
  ipcMain.handle("privacy:clear-vault", async () =>
    privacyFirewall.clearVault(),
  );

  ipcMain.handle("repo:bootstrap", async () => bootstrapWorkspaceState());
  ipcMain.handle(
    "repo:generate-compliance-report",
    async (_event, request: unknown) => {
      const { taskId } = validateComplianceExportRequest(request);
      const workspace = await resolveActiveWorkspace();
      // Phase 1: with strict active resolution (no silent [0] or cwd seed), this workspace.path
      // is the user-selected target. Evidence for the taskId was written under its .mate-x tree.
      // load + generate will target the correct location; assert failures now indicate real
      // mismatch rather than launch-cwd pollution.
      const evidencePack = await loadVerifiedEvidencePackForExport(workspace.path, taskId);
      const result = await generateComplianceExport({
        evidencePack,
        taskId,
        workspacePath: workspace.path,
        userId: workspace.id,
        policyApplied: "workspace-trust-contract",
      });
      await verifyComplianceZipForDelivery(result);
      return result;
    },
  );

  // ── Evidence Pack local standalone surface (Phase C) ─────────────────────
  // These operate on the authoritative on-disk .mate-x/evidence/<taskId> tree
  // (populated by attestation at run end, enriched with sidecars in Phase B).
  // They enable listing/browsing packs without depending on chat message history.
  ipcMain.handle("evidence:list-packs", async (_event, workspaceId?: string) =>
    listLocalEvidencePacks(optionalWorkspaceId(workspaceId)),
  );

  ipcMain.handle("evidence:get-pack", async (_event, workspaceId: string, taskId: string) => {
    const wsId = requireWorkspaceId(workspaceId);
    const snapshot = await collectRepoSnapshot("get-evidence-pack", wsId);
    const sanitizedTaskId = sanitizeComplianceTaskId(requireBoundedString(taskId, "taskId", 200));
    return loadVerifiedEvidencePackForExport(snapshot.workspace.path, sanitizedTaskId);
  });

  ipcMain.handle("evidence:verify-attestation", async (_event, workspaceId: string, taskId: string) => {
    const wsId = requireWorkspaceId(workspaceId);
    const snapshot = await collectRepoSnapshot("verify-attestation", wsId);
    const sanitizedTaskId = sanitizeComplianceTaskId(requireBoundedString(taskId, "taskId", 200));
    try {
      await loadVerifiedEvidencePackForExport(snapshot.workspace.path, sanitizedTaskId);
      return { valid: true };
    } catch (err: any) {
      return { valid: false, reason: err?.message ?? "Verification failed" };
    }
  });

  ipcMain.handle("evidence:export-compliance-zip", async (_event, workspaceId: string, taskId: string) => {
    const wsId = requireWorkspaceId(workspaceId);
    const snapshot = await collectRepoSnapshot("export-evidence", wsId);
    const sanitizedTaskId = sanitizeComplianceTaskId(requireBoundedString(taskId, "taskId", 200));
    const evidencePack = await loadVerifiedEvidencePackForExport(snapshot.workspace.path, sanitizedTaskId);
    const result = await generateComplianceExport({
      evidencePack,
      taskId: sanitizedTaskId,
      workspacePath: snapshot.workspace.path,
      userId: snapshot.workspace.id,
      policyApplied: "workspace-trust-contract",
    });
    await verifyComplianceZipForDelivery(result);
    return result;
  });

  ipcMain.handle("repo:get-workspaces", async () => getWorkspaceEntries());
  ipcMain.handle("repo:get-workspace-summary", async () =>
    getWorkspaceSummary(),
  );
  ipcMain.handle(
    "repo:get-workspace-trust-contract",
    async (_event, workspaceId?: string) =>
      getWorkspaceTrustContract(optionalWorkspaceId(workspaceId)),
  );
  ipcMain.handle(
    "repo:update-workspace-trust-contract",
    async (_event, contract) => updateWorkspaceTrustContract(validateWorkspaceTrustContract(contract)),
  );
  ipcMain.handle("repo:get-workspace-memory-status", async () => {
    const workspace = await resolveActiveWorkspace();
    return workspaceMemoryService.getStatus(workspace.id, workspace.path);
  });
  ipcMain.handle(
    "repo:write-workspace-memory-file",
    async (_event, kind: WorkspaceMemoryFileKind, content: string) => {
      const workspace = await resolveActiveWorkspace();
      return workspaceMemoryService.writeFile(
        workspace.id,
        workspace.path,
        validateWorkspaceMemoryKind(kind),
        requireBoundedString(content, "workspace memory content", MAX_IPC_TEXT_LENGTH),
      );
    },
  );
  ipcMain.handle(
    "repo:reset-workspace-memory-file",
    async (_event, kind: WorkspaceMemoryFileKind) => {
      const workspace = await resolveActiveWorkspace();
      return workspaceMemoryService.resetFile(workspace.id, workspace.path, validateWorkspaceMemoryKind(kind));
    },
  );
  ipcMain.handle("repo:reveal-workspace-memory-folder", async () => {
    const workspace = await resolveActiveWorkspace();
    return workspaceMemoryService.revealFolder(workspace.id, workspace.path);
  });
  ipcMain.handle("repo:get-workspace-memory-bootstrap-context", async () => {
    const workspace = await resolveActiveWorkspace();
    return workspaceMemoryService.getBootstrapContext(workspace.id, workspace.path);
  });
  ipcMain.handle(
    "repo:set-active-workspace",
    async (_event, workspaceId: string) => {
      const snapshot = await setActiveWorkspace(requireWorkspaceId(workspaceId));
      const workspace = await resolveActiveWorkspace();
      void repoGraphService.ensureWorkspaceGraph(workspace);
      return snapshot;
    },
  );
  ipcMain.handle("repo:remove-workspace", async (_event, workspaceId: string) =>
    removeWorkspace(requireWorkspaceId(workspaceId)),
  );
  ipcMain.handle(
    "repo:save-workspace-session",
    async (_event, workspaceId: string, threads, activeThreadId: string) =>
      saveWorkspaceSession(
        requireWorkspaceId(workspaceId),
        validateConversationSnapshot(threads),
        requireBoundedString(activeThreadId, "activeThreadId", 200),
      ),
  );
  ipcMain.handle("repo:open-workspace-picker", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return addWorkspace(result.filePaths[0]);
  });
  ipcMain.handle(
    "repo:open-workspace-path",
    async (_event, target: string) => {
      const validTargets = new Set(["folder", "vscode", "terminal"]);
      if (!validTargets.has(target)) {
        throw new Error(`Invalid target: ${target}. Must be one of: folder, vscode, terminal.`);
      }

      const workspacePath = await resolveActiveWorkspacePath();

      if (target === "folder") {
        await shell.openPath(workspacePath);
        return;
      }

      if (target === "vscode") {
        await shell.openExternal(vscodeFileUri(workspacePath));
        return;
      }

      if (target === "terminal") {
        if (process.platform === "darwin") {
          const terminal = spawn("osascript", [
            "-e",
            `tell application "Terminal" to do script "cd " & quoted form of ${appleScriptString(workspacePath)}`,
            "-e",
            `tell application "Terminal" to activate`,
          ], {
            detached: true,
            stdio: "ignore",
          });
          terminal.on("error", (error) => {
            console.error("Failed to open Terminal:", error);
          });
          terminal.unref();
          return;
        }

        if (process.platform === "win32") {
          const terminal = spawn("cmd.exe", ["/K"], {
            cwd: workspacePath,
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          });
          terminal.on("error", (error) => {
            console.error("Failed to open Command Prompt:", error);
          });
          terminal.unref();
          return;
        }

        await shell.openPath(workspacePath);
        return;
      }

      await shell.openPath(workspacePath);
    },
  );
  ipcMain.handle("repo:list-files", async (_event, limit?: number) =>
    listFiles(validateLimit(limit)),
  );
  ipcMain.handle("repo:search", async (_event, query: string, limit?: number) =>
    searchInFiles(requireBoundedString(query, "query", 2_000), validateLimit(limit)),
  );
  ipcMain.handle("repo:get-threat-graph", async () => {
    const startedAt = Date.now();
    const graph = await buildThreatGraphSnapshot();
    recordPerformanceMetric({
      kind: "run",
      name: "threat_graph_build",
      value: Date.now() - startedAt,
      unit: "ms",
      budget: 2_000,
    });
    return graph;
  });
  ipcMain.handle("perf:get-snapshot", async () => buildBenchmarkSnapshot());
  ipcMain.handle("perf:run-benchmark", async () => {
    const startedAt = Date.now();
    await buildThreatGraphSnapshot();
    recordPerformanceMetric({
      kind: "benchmark",
      name: "warm_threat_graph",
      value: Date.now() - startedAt,
      unit: "ms",
      budget: 2_000,
    });
    return buildBenchmarkSnapshot();
  });
  ipcMain.handle("agent-firewall:list-decisions", async () =>
    frontierFirewallDecisions.slice(-100),
  );
  ipcMain.handle("agent-firewall:evaluate-command", async (_event, command: string) => {
    const settings = await tursoService.getAppSettings();
    const decision = classifyAgentCommand(
      requireBoundedString(command, "command", 20_000),
      settings.agentFirewallMode,
    );
    frontierFirewallDecisions.push(decision);
    if (frontierFirewallDecisions.length > 200) {
      frontierFirewallDecisions.splice(0, frontierFirewallDecisions.length - 200);
    }
    return decision;
  });
  ipcMain.handle(
    "repo:get-agent-capability-profiles",
    async (_event, workspaceId?: string) =>
      tursoService.listAgentCapabilityProfiles(optionalWorkspaceId(workspaceId)),
  );
  ipcMain.handle(
    "repo:get-agent-routing-recommendation",
    async (_event, task: string, workspaceId?: string) =>
      getAgentRoutingRecommendation(
        requireBoundedString(task, "task", 5_000),
        optionalWorkspaceId(workspaceId),
      ),
  );
  ipcMain.handle(
    "repo:run-assistant",
    async (
      event,
      prompt: string,
      history: string[],
      options?: AssistantRunOptions,
      runId?: string,
      workspaceId?: string,
    ) => {
      let pendingProgress: {
        runId: string;
        status: string;
        content: string;
        thought?: string;
        events?: Array<{ id?: string; status?: string }>;
        artifacts?: unknown[];
      } | null = null;
      let progressFlushTimer: ReturnType<typeof setTimeout> | null = null;
      let lastProgressSignature = "";

      const flushProgress = () => {
        if (progressFlushTimer) {
          clearTimeout(progressFlushTimer);
          progressFlushTimer = null;
        }

        if (!pendingProgress || event.sender.isDestroyed()) {
          pendingProgress = null;
          return;
        }

        event.sender.send("repo:assistant-progress", pendingProgress);
        pendingProgress = null;
      };

      const emitProgress = (
        progress: NonNullable<Parameters<typeof runAssistant>[4]>["emit"] extends (
          value: infer T,
        ) => void
          ? T
          : never,
      ) => {
        const lastEvent = progress.events?.at(-1);
        const signature = [
          progress.runId,
          progress.status,
          progress.content,
          progress.thought ?? "",
          progress.events?.length ?? 0,
          lastEvent?.id ?? "",
          lastEvent?.status ?? "",
          progress.artifacts?.length ?? 0,
        ].join("\u001f");

        if (signature === lastProgressSignature) {
          return;
        }

        lastProgressSignature = signature;
        pendingProgress = progress;

        if (ASSISTANT_PROGRESS_TERMINAL_STATUSES.has(progress.status)) {
          flushProgress();
          return;
        }

        progressFlushTimer ??= setTimeout(
          flushProgress,
          ASSISTANT_PROGRESS_IPC_FLUSH_MS,
        );
      };

      try {
        return await runAssistant(
        requireBoundedString(prompt, "prompt"),
        requireStringArray(history, "history", MAX_IPC_TEXT_LENGTH),
        // Forward explicit workspaceId when provided by caller (future renderer updates can pass
        // the active workspace for the chat thread). Falls back to undefined so that
        // collectRepoSnapshot / resolveWorkspace uses the (now strict) active workspace.
        // This + removal of cwd seeding + strict no-[0] fallback in resolveWorkspace ensures
        // evidence artifacts are always scoped to the user-selected target repo.
        optionalWorkspaceId(workspaceId),
        validateAssistantOptions(options),
        runId
          ? {
              runId: requireBoundedString(runId, "runId", 200),
              emit: emitProgress,
            }
          : undefined,
        );
      } finally {
        flushProgress();
      }
    },
  );

  ipcMain.handle("repo-graph:refresh", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.refreshWorkspace(workspace);
  });
  ipcMain.handle("repo-graph:get-entrypoints", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getEntrypoints(workspace);
  });
  ipcMain.handle("repo-graph:get-impacted-files", async (_event, files: string[]) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getImpactedFiles(
      workspace,
      requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files")),
    );
  });
  ipcMain.handle("repo-graph:get-tests-for-file", async (_event, file: string) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getTestsForFile(workspace, assertSafeRelativePath(requireBoundedString(file, "file", 2_000), "file"));
  });
  ipcMain.handle("repo-graph:get-import-chain", async (_event, from: string, to: string) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getImportChain(
      workspace,
      assertSafeRelativePath(requireBoundedString(from, "from", 2_000), "from"),
      assertSafeRelativePath(requireBoundedString(to, "to", 2_000), "to"),
    );
  });
  ipcMain.handle("repo-graph:get-ipc-surface", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getIpcSurface(workspace);
  });
  ipcMain.handle("repo-graph:get-env-usage", async (_event, variable?: string) => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getEnvUsage(workspace, optionalBoundedString(variable, "variable", 200)?.trim() || undefined);
  });
  ipcMain.handle("repo-graph:get-dependency-surface", async () => {
    const workspace = await resolveActiveWorkspaceForRepoGraph();
    return repoGraphService.getDependencySurface(workspace);
  });

  ipcMain.handle("mate-x:orchestrator:execute", async (_event, action: unknown) => {
    if (!action || typeof action !== "object") {
      throw new Error("SDK action must be an object.");
    }
    try {
      const result = await getStack().orchestrator.execute(action as never);
      return { success: true, result };
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "MissingSDKClientError" &&
        typeof (error as Error & { client?: unknown }).client === "string"
      ) {
        return {
          success: false,
          error: "SDK_CLIENT_NOT_CONFIGURED",
          client: (error as Error & { client: string }).client,
        };
      }
      throw error;
    }
  });

  ipcMain.handle("mate-x:orchestrator:routing", async () =>
    getStack().orchestrator.getRoutingRecommendations(),
  );

  ipcMain.handle("mate-x:storage:list-packs", async (_event, workspaceId: string) =>
    getStack().evidencePackStorage.list(requireBoundedString(workspaceId, "workspaceId", 500)),
  );

  ipcMain.handle("mate-x:storage:sync-status", async () => ({
    configured: true,
    routing: getStack().orchestrator.getRoutingRecommendations(),
  }));

  ipcMain.handle("mate-x:storage:force-sync", async () =>
    getStack().failureMemorySync.sync(),
  );

  ipcMain.handle("git:status", async () => {
    const workspace = await resolveActiveWorkspace();
    const status = await (await resolveGitService()).getStatus();
    void repoGraphService.noteGitStatusChanged(workspace);
    return status;
  });
  ipcMain.handle("git:log", async (_event, limit?: number) =>
    (await resolveGitService()).getLog(validateLimit(limit)),
  );
  ipcMain.handle("git:stage-files", async (_event, files: string[]) =>
    (await resolveGitService()).stageFiles(requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files"))),
  );
  ipcMain.handle("git:commit", async (_event, message: string) =>
    (await resolveGitService()).commit(requireBoundedString(message, "message", 20_000)),
  );
  ipcMain.handle("git:push", async () => (await resolveGitService()).push());
  ipcMain.handle("git:pull", async () => (await resolveGitService()).pull());
  ipcMain.handle("git:diff", async () => (await resolveGitService()).getDiff());
  ipcMain.handle("git:unstage", async (_event, files: string[]) =>
    (await resolveGitService()).unstageFiles(requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files"))),
  );

  // ── Policy Stops ────────────────────────────────────────────────────────
  ipcMain.handle("policy:list-stops", async (_event, runId?: string) =>
    policyService.listStops(optionalBoundedString(runId, "runId", 200)),
  );
  ipcMain.handle("policy:get-run-state", async (_event, runId: string) => {
    if (typeof runId !== "string" || !runId.trim()) {
      throw new Error("Policy run id is required.");
    }

    return policyService.getRunState(runId);
  });
  ipcMain.handle(
    "policy:resolve-stop",
    async (_event, request: ResolvePolicyStopRequest) =>
      policyService.resolveStop(validateResolvePolicyStopRequest(request)),
  );

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle("settings:get-api-key-status", async () => tursoService.getApiKeyStatus());
  ipcMain.handle("settings:set-api-key", async (_event, apiKey: string) =>
    tursoService.setApiKey(normalizeRainyApiKey(requireBoundedString(apiKey, "apiKey", 2_000))),
  );
  ipcMain.handle(
    "settings:list-models",
    async (_event, forceRefresh?: boolean) =>
      listRainyModels({ apiKey: await tursoService.getApiKey(), forceRefresh: forceRefresh === true }),
  );
  ipcMain.handle("settings:get-model", async () => tursoService.getModel());
  ipcMain.handle("settings:set-model", async (_event, model: string) => {
    const apiKey = await tursoService.getApiKey();
    const normalizedModel = requireBoundedString(model, "model", 500);
    await validateRainyModelSelection({ apiKey, model: normalizedModel });
    await tursoService.setModel(normalizedModel);
  });
  ipcMain.handle("settings:list-embedding-models", async () => [
    ...RAINY_REPO_EMBEDDING_MODELS,
  ]);
  ipcMain.handle("settings:get-embedding-model", async () =>
    tursoService.getEmbeddingModel(),
  );
  ipcMain.handle("settings:set-embedding-model", async (_event, model: string) => {
    const normalizedModel = requireBoundedString(model, "model", 500);
    validateRainyEmbeddingModelSelection(normalizedModel);
    await tursoService.setEmbeddingModel(normalizedModel);
    try {
      const workspace = await resolveActiveWorkspaceForRepoGraph();
      await repoGraphService.refreshWorkspace(
        workspace,
        (progress) => {
          if (!_event.sender.isDestroyed()) {
            _event.sender.send("repo-graph:embedding-progress", progress);
          }
        },
        true,
      );
    } catch (error) {
      console.warn("RepoGraph embedding reindex after model change failed:", error);
    }
  });
  ipcMain.handle("settings:get-app-settings", async () =>
    tursoService.getAppSettings(),
  );
  ipcMain.handle(
    "settings:update-app-settings",
    async (_event, settings: AppSettings) =>
      tursoService.updateAppSettings(validateAppSettings(settings)),
  );

  // ── Mobile Companion ───────────────────────────────────────────────────
  ipcMain.handle("mobile:start-pairing", async () => mobileBridgeService.startPairing());
  ipcMain.handle("mobile:stop-pairing", async () => mobileBridgeService.stopPairing());
  ipcMain.handle("mobile:get-status", async () => mobileBridgeService.getStatus());
  ipcMain.handle("mobile:get-pending-pairing", async () => mobileBridgeService.getPendingPairing());
  ipcMain.handle("mobile:approve-pending-pairing", async (_event, approved: boolean) =>
    mobileBridgeService.approvePendingPairing(approved === true),
  );
  ipcMain.handle("mobile:list-devices", async () => mobileBridgeService.listDevices());
  ipcMain.handle("mobile:revoke-device", async (_event, deviceId: string) =>
    mobileBridgeService.revokeDevice(requireBoundedString(deviceId, "deviceId", 200)),
  );

  // ── GitHub Integration ──────────────────────────────────────────────────
  ipcMain.handle("github:detect-remote", async (_event, workspacePath: string) =>
    detectGitHubRemote(requireBoundedString(workspacePath, "workspacePath", 4_000)),
  );
  ipcMain.handle("github:get-current-branch", async (_event, workspacePath: string) =>
    getCurrentBranch(requireBoundedString(workspacePath, "workspacePath", 4_000)),
  );
  ipcMain.handle("github:get-local-diff", async (_event, workspacePath: string) =>
    getLocalDiff(requireBoundedString(workspacePath, "workspacePath", 4_000)),
  );
  ipcMain.handle("github:get-changed-files", async (_event, workspacePath: string) =>
    getChangedFiles(requireBoundedString(workspacePath, "workspacePath", 4_000)),
  );
  ipcMain.handle("github:collect-local-evidence", async (_event, workspacePath: string) =>
    collectGitHubLocalEvidence(requireBoundedString(workspacePath, "workspacePath", 4_000)),
  );
  ipcMain.handle("github:get-status", async (_event, workspacePath: string) => {
    const settings = await tursoService.getAppSettings();
    return getIntegrationStatus(
      requireBoundedString(workspacePath, "workspacePath", 4_000),
      settings.githubIntegrationEnabled,
    );
  });
  ipcMain.handle("github:get-pr-for-branch", async () => getPullRequestForBranch());
  ipcMain.handle("github:get-pr-files", async () => getPullRequestFiles());
  ipcMain.handle("github:get-pr-checks", async () => getPullRequestChecks());

  // ── UI ───────────────────────────────────────────────────────────────────
  ipcMain.handle(
    "ui:show-chat-context-menu",
    async (event, threadId: string) => {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: "Rename",
          click: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat:rename-thread", threadId);
            }
          },
        },
        {
          label: "Archive",
          click: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat:archive-thread", threadId);
            }
          },
        },
        { type: "separator" },
        {
          label: "Delete",
          click: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat:delete-thread", threadId);
            }
          },
        },
      ];

      const menu = Menu.buildFromTemplate(template);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        menu.popup({ window });
      }
    },
  );
  ipcMain.handle(
    "ui:copy-to-clipboard",
    async (_event, text: string) => {
      clipboard.writeText(String(text ?? ""));
    },
  );
}
