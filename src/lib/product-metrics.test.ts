import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalProductMetrics, sanitizeMetricProperties, type ProductMetricEvent } from "./product-metrics";

describe("product metrics", () => {
  it("drops sensitive paths, prompts, source, commands, and evidence", () => {
    assert.deepEqual(
      sanitizeMetricProperties({
        validation_passed: 2,
        failure_category: "typecheck",
        path: "/Users/alice/private/repo",
        raw_prompt: "fix my secret",
        command: "cat .env",
        evidence: "tool output",
        api_key: "ra-secret",
      }),
      { validation_passed: 2, failure_category: "typecheck" },
    );
  });

  it("records only when telemetry is enabled", async () => {
    const events: ProductMetricEvent[] = [];
    const disabled = new LocalProductMetrics({ enabled: false }, { record: (event) => { events.push(event); } });
    await disabled.record("app_opened", { latency_ms: 12 });
    assert.equal(events.length, 0);

    const enabled = new LocalProductMetrics({ enabled: true, anonymousWorkspaceId: "ws-anon" }, { record: (event) => { events.push(event); } });
    await enabled.record("ship_proof_generated", { validation_passed: 3, estimated_cost_usd: 0.42 });
    assert.equal(events.length, 1);
    assert.equal(events[0].anonymousWorkspaceId, "ws-anon");
  });
});
