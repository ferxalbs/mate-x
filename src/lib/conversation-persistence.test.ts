import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Conversation } from "../contracts/chat";
import {
  compactConversationSnapshotForPersistence,
  MAX_PERSISTED_CONVERSATION_SIZE,
} from "./conversation-persistence";

describe("conversation persistence", () => {
  it("keeps normal conversation history while bounding duplicated run payloads", () => {
    const thread: Conversation = {
      id: "thread-1",
      title: "Investigate the renderer",
      lastUpdatedAt: new Date().toISOString(),
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Keep this prompt",
          createdAt: new Date().toISOString(),
          events: Array.from({ length: 500 }, (_, index) => ({
            id: `event-${index}`,
            label: "command",
            detail: "large command output ".repeat(500),
            status: "completed" as const,
          })),
        },
      ],
      runs: Array.from({ length: 20 }, (_, index) => ({
        id: `run-${index}`,
        threadId: "thread-1",
        userMessageId: "message-1",
        assistantMessageId: `assistant-${index}`,
        title: "Run",
        userIntent: "Keep this run metadata",
        status: "completed" as const,
        startedAt: new Date().toISOString(),
        events: [],
        decisions: [],
        artifacts: [],
        initialState: {} as any,
      })),
    };

    const snapshot = compactConversationSnapshotForPersistence(
      [thread],
      thread.id,
    );

    assert.ok(JSON.stringify(snapshot).length <= MAX_PERSISTED_CONVERSATION_SIZE);
    assert.equal(snapshot[0]?.messages[0]?.content, "Keep this prompt");
    assert.ok((snapshot[0]?.messages[0]?.events?.length ?? 0) <= 120);
  });

  it("preserves the active thread when the entire workspace needs a core fallback", () => {
    const threads: Conversation[] = Array.from({ length: 500 }, (_, index) => ({
      id: `thread-${index}`,
      title: `Thread ${index}`,
      lastUpdatedAt: new Date(index).toISOString(),
      messages: Array.from({ length: 40 }, (_, messageIndex) => ({
        id: `message-${index}-${messageIndex}`,
        role: "assistant" as const,
        content: "history ".repeat(4_000),
        createdAt: new Date(index).toISOString(),
      })),
    }));

    const snapshot = compactConversationSnapshotForPersistence(
      threads,
      "thread-12",
    );

    assert.ok(JSON.stringify(snapshot).length <= MAX_PERSISTED_CONVERSATION_SIZE);
    assert.equal(snapshot.some((thread) => thread.id === "thread-12"), true);
  });
});
