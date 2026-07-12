/**
 * NES-8.1 / R4 / CLOSURE 2 — Factory write authority is deleted.
 * Regex stage completion is not product truth.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantRunOptions, ToolEvent } from "../contracts/chat";
import type { LegacyFactoryRun } from "../electron/engineering/migration/legacy-factory-types";
import {
  completeFactoryRun,
  createFactoryRun,
  createInitialFactoryStages,
  normalizeFactoryRunOptions,
  projectLegacyFactoryStagesFromEvents,
} from "./factory-run";

const fullOptions: AssistantRunOptions = {
  access: "full",
  pathKind: "full",
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
        options: fullOptions,
        createdAt: "2026-07-07T00:00:00.000Z",
      }),
      undefined,
    );
  });

  it("does not create runs for chat_help either", () => {
    assert.equal(
      createFactoryRun({
        id: "factory-1",
        prompt: "hello",
        options: { ...fullOptions, pathKind: "chat_help", access: "approval" },
        createdAt: "2026-07-07T00:00:00.000Z",
      }),
      undefined,
    );
  });

  it("normalizes residual legacy mode fields away from write path", () => {
    const factory = normalizeFactoryRunOptions({
      ...fullOptions,
      mode: "factory",
    } as AssistantRunOptions & { mode: string });
    assert.equal(factory.access, "approval");
    assert.equal(factory.pathKind, "full");
    assert.equal("mode" in factory, false);

    const ship = normalizeFactoryRunOptions({
      ...fullOptions,
      access: "full",
      mode: "ship",
      runbookId: "review_classify_summarize",
    } as AssistantRunOptions & { mode: string });
    assert.equal(ship.access, "approval");
    assert.equal(ship.pathKind, "verify_only");
    assert.equal(ship.runbookId, "patch_test_verify");
  });

  it("completeFactoryRun does not advance stages via regex authority", () => {
    const historical: LegacyFactoryRun = {
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
    assert.equal(
      createFactoryRun({
        id: "x",
        prompt: "y",
        options: fullOptions,
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
