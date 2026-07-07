import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { AssistantRunOptions } from "../contracts/chat";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

const runAssistantMock = createSpy(
  async (
    prompt: string,
    _history: string[],
    options: AssistantRunOptions,
  ) => ({
    message: {
      id: "assistant-final",
      role: "assistant" as const,
      content: `Completed ${options.runbookId} for ${prompt}`,
      createdAt: new Date().toISOString(),
      events: [],
      artifacts: [],
    },
    suggestedTitle: "Safety check",
  }),
);

(mock as any).module("../services/repo-client", () => ({
  bootstrapWorkspaceState: createSpy(async () => ({
    activeWorkspaceId: null,
    activeThreadId: null,
    workspaces: [],
    threads: [],
    workspace: null,
    trustContract: null,
    files: [],
    signals: [],
  })),
  cancelAssistant: createSpy(async () => {}),
  onAssistantProgress: createSpy(() => () => {}),
  openWorkspacePicker: createSpy(async () => null),
  removeWorkspace: createSpy(async () => {}),
  runAssistant: runAssistantMock,
  saveWorkspaceSession: createSpy(async () => {}),
  setActiveWorkspace: createSpy(async () => ({
    activeWorkspaceId: null,
    activeThreadId: null,
    workspaces: [],
    threads: [],
    workspace: null,
    trustContract: null,
    files: [],
    signals: [],
  })),
}));

describe("submitPrompt flow", () => {
  let useChatStore: typeof import("./chat-store").useChatStore;

  beforeEach(async () => {
    ({ useChatStore } = await import("./chat-store"));
    runAssistantMock.mockClear();
    runAssistantMock.impl =
      async (
        prompt: string,
        _history: string[],
        options: AssistantRunOptions,
      ) => ({
        message: {
          id: "assistant-final",
          role: "assistant" as const,
          content: `Completed ${options.runbookId} for ${prompt}`,
          createdAt: new Date().toISOString(),
          events: [],
          artifacts: [],
        },
        suggestedTitle: "Safety check",
      });
    useChatStore.setState({
      activeRun: null,
      activeThreadIds: { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
      isBootstrapped: true,
      lastError: null,
      repoFiles: [],
      repoSignals: [],
      runStatus: "idle",
      threadsByWorkspace: {
        "workspace-1": [
          {
            id: "thread-1",
            title: "New thread",
            messages: [],
            runs: [],
            lastUpdatedAt: new Date().toISOString(),
          },
        ],
      },
      trustContract: null,
      workspace: {
        id: "workspace-1",
        name: "mate-x",
        path: "/tmp/mate-x",
        branch: "main",
        status: "ready",
        stack: ["typescript"],
        facts: [],
      },
      workspaces: [],
    });
  });

  afterEach(() => {
    useChatStore.setState({
      activeRun: null,
      activeThreadIds: {},
      activeWorkspaceId: null,
      runStatus: "idle",
      threadsByWorkspace: {},
      workspace: null,
      workspaces: [],
    });
  });

  it("creates a normal chat turn and preserves mode/intent", async () => {
    await useChatStore.getState().submitPrompt("Run the smallest useful safety check", {
      access: "approval",
      mode: "build",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    });

    assert.equal(runAssistantMock.calls.length, 1);
    assert.equal(runAssistantMock.calls[0][0], "Run the smallest useful safety check");
    assert.equal(runAssistantMock.calls[0][2].mode, "build");
    assert.equal(runAssistantMock.calls[0][2].access, "approval");
    assert.equal(runAssistantMock.calls[0][2].runbookId, "scan_contain_report");

    const thread = useChatStore.getState().threadsByWorkspace["workspace-1"][0];
    assert.equal(thread.messages[0].role, "user");
    assert.equal(
      thread.messages[0].content,
      "Run the smallest useful safety check",
    );
    assert.equal(thread.messages[1].role, "assistant");
    assert.equal(
      thread.messages[1].content,
      "Completed scan_contain_report for Run the smallest useful safety check",
    );
    assert.equal(thread.messages[1].factoryRun, undefined);
  });

  it("does not create FactoryRun state for casual Chat mode", async () => {
    await useChatStore.getState().submitPrompt("What changed?", {
      access: "approval",
      mode: "chat",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "review_classify_summarize",
      serviceTier: "standard",
    });

    assert.equal(runAssistantMock.calls[0][2].mode, "chat");
    const thread = useChatStore.getState().threadsByWorkspace["workspace-1"][0];
    assert.equal(thread.messages[1].factoryRun, undefined);
  });

  it("creates FactoryRun state and overrides renderer full access", async () => {
    await useChatStore.getState().submitPrompt("Fix and verify", {
      access: "full",
      mode: "factory",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    });

    assert.equal(runAssistantMock.calls[0][2].mode, "factory");
    assert.equal(runAssistantMock.calls[0][2].access, "approval");
    assert.equal(runAssistantMock.calls[0][2].runbookId, "scan_contain_report");
    const thread = useChatStore.getState().threadsByWorkspace["workspace-1"][0];
    assert.equal(thread.messages[1].factoryRun?.mode, "factory");
    assert.equal(thread.messages[1].factoryRun?.access, "approval");
  });

  it("failed submit shows a user-visible inline failure state", async () => {
    runAssistantMock.impl = async () => {
      throw new Error("Provider unavailable");
    };

    await useChatStore.getState().submitPrompt("Review changes", {
      access: "approval",
      mode: "build",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "review_classify_summarize",
      serviceTier: "standard",
    });

    const thread = useChatStore.getState().threadsByWorkspace["workspace-1"][0];
    assert.equal(useChatStore.getState().runStatus, "failed");
    assert.equal(thread.messages[0].role, "user");
    assert.equal(thread.messages[0].content, "Review changes");
    assert.equal(thread.messages[1].role, "assistant");
    assert.equal(thread.messages[1].content, "Provider unavailable");
    assert.deepEqual(thread.messages[1].artifacts?.[0], {
      id: "assistant-error",
      label: "Status",
      value: "Provider unavailable",
      tone: "warning",
    });
  });
});

function createSpy(impl: (...args: any[]) => any) {
  const spy = (...args: any[]) => {
    spy.calls.push(args);
    return spy.impl(...args);
  };
  spy.calls = [] as any[][];
  spy.impl = impl;
  spy.mockClear = () => {
    spy.calls = [];
    spy.impl = impl;
  };
  return spy;
}
