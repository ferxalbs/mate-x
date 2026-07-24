import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
  compressResponsesInputItems,
  resolveContextCompressionLimits,
} from "./context-compression";

test("uses a 252k prompt target inside the 272k default context budget", () => {
  assert.deepEqual(resolveContextCompressionLimits(), {
    truncateThreshold: 201_600,
    compactThreshold: 226_800,
    maxLimit: 252_000,
  });
});

test("adapts compaction to models with smaller context windows", () => {
  assert.deepEqual(resolveContextCompressionLimits(128_000), {
    truncateThreshold: 86_400,
    compactThreshold: 97_200,
    maxLimit: 108_000,
  });
});

test("scales compaction through 1M and 2M authenticated plan limits", () => {
  assert.deepEqual(resolveContextCompressionLimits(1_000_000), {
    truncateThreshold: 784_000,
    compactThreshold: 882_000,
    maxLimit: 980_000,
  });
  assert.deepEqual(resolveContextCompressionLimits(2_000_000), {
    truncateThreshold: 1_584_000,
    compactThreshold: 1_782_000,
    maxLimit: 1_980_000,
  });
});

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
