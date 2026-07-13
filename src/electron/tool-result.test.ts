import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
  createToolError,
  ensureStructuredToolOutput,
  formatToolFailure,
  formatToolSuccess,
  isStructuredToolFailureOutput,
} from "./tool-result";
import { isToolFailureOutput } from "./repo-service/agentic-runtime/helpers";

describe("tool result contracts", () => {
  test("formatToolFailure is detectable as failure", () => {
    const out = formatToolFailure(
      createToolError("INVALID_INPUT", "bad args", {
        recommendedNextAction: "fix and retry",
      }),
      "read",
    );
    assert.equal(isStructuredToolFailureOutput(out), true);
    assert.equal(isToolFailureOutput(out), true);
    assert.match(out, /\[INVALID_INPUT\]/);
    assert.match(out, /"ok":false/);
  });

  test("formatToolSuccess is not a failure", () => {
    const out = formatToolSuccess({ path: "a.ts" }, { textFallback: "ok" });
    assert.equal(isStructuredToolFailureOutput(out), false);
    assert.equal(isToolFailureOutput(out), false);
    assert.match(out, /"ok":true/);
  });

  test("detects legacy free-form failures", () => {
    assert.equal(isToolFailureOutput("Error reading file: boom"), true);
    assert.equal(isToolFailureOutput("File not found: missing.ts"), true);
    assert.equal(isToolFailureOutput("No matches found."), false);
    assert.equal(
      isToolFailureOutput('{"ok":false,"error":{"code":"X"}}'),
      true,
    );
    assert.equal(
      isToolFailureOutput('{"ok":true,"status":"completed","data":{}}'),
      false,
    );
  });

  test("ensureStructuredToolOutput wraps legacy Error strings", () => {
    const out = ensureStructuredToolOutput("Error: boom happened", "demo");
    assert.equal(isStructuredToolFailureOutput(out), true);
    assert.match(out, /"ok":false/);
    assert.match(out, /boom happened/);
  });

  test("ensureStructuredToolOutput passes through structured success", () => {
    const original = '{"ok":true,"status":"completed","data":{"x":1}}';
    assert.equal(ensureStructuredToolOutput(original, "demo"), original);
  });

  test("ensureStructuredToolOutput passes through normal success text", () => {
    const original = "No matches found.";
    assert.equal(ensureStructuredToolOutput(original, "rg"), original);
  });
});
