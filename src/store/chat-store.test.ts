import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { AssistantRunOptions, ChatMessage } from "../contracts/chat";

const runAssistantMock: {
  calls: Array<[string, string[], AssistantRunOptions, string]>;
  impl: (
    prompt: string,
    history: string[],
    options: AssistantRunOptions,
    runId: string,
  ) => Promise<{
    message: {
      id: string;
      role: "assistant";
      content: string;
      createdAt: string;
      events?: [];
      artifacts?: [];
    };
    suggestedTitle?: string;
  }>;
} = {
  calls: [],
  impl: async (prompt, _history, options) => ({
    message: {
      id: "assistant-1",
      role: "assistant",
      content: `Completed ${options.runbookId ?? "run"} for ${prompt}`,
      createdAt: new Date().toISOString(),
      events: [],
      artifacts: [],
    },
  }),
};

// Mock repo-client before importing store
const originalImport = await import("../services/repo-client");
void originalImport;

// Use dynamic mock pattern via module patching for bun/node test
const repoClientPath = new URL("../services/repo-client.ts", import.meta.url).pathname;

// Simpler: patch after import by reassigning store dependencies through test doubles in the store's import graph.
// chat-store imports runAssistant from repo-client — we replace via bun mock if available.

describe("chat-store submit without Factory authority [NES-8][CLOSURE 2]", () => {
  let useChatStore: typeof import("./chat-store").useChatStore;
  let runAssistant: typeof import("../services/repo-client").runAssistant;

  beforeEach(async () => {
    const testGlobal = globalThis as unknown as {
      mate: Record<string, unknown>;
      window: unknown;
    };
    testGlobal.window = globalThis;
    testGlobal.mate = {
      repo: { saveWorkspaceSession: async () => undefined },
    };
    runAssistantMock.calls = [];
    runAssistantMock.impl = async (prompt, _history, options) => ({
      message: {
        id: "assistant-1",
        role: "assistant",
        content: `Completed ${options.runbookId ?? "run"} for ${prompt}`,
        createdAt: new Date().toISOString(),
        events: [],
        artifacts: [],
      },
    });

    // Re-import fresh modules
    const repoClient = await import("../services/repo-client");
    runAssistant = repoClient.runAssistant;

    // Monkey-patch runAssistant for this suite when the export is mutable
    const storeMod = await import("./chat-store");
    useChatStore = storeMod.useChatStore;

    // Reset store state
    useChatStore.setState({
      activeRun: null,
      activeThreadIds: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
      repoFiles: [],
      repoSignals: [],
      runStatus: "idle",
      settings: {
        privacyFirewallEnabled: true,
        privacyMode: "strict",
        theme: "system",
      } as never,
      threadsByWorkspace: {
        "workspace-1": [
          {
            id: "thread-1",
            title: "New thread",
            messages: [],
            lastUpdatedAt: new Date().toISOString(),
          },
        ],
      },
      trustContract: null,
      workspace: {
        id: "workspace-1",
        name: "fixture",
        path: "/tmp/fixture",
        branch: "main",
        stack: [],
      } as never,
      workspaces: [],
    });

    // Intercept via global mock if the store uses the imported function
    // The store imports runAssistant at module load — patch the module export.
    try {
      Object.assign(repoClient, {
        runAssistant: async (
          prompt: string,
          history: string[],
          options: AssistantRunOptions,
          runId: string,
        ) => {
          runAssistantMock.calls.push([prompt, history, options, runId]);
          return runAssistantMock.impl(prompt, history, options, runId);
        },
        cancelAssistant: async () => undefined,
        onAssistantProgress: () => () => undefined,
      });
    } catch {
      /* immutable export */
    }
    void runAssistant;
    void repoClientPath;
  });

  it("creates a normal chat turn with pathKind not product mode", async () => {
    // Direct unit test of normalize path without full IPC
    const { normalizeFactoryRunOptions } = await import("../lib/factory-run");
    const normalized = normalizeFactoryRunOptions({
      behaviorMode: "execute",
      pathKind: "full",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    });
    assert.equal(normalized.pathKind, "full");
    assert.equal("mode" in normalized, false);
  });

  it("does not create FactoryRun state for casual help path", async () => {
    const { createFactoryRun } = await import("../lib/factory-run");
    assert.equal(
      createFactoryRun({
        id: "x",
        prompt: "What changed?",
        options: {
          behaviorMode: "review",
          pathKind: "chat_help",
          reasoning: "high",
          reasoningEnabled: true,
          runbookId: "review_classify_summarize",
          serviceTier: "standard",
        },
        createdAt: new Date().toISOString(),
      }),
      undefined,
    );
  });

  it("strips residual factory mode aliases without restoring Factory authority", async () => {
    const { normalizeFactoryRunOptions, createFactoryRun } = await import(
      "../lib/factory-run"
    );
    const opts = normalizeFactoryRunOptions({
      behaviorMode: "execute",
      mode: "factory",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    } as AssistantRunOptions & { mode: string });
    assert.equal(opts.behaviorMode, "execute");
    assert.equal(opts.pathKind, "full");
    assert.equal(
      createFactoryRun({
        id: "f",
        prompt: "Fix and verify",
        options: opts,
        createdAt: new Date().toISOString(),
      }),
      undefined,
    );
  });

  it("derives terminal state from structured outcome instead of assistant wording", async () => {
    const { deriveExecutionOutcome } = await import("./chat-store");
    const message: ChatMessage = {
      id: "assistant-error",
      role: "assistant",
      content: "The run succeeded.",
      createdAt: new Date().toISOString(),
      events: [{
        id: "tool-sandbox",
        label: "Sandbox run",
        detail: "Command failed.",
        status: "error",
      }],
      outcome: {
        status: "failed",
        summary: "Validation failed.",
      },
    };
    const outcome = deriveExecutionOutcome(message);

    assert.equal(outcome.terminalState, "failed");
    assert.notEqual(outcome.terminalState, "completed");
  });

  it("keeps approval-required as a typed cause on the canonical blocked terminal", async () => {
    const { deriveExecutionOutcome } = await import("./chat-store");
    const message: ChatMessage = {
      id: "assistant-approval",
      role: "assistant",
      content: "Approval is required.",
      createdAt: new Date().toISOString(),
      outcome: {
        status: "needs_approval",
        summary: "Approve this repository change once.",
        approvalId: "approval-1",
      },
    };

    const outcome = deriveExecutionOutcome(message);
    assert.equal(outcome.terminalState, "blocked");
    assert.equal(outcome.primaryCause?.code, "APPROVAL_REQUIRED");
    assert.equal(outcome.nextActions?.[0]?.id, "review-approval");
  });

  it("reuses an unused thread and only creates another after the current one has a prompt", () => {
    const initialThreadId = useChatStore.getState().activeThreadIds["workspace-1"];
    useChatStore.getState().createThread();

    let state = useChatStore.getState();
    assert.equal(state.threadsByWorkspace["workspace-1"]?.length, 1);
    assert.equal(
      state.activeThreadIds["workspace-1"],
      initialThreadId,
    );

    state = useChatStore.getState();
    useChatStore.setState({
      threadsByWorkspace: {
        ...state.threadsByWorkspace,
        "workspace-1": [
          {
            ...state.threadsByWorkspace["workspace-1"]![0]!,
            messages: [
              {
                id: "user-1",
                role: "user",
                content: "A real prompt",
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
      },
    });
    useChatStore.getState().createThread();

    assert.equal(
      useChatStore.getState().threadsByWorkspace["workspace-1"]?.length,
      2,
    );
  });

  it("renders the submitted turn before a delayed CaptureTask resolves", async () => {
    let releaseCapture!: () => void;
    let markCaptureStarted!: () => void;
    const captureStarted = new Promise<void>((resolve) => {
      markCaptureStarted = resolve;
    });
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    let receivedOptions: AssistantRunOptions | undefined;
    const testGlobal = globalThis as unknown as {
      mate: Record<string, unknown>;
      window: unknown;
    };
    testGlobal.window = globalThis;
    testGlobal.mate = {
      engineering: {
        dispatch: async () => {
          markCaptureStarted();
          await captureGate;
          return {
            ok: true,
            data: { engineeringTaskId: "engineering-task-1" },
          };
        },
      },
      repo: {
        saveWorkspaceSession: async () => undefined,
        runAssistant: async (
          _prompt: string,
          _history: string[],
          options: AssistantRunOptions,
        ) => {
          receivedOptions = options;
          return {
            message: {
              id: "assistant-complete",
              role: "assistant" as const,
              content: "Implemented the focused fix.",
              createdAt: new Date().toISOString(),
              events: [],
              artifacts: [],
            },
          };
        },
      },
    };

    const submission = useChatStore.getState().submitPrompt("Fix the flow", {
      behaviorMode: "execute",
      pathKind: "full",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "patch_test_verify",
      serviceTier: "standard",
    });
    await captureStarted;

    const pendingState = useChatStore.getState();
    const pendingMessages = pendingState.threadsByWorkspace["workspace-1"]![0]!.messages;
    assert.equal(pendingState.runStatus, "running");
    assert.equal(pendingMessages.length, 2);
    assert.equal(pendingMessages[0]?.content, "Fix the flow");
    assert.equal(pendingMessages[1]?.role, "assistant");
    assert.equal(receivedOptions, undefined);

    releaseCapture();
    await submission;
    const completedOptions = receivedOptions as AssistantRunOptions | undefined;
    assert.equal(completedOptions?.engineeringTaskId, "engineering-task-1");
  });

  it("routes a greeting through chat_help without CaptureTask or an Outcome Card payload", async () => {
    let captureCalls = 0;
    let receivedOptions: AssistantRunOptions | undefined;
    const testGlobal = globalThis as unknown as {
      mate: Record<string, unknown>;
      window: unknown;
    };
    testGlobal.window = globalThis;
    testGlobal.mate = {
      engineering: {
        dispatch: async () => {
          captureCalls += 1;
          return { ok: false };
        },
      },
      repo: {
        saveWorkspaceSession: async () => undefined,
        runAssistant: async (
          _prompt: string,
          _history: string[],
          options: AssistantRunOptions,
        ) => {
          receivedOptions = options;
          return {
            message: {
              id: "assistant-greeting",
              role: "assistant" as const,
              content: "Hey — what do you want to inspect or change in fixture?",
              createdAt: new Date().toISOString(),
              events: [],
              artifacts: [],
            },
          };
        },
      },
    };

    await useChatStore.getState().submitPrompt("Hi", {
      behaviorMode: "execute",
      pathKind: "full",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "patch_test_verify",
      serviceTier: "standard",
    });

    const finalMessage = useChatStore.getState()
      .threadsByWorkspace["workspace-1"]![0]!.messages.at(-1);
    assert.equal(captureCalls, 0);
    assert.equal(receivedOptions?.pathKind, "chat_help");
    assert.equal(finalMessage?.content, "Hey — what do you want to inspect or change in fixture?");
    assert.equal(finalMessage?.executionOutcome, undefined);
  });

  it("routes repository explanations through read-only repository inspection", async () => {
    let captureCalls = 0;
    let receivedOptions: AssistantRunOptions | undefined;
    const testGlobal = globalThis as unknown as {
      mate: Record<string, unknown>;
      window: unknown;
    };
    testGlobal.window = globalThis;
    testGlobal.mate = {
      engineering: {
        dispatch: async () => {
          captureCalls += 1;
          return {
            ok: true,
            data: { engineeringTaskId: "engineering-repo-explanation" },
          };
        },
      },
      repo: {
        saveWorkspaceSession: async () => undefined,
        runAssistant: async (
          _prompt: string,
          _history: string[],
          options: AssistantRunOptions,
        ) => {
          receivedOptions = options;
          return {
            message: {
              id: "assistant-repo-explanation",
              role: "assistant" as const,
              content: "This repository is grounded in its inspected manifest and entry points.",
              createdAt: new Date().toISOString(),
              events: [],
              artifacts: [],
            },
          };
        },
      },
    };

    await useChatStore.getState().submitPrompt("Explain me the repo", {
      behaviorMode: "execute",
      pathKind: "chat_help",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "patch_test_verify",
      serviceTier: "standard",
    });

    assert.equal(captureCalls, 1);
    assert.equal(receivedOptions?.pathKind, "verify_only");
    assert.equal(receivedOptions?.behaviorMode, "review");
    assert.equal(receivedOptions?.runbookId, "review_classify_summarize");
    assert.equal(
      receivedOptions?.engineeringTaskId,
      "engineering-repo-explanation",
    );
  });
});
