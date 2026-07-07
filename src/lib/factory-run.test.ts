import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantRunOptions, EvidencePack, ToolEvent } from "../contracts/chat";
import {
  completeFactoryRun,
  createFactoryRun,
  normalizeFactoryRunOptions,
} from "./factory-run";

const factoryOptions: AssistantRunOptions = {
  access: "full",
  mode: "factory",
  reasoning: "high",
  reasoningEnabled: true,
  runbookId: "patch_test_verify",
  serviceTier: "standard",
};

describe("Factory Mode Lite", () => {
  it("creates the Factory mode stages", () => {
    const run = createFactoryRun({
      id: "factory-1",
      prompt: "Fix the failing validation",
      options: factoryOptions,
      createdAt: "2026-07-07T00:00:00.000Z",
    });

    assert.deepEqual(
      run?.stages.map((stage) => stage.label),
      [
        "Spec",
        "Repo context",
        "Risk surfaces",
        "Validation plan",
        "Agent actions",
        "Verification result",
        "Ratchet suggestions",
        "Ship Proof status",
      ],
    );
  });

  it("does not trigger for casual Chat mode", () => {
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

  it("uses approval-required access for Factory mode", () => {
    assert.equal(normalizeFactoryRunOptions(factoryOptions).access, "approval");
  });

  it("uses approval-required access and proof runbook for Ship mode", () => {
    const options = normalizeFactoryRunOptions({
      ...factoryOptions,
      access: "full",
      mode: "ship",
      runbookId: "review_classify_summarize",
    });

    assert.equal(options.access, "approval");
    assert.equal(options.runbookId, "patch_test_verify");
  });

  it("displays missing validation honestly", () => {
    const run = createFactoryRun({
      id: "factory-1",
      prompt: "Fix it",
      options: normalizeFactoryRunOptions(factoryOptions),
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    const completed = completeFactoryRun(run, {
      events: [],
      completedAt: "2026-07-07T00:01:00.000Z",
    });

    const verification = completed?.stages.find((stage) => stage.id === "verification_result");
    assert.equal(verification?.status, "missing");
    assert.match(verification?.summary ?? "", /Missing validation execution/);
  });

  it("does not complete repo context or risk stages without matching evidence", () => {
    const run = createFactoryRun({
      id: "factory-1",
      prompt: "Fix it",
      options: normalizeFactoryRunOptions(factoryOptions),
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    const completed = completeFactoryRun(run, {
      events: [
        { id: "1", label: "read file", detail: "Opened src/app.ts", status: "done" },
      ],
      completedAt: "2026-07-07T00:01:00.000Z",
    });

    assert.equal(completed?.stages.find((stage) => stage.id === "repo_context")?.status, "missing");
    assert.equal(completed?.stages.find((stage) => stage.id === "risk_surfaces")?.status, "missing");
  });

  it("requires approval for ratchet suggestions", () => {
    const run = createFactoryRun({
      id: "factory-1",
      prompt: "Validate",
      options: normalizeFactoryRunOptions(factoryOptions),
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    const events: ToolEvent[] = [
      { id: "1", label: "npm failed", detail: "Detected Bun but npm command was suggested.", status: "error" },
      { id: "2", label: "npm failed", detail: "Detected Bun but npm command was suggested.", status: "error" },
    ];

    const completed = completeFactoryRun(run, {
      events,
      completedAt: "2026-07-07T00:01:00.000Z",
    });

    assert.equal(completed?.ratchetSuggestions[0]?.requiresApproval, true);
    assert.deepEqual(completed?.ratchetSuggestions[0]?.actions, [
      "Add repo rule",
      "Ignore once",
      "Never suggest again",
    ]);
  });

  it("summarizes Ship Proof without inventing validation", () => {
    const run = createFactoryRun({
      id: "factory-1",
      prompt: "Ship",
      options: { ...normalizeFactoryRunOptions(factoryOptions), mode: "ship" },
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    const evidencePack: EvidencePack = {
      status: "partial",
      verdict: { label: "Needs validation", summary: "Missing checks", confidence: "medium" },
      filesModified: [{ path: "src/a.ts" }],
      commandsExecuted: [],
      generatedAt: "2026-07-07T00:01:00.000Z",
    };

    const completed = completeFactoryRun(run, {
      events: [],
      evidencePack,
      completedAt: "2026-07-07T00:01:00.000Z",
    });

    assert.equal(completed?.shipProof?.gitStatus, "blocked");
    assert.deepEqual(completed?.shipProof?.missingEvidence, ["Validation command evidence missing."]);
  });

  it("does not mark fake proof as git-allowed or trusted", () => {
    const run = createFactoryRun({
      id: "factory-1",
      prompt: "Ship",
      options: { ...normalizeFactoryRunOptions(factoryOptions), mode: "ship" },
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    const evidencePack: EvidencePack = {
      status: "complete",
      verdict: { label: "Ready", summary: "Model says ready", confidence: "high" },
      commandsExecuted: [],
      generatedAt: "2026-07-07T00:01:00.000Z",
    };

    const completed = completeFactoryRun(run, {
      events: [],
      evidencePack,
      completedAt: "2026-07-07T00:01:00.000Z",
    });

    assert.equal(completed?.shipProof?.gitStatus, "blocked");
    assert.deepEqual(completed?.shipProof?.missingEvidence, ["Validation command evidence missing."]);
  });
});
