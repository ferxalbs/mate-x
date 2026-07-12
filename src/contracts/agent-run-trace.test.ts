import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { normalizeToolEvent, type ToolEvent } from "./chat";

describe("agent run trace contract", () => {
  test("upgrades a persisted v1 event without rewriting its identity", () => {
    const legacy: ToolEvent = {
      id: "legacy-read",
      label: "Executing read",
      detail: "src/contracts/chat.ts",
      status: "done",
    };

    const normalized = normalizeToolEvent(legacy, {
      runId: "run-1",
      sequence: 4,
      timestamp: "2026-07-12T20:00:00.000Z",
    });
    assert.equal(normalized.id, "legacy-read");
    assert.equal(normalized.version, 2);
    assert.equal(normalized.runId, "run-1");
    assert.equal(normalized.sequence, 4);
    assert.equal(normalized.type, "read");
    assert.equal(normalized.status, "done");
    assert.equal(normalized.title, "Lectura completa: read");
    assert.equal(normalized.visibility, "public");
  });

  test("preserves provider-normalized v2 metadata", () => {
    const event: ToolEvent = {
      id: "approval-1",
      version: 2,
      runId: "run-provider",
      sequence: 9,
      timestamp: "2026-07-12T20:01:00.000Z",
      agentId: "security-reviewer",
      type: "approval",
      title: "Approval required",
      summary: "Workspace write needs confirmation.",
      label: "policy stop",
      detail: "restricted target",
      status: "blocked",
      visibility: "technical",
    };

    assert.deepEqual(normalizeToolEvent(event, { runId: "ignored", sequence: 1 }), event);
  });

  test("turns raw tool names into human active states", () => {
    const event = normalizeToolEvent({
      id: "edit-1",
      label: "Executing file_editor",
      detail: "Applying patch",
      status: "active",
    });

    assert.equal(event.type, "edit");
    assert.equal(event.title, "Editando: file editor");
  });
});
