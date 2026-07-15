import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { compressResponsesInputItems } from "./context-compression";

describe("compressResponsesInputItems", () => {
  test("truncates large function_call_output items", () => {
    const big = "a".repeat(10_000);
    const items = [
      {
        type: "function_call_output",
        call_id: "c1",
        output: big,
      },
    ];
    const compressed = compressResponsesInputItems(items);
    assert.ok(typeof compressed[0].output === "string");
    assert.ok((compressed[0].output as string).length < big.length);
    assert.ok(
      (compressed[0].output as string).includes(
        "TRUNCATED BY CONTEXT COMPRESSION",
      ),
    );
  });

  test("leaves small items unchanged", () => {
    const items = [
      {
        type: "function_call_output",
        call_id: "c1",
        output: "ok",
      },
    ];
    const compressed = compressResponsesInputItems(items);
    assert.equal(compressed[0].output, "ok");
  });
});
