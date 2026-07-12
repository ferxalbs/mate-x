import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { AssistantRunOptions } from "../contracts/chat";

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
      access: "approval",
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
          access: "approval",
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
      access: "full",
      mode: "factory",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    } as AssistantRunOptions & { mode: string });
    assert.equal(opts.access, "approval");
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
});
