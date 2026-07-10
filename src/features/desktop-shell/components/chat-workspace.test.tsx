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
  });

  it("empty state Review code and suggest changes submits immediately instead of only populating input", async () => {
    const view = render(
      <ChatWorkspace
        canUndoLastTurn={false}
        composer={<div />}
        isBootstrapped
        isRunning={false}
        lastError={null}
        messages={[]}
        onSelectPrompt={mockSelectPrompt}
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={workspace}
      />,
    );

    fireEvent.click(view.getByText("Review code and suggest changes"));

    await waitFor(() => assert.equal(mockSubmitPrompt.calls.length, 1));
    assert.match(mockSubmitPrompt.calls[0][0], /Review the recent changes/);
    assert.equal(mockSubmitPrompt.calls[0][1], undefined);
    assert.equal(mockSelectPrompt.calls.length, 0);
  });

  it("empty state Review changes submits with review intent", async () => {
    const view = render(
      <ChatWorkspace
        canUndoLastTurn={false}
        composer={<div />}
        isBootstrapped
        isRunning={false}
        lastError={null}
        messages={[]}
        onSelectPrompt={mockSelectPrompt}
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={workspace}
      />,
    );

    fireEvent.click(view.getByText("Review code and suggest changes"));

    await waitFor(() => assert.equal(mockSubmitPrompt.calls.length, 1));
    assert.match(mockSubmitPrompt.calls[0][0], /Review the recent changes/);
    assert.equal(mockSubmitPrompt.calls[0][1], undefined);
    assert.equal(mockSelectPrompt.calls.length, 0);
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
        onSubmitPrompt={mockSubmitPrompt}
        onUndoLastTurn={mockUndo}
        workspace={workspace}
      />,
    );

    assert.equal((view.getByText("Review code and suggest changes").closest("button") as HTMLButtonElement).disabled, true);
    assert.equal((view.getByText("Review code and suggest changes").closest("button") as HTMLButtonElement).disabled, true);
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
