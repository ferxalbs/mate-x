/**
 * NES-8.1 / R4 — Factory write authority is deleted.
 * Regex stage completion is not product truth.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantRunOptions, FactoryRun, ToolEvent } from "../contracts/chat";
import {
  completeFactoryRun,
  createFactoryRun,
  createInitialFactoryStages,
  normalizeFactoryRunOptions,
  projectLegacyFactoryStagesFromEvents,
} from "./factory-run";

const factoryOptions: AssistantRunOptions = {
  access: "full",
  mode: "factory",
  reasoning: "high",
  reasoningEnabled: true,
  runbookId: "patch_test_verify",
  serviceTier: "standard",
};

describe("Factory write authority deleted [NES-8.1][R4]", () => {
  it("never creates new Factory runs (write authority dead)", () => {
    assert.equal(
      createFactoryRun({
        id: "factory-1",
        prompt: "Fix the failing validation",
        options: factoryOptions,
        createdAt: "2026-07-07T00:00:00.000Z",
      }),
      undefined,
    );
  });

  it("does not create runs for chat either", () => {
    assert.equal(
      createFactoryRun({
        id: "factory-1",
        prompt: "hello",
        options: { ...factoryOptions, mode: "chat", access: "approval" },
        createdAt: "2026-07-07T00:00:00.000Z",
      }),
      undefined,
    );
  });

  it("normalizes factory/ship product modes away from write path", () => {
    const factory = normalizeFactoryRunOptions(factoryOptions);
    assert.equal(factory.access, "approval");
    assert.equal(factory.mode, "chat");

    const ship = normalizeFactoryRunOptions({
      ...factoryOptions,
      access: "full",
      mode: "ship",
      runbookId: "review_classify_summarize",
    });
    assert.equal(ship.access, "approval");
    assert.equal(ship.mode, "chat");
    assert.equal(ship.runbookId, "patch_test_verify");
  });

  it("completeFactoryRun does not advance stages via regex authority", () => {
    const historical: FactoryRun = {
      id: "legacy-1",
      mode: "factory",
      prompt: "old",
      access: "approval",
      stages: createInitialFactoryStages("old"),
      ratchetSuggestions: [],
      createdAt: "2026-07-07T00:00:00.000Z",
    };
    const events: ToolEvent[] = [
      {
        id: "1",
        label: "sandbox_run",
        detail: "bun run typecheck",
        status: "done",
      },
    ];
    const completed = completeFactoryRun(historical, {
      events,
      completedAt: "2026-07-07T00:01:00.000Z",
    });
    assert.equal(completed?.completedAt, "2026-07-07T00:01:00.000Z");
    // Stages remain pending — regex cannot mark complete as product truth
    for (const stage of completed?.stages ?? []) {
      assert.equal(stage.status, "pending");
    }
  });

  it("legacy projection helper is explicit and non-authoritative", () => {
    const stages = createInitialFactoryStages("fixture");
    const projected = projectLegacyFactoryStagesFromEvents(stages, [
      {
        id: "1",
        label: "sandbox_run validation run",
        detail: "ok",
        status: "done",
      },
    ]);
    const verification = projected.find((s) => s.id === "verification_result");
    assert.equal(verification?.status, "completed");
    // Document that this is projection only — not used by create/complete write path
    assert.equal(
      createFactoryRun({
        id: "x",
        prompt: "y",
        options: factoryOptions,
        createdAt: "t",
      }),
      undefined,
    );
  });

  it("initial factory stages never mark prompt as completed Spec", () => {
    const stages = createInitialFactoryStages(
      "This prompt must not become a frozen specification",
    );
    assert.ok(!stages.some((s) => s.id === "spec" && s.status === "completed"));
    assert.ok(stages.every((s) => s.status === "pending"));
  });
});
