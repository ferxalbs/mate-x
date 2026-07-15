import { describe, expect, test } from "bun:test";

import type { ToolEvent } from "../../../contracts/chat";
import { formatDuration, getTimelineDuration } from "./agent-execution-trace-utils";

function event(id: string, timestamp?: string): ToolEvent {
  return {
    id,
    label: id,
    detail: "",
    status: "done",
    timestamp,
  };
}

describe("agent execution duration", () => {
  test("uses the full timestamp range regardless of render order", () => {
    const timeline = [
      event("tool", "2026-07-13T01:03:17.000Z"),
      event("reasoning", "2026-07-13T01:00:00.000Z"),
      event("final", "2026-07-13T01:02:00.000Z"),
    ];

    expect(String(getTimelineDuration(timeline))).toMatch(/^197000$/);
    expect(formatDuration(getTimelineDuration(timeline))).toMatch(/^3m 17s$/);
  });

  test("ignores invalid timestamps without producing a fake duration", () => {
    expect(String(getTimelineDuration([
      event("missing"),
      event("invalid", "not-a-date"),
    ]))).toMatch(/^0$/);
  });

  test("includes final-response timestamp in completed duration", () => {
    const timeline = [
      event("reasoning", "2026-07-13T01:00:00.000Z"),
      { ...event("final", "2026-07-13T01:00:04.000Z"), segmentKind: "final_response" as const },
    ];

    expect(formatDuration(getTimelineDuration(timeline))).toMatch(/^4s$/);
  });
});
