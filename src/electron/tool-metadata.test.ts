import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import {
  getToolModelOutputBudgetChars,
  getToolOperationalMeta,
  isToolBatchExclusive,
  resolveToolTimeoutMs,
} from "./tool-metadata";
import { resolveToolExecutionTimeoutMs } from "./repo-service/agentic-runtime/config";

describe("tool metadata catalog", () => {
  test("resolves alias and canonical names for git", () => {
    const byAlias = getToolOperationalMeta("git");
    const byCanonical = getToolOperationalMeta("git_diag");
    assert.equal(byAlias.name, "git_diag");
    assert.equal(byCanonical.name, "git_diag");
    assert.equal(byAlias.idempotent, true);
    assert.equal(byAlias.hasSideEffects, false);
  });

  test("marks mutating tools non-retryable", () => {
    const editor = getToolOperationalMeta("file_editor");
    assert.equal(editor.hasSideEffects, true);
    assert.equal(editor.retryable, false);
    assert.equal(editor.requiresVerification, true);
    assert.equal(editor.parallelSafe, false);
  });

  test("analysis tools get longer timeouts than default 20s", () => {
    const deep = resolveToolTimeoutMs("deep_analysis_pipeline");
    assert.ok(deep > 20_000);
    assert.equal(
      resolveToolExecutionTimeoutMs("deep_analysis_pipeline", {}),
      deep,
    );
  });

  test("sandbox_run honors allowed timeoutSeconds", () => {
    assert.equal(
      resolveToolTimeoutMs("sandbox_run", { timeoutSeconds: 120 }),
      120_000 + 5_000,
    );
    assert.equal(
      resolveToolTimeoutMs("sandbox_run", { timeoutSeconds: 999 }),
      30_000 + 5_000,
    );
  });

  test("marks exclusive tools for serial batching", () => {
    assert.equal(isToolBatchExclusive("file_editor"), true);
    assert.equal(isToolBatchExclusive("sandbox_run"), true);
    assert.equal(isToolBatchExclusive("read"), false);
    assert.equal(isToolBatchExclusive("rg"), false);
  });

  test("noisy search tools get tighter model output budgets", () => {
    assert.ok(getToolModelOutputBudgetChars("rg") < getToolModelOutputBudgetChars("file_editor") || getToolModelOutputBudgetChars("rg") <= 20_000);
    assert.ok(getToolModelOutputBudgetChars("rg") <= 20_000);
  });
});
