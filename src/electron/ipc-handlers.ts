import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";

import type { AssistantRunOptions, Conversation, EvidencePack } from "../contracts/chat";
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
import { generateComplianceExport } from "../features/compliance/complianceExport";
import { canonicalJson, sha256Hex } from "../features/compliance/attestation";

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
  "liquidGlassSidebar",
  "liquidGlassDensity",
  "liquidGlassShineColors",
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
  "supermemoryApiKey",
  "onboardingCompleted",
]);

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
  const workspaces = await tursoService.getWorkspaces();
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0];

  if (!activeWorkspace) {
    throw new Error("No active workspace available.");
  }

  return activeWorkspace.path;
}

async function resolveActiveWorkspace() {
  const workspaces = await tursoService.getWorkspaces();
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0];

  if (!activeWorkspace) {
    throw new Error("No active workspace available.");
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
      const evidencePack = await loadVerifiedEvidencePackForExport(workspace.path, taskId);
      return generateComplianceExport({
        evidencePack,
        taskId,
        workspacePath: workspace.path,
        userId: workspace.id,
        policyApplied: "workspace-trust-contract",
      });
    },
  );
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
        undefined,
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
