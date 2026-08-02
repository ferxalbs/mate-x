import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { normalizePersistedValidationPlan } from "./validation-contract";

function command(command: string | null, requirementId = "test") {
  return {
    command,
    availability: command ? "resolved" : "unresolved",
    requirementId,
    source: command ? "repository_script" : null,
    reason: "Persisted validation requirement.",
    estimatedCost: "cheap",
    expectedSignal: `${requirementId} evidence`,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    objective: "Validate the repository.",
    changedFiles: [],
    impactedFiles: [],
    riskLevel: "low",
    primary: command("bun test"),
    fallback: command(null, "build"),
    requirements: [command("bun test")],
    fallbackTrigger: "primary_failed",
    recommendations: [],
    comments: [],
    executionState: {
      primary: "not_run",
      fallback: "not_run",
      persistence: "not_verified",
      blockingInstruction: "Run the current repository command.",
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("persisted validation contract migration", () => {
  test("maps a legacy flat requirement to explicit canonical defaults", () => {
    const normalized = normalizePersistedValidationPlan(plan());

    assert.ok(normalized);
    assert.equal(normalized.contract?.source, "legacy_adapter");
    assert.deepEqual(normalized.contract?.items[0], {
      id: "test",
      signal: "test",
      obligation: "required",
      trigger: "always",
      applicability: "applicable",
      availability: "resolved",
      command: "bun test",
      commandSource: "repository_script",
      evidence: { status: "not_run" },
      reason: "Persisted validation requirement.",
    });
  });

  test("drops a malformed cached contract without trusting it as authority", () => {
    const normalized = normalizePersistedValidationPlan(plan({
      contract: {
        schemaVersion: 1,
        items: [{ id: "bad", signal: "typecheck" }],
      },
    }));

    assert.ok(normalized);
    assert.equal(normalized.contract, undefined);
    assert.equal(normalized.requirements?.[0]?.command, "bun test");
  });

  test("rejects malformed persisted plans", () => {
    assert.equal(normalizePersistedValidationPlan({ id: "missing-fields" }), null);
    assert.equal(normalizePersistedValidationPlan(null), null);
  });
});
