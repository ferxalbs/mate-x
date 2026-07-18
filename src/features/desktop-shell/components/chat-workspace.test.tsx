import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { ChatWorkspace } from "./chat-workspace";
import type { WorkspaceSummary } from "../../../contracts/workspace";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

afterEach(() => {
  cleanup();
});

describe("ChatWorkspace contextual actions", () => {
  const mockSubmitPrompt = createSpy(async () => {});
  const mockSelectPrompt = createSpy(() => {});
  const mockUndo = createSpy(async () => null);
  const mockOpenRepository = createSpy(async () => {});

  const workspace: WorkspaceSummary = {
    id: "workspace-1",
    name: "mate-x",
    path: "/tmp/mate-x",
    branch: "main",
    status: "ready",
    stack: ["typescript"],
    facts: [],
  };

  beforeEach(() => {
    mockSubmitPrompt.mockClear();
    mockSelectPrompt.mockClear();
    mockUndo.mockClear();
    mockOpenRepository.mockClear();
  });

  it("submits the repository-specific review starter immediately", async () => {
    const view = render(
      <ChatWorkspace
        canUndoLastTurn={false}
        composer={<div />}
        isBootstrapped
        isRunning={false}
        lastError={null}
        messages={[]}
        onSelectPrompt={mockSelectPrompt}
        onOpenRepository={mockOpenRepository}
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={workspace}
      />,
    );

    fireEvent.click(view.getByText("Review current changes"));

    await waitFor(() => assert.equal(mockSubmitPrompt.calls.length, 1));
    assert.match(mockSubmitPrompt.calls[0][0], /Rank concrete risks/);
    assert.equal(mockSubmitPrompt.calls[0][1], undefined);
    assert.equal(mockSelectPrompt.calls.length, 0);
  });

  it("describes the expected evidence for every starter", () => {
    const view = render(
      <ChatWorkspace
        canUndoLastTurn={false}
        composer={<div />}
        isBootstrapped
        isRunning={false}
        lastError={null}
        messages={[]}
        onSelectPrompt={mockSelectPrompt}
        onOpenRepository={mockOpenRepository}
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={workspace}
      />,
    );

    assert.ok(view.getByText("Risk-ranked findings with file evidence"));
    assert.ok(view.getByText("Checks run, results, and remaining risk"));
    assert.ok(view.getByText("Source-to-sink path and trust boundaries"));
    assert.ok(view.getByText("Risk model grounded in repository signals"));
  });

  it("active run disables empty state contextual action buttons", () => {
    const view = render(
      <ChatWorkspace
        canUndoLastTurn={false}
        composer={<div />}
        isBootstrapped
        isRunning
        lastError={null}
        messages={[]}
        onSelectPrompt={mockSelectPrompt}
        onOpenRepository={mockOpenRepository}
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={workspace}
      />,
    );

    assert.equal((view.getByText("Review current changes").closest("button") as HTMLButtonElement).disabled, true);
    assert.equal((view.getByText("Validate a fix").closest("button") as HTMLButtonElement).disabled, true);
  });

  it("shows Open repository instead of a disabled composer without context", async () => {
    const view = render(
      <ChatWorkspace
        canUndoLastTurn={false}
        composer={<div data-testid="composer">Composer</div>}
        isBootstrapped
        isRunning={false}
        lastError={null}
        messages={[]}
        onOpenRepository={mockOpenRepository}
        onSelectPrompt={mockSelectPrompt}
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={null}
      />,
    );

    assert.equal(view.queryByTestId("composer"), null);
    fireEvent.click(view.getByRole("button", { name: "Open repository" }));
    await waitFor(() => assert.equal(mockOpenRepository.calls.length, 1));
  });
});

function createSpy(impl: (...args: any[]) => any) {
  const spy = (...args: any[]) => {
    spy.calls.push(args);
    return spy.impl(...args);
  };
  spy.calls = [] as any[][];
  spy.impl = impl;
  spy.mockClear = () => {
    spy.calls = [];
    spy.impl = impl;
  };
  return spy;
}
