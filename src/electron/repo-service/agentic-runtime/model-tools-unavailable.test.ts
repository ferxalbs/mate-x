import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  createModelToolsUnavailableResult,
  isModelToolsUnavailableError,
} from "./model-tools-unavailable";

describe("required model tools", () => {
  test("returns a typed failure and never preserves a model draft", () => {
    const result = createModelToolsUnavailableResult([]);

    assert.equal(result.outcome.status, "failed");
    assert.equal(result.outcome.diagnostic?.code, "MODEL_TOOLS_UNAVAILABLE");
    assert.equal(result.outcome.remediation?.type, "select_model");
    assert.doesNotMatch(result.content, /I'll|I will|tool_call|arguments/i);
  });

  test("recognizes only the typed incompatibility", () => {
    assert.equal(
      isModelToolsUnavailableError({ code: "MODEL_TOOLS_UNAVAILABLE" }),
      true,
    );
    assert.equal(isModelToolsUnavailableError(new Error("network")), false);
  });
});
