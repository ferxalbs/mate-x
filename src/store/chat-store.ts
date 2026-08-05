import { create } from "zustand";

import type {
  AssistantRunOptions,
  ChatMessage,
  Conversation,
  ReproducibleRun,
  RunStatus,
  ToolEvent,
} from "../contracts/chat";
import {
  normalizeExecutionOutcome,
  type ExecutionEvidence,
  type ExecutionOutcome,
  type ExecutionTerminalState,
} from "../contracts/execution";
import { normalizeToolEvent } from "../contracts/chat";
import type {
  SearchMatch,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceSummary,
  WorkspaceTrustContract,
} from "../contracts/workspace";
import { createId } from "../lib/id";
import {
  bootstrapWorkspaceState,
  cancelAssistant,
  getAssistantRunEvents,
  onAssistantProgress,
  openWorkspacePicker,
  removeWorkspace,
  runAssistant,
  saveWorkspaceSession,
  setActiveWorkspace,
} from "../services/repo-client";
import { buildThreadTitle } from "../features/desktop-shell/model";
import {
  completeFactoryRun,
  createFactoryRun,
  normalizeFactoryRunOptions,
} from "../lib/factory-run";
import { type AppSettings, DEFAULT_APP_SETTINGS } from "../contracts/settings";
import { behaviorRunOptions } from "../contracts/behavior-mode";
import { getAppSettings } from "../services/settings-client";
import { compactConversationSnapshotForPersistence } from "../lib/conversation-persistence";
import {
  isConversationalPrompt,
  isPureSocialPrompt,
  isRepositoryGroundedQuestion,
  isRepositoryWorkRequest,
} from "../lib/conversational-intent";

interface ChatState {
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  trustContract: WorkspaceTrustContract | null;
  activeWorkspaceId: string | null;
  repoFiles: string[];
  repoSignals: SearchMatch[];
  threadsByWorkspace: Record<string, Conversation[]>;
  activeThreadIds: Record<string, string>;
  activeRun: {
    runId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    reproducibleRunId: string;
  } | null;
  runStatus: RunStatus;
  isBootstrapped: boolean;
  lastError: string | null;
  bootstrap: () => Promise<void>;
  importWorkspace: () => Promise<void>;
  activateWorkspace: (workspaceId: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  createThread: () => void;
  selectThread: (threadId: string) => void;
  archiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string, title: string) => Promise<void>;
  submitPrompt: (prompt: string, options: AssistantRunOptions) => Promise<void>;
  cancelActiveRun: () => Promise<void>;
  undoLastTurn: () => Promise<string | null>;
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
}

let assistantProgressUnsubscribe: (() => void) | null = null;
const ASSISTANT_PROGRESS_FLUSH_MS = 120;
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["completed", "failed"]);
const API_STATUS_ERROR_PATTERN = /\b(?:status(?: code)?\s*)?([45]\d{2})\b/i;
const ASSISTANT_FIRST_PROGRESS_TIMEOUT_MS = 12_000;

type AssistantProgressPayload = Parameters<
  Parameters<typeof onAssistantProgress>[0]
>[0];
type ChatStateSetter = (
  partial:
    | ChatState
    | Partial<ChatState>
    | ((state: ChatState) => ChatState | Partial<ChatState>),
) => void;

let pendingAssistantProgress: AssistantProgressPayload | null = null;
let assistantProgressFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastAssistantProgressSignature: string | null = null;
const assistantRunEventCursors = new Map<string, number>();
const assistantRunsWithVisibleProgress = new Set<string>();

function createEmptyConversation(
  partial?: Partial<Conversation>,
): Conversation {
  return {
    id: partial?.id ?? createId("thread"),
    title: partial?.title ?? "New thread",
    lastUpdatedAt: partial?.lastUpdatedAt ?? new Date().toISOString(),
    messages: partial?.messages ?? [],
  };
}

function applyWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  threadsByWorkspace: Record<string, Conversation[]>,
  activeThreadIds: Record<string, string>,
) {
  const nextWorkspaceId = snapshot.activeWorkspaceId;
  if (!nextWorkspaceId) {
    return {
      workspaces: snapshot.workspaces,
      workspace: null,
      trustContract: null,
      activeWorkspaceId: null,
      repoFiles: [],
      repoSignals: [],
      threadsByWorkspace,
      activeThreadIds,
    };
  }
  const snapshotThreads =
    snapshot.threads.length > 0
      ? snapshot.threads
      : [
        createEmptyConversation({
          id: createId(`thread-${nextWorkspaceId}`),
          title: "New thread",
        }),
      ];
  const nextActiveThreadId = snapshot.activeThreadId || snapshotThreads[0].id;

  return {
    workspaces: snapshot.workspaces,
    workspace: snapshot.workspace,
    trustContract: snapshot.trustContract,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    repoFiles: snapshot.files,
    repoSignals: snapshot.signals,
    threadsByWorkspace: {
      ...threadsByWorkspace,
      [nextWorkspaceId]: snapshotThreads,
    },
    activeThreadIds: {
      ...activeThreadIds,
      [nextWorkspaceId]: nextActiveThreadId,
    },
  };
}

function formatAssistantError(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : "The assistant failed before responding.";
  const statusCode = rawMessage.match(API_STATUS_ERROR_PATTERN)?.[1];

  if (
    error instanceof Error &&
    (error.name === "AbortError" || /\babort(?:ed)?\b|\bcancel(?:led)?\b/i.test(rawMessage))
  ) {
    return "Run paused. API connection stopped.";
  }

  if (statusCode) {
    return `API ${statusCode}: ${summarizeApiStatus(statusCode)}`;
  }

  return rawMessage;
}

function summarizeApiStatus(statusCode: string) {
  switch (statusCode) {
    case "401":
    case "403":
      return "Access denied. Check API key, model access, or billing permissions.";
    case "429":
      return "Rate limit hit. Wait briefly, then retry.";
    case "500":
    case "502":
    case "503":
    case "504":
      return "Provider unavailable. Retry later or switch model/tier.";
    default:
      return "Request failed.";
  }
}

function createNoProgressTimeoutError() {
  return new Error(
    "API timeout: no response after 12 seconds. Connection stopped to avoid repeated calls.",
  );
}

async function persistWorkspaceState(
  workspaceId: string,
  threadsByWorkspace: Record<string, Conversation[]>,
  activeThreadIds: Record<string, string>,
) {
  const threads = threadsByWorkspace[workspaceId] ?? [];
  const activeThreadId = activeThreadIds[workspaceId] ?? threads[0]?.id;

  if (!activeThreadId) {
    return;
  }

  const persistedThreads = compactConversationSnapshotForPersistence(
    threads,
    activeThreadId,
  );

  try {
    await saveWorkspaceSession(workspaceId, persistedThreads, activeThreadId);
  } catch (error) {
    // Persistence is background work. Keep a database/IPC failure from
    // becoming an unhandled rejection that destabilizes the renderer.
    console.error("Failed to persist workspace session:", error);
  }
}

function replaceMessageById(
  messages: ChatMessage[],
  messageId: string,
  nextMessage: ChatMessage,
) {
  const messageIndex = messages.findIndex(
    (message) => message.id === messageId,
  );

  if (messageIndex === -1) {
    return [...messages, nextMessage];
  }

  return messages.map((message, index) =>
    index === messageIndex ? nextMessage : message,
  );
}

function replaceRunById(
  runs: ReproducibleRun[] | undefined,
  nextRun: ReproducibleRun,
) {
  const existingRuns = runs ?? [];
  const runIndex = existingRuns.findIndex((run) => run.id === nextRun.id);

  if (runIndex === -1) {
    return [nextRun, ...existingRuns];
  }

  return existingRuns.map((run, index) =>
    index === runIndex ? nextRun : run,
  );
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(ra-[a-z0-9_-]{16,})/gi, "[REDACTED_RAINY_KEY]")
    .replace(/(sk-[a-z0-9_-]{16,})/gi, "[REDACTED_API_KEY]")
    .replace(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, "[REDACTED_EMAIL]")
    .replace(/(token|api[_-]?key|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, "$1=[REDACTED]");
}

function getAssistantProgressSignature(progress: AssistantProgressPayload) {
  return [
    progress.runId,
    progress.status,
    progress.content,
    progress.outcome?.status ?? "",
    progress.events?.length ?? 0,
    progress.events?.at(-1)?.id ?? "",
    progress.events?.at(-1)?.status ?? "",
    progress.delta?.fromSeq ?? "",
    progress.delta?.toSeq ?? "",
    progress.artifacts?.length ?? 0,
  ].join("\u001f");
}

export function projectRunEventToToolEvent(
  event: NonNullable<AssistantProgressPayload["delta"]>["events"][number],
): ToolEvent {
  const payload = event.payload as {
    title?: string;
    summary?: string;
    status?: ToolEvent["status"];
    toolClass?: string;
    code?: string;
    durationMs?: number;
    relativePath?: string;
    verifier?: string;
    beforeHash?: string;
    afterHash?: string;
  };
  const isPublicAgentProgress =
    event.kind === "provider.completed" && event.visibility === "public";
  const type: ToolEvent["type"] =
    isPublicAgentProgress
      ? "result"
      : event.kind.startsWith("validation.")
        ? "validation"
        : event.kind.startsWith("mutation.")
          ? "edit"
          : event.kind.startsWith("approval.")
            ? "approval"
            : event.kind.startsWith("provider.")
              ? "reasoning"
              : event.kind.startsWith("run.")
                ? "result"
                : "wait";
  const status: ToolEvent["status"] =
    payload.status ??
    (event.kind.endsWith(".completed") || event.kind === "mutation.committed"
      ? "completed"
      : event.kind.endsWith(".blocked")
        ? "blocked"
        : event.kind.endsWith(".failed") || event.kind === "recovery.conflict"
          ? "failed"
          : event.kind.endsWith(".cancelled")
            ? "cancelled"
            : "active");
  const diagnosticTitle = [
    payload.toolClass,
    payload.relativePath,
  ].filter(Boolean).join(" · ");
  const diagnosticDetail = [
    payload.code ? `Code: ${payload.code}` : "",
    typeof payload.durationMs === "number" ? `Duration: ${payload.durationMs} ms` : "",
    payload.verifier ? `Verifier: ${payload.verifier}` : "",
    payload.beforeHash ? `Before: ${payload.beforeHash}` : "",
    payload.afterHash ? `After: ${payload.afterHash}` : "",
  ].filter(Boolean).join("\n");
  const title =
    payload.title ??
    (diagnosticTitle || event.kind.replaceAll(".", " "));
  return {
    id: event.eventId,
    segmentId: event.eventId,
    version: 2,
    runId: event.runId,
    sequence: event.seq,
    timestamp: event.occurredAt,
    segmentKind: isPublicAgentProgress ? "intermediate_response" : "tool",
    type,
    title,
    summary: payload.summary,
    label: title,
    detail: payload.summary ?? diagnosticDetail,
    status,
    durationMs: payload.durationMs,
    visibility: event.visibility === "public" ? "public" : "technical",
  };
}

export function mergeTimelineSegments(
  previous: ChatMessage["events"],
  incoming: AssistantProgressPayload["events"],
  _progress: Pick<AssistantProgressPayload, "runId">,
  startedAt?: string,
) {
  const merged = new Map((previous ?? []).map((event) => [event.id, event]));
  const receivedAt = new Date().toISOString();

  incoming.forEach((event, index) => {
    const segmentId = event.segmentId ?? event.id;
    const current = merged.get(segmentId);
    const normalized = normalizeToolEvent({ ...current, ...event, id: segmentId, segmentId }, {
      runId: event.runId,
      sequence: current?.sequence ?? event.sequence ?? (previous?.length ?? 0) + index,
      timestamp:
        event.timestamp ??
        current?.timestamp ??
        (merged.size === 0 && index === 0 ? startedAt : undefined) ??
        receivedAt,
    });
    merged.set(segmentId, normalized);
  });
  return [...merged.values()].sort(
    (left, right) => (left.sequence ?? 0) - (right.sequence ?? 0),
  );
}

function applyAssistantProgress(
  progress: AssistantProgressPayload,
  set: ChatStateSetter,
) {
  const nextSignature = getAssistantProgressSignature(progress);
  if (nextSignature === lastAssistantProgressSignature) {
    return;
  }
  lastAssistantProgressSignature = nextSignature;

  set((state) => {
    const activeRun = state.activeRun;
    if (!activeRun || activeRun.runId !== progress.runId) {
      return state;
    }

    const nextThreadsByWorkspace = {
      ...state.threadsByWorkspace,
      [activeRun.workspaceId]: (
        state.threadsByWorkspace[activeRun.workspaceId] ?? []
      ).map((thread) =>
        thread.id !== activeRun.threadId
          ? thread
          : {
            ...thread,
            lastUpdatedAt: TERMINAL_RUN_STATUSES.has(progress.status)
              ? new Date().toISOString()
              : thread.lastUpdatedAt,
            messages: thread.messages.map((message) =>
              message.id !== activeRun.messageId
                ? message
                : {
                  ...message,
                  content: progress.content,
                  events: mergeTimelineSegments(
                    message.events,
                    progress.delta
                      ? progress.delta.events.map(projectRunEventToToolEvent)
                      : progress.events,
                    progress,
                    message.createdAt,
                  ),
                  artifacts: progress.artifacts,
                  outcome: progress.outcome,
                },
            ),
            runs: (thread.runs ?? []).map((run) =>
              run.id !== activeRun.reproducibleRunId
                ? run
                : {
                  ...run,
                  status: progress.status,
                  events: mergeTimelineSegments(
                    run.events,
                    progress.delta
                      ? progress.delta.events.map(projectRunEventToToolEvent)
                      : progress.events,
                    progress,
                    run.startedAt,
                  ),
                  artifacts: progress.artifacts,
                },
            ),
          },
      ),
    };

    return {
      runStatus: progress.status,
      threadsByWorkspace: nextThreadsByWorkspace,
    };
  });
}

function queueAssistantProgress(
  progress: AssistantProgressPayload,
  set: ChatStateSetter,
) {
  if (!assistantRunsWithVisibleProgress.has(progress.runId)) {
    assistantRunsWithVisibleProgress.add(progress.runId);
    applyAssistantProgress(progress, set);
    return;
  }

  if (TERMINAL_RUN_STATUSES.has(progress.status)) {
    if (assistantProgressFlushTimer) {
      clearTimeout(assistantProgressFlushTimer);
      assistantProgressFlushTimer = null;
    }
    pendingAssistantProgress = null;
    applyAssistantProgress(progress, set);
    return;
  }

  pendingAssistantProgress =
    pendingAssistantProgress?.runId === progress.runId &&
      pendingAssistantProgress.delta &&
      progress.delta
      ? {
        ...progress,
        delta: {
          runId: progress.runId,
          fromSeq: pendingAssistantProgress.delta.fromSeq,
          toSeq: progress.delta.toSeq,
          events: [
            ...pendingAssistantProgress.delta.events,
            ...progress.delta.events,
          ],
        },
      }
      : progress;
  if (assistantProgressFlushTimer) {
    return;
  }

  assistantProgressFlushTimer = setTimeout(() => {
    assistantProgressFlushTimer = null;
    const nextProgress = pendingAssistantProgress;
    pendingAssistantProgress = null;
    if (nextProgress) {
      applyAssistantProgress(nextProgress, set);
    }
  }, ASSISTANT_PROGRESS_FLUSH_MS);
}

async function reconcileAssistantProgress(
  progress: AssistantProgressPayload,
  set: ChatStateSetter,
) {
  const delta = progress.delta;
  if (!delta) {
    queueAssistantProgress(progress, set);
    return;
  }

  const cursor = assistantRunEventCursors.get(progress.runId) ?? 0;
  if (delta.toSeq <= cursor) {
    return;
  }

  if (delta.fromSeq > cursor + 1) {
    try {
      const replay = await getAssistantRunEvents(progress.runId, cursor, 10_000);
      if (replay.events.length === 0 || replay.fromSeq !== cursor + 1) {
        throw new Error("RUN_EVENT_REPLAY_GAP");
      }
      assistantRunEventCursors.set(progress.runId, replay.toSeq);
      queueAssistantProgress({ ...progress, delta: replay }, set);
    } catch {
      // Preserve terminal/content state without projecting an incomplete trace.
      queueAssistantProgress({ ...progress, delta: undefined, events: [] }, set);
    }
    return;
  }

  const unseenEvents = delta.events.filter((event) => event.seq > cursor);
  const contiguousDelta = {
    ...delta,
    fromSeq: unseenEvents[0]?.seq ?? cursor + 1,
    events: unseenEvents,
  };
  assistantRunEventCursors.set(progress.runId, delta.toSeq);
  queueAssistantProgress({ ...progress, delta: contiguousDelta }, set);
}

export function deriveExecutionOutcome(message: ChatMessage): ExecutionOutcome {
  const hasMutation = (message.evidencePack?.filesModified?.length ?? 0) > 0;

  const existingOutcome = message.executionOutcome ?? message.evidencePack?.executionOutcome;
  if (existingOutcome) return normalizeExecutionOutcome(existingOutcome);

  const agentStatus = message.outcome?.status;
  const terminalState: ExecutionTerminalState =
    hasMutation && (agentStatus === "blocked" || agentStatus === "failed")
      ? "partial"
      : agentStatus === "needs_approval"
        ? "blocked"
        : agentStatus === "blocked"
          ? "blocked"
          : agentStatus === "failed"
            ? "failed"
            : message.evidencePack?.status === "partial"
              ? "partial"
              : message.evidencePack?.status === "blocked"
                ? "blocked"
                : message.evidencePack?.status === "failed"
                  ? "failed"
                  : message.content.trim()
                    ? "completed"
                    : "failed";

  const evidence: ExecutionEvidence = {
    completedSteps: [],
    failedSteps: [],
    blockedSteps: [],
    changedFiles: (message.evidencePack?.filesModified ?? []).map((file) => ({
      path: file.path,
      operation: file.changeType ?? "unknown",
      backupCreated: false,
      impactAnalysis: "unknown" as const,
    })),
    validation: {
      status: message.evidencePack?.checks?.some((check) => check.status === "passed")
        ? "passed"
        : "not_run",
    },
    synthesis: {
      status: message.content.trim() ? "valid" : "missing",
    },
  };

  return {
    terminalState,
    completionKind:
      terminalState === "partial"
        ? hasMutation ? "changed_unverified" : "blocked"
        : terminalState === "blocked"
          ? agentStatus === "needs_approval" ? "awaiting_approval" : "blocked"
          : terminalState === "failed"
            ? "failed"
            : hasMutation
              ? "changed_verified"
              : "inspection_completed",
    primaryCause:
      agentStatus === "needs_approval"
        ? {
          code: "APPROVAL_REQUIRED",
          summary: message.outcome?.summary ?? "Approval is required before continuing.",
          source: "policy",
        }
        : null,
    nextActions:
      agentStatus === "needs_approval"
        ? [{ id: "review-approval", type: "review_workspace_policy", label: "Review approval" }]
        : [],
    evidence,
    summary:
      message.outcome?.summary ??
      message.evidencePack?.verdict.summary ??
      (message.content.trim() || "The run did not produce a final result."),
  };
}

function redactRun(run: ReproducibleRun): ReproducibleRun {
  return {
    ...run,
    userIntent: redactSensitiveText(run.userIntent),
    decisions: run.decisions.map((decision) => ({
      ...decision,
      summary: redactSensitiveText(decision.summary),
      reason: redactSensitiveText(decision.reason),
    })),
    events: run.events.map((event) => ({
      ...event,
      label: redactSensitiveText(event.label),
      detail: redactSensitiveText(event.detail),
    })),
    artifacts: run.artifacts.map((artifact) => ({
      ...artifact,
      label: redactSensitiveText(artifact.label),
      value: redactSensitiveText(artifact.value),
    })),
    result: run.result
      ? {
        ...run.result,
        summary: redactSensitiveText(run.result.summary),
      }
      : undefined,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sealRunIntegrity(run: ReproducibleRun): Promise<ReproducibleRun> {
  const redactedRun = redactRun(run);
  const hashInputs = [
    {
      type: "initial_state",
      payload: redactedRun.initialState,
    },
    ...redactedRun.decisions.map((decision) => ({
      type: "decision",
      payload: decision,
    })),
    ...redactedRun.events.map((event) => ({
      type: "event",
      payload: event,
    })),
    {
      type: "result",
      payload: redactedRun.result ?? null,
    },
  ];
  const eventHashes: string[] = [];
  let previousHash = "GENESIS";

  for (const input of hashInputs) {
    previousHash = await sha256(
      stableJson({
        previousHash,
        ...input,
      }),
    );
    eventHashes.push(previousHash);
  }

  return {
    ...redactedRun,
    integrity: {
      algorithm: "sha256",
      canonicalVersion: 1,
      eventHashes,
      rootHash: previousHash,
      generatedAt: new Date().toISOString(),
    },
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  workspace: null,
  trustContract: null,
  activeWorkspaceId: null,
  repoFiles: [],
  repoSignals: [],
  threadsByWorkspace: {},
  activeThreadIds: {},
  activeRun: null,
  runStatus: "idle",
  isBootstrapped: false,
  lastError: null,
  settings: DEFAULT_APP_SETTINGS,
  setSettings: (settings) => set({ settings }),
  async bootstrap() {
    if (get().isBootstrapped) {
      return;
    }

    try {
      const appSettings = await getAppSettings();
      set({ settings: appSettings, lastError: null });
    } catch (error) {
      set({ isBootstrapped: true, lastError: errorToMessage(error, "Unable to load app settings.") });
      return;
    }

    if (!assistantProgressUnsubscribe) {
      assistantProgressUnsubscribe = onAssistantProgress((progress) => {
        void reconcileAssistantProgress(progress, set);
      });
    }

    let snapshot: WorkspaceSnapshot;
    try {
      snapshot = await bootstrapWorkspaceState();
    } catch (error) {
      set({ isBootstrapped: true, lastError: errorToMessage(error, "Unable to restore workspace state.") });
      return;
    }
    const { ui } = (window as any).mate;

    if (ui) {
      ui.onRenameThread((threadId: string) => {
        // Dispatch a custom event to the sidebar to trigger rename UI
        window.dispatchEvent(
          new CustomEvent("mate:trigger-rename-thread", {
            detail: { threadId },
          }),
        );
      });
      ui.onArchiveThread((threadId: string) => {
        window.dispatchEvent(
          new CustomEvent("mate:trigger-archive-thread", {
            detail: { threadId },
          }),
        );
      });
      ui.onDeleteThread((threadId: string) => {
        window.dispatchEvent(
          new CustomEvent("mate:trigger-delete-thread", {
            detail: { threadId },
          }),
        );
      });
    }

    set((state) => ({
      ...applyWorkspaceSnapshot(
        snapshot,
        state.threadsByWorkspace,
        state.activeThreadIds,
      ),
      isBootstrapped: true,
      lastError: null,
    }));
  },
  async importWorkspace() {
    let snapshot: WorkspaceSnapshot | null;
    try {
      snapshot = await openWorkspacePicker();
    } catch (error) {
      set({ lastError: errorToMessage(error, "Unable to import folder.") });
      return;
    }
    if (!snapshot) {
      return;
    }

    set((state) => ({
      ...applyWorkspaceSnapshot(
        snapshot,
        state.threadsByWorkspace,
        state.activeThreadIds,
      ),
      activeRun: null,
      runStatus: "idle",
      lastError: null,
    }));
  },
  async activateWorkspace(workspaceId) {
    let snapshot: WorkspaceSnapshot;
    try {
      snapshot = await setActiveWorkspace(workspaceId);
    } catch (error) {
      set({ lastError: errorToMessage(error, "Unable to open workspace.") });
      return;
    }
    set((state) => ({
      ...applyWorkspaceSnapshot(
        snapshot,
        state.threadsByWorkspace,
        state.activeThreadIds,
      ),
      activeRun: null,
      runStatus: "idle",
      lastError: null,
    }));
  },
  async removeWorkspace(workspaceId) {
    let snapshot: WorkspaceSnapshot;
    try {
      snapshot = await removeWorkspace(workspaceId);
    } catch (error) {
      set({ lastError: errorToMessage(error, "Unable to remove workspace.") });
      return;
    }

    set((state) => {
      const nextThreadsByWorkspace = { ...state.threadsByWorkspace };
      const nextActiveThreadIds = { ...state.activeThreadIds };
      delete nextThreadsByWorkspace[workspaceId];
      delete nextActiveThreadIds[workspaceId];

      return {
        ...applyWorkspaceSnapshot(
          snapshot,
          nextThreadsByWorkspace,
          nextActiveThreadIds,
        ),
        activeRun: null,
        runStatus: "idle",
        lastError: null,
      };
    });
  },
  createThread() {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    // A running assistant owns the active thread. Creating another active
    // thread mid-run makes subsequent progress ambiguous and invites double
    // clicks to create unused sessions.
    if (state.runStatus === "running") {
      return;
    }

    const workspaceThreads = state.threadsByWorkspace[workspaceId] ?? [];
    const reusableThread = workspaceThreads.find(
      (thread) => !thread.isArchived && thread.messages.length === 0,
    );

    if (reusableThread) {
      const nextThreads = workspaceThreads.filter(
        (thread) =>
          thread.id === reusableThread.id ||
          thread.isArchived ||
          thread.messages.length > 0,
      );
      const nextState = {
        activeThreadIds: {
          ...state.activeThreadIds,
          [workspaceId]: reusableThread.id,
        },
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: nextThreads,
        },
      };

      set(nextState);
      void persistWorkspaceState(
        workspaceId,
        nextState.threadsByWorkspace,
        nextState.activeThreadIds,
      );
      return;
    }

    const nextThread = createEmptyConversation();
    set((currentState) => {
      const nextState = {
        activeThreadIds: {
          ...currentState.activeThreadIds,
          [workspaceId]: nextThread.id,
        },
        threadsByWorkspace: {
          ...currentState.threadsByWorkspace,
          [workspaceId]: [
            nextThread,
            ...(currentState.threadsByWorkspace[workspaceId] ?? []),
          ],
        },
      };

      void persistWorkspaceState(
        workspaceId,
        nextState.threadsByWorkspace,
        nextState.activeThreadIds,
      );

      return nextState;
    });
  },
  selectThread(threadId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    set((state) => {
      const nextState = {
        activeThreadIds: {
          ...state.activeThreadIds,
          [workspaceId]: threadId,
        },
      };

      void persistWorkspaceState(
        workspaceId,
        state.threadsByWorkspace,
        nextState.activeThreadIds,
      );

      return nextState;
    });
  },
  async archiveThread(threadId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;

    set((state) => {
      const nextThreads = (state.threadsByWorkspace[workspaceId] ?? []).map(
        (t) => (t.id === threadId ? { ...t, isArchived: true } : t),
      );
      const nextState = {
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: nextThreads,
        },
      };
      void persistWorkspaceState(
        workspaceId,
        nextState.threadsByWorkspace,
        state.activeThreadIds,
      );
      return nextState;
    });
  },
  async deleteThread(threadId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;

    set((state) => {
      const nextThreads = (state.threadsByWorkspace[workspaceId] ?? []).filter(
        (t) => t.id !== threadId,
      );

      // Ensure there's always at least one thread
      if (nextThreads.length === 0) {
        nextThreads.push(
          createEmptyConversation({ id: createId(`thread-${workspaceId}`) }),
        );
      }

      const currentActiveId = state.activeThreadIds[workspaceId];
      const nextActiveId =
        currentActiveId === threadId ? nextThreads[0].id : currentActiveId;

      const nextState = {
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: nextThreads,
        },
        activeThreadIds: {
          ...state.activeThreadIds,
          [workspaceId]: nextActiveId,
        },
      };
      void persistWorkspaceState(
        workspaceId,
        nextState.threadsByWorkspace,
        nextState.activeThreadIds,
      );
      return nextState;
    });
  },
  async renameThread(threadId, title) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;

    set((state) => {
      const nextThreads = (state.threadsByWorkspace[workspaceId] ?? []).map(
        (t) => (t.id === threadId ? { ...t, title } : t),
      );
      const nextState = {
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: nextThreads,
        },
      };
      void persistWorkspaceState(
        workspaceId,
        nextState.threadsByWorkspace,
        state.activeThreadIds,
      );
      return nextState;
    });
  },
  async submitPrompt(prompt: string, options: AssistantRunOptions) {
    const normalizedOptions = normalizeFactoryRunOptions(options);
    const trimmedPrompt = prompt.trim();
    const attachmentNames = normalizedOptions.attachments?.map((attachment) => attachment.name) ?? [];
    const displayedPrompt =
      trimmedPrompt ||
      (attachmentNames.length > 0
        ? `Attached ${attachmentNames.join(", ")}`
        : "");
    const hasActiveWorkspace = Boolean(get().workspace);
    const repositoryGrounded = isRepositoryGroundedQuestion(displayedPrompt, {
      hasActiveWorkspace,
    });
    const repositoryWork = isRepositoryWorkRequest(displayedPrompt);
    const pureSocial = isPureSocialPrompt(displayedPrompt);
    const conversational = !repositoryGrounded && !repositoryWork && (
      pureSocial ||
      normalizedOptions.pathKind === "chat_help" ||
      isConversationalPrompt(displayedPrompt, { hasActiveWorkspace })
    );
    const runOptions = repositoryGrounded
      ? {
        ...normalizedOptions,
        pathKind: "verify_only" as const,
        behaviorMode: "review" as const,
        runbookId: "review_classify_summarize" as const,
      }
      : repositoryWork
        ? {
          ...normalizedOptions,
          ...behaviorRunOptions({ mode: normalizedOptions.behaviorMode }),
        }
      : conversational
      ? {
        ...normalizedOptions,
        pathKind: "chat_help" as const,
        runbookId: "review_classify_summarize" as const,
      }
      : normalizedOptions;
    const workspaceId = get().activeWorkspaceId;

    if (!displayedPrompt || get().runStatus === "running" || !workspaceId) {
      return;
    }

    const workspaceThreads = get().threadsByWorkspace[workspaceId] ?? [];
    const activeThreadId = get().activeThreadIds[workspaceId];
    const currentThread = workspaceThreads.find(
      (thread) => thread.id === activeThreadId,
    );
    if (!currentThread) {
      return;
    }

    let engineeringTaskId: string | null =
      typeof runOptions.engineeringTaskId === "string"
        ? runOptions.engineeringTaskId
        : null;
    const historyBeforePrompt = currentThread.messages.map(
      (message) => `${message.role}: ${message.content}`,
    );

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: displayedPrompt,
      createdAt: new Date().toISOString(),
    };
    const runId = createId("run");
    const assistantPlaceholder: ChatMessage = {
      id: createId("assistant"),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      events: [],
      artifacts: [],
      // Factory write authority deleted — never embed factoryRun
    };
    // Keep createFactoryRun call to prove write path remains dead (always undefined)
    void createFactoryRun({
      id: createId("factory"),
      prompt: displayedPrompt,
      options: runOptions,
      createdAt: new Date().toISOString(),
    });

    const reproducibleRun: ReproducibleRun = redactRun({
      id: runId,
      threadId: activeThreadId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantPlaceholder.id,
      title: buildThreadTitle(displayedPrompt),
      userIntent: displayedPrompt,
      status: "running",
      startedAt: userMessage.createdAt,
      initialState: {
        workspaceId,
        workspacePath: get().workspace?.path ?? "",
        workspaceName: get().workspace?.name ?? "",
        branch: get().workspace?.branch ?? "unknown",
        threadId: activeThreadId,
        activeMessageCount: currentThread.messages.length,
        settings: {
          reasoningEnabled: options.reasoningEnabled,
          reasoning: runOptions.reasoning,
          pathKind: runOptions.pathKind,
          behaviorMode: runOptions.behaviorMode,
          runbookId: runOptions.runbookId,
        },
        workspaceWriteAccess: get().trustContract?.writeAccess,
      },
      decisions: [
        {
          id: createId("decision"),
          at: userMessage.createdAt,
          summary: "Execution scope accepted",
          reason:
            "User submitted prompt from active workspace thread; MaTE X captured initial state before running tools.",
        },
      ],
      events: [],
      artifacts: [],
    });

    set((state) => {
      const nextThreadsByWorkspace = {
        ...state.threadsByWorkspace,
        [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? []).map(
          (thread) =>
            thread.id !== state.activeThreadIds[workspaceId]
              ? thread
              : {
                ...thread,
                title:
                  thread.messages.length === 0 ||
                    thread.title === "New thread"
                    ? buildThreadTitle(displayedPrompt)
                    : thread.title,
                lastUpdatedAt: assistantPlaceholder.createdAt,
                messages: [
                  ...thread.messages,
                  userMessage,
                  assistantPlaceholder,
                ],
                runs: replaceRunById(thread.runs, reproducibleRun),
              },
        ),
      };

      void persistWorkspaceState(
        workspaceId,
        nextThreadsByWorkspace,
        state.activeThreadIds,
      );

      return {
        activeRun: {
          runId,
          workspaceId,
          threadId: activeThreadId,
          messageId: assistantPlaceholder.id,
          reproducibleRunId: reproducibleRun.id,
        },
        runStatus: "running",
        threadsByWorkspace: nextThreadsByWorkspace,
      };
    });

    try {
      // Commit the visible turn before crossing any IPC boundary. CaptureTask
      // remains the sole EngineeringTask authority, but it no longer blocks the
      // submitted message or active assistant state from rendering.
      if (!engineeringTaskId && !conversational) {
        try {
          const { captureEngineeringTask } = await import(
            "../services/engineering-client"
          );
          const captured = await captureEngineeringTask({
            workspaceId,
            objectiveSeed: displayedPrompt,
            conversationId: activeThreadId,
          });
          if (captured.ok && captured.engineeringTaskId) {
            engineeringTaskId = captured.engineeringTaskId;
          }
        } catch {
          // Unit tests without IPC still exercise chat path; packaged app has engineering IPC.
        }
      }

      if (get().activeRun?.runId !== runId) {
        return;
      }

      const noProgressTimeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          const state = get();
          const activeRun = state.activeRun;
          if (activeRun?.runId !== runId) {
            return;
          }
          const activeThread = (
            state.threadsByWorkspace[activeRun.workspaceId] ?? []
          ).find((thread) => thread.id === activeRun.threadId);
          const activeMessage = activeThread?.messages.find(
            (message) => message.id === activeRun.messageId,
          );
          const hasProgress =
            Boolean(activeMessage?.content.trim()) ||
            Boolean(activeMessage?.events?.length) ||
            Boolean(activeMessage?.artifacts?.length);

          if (hasProgress) {
            return;
          }

          void cancelAssistant(runId);
          reject(createNoProgressTimeoutError());
        }, ASSISTANT_FIRST_PROGRESS_TIMEOUT_MS);
      });
      const assistantExecution = runAssistant(
        displayedPrompt,
        historyBeforePrompt,
        {
          ...runOptions,
          engineeringTaskId,
        },
        runId,
      );
      const execution = await Promise.race([
        assistantExecution,
        noProgressTimeout,
      ]);

      const finalMessage: ChatMessage = {
        ...execution.message,
      };
      const executionOutcome = conversational
        ? undefined
        : deriveExecutionOutcome({
            ...finalMessage,
            executionOutcome: execution.executionOutcome,
          });
      if (executionOutcome) {
        finalMessage.executionOutcome = executionOutcome;
      }
      // Prove dead write path — completeFactoryRun never restores authority
      void completeFactoryRun(undefined, {
        events: execution.message.events ?? [],
        evidencePack: execution.message.evidencePack,
        completedAt: execution.message.createdAt,
      });

      const finalRun = await sealRunIntegrity({
        ...reproducibleRun,
        assistantMessageId: finalMessage.id,
        status: "completed",
        completedAt: finalMessage.createdAt,
        events: finalMessage.events ?? [],
        artifacts: finalMessage.artifacts ?? [],
        result: {
          status: executionOutcome?.terminalState ?? "completed",
          summary: executionOutcome?.summary ?? finalMessage.content,
          executionOutcome,
          evidencePack: finalMessage.evidencePack,
          workingSet: finalMessage.workingSet?.metadata,
        },
      });

      set((state) => {
        const activeRun = state.activeRun;
        const nextThreadsByWorkspace = {
          ...state.threadsByWorkspace,
          [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? [])
            .map((thread) =>
              thread.id !==
                (activeRun?.threadId ?? state.activeThreadIds[workspaceId])
                ? thread
                : {
                  ...thread,
                  title: execution.suggestedTitle ?? thread.title,
                  lastUpdatedAt: finalMessage.createdAt,
                  messages:
                    activeRun && activeRun.runId === runId
                      ? replaceMessageById(
                        thread.messages,
                        activeRun.messageId,
                        finalMessage,
                      )
                      : [...thread.messages, finalMessage],
                  runs: replaceRunById(thread.runs, finalRun),
                },
            )
            .toSorted((left, right) =>
              right.lastUpdatedAt.localeCompare(left.lastUpdatedAt),
            ),
        };

        void persistWorkspaceState(
          workspaceId,
          nextThreadsByWorkspace,
          state.activeThreadIds,
        );

        return {
          activeRun: state.activeRun?.runId === runId ? null : state.activeRun,
          runStatus: "completed",
          threadsByWorkspace: nextThreadsByWorkspace,
        };
      });
    } catch (error) {
      const formattedError = formatAssistantError(error);
      const fallbackMessage: ChatMessage = {
        id: createId("assistant"),
        role: "assistant",
        content: formattedError,
        createdAt: new Date().toISOString(),
        artifacts: [
          {
            id: "assistant-error",
            label: "Status",
            value: formattedError,
            tone: "warning",
          },
        ],
      };
      void completeFactoryRun(undefined, {
        events: [],
        completedAt: new Date().toISOString(),
      });
      const failedRun = await sealRunIntegrity({
        ...reproducibleRun,
        assistantMessageId: fallbackMessage.id,
        status: "failed",
        completedAt: fallbackMessage.createdAt,
        artifacts: fallbackMessage.artifacts ?? [],
        result: {
          status: "failed",
          summary: fallbackMessage.content,
        },
      });

      set((state) => {
        const activeRun = state.activeRun;
        const nextThreadsByWorkspace = {
          ...state.threadsByWorkspace,
          [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? []).map(
            (thread) =>
              thread.id !==
                (activeRun?.threadId ?? state.activeThreadIds[workspaceId])
                ? thread
                : {
                  ...thread,
                  lastUpdatedAt: fallbackMessage.createdAt,
                  messages:
                    activeRun && activeRun.runId === runId
                      ? replaceMessageById(
                        thread.messages,
                        activeRun.messageId,
                        fallbackMessage,
                      )
                      : [...thread.messages, fallbackMessage],
                  runs: replaceRunById(thread.runs, failedRun),
                },
          ),
        };

        void persistWorkspaceState(
          workspaceId,
          nextThreadsByWorkspace,
          state.activeThreadIds,
        );

        return {
          activeRun: state.activeRun?.runId === runId ? null : state.activeRun,
          runStatus: "failed",
          threadsByWorkspace: nextThreadsByWorkspace,
        };
      });
    }
  },
  async cancelActiveRun() {
    const activeRun = get().activeRun;
    if (!activeRun) {
      return;
    }

    await cancelAssistant(activeRun.runId);
    set((state) =>
      state.activeRun?.runId === activeRun.runId
        ? { activeRun: null, runStatus: "failed" }
        : {},
    );
  },
  async undoLastTurn() {
    const workspaceId = get().activeWorkspaceId;

    if (!workspaceId || get().runStatus === "running") {
      return null;
    }

    const threads = get().threadsByWorkspace[workspaceId] ?? [];
    const activeThreadId = get().activeThreadIds[workspaceId];
    const currentThread = threads.find(
      (thread) => thread.id === activeThreadId,
    );

    if (!currentThread) {
      return null;
    }

    const lastUserIndex = currentThread.messages.findLastIndex(
      (message) => message.role === "user",
    );
    if (lastUserIndex === -1) {
      return null;
    }

    const restoredPrompt =
      currentThread.messages[lastUserIndex]?.content ?? null;
    const nextMessages = currentThread.messages.slice(0, lastUserIndex);
    const nextLastUpdatedAt =
      nextMessages.at(-1)?.createdAt ?? new Date().toISOString();

    const nextThreads = threads.map((thread) =>
      thread.id !== activeThreadId
        ? thread
        : {
          ...thread,
          lastUpdatedAt: nextLastUpdatedAt,
          messages: nextMessages,
          title: nextMessages.length === 0 ? "New thread" : thread.title,
        },
    );

    set((state) => ({
      threadsByWorkspace: {
        ...state.threadsByWorkspace,
        [workspaceId]: nextThreads,
      },
    }));

    await persistWorkspaceState(
      workspaceId,
      {
        ...get().threadsByWorkspace,
        [workspaceId]: nextThreads,
      },
      get().activeThreadIds,
    );

    return restoredPrompt;
  },
}));

function errorToMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
