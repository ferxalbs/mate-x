import { describe, test } from "bun:test";
import { deepStrictEqual, equal } from "node:assert/strict";

import type { ToolEvent } from "../contracts/chat";
import { mergeTimelineSegments } from "./chat-store";

const runId = "run-1";

function segment(
  segmentId: string,
  sequence: number,
  detail: string,
  overrides: Partial<ToolEvent> = {},
): ToolEvent {
  return {
    id: segmentId,
    segmentId,
    runId,
    sequence,
    timestamp: `2026-07-12T19:00:0${sequence}.000Z`,
    label: segmentId,
    detail,
    status: "active",
    ...overrides,
  };
}

describe("append-only agent timeline", () => {
  test("keeps reasoning, tool, reasoning, and final segments stable across deltas and hydration", () => {
    let timeline: ToolEvent[] = [];
    const apply = (event: ToolEvent) => {
      timeline = mergeTimelineSegments(timeline, [event], { runId });
    };

    apply(segment("reasoning-1", 0, "The user", { passId: "pass-1", segmentKind: "reasoning" }));
    apply(segment("reasoning-1", 0, "The user said hello.", { passId: "pass-1", segmentKind: "reasoning" }));
    apply(segment("reasoning-1", 0, "The user said hello.", { passId: "pass-1", segmentKind: "reasoning", status: "completed" }));
    apply(segment("tool-read", 1, "AGENTS.md", { passId: "pass-1", segmentKind: "tool", type: "read" }));
    apply(segment("tool-read", 1, "Instructions loaded", { passId: "pass-1", segmentKind: "tool", type: "read", status: "completed" }));
    apply(segment("reasoning-2", 2, "I should answer briefly.", { passId: "pass-2", segmentKind: "reasoning" }));
    apply(segment("reasoning-2", 2, "I should answer briefly.", { passId: "pass-2", segmentKind: "reasoning", status: "completed" }));
    apply(segment("final", 3, "Hello", { passId: "pass-2", segmentKind: "final_response", type: "result" }));
    apply(segment("final", 3, "Hello! What's next?", { passId: "pass-2", segmentKind: "final_response", type: "result" }));
    apply(segment("final", 3, "Hello! What's next?", { passId: "pass-2", segmentKind: "final_response", type: "result", status: "completed" }));

    deepStrictEqual(timeline.map((item) => item.segmentId), ["reasoning-1", "tool-read", "reasoning-2", "final"]);
    deepStrictEqual(timeline.map((item) => item.detail), [
      "The user said hello.",
      "Instructions loaded",
      "I should answer briefly.",
      "Hello! What's next?",
    ]);
    equal(timeline.filter((item) => item.segmentKind === "final_response").length, 1);
    deepStrictEqual(JSON.parse(JSON.stringify(timeline)), timeline);
  });

  test("preserves agent ancestry and objective terminal states without invented reasoning", () => {
    const events = [
      segment("delegated-tool", 0, "Done", { segmentKind: "tool", agentId: "child", parentAgentId: "root", status: "completed" }),
      segment("error", 1, "Provider failed", { segmentKind: "error", type: "error", status: "failed" }),
      segment("cancelled", 2, "Cancelled by user", { segmentKind: "cancelled", status: "cancelled" }),
      segment("final", 3, "Hello!", { segmentKind: "final_response", type: "result", status: "completed" }),
    ];
    const timeline = mergeTimelineSegments([], events, { runId });

    equal(timeline.some((item) => item.type === "reasoning"), false);
    deepStrictEqual({ agentId: timeline[0]?.agentId, parentAgentId: timeline[0]?.parentAgentId }, { agentId: "child", parentAgentId: "root" });
    deepStrictEqual(timeline.map((item) => item.status), ["completed", "failed", "cancelled", "completed"]);
    equal(timeline.at(-1)?.segmentKind, "final_response");
  });
});
