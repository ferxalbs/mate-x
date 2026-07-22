import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";

import type { AssistantRunOptions, Conversation, EvidencePack } from "../contracts/chat";
import { validateAssistantRunOptions } from "../contracts/assistant-run-options";
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
import { requiresSensitiveIpcApproval } from "./ipc/approval-policy";
import { assertTrustedRendererSender } from "./ipc/guards";
import { policyService } from "./policy-service";
import {
  addWorkspace,
  bootstrapWorkspaceState,
  getWorkspaceEntries,
  getWorkspaceSummary,
  getWorkspaceTrustContract,
  listFiles,
  removeWorkspace,
  saveWorkspaceSession,
  searchInFiles,
  setActiveWorkspace,
  updateWorkspaceTrustContract,
  collectRepoSnapshot,
} from "./repo-service/workspace";
import { tursoService } from "./turso-service";
import { checkForUpdates } from "./updater";
import { applyWindowAppearance } from "./window-appearance";
import { getStack } from "./main-stack";
import { setAuthorizedBackgroundImagePath } from "./background-image-auth";

// ── Lazy service loaders (keep main-process cold start free of assistant/SDK bulk) ──
const loadRepoService = () => import("./repo-service");
const loadRainyService = () => import("./rainy-service");
const loadRepoGraphService = () => import("./repo-graph-service");
const loadWorkspaceMemoryService = () => import("./workspace-memory-service");
const loadPrivacyFirewall = () => import("./privacy/privacy-firewall-service");
const loadGitService = () => import("./git-service");
const loadGitHubIntegration = () => import("./github-integration-service");
const loadComplianceExport = () => import("../features/compliance/complianceExport");
const loadAttestation = () => import("../features/compliance/attestation");
const loadMobileBridge = () => import("./mobile-bridge-service");


const ASSISTANT_PROGRESS_IPC_FLUSH_MS = 80;
const ASSISTANT_PROGRESS_TERMINAL_STATUSES = new Set(["completed", "failed"]);
const activeAssistantRunControllers = new Map<string, AbortController>();
const MAX_IPC_TEXT_LENGTH = 200_000;
const MAX_IPC_ARRAY_LENGTH = 500;
const WORKSPACE_MEMORY_FILE_KINDS = new Set<WorkspaceMemoryFileKind>(["memory", "guardrails", "workstate"]);
const POLICY_STOP_ACTIONS = new Set(["approve_once", "expand_scope", "abort", "safer_alternative"]);
const TRUST_AUTONOMY_VALUES = new Set(["plan-only", "approval-required", "trusted-patch"]);
const APP_SETTING_KEYS = new Set([
  "appearance",
  "theme",
  "blurEnabled",
  "vibrancyMode",
  "timeFormat",
  "agentTraceVersion",
  "agentTraceV2InlineEvents",
  "diffLineWrapping",
  "assistantOutput",
  "compactMode",
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
  "customBackgroundImage",
  "customBackgroundOpacity",
]);
const frontierStartedAt = Date.now();
const frontierPerformanceMetrics: PerformanceMetric[] = [];
const frontierFirewallDecisions: AgentFirewallDecision[] = [];

function registerGuardedIpcHandler(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedRendererSender(event);
    return listener(event, ...args);
  });
}

async function requireSensitiveIpcApproval(input: {
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}) {
  const workspace = await resolveActiveWorkspace().catch(() => ({
    path: app.getPath("userData"),
  }));
  const stop = policyService.createStop({
    runId: `ipc-${Date.now()}`,
    workspacePath: workspace.path,
    toolName: "ipc",
    severity: "warning",
    policyId: "ipc.high_impact.approval",
    title: "High-impact app action requires approval.",
    explanation: "A renderer IPC request attempted a local mutation or credential-sensitive operation.",
    kind: "HIGH_IMPACT_PATCH_APPROVAL",
    target: input.target ?? input.action,
    metadata: {
      action: input.action,
      ...input.metadata,
    },
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort", "safer_alternative"],
  });
  const resolvedStop = await policyService.waitForResolution(stop.id);
  policyService.markStopCompleted(stop.id);
  if (resolvedStop.resolution?.action !== "approve_once") {
    throw new Error(`IPC action "${input.action}" was not approved.`);
  }
  return workspace;
}

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
  const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
  const [entrypoints, ipcSurface, envUsage, dependencySurface] = await Promise.all([
    (await loadRepoGraphService()).repoGraphService.getEntrypoints(workspace),
    (await loadRepoGraphService()).repoGraphService.getIpcSurface(workspace),
    (await loadRepoGraphService()).repoGraphService.getEnvUsage(workspace),
    (await loadRepoGraphService()).repoGraphService.getDependencySurface(workspace),
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
  const actualDigest = (await loadAttestation()).sha256Hex((await loadAttestation()).canonicalJson(evidencePack));
  if (!expectedDigest || expectedDigest !== actualDigest) {
    throw new Error("Evidence Pack digest does not match signed attestation.");
  }

  const scan = await (await loadPrivacyFirewall()).privacyFirewall.scanTextSafe((await loadAttestation()).canonicalJson(evidencePack));
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
          const actualDigest = (await loadAttestation()).sha256Hex((await loadAttestation()).canonicalJson(pack));
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
  const [{ GitService }, workspacePath] = await Promise.all([
    loadGitService(),
    resolveActiveWorkspacePath(),
  ]);
  return new GitService(workspacePath);
}

export function registerIpcHandlers() {
  const handle = registerGuardedIpcHandler;
  const linearAction = async <T>(action: (service: import("./linear/linear-connection-service").LinearConnectionService) => Promise<T>): Promise<T> => {
    try {
      const service = (await import("./linear")).getLinearConnectionService();
      return await action(service);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const safeMessage = /^(Enter a valid Linear Client ID\.|MaTE X could not open Linear\. Try again\.|Linear authorization .{0,160}|Linear OAuth token request failed \(\d{3}\))$/.test(message)
        ? message
        : "Linear could not complete that action. Try again.";
      throw new Error(safeMessage, { cause: error });
    }
  };

  handle("app:check-updates", async () => checkForUpdates(true));
  handle("linear:get-status", async () => linearAction((service) => service.status()));
  handle("linear:connect", async () => linearAction((service) => service.begin()));
  handle("linear:open-developer-setup", async () => linearAction((service) => service.openDeveloperSetup()));
  handle("linear:save-client-id-and-connect", async (_event, clientId: unknown) => {
    if (typeof clientId !== "string" || clientId.length > 200) throw new Error("Enter a valid Linear Client ID.");
    return linearAction((service) => service.saveClientIdAndBegin(clientId));
  });
  handle("linear:disconnect", async () => linearAction((service) => service.revoke()));
  handle("privacy:scan-text", async (_event, text: string) => {
    if (typeof text !== "string") {
      throw new Error("privacy scan text must be a string.");
    }
    if (text.length > MAX_IPC_TEXT_LENGTH) {
      throw new Error(`privacy scan text exceeds ${MAX_IPC_TEXT_LENGTH} characters.`);
    }
    return (await loadPrivacyFirewall()).privacyFirewall.scanTextSafe(text);
  });
  handle("privacy:get-model-status", async () =>
    (await loadPrivacyFirewall()).privacyFirewall.getModelStatus(),
  );
  handle("privacy:download-model", async (event) =>
    (await loadPrivacyFirewall()).privacyFirewall.downloadModel((progress) => {
      event.sender.send("privacy:model-download-progress", progress);
    }),
  );
  handle("privacy:clear-vault", async () => {
    await requireSensitiveIpcApproval({ action: "privacy:clear-vault" });
    return (await loadPrivacyFirewall()).privacyFirewall.clearVault();
  });

  handle("repo:bootstrap", async () => bootstrapWorkspaceState());
  handle(
    "repo:generate-compliance-report",
    async (_event, request: unknown) => {
      const { taskId } = validateComplianceExportRequest(request);
      const workspace = await resolveActiveWorkspace();
      // Phase 1: with strict active resolution (no silent [0] or cwd seed), this workspace.path
      // is the user-selected target. Evidence for the taskId was written under its .mate-x tree.
      // load + generate will target the correct location; assert failures now indicate real
      // mismatch rather than launch-cwd pollution.
      const evidencePack = await loadVerifiedEvidencePackForExport(workspace.path, taskId);
      const result = await (await loadComplianceExport()).generateComplianceExport({
        evidencePack,
        taskId,
        workspacePath: workspace.path,
        userId: workspace.id,
        policyApplied: "workspace-trust-contract",
      });
      await (await loadComplianceExport()).verifyComplianceZipForDelivery(result);
      return result;
    },
  );

  // ── Evidence Pack local standalone surface (Phase C) ─────────────────────
  // These operate on the authoritative on-disk .mate-x/evidence/<taskId> tree
  // (populated by attestation at run end, enriched with sidecars in Phase B).
  // They enable listing/browsing packs without depending on chat message history.
  handle("evidence:list-packs", async (_event, workspaceId?: string) =>
    listLocalEvidencePacks(optionalWorkspaceId(workspaceId)),
  );

  handle("evidence:get-pack", async (_event, workspaceId: string, taskId: string) => {
    const wsId = requireWorkspaceId(workspaceId);
    const snapshot = await collectRepoSnapshot("get-evidence-pack", wsId);
    const sanitizedTaskId = (await loadComplianceExport()).sanitizeComplianceTaskId(requireBoundedString(taskId, "taskId", 200));
    return loadVerifiedEvidencePackForExport(snapshot.workspace.path, sanitizedTaskId);
  });

  handle("evidence:verify-attestation", async (_event, workspaceId: string, taskId: string) => {
    const wsId = requireWorkspaceId(workspaceId);
    const snapshot = await collectRepoSnapshot("verify-attestation", wsId);
    const sanitizedTaskId = (await loadComplianceExport()).sanitizeComplianceTaskId(requireBoundedString(taskId, "taskId", 200));
    try {
      await loadVerifiedEvidencePackForExport(snapshot.workspace.path, sanitizedTaskId);
      return { valid: true };
    } catch (err: any) {
      return { valid: false, reason: err?.message ?? "Verification failed" };
    }
  });

  handle("evidence:export-compliance-zip", async (_event, workspaceId: string, taskId: string) => {
    const wsId = requireWorkspaceId(workspaceId);
    const snapshot = await collectRepoSnapshot("export-evidence", wsId);
    const sanitizedTaskId = (await loadComplianceExport()).sanitizeComplianceTaskId(requireBoundedString(taskId, "taskId", 200));
    const evidencePack = await loadVerifiedEvidencePackForExport(snapshot.workspace.path, sanitizedTaskId);
    const result = await (await loadComplianceExport()).generateComplianceExport({
      evidencePack,
      taskId: sanitizedTaskId,
      workspacePath: snapshot.workspace.path,
      userId: snapshot.workspace.id,
      policyApplied: "workspace-trust-contract",
    });
    await (await loadComplianceExport()).verifyComplianceZipForDelivery(result);
    return result;
  });

  handle("repo:get-workspaces", async () => getWorkspaceEntries());
  handle("repo:get-workspace-summary", async () =>
    getWorkspaceSummary(),
  );
  handle(
    "repo:get-workspace-trust-contract",
    async (_event, workspaceId?: string) =>
      getWorkspaceTrustContract(optionalWorkspaceId(workspaceId)),
  );
  handle(
    "repo:update-workspace-trust-contract",
    async (_event, contract) => updateWorkspaceTrustContract(validateWorkspaceTrustContract(contract)),
  );
  handle("repo:get-workspace-memory-status", async () => {
    const workspace = await resolveActiveWorkspace();
    return (await loadWorkspaceMemoryService()).workspaceMemoryService.getStatus(workspace.id, workspace.path);
  });
  handle(
    "repo:write-workspace-memory-file",
    async (_event, kind: WorkspaceMemoryFileKind, content: string) => {
      const workspace = await resolveActiveWorkspace();
      return (await loadWorkspaceMemoryService()).workspaceMemoryService.writeFile(
        workspace.id,
        workspace.path,
        validateWorkspaceMemoryKind(kind),
        requireBoundedString(content, "workspace memory content", MAX_IPC_TEXT_LENGTH),
      );
    },
  );
  handle(
    "repo:reset-workspace-memory-file",
    async (_event, kind: WorkspaceMemoryFileKind) => {
      const workspace = await resolveActiveWorkspace();
      return (await loadWorkspaceMemoryService()).workspaceMemoryService.resetFile(workspace.id, workspace.path, validateWorkspaceMemoryKind(kind));
    },
  );
  handle("repo:reveal-workspace-memory-folder", async () => {
    const workspace = await resolveActiveWorkspace();
    return (await loadWorkspaceMemoryService()).workspaceMemoryService.revealFolder(workspace.id, workspace.path);
  });
  handle("repo:get-workspace-memory-bootstrap-context", async () => {
    const workspace = await resolveActiveWorkspace();
    return (await loadWorkspaceMemoryService()).workspaceMemoryService.getBootstrapContext(workspace.id, workspace.path);
  });
  handle(
    "repo:set-active-workspace",
    async (_event, workspaceId: string) => {
      const snapshot = await setActiveWorkspace(requireWorkspaceId(workspaceId));
      const workspace = await resolveActiveWorkspace();
      void (await loadRepoGraphService()).repoGraphService.ensureWorkspaceGraph(workspace);
      return snapshot;
    },
  );
  handle("repo:remove-workspace", async (_event, workspaceId: string) =>
    removeWorkspace(requireWorkspaceId(workspaceId)),
  );
  handle(
    "repo:save-workspace-session",
    async (_event, workspaceId: string, threads, activeThreadId: string) =>
      saveWorkspaceSession(
        requireWorkspaceId(workspaceId),
        validateConversationSnapshot(threads),
        requireBoundedString(activeThreadId, "activeThreadId", 200),
      ),
  );
  handle("repo:open-workspace-picker", async (event) => {
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
  handle(
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
        await requireSensitiveIpcApproval({ action: "repo:open-workspace-path", target: "terminal" });

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
  handle("repo:list-files", async (_event, limit?: number) =>
    listFiles(validateLimit(limit)),
  );
  handle("repo:search", async (_event, query: string, limit?: number) =>
    searchInFiles(requireBoundedString(query, "query", 2_000), validateLimit(limit)),
  );
  handle("repo:get-threat-graph", async () => {
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
  handle("perf:get-snapshot", async () => buildBenchmarkSnapshot());
  handle("perf:run-benchmark", async () => {
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
  handle("agent-firewall:list-decisions", async () =>
    frontierFirewallDecisions.slice(-100),
  );
  handle("agent-firewall:evaluate-command", async (_event, command: string) => {
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
  handle(
    "repo:get-agent-capability-profiles",
    async (_event, workspaceId?: string) =>
      tursoService.listAgentCapabilityProfiles(optionalWorkspaceId(workspaceId)),
  );
  handle(
    "repo:get-agent-routing-recommendation",
    async (_event, task: string, workspaceId?: string) =>
      (await loadRepoService()).getAgentRoutingRecommendation(
        requireBoundedString(task, "task", 5_000),
        optionalWorkspaceId(workspaceId),
      ),
  );
  handle(
    "repo:run-assistant",
    async (
      event,
      prompt: string,
      history: string[],
      options?: AssistantRunOptions,
      runId?: string,
      workspaceId?: string,
    ) => {
      const normalizedRunId = runId
        ? requireBoundedString(runId, "runId", 200)
        : undefined;
      const assistantAbortController = new AbortController();
      if (normalizedRunId) {
        activeAssistantRunControllers.set(normalizedRunId, assistantAbortController);
      }
      let pendingProgress: {
        runId: string;
        status: string;
        content: string;
        thought?: string;
        events?: Array<{ id?: string; segmentId?: string; status?: string; detail?: string }>;
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
        progress: NonNullable<Parameters<Awaited<ReturnType<typeof loadRepoService>>["runAssistant"]>[4]>["emit"] extends (
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
          lastEvent?.segmentId ?? "",
          lastEvent?.status ?? "",
          lastEvent?.detail ?? "",
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
        return await (await loadRepoService()).runAssistant(
        requireBoundedString(prompt, "prompt"),
        requireStringArray(history, "history", MAX_IPC_TEXT_LENGTH),
        // Forward explicit workspaceId when provided by caller (future renderer updates can pass
        // the active workspace for the chat thread). Falls back to undefined so that
        // collectRepoSnapshot / resolveWorkspace uses the (now strict) active workspace.
        // This + removal of cwd seeding + strict no-[0] fallback in resolveWorkspace ensures
        // evidence artifacts are always scoped to the user-selected target repo.
        optionalWorkspaceId(workspaceId),
        validateAssistantRunOptions(options),
        normalizedRunId
          ? {
              runId: normalizedRunId,
              emit: emitProgress,
              signal: assistantAbortController.signal,
            }
          : undefined,
        );
      } finally {
        if (normalizedRunId) {
          activeAssistantRunControllers.delete(normalizedRunId);
        }
        flushProgress();
      }
    },
  );
  handle("repo:cancel-assistant", async (_event, runId: string) => {
    const normalizedRunId = requireBoundedString(runId, "runId", 200);
    const controller = activeAssistantRunControllers.get(normalizedRunId);
    controller?.abort();
    activeAssistantRunControllers.delete(normalizedRunId);
    return Boolean(controller);
  });

  handle("repo-graph:refresh", async () => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.refreshWorkspace(workspace);
  });
  handle("repo-graph:get-entrypoints", async () => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getEntrypoints(workspace);
  });
  handle("repo-graph:get-impacted-files", async (_event, files: string[]) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getImpactedFiles(
      workspace,
      requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files")),
    );
  });
  handle("repo-graph:get-tests-for-file", async (_event, file: string) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getTestsForFile(workspace, assertSafeRelativePath(requireBoundedString(file, "file", 2_000), "file"));
  });
  handle("repo-graph:get-import-chain", async (_event, from: string, to: string) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getImportChain(
      workspace,
      assertSafeRelativePath(requireBoundedString(from, "from", 2_000), "from"),
      assertSafeRelativePath(requireBoundedString(to, "to", 2_000), "to"),
    );
  });
  handle("repo-graph:get-ipc-surface", async () => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getIpcSurface(workspace);
  });
  handle("repo-graph:get-env-usage", async (_event, variable?: string) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getEnvUsage(workspace, optionalBoundedString(variable, "variable", 200)?.trim() || undefined);
  });
  handle("repo-graph:get-dependency-surface", async () => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getDependencySurface(workspace);
  });
  handle("repo-graph:semantic-search", async (_event, query: string, limit?: number, role?: string, risk?: string) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.semanticSearch(
      workspace,
      requireBoundedString(query, "query", 2_000),
      {
        limit: typeof limit === "number" ? limit : undefined,
        role: optionalBoundedString(role, "role", 80)?.trim() || undefined,
        risk: optionalBoundedString(risk, "risk", 80)?.trim() || undefined,
      },
    );
  });
  handle("repo-graph:get-semantic-profile", async (_event, file: string) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getSemanticProfile(
      workspace,
      assertSafeRelativePath(requireBoundedString(file, "file", 2_000), "file"),
    );
  });
  handle("repo-graph:get-architecture-summary", async () => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.getArchitectureSummary(workspace);
  });
  handle("repo-graph:detect-changes", async (_event, files?: string[]) => {
    const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
    return (await loadRepoGraphService()).repoGraphService.detectChanges(
      workspace,
      Array.isArray(files)
        ? requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files"))
        : undefined,
    );
  });

  handle("mate-x:orchestrator:execute", async (_event, action: unknown) => {
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

  handle("mate-x:orchestrator:routing", async () =>
    getStack().orchestrator.getRoutingRecommendations(),
  );

  handle("mate-x:storage:list-packs", async (_event, workspaceId: string) =>
    getStack().evidencePackStorage.list(requireBoundedString(workspaceId, "workspaceId", 500)),
  );

  handle("mate-x:storage:sync-status", async () => ({
    configured: true,
    routing: getStack().orchestrator.getRoutingRecommendations(),
  }));

  handle("mate-x:storage:force-sync", async () => {
    await requireSensitiveIpcApproval({ action: "mate-x:storage:force-sync" });
    return getStack().failureMemorySync.sync();
  });

  handle("git:status", async () => {
    const workspace = await resolveActiveWorkspace();
    const status = await (await resolveGitService()).getStatus();
    void (await loadRepoGraphService()).repoGraphService.noteGitStatusChanged(workspace);
    return status;
  });
  handle("git:log", async (_event, limit?: number) =>
    (await resolveGitService()).getLog(validateLimit(limit)),
  );
  handle("git:stage-files", async (_event, files: string[]) => {
    const safeFiles = requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files"));
    await requireSensitiveIpcApproval({
      action: "git:stage-files",
      metadata: { fileCount: safeFiles.length },
    });
    return (await resolveGitService()).stageFiles(safeFiles);
  });
  handle(
    "git:commit",
    async (
      _event,
      messageOrPayload:
        | string
        | { message: string; proofHandle?: string | null },
    ) => {
      const payload =
        typeof messageOrPayload === "string"
          ? { message: messageOrPayload, proofHandle: null as string | null }
          : messageOrPayload;
      const normalizedMessage = requireBoundedString(
        payload.message,
        "message",
        20_000,
      );
      await requireSensitiveIpcApproval({ action: "git:commit" });
      // R3: GitGate always active in release; no emergency bypass
      const { assertMainProcessGitWrite } = await import(
        "./engineering/git-gate-ipc"
      );
      await assertMainProcessGitWrite({
        op: "commit",
        proofHandle: payload.proofHandle,
        resolveWorkspace: resolveActiveWorkspace,
        resolveGitService,
      });
      return (await resolveGitService()).commit(normalizedMessage);
    },
  );
  handle(
    "git:push",
    async (_event, payload?: { proofHandle?: string | null }) => {
      await requireSensitiveIpcApproval({ action: "git:push" });
      const { assertMainProcessGitWrite } = await import(
        "./engineering/git-gate-ipc"
      );
      await assertMainProcessGitWrite({
        op: "push",
        proofHandle: payload?.proofHandle ?? null,
        resolveWorkspace: resolveActiveWorkspace,
        resolveGitService,
      });
      return (await resolveGitService()).push();
    },
  );

  // ── Engineering control plane (NES-1.3) ─────────────────────────────────
  handle("engineering:dispatch", async (_event, command: unknown) => {
    const { getEngineeringCommandBus } = await import(
      "./engineering/command-bus"
    );
    const { createPhaseHandler } = await import("./engineering/phase-handler");
    const { getEngineeringRepository } = await import(
      "./engineering/repository"
    );
    const repo = getEngineeringRepository();
    const bus = getEngineeringCommandBus();
    bus.setPhaseHandler(createPhaseHandler(repo));
    return bus.dispatch(command as never);
  });
  handle("engineering:list-tasks", async (_event, workspaceId: string) => {
    const { getEngineeringCommandBus } = await import(
      "./engineering/command-bus"
    );
    return getEngineeringCommandBus().listTasks(
      requireBoundedString(workspaceId, "workspaceId", 200),
    );
  });
  handle("engineering:get-task", async (_event, engineeringTaskId: string) => {
    const { getEngineeringCommandBus } = await import(
      "./engineering/command-bus"
    );
    return getEngineeringCommandBus().getTask(
      requireBoundedString(engineeringTaskId, "engineeringTaskId", 200),
    );
  });
  handle(
    "engineering:evaluate-git-gate",
    async (
      _event,
      input: {
        proofHandle?: string | null;
        workspaceId: string;
        headSha: string;
        diffHash: string;
        policyHash: string;
      },
    ) => {
      const { evaluateGitGate, toGitGateMirror } = await import(
        "./engineering/git-gate"
      );
      const { getEngineeringRepository } = await import(
        "./engineering/repository"
      );
      const evaluation = evaluateGitGate({
        repo: getEngineeringRepository(),
        proofHandle: input.proofHandle,
        current: {
          workspaceId: requireBoundedString(input.workspaceId, "workspaceId", 200),
          headSha: requireBoundedString(input.headSha, "headSha", 200),
          diffHash: requireBoundedString(input.diffHash, "diffHash", 200),
          policyHash: requireBoundedString(input.policyHash, "policyHash", 200),
        },
      });
      return toGitGateMirror(evaluation);
    },
  );
  handle("git:pull", async () => {
    await requireSensitiveIpcApproval({ action: "git:pull" });
    return (await resolveGitService()).pull();
  });
  handle("git:diff", async () => (await resolveGitService()).getDiff());
  handle("git:unstage", async (_event, files: string[]) => {
    const safeFiles = requireStringArray(files, "files").map((file) => assertSafeRelativePath(file, "files"));
    await requireSensitiveIpcApproval({
      action: "git:unstage",
      metadata: { fileCount: safeFiles.length },
    });
    return (await resolveGitService()).unstageFiles(safeFiles);
  });

  // ── Policy Stops ────────────────────────────────────────────────────────
  handle("policy:list-stops", async (_event, runId?: string) =>
    policyService.listStops(optionalBoundedString(runId, "runId", 200)),
  );
  handle("policy:get-run-state", async (_event, runId: string) => {
    if (typeof runId !== "string" || !runId.trim()) {
      throw new Error("Policy run id is required.");
    }

    return policyService.getRunState(runId);
  });
  handle(
    "policy:resolve-stop",
    async (_event, request: ResolvePolicyStopRequest) =>
      policyService.resolveStop(validateResolvePolicyStopRequest(request)),
  );

  // ── Settings ─────────────────────────────────────────────────────────────
  handle("settings:get-api-key-status", async () => tursoService.getApiKeyStatus());
  handle("settings:set-api-key", async (_event, apiKey: string) => {
    const normalizedApiKey = normalizeRainyApiKey(requireBoundedString(apiKey, "apiKey", 2_000));
    if (requiresSensitiveIpcApproval("settings:set-api-key")) {
      await requireSensitiveIpcApproval({ action: "settings:set-api-key" });
    }
    return tursoService.setApiKey(normalizedApiKey);
  });
  handle(
    "settings:list-models",
    async (_event, forceRefresh?: boolean) =>
      (await loadRainyService()).listRainyModels({ apiKey: await tursoService.getApiKey(), forceRefresh: forceRefresh === true }),
  );
  handle(
    "settings:list-model-launches",
    async (_event, forceRefresh?: boolean) =>
      (await loadRainyService()).listRainyModelLaunches({
        apiKey: await tursoService.getApiKey(),
        forceRefresh: forceRefresh === true,
      }),
  );
  handle("settings:get-model", async () => tursoService.getModel());
  handle("settings:set-model", async (_event, model: string) => {
    const apiKey = await tursoService.getApiKey();
    const normalizedModel = requireBoundedString(model, "model", 500);
    await (await loadRainyService()).validateRainyModelSelection({ apiKey, model: normalizedModel });
    await tursoService.setModel(normalizedModel);
  });
  handle("settings:list-embedding-models", async () => [
    ...(await loadRainyService()).RAINY_REPO_EMBEDDING_MODELS,
  ]);
  handle("settings:get-embedding-model", async () =>
    tursoService.getEmbeddingModel(),
  );
  handle("settings:set-embedding-model", async (_event, model: string) => {
    const normalizedModel = requireBoundedString(model, "model", 500);
    (await loadRainyService()).validateRainyEmbeddingModelSelection(normalizedModel);
    await tursoService.setEmbeddingModel(normalizedModel);
    try {
      const workspace = await (await loadRepoGraphService()).resolveActiveWorkspaceForRepoGraph();
      await (await loadRepoGraphService()).repoGraphService.refreshWorkspace(
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
  handle("settings:get-app-settings", async () =>
    tursoService.getAppSettings(),
  );
  handle(
    "settings:update-app-settings",
    async (_event, settings: AppSettings) => {
      const updatedSettings = await tursoService.updateAppSettings(validateAppSettings(settings));
      // Keep the protocol authorization cache in sync so the renderer can
      // immediately load the new background image without restarting the app.
      setAuthorizedBackgroundImagePath(updatedSettings.customBackgroundImage);
      const [win] = BrowserWindow.getAllWindows();
      if (win) {
        applyWindowAppearance(
          win,
          updatedSettings,
          process.platform,
          nativeTheme.shouldUseDarkColors,
        );
      }
      return updatedSettings;
    }
  );

  // ── Mobile Companion ───────────────────────────────────────────────────
  handle("mobile:start-pairing", async () => {
    await requireSensitiveIpcApproval({ action: "mobile:start-pairing" });
    return (await loadMobileBridge()).mobileBridgeService.startPairing();
  });
  handle("mobile:stop-pairing", async () => {
    await requireSensitiveIpcApproval({ action: "mobile:stop-pairing" });
    return (await loadMobileBridge()).mobileBridgeService.stopPairing();
  });
  handle("mobile:get-status", async () => (await loadMobileBridge()).mobileBridgeService.getStatus());
  handle("mobile:get-pending-pairing", async () => (await loadMobileBridge()).mobileBridgeService.getPendingPairing());
  handle("mobile:approve-pending-pairing", async (_event, approved: boolean) => {
    await requireSensitiveIpcApproval({
      action: "mobile:approve-pending-pairing",
      metadata: { approved: approved === true },
    });
    return (await loadMobileBridge()).mobileBridgeService.approvePendingPairing(approved === true);
  });
  handle("mobile:list-devices", async () => (await loadMobileBridge()).mobileBridgeService.listDevices());
  handle("mobile:revoke-device", async (_event, deviceId: string) => {
    const normalizedDeviceId = requireBoundedString(deviceId, "deviceId", 200);
    await requireSensitiveIpcApproval({
      action: "mobile:revoke-device",
      target: normalizedDeviceId,
    });
    return (await loadMobileBridge()).mobileBridgeService.revokeDevice(normalizedDeviceId);
  });

  // ── GitHub Integration ──────────────────────────────────────────────────
  handle("github:detect-remote", async () => {
    const workspacePath = await resolveActiveWorkspacePath();
    return (await loadGitHubIntegration()).detectGitHubRemote(workspacePath);
  });
  handle("github:get-current-branch", async () => {
    const workspacePath = await resolveActiveWorkspacePath();
    return (await loadGitHubIntegration()).getCurrentBranch(workspacePath);
  });
  handle("github:get-local-diff", async () => {
    const workspacePath = await resolveActiveWorkspacePath();
    return (await loadGitHubIntegration()).getLocalDiff(workspacePath);
  });
  handle("github:get-changed-files", async () => {
    const workspacePath = await resolveActiveWorkspacePath();
    return (await loadGitHubIntegration()).getChangedFiles(workspacePath);
  });
  handle("github:collect-local-evidence", async () => {
    const workspacePath = await resolveActiveWorkspacePath();
    await requireSensitiveIpcApproval({ action: "github:collect-local-evidence" });
    return (await loadGitHubIntegration()).collectGitHubLocalEvidence(workspacePath);
  });
  handle("github:get-status", async () => {
    const workspacePath = await resolveActiveWorkspacePath();
    const settings = await tursoService.getAppSettings();
    return (await loadGitHubIntegration()).getIntegrationStatus(
      workspacePath,
      settings.githubIntegrationEnabled,
    );
  });
  handle("github:get-pr-for-branch", async () => (await loadGitHubIntegration()).getPullRequestForBranch());
  handle("github:get-pr-files", async () => (await loadGitHubIntegration()).getPullRequestFiles());
  handle("github:get-pr-checks", async () => (await loadGitHubIntegration()).getPullRequestChecks());

  // ── UI ───────────────────────────────────────────────────────────────────
  handle(
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
  handle(
    "ui:copy-to-clipboard",
    async (_event, text: string) => {
      clipboard.writeText(String(text ?? ""));
    },
  );
}
