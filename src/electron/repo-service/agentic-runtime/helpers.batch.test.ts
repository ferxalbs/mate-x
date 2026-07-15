import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
  executeToolBatchWithSafety,
  truncateToolOutputForModel,
} from "./helpers";

describe("executeToolBatchWithSafety", () => {
  test("parallelizes safe contiguous runs without crossing exclusive tools", async () => {
    const order: string[] = [];
    const active = { parallel: 0, maxParallel: 0 };

    const toolCalls = [
      { name: "read", id: "1" },
      { name: "rg", id: "2" },
      { name: "file_editor", id: "3" },
      { name: "sandbox_run", id: "4" },
    ];

    const results = await executeToolBatchWithSafety(
      toolCalls,
      4,
      async (toolCall) => {
        if (toolCall.name === "file_editor" || toolCall.name === "sandbox_run") {
          // Exclusive tools must not overlap with each other.
          assert.equal(active.parallel, 0);
          order.push(`start:${toolCall.name}`);
          await Promise.resolve();
          order.push(`end:${toolCall.name}`);
          return `ok:${toolCall.name}`;
        }

        active.parallel += 1;
        active.maxParallel = Math.max(active.maxParallel, active.parallel);
        order.push(`start:${toolCall.name}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push(`end:${toolCall.name}`);
        active.parallel -= 1;
        return `ok:${toolCall.name}`;
      },
    );

    assert.deepEqual(results, [
      "ok:read",
      "ok:rg",
      "ok:file_editor",
      "ok:sandbox_run",
    ]);
    // Reads may overlap; mutators run after and one at a time.
    assert.ok(active.maxParallel >= 1);
    const editorStart = order.indexOf("start:file_editor");
    const sandboxStart = order.indexOf("start:sandbox_run");
    const lastReadEnd = Math.max(order.indexOf("end:read"), order.indexOf("end:rg"));
    assert.ok(editorStart > lastReadEnd);
    assert.ok(sandboxStart > order.indexOf("end:file_editor"));
  });

  test("preserves an edit-before-read dependency", async () => {
    const order: string[] = [];

    const results = await executeToolBatchWithSafety(
      [
        { name: "file_editor", id: "1" },
        { name: "read", id: "2" },
      ],
      4,
      async (toolCall) => {
        order.push(toolCall.name);
        return `ok:${toolCall.name}`;
      },
    );

    assert.deepEqual(order, ["file_editor", "read"]);
    assert.deepEqual(results, ["ok:file_editor", "ok:read"]);
  });
});

describe("truncateToolOutputForModel", () => {
  test("applies tighter budget for noisy search tools than hard ceiling", () => {
    const huge = "x".repeat(50_000);
    const truncated = truncateToolOutputForModel("rg", huge);
    assert.ok(truncated.length < huge.length);
    assert.ok(truncated.length <= 16_000 + 80); // budget + truncation suffix
  });
});
