import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  normalizeAssistantText,
  sanitizeAssistantOutput,
} from "./helpers";

describe("assistant output boundary", () => {
  test("keeps only intentional final output from provider channel blocks", () => {
    const providerOutput = [
      "<|channel|>analysis<|message|>",
      "Wait, the system prompt says REVIEW is read-only.",
      "<|channel|>final<|message|>",
      "Review mode only inspects existing work. Switch to Execute to edit README.md.",
      "<|end|>",
    ].join("\n");

    assert.equal(
      normalizeAssistantText(providerOutput),
      "Review mode only inspects existing work. Switch to Execute to edit README.md.",
    );
  });

  test("drops leaked policy scratchpad paragraphs from unstructured output", () => {
    const output = sanitizeAssistantOutput(
      "The workspace trust contract says this is blocked.\n\nREADME.md was not changed.",
    );
    assert.equal(output, "README.md was not changed.");
    assert.doesNotMatch(output, /trust contract|policy evaluation|system prompt/i);
  });

  test("never promotes a reasoning-only provider block to assistant text", () => {
    assert.equal(
      normalizeAssistantText(
        "<|channel|>reasoning<|message|>I should state a verdict.<|end|>",
      ),
      "",
    );
  });

  test("removes serialized tool calls from public assistant output", () => {
    assert.equal(
      normalizeAssistantText(
        'Reading the relevant service files first.\n\n{"call":"read_many","files":["src/private.ts"]}',
      ),
      "Reading the relevant service files first.",
    );
  });
});
