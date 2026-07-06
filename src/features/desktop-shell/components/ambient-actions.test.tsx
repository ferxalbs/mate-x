import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "bun:test";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { MessageStream } from "./message-stream";
import { MessageScrollerProvider } from "../../../components/ui/message-scroller";
import type { ChatMessage } from "../../../contracts/chat";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Setup happy-dom globally for React Testing Library
if (!globalThis.document) {
  GlobalRegistrator.register();
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

afterEach(() => {
  cleanup();
});

describe("Ambient Safety Actions in MessageStream", () => {
  const mockOnSelect = createSpy(() => {});
  const mockOnSubmit = createSpy(async () => {});
  const mockOnUndo = createSpy(async () => null);

  beforeEach(() => {
    mockOnSelect.mockClear();
    mockOnSubmit.mockClear();
    mockOnUndo.mockClear();
  });

  const defaultMessages: ChatMessage[] = [
    {
      id: "msg-1",
      role: "assistant",
      content: "Hello! Repo note: changes need a safety check before commit.",
      createdAt: new Date().toISOString(),
    }
  ];

  it("renders contextual action buttons when ambient safety note is present", () => {
    const view = render(
      <MessageScrollerProvider>
        <ScrollArea.Root>
          <MessageStream
            canUndoLastTurn={false}
            messages={defaultMessages}
            isRunning={false}
            onSelectPrompt={mockOnSelect}
            onSubmitPrompt={mockOnSubmit}
            onUndoLastTurn={mockOnUndo}
          />
        </ScrollArea.Root>
      </MessageScrollerProvider>
    );

    assert.ok(view.getByText("Run safety check"));
    assert.ok(view.getByText("Review changes"));
  });

  it("clicking Run safety check submits immediately and preserves mode/intent", async () => {
    const view = render(
      <MessageScrollerProvider>
        <ScrollArea.Root>
          <MessageStream
            canUndoLastTurn={false}
            messages={defaultMessages}
            isRunning={false}
            onSelectPrompt={mockOnSelect}
            onSubmitPrompt={mockOnSubmit}
            onUndoLastTurn={mockOnUndo}
          />
        </ScrollArea.Root>
      </MessageScrollerProvider>
    );

    fireEvent.click(view.getByText("Run safety check"));
    await waitFor(() => assert.equal(mockOnSubmit.calls.length, 1));
    assert.match(mockOnSubmit.calls[0][0], /smallest useful safety check/);
    assert.deepEqual(mockOnSubmit.calls[0][1], { runbookId: "scan_contain_report" });
    assert.equal(mockOnSelect.calls.length, 0);
  });

  it("clicking Review changes submits immediately and preserves mode/intent", async () => {
    const view = render(
      <MessageScrollerProvider>
        <ScrollArea.Root>
          <MessageStream
            canUndoLastTurn={false}
            messages={defaultMessages}
            isRunning={false}
            onSelectPrompt={mockOnSelect}
            onSubmitPrompt={mockOnSubmit}
            onUndoLastTurn={mockOnUndo}
          />
        </ScrollArea.Root>
      </MessageScrollerProvider>
    );

    fireEvent.click(view.getByText("Review changes"));
    await waitFor(() => assert.equal(mockOnSubmit.calls.length, 1));
    assert.match(mockOnSubmit.calls[0][0], /Explain the current changes/);
    assert.deepEqual(mockOnSubmit.calls[0][1], { runbookId: "review_classify_summarize" });
    assert.equal(mockOnSelect.calls.length, 0);
  });

  it("double click does not create duplicate runs", async () => {
    let resolveSubmit!: () => void;
    mockOnSubmit.impl =
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        });

    const view = render(
      <MessageScrollerProvider>
        <ScrollArea.Root>
          <MessageStream
            canUndoLastTurn={false}
            messages={defaultMessages}
            isRunning={false}
            onSelectPrompt={mockOnSelect}
            onSubmitPrompt={mockOnSubmit}
            onUndoLastTurn={mockOnUndo}
          />
        </ScrollArea.Root>
      </MessageScrollerProvider>
    );

    const button = view.getByText("Run safety check") as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => assert.equal(mockOnSubmit.calls.length, 1));
    assert.equal(button.disabled, true);
    resolveSubmit();
  });

  it("buttons are disabled and cursor-not-allowed when isRunning is true", () => {
    const view = render(
      <MessageScrollerProvider>
        <ScrollArea.Root>
          <MessageStream
            canUndoLastTurn={false}
            messages={defaultMessages}
            isRunning={true}
            onSelectPrompt={mockOnSelect}
            onSubmitPrompt={mockOnSubmit}
            onUndoLastTurn={mockOnUndo}
          />
        </ScrollArea.Root>
      </MessageScrollerProvider>
    );

    const btn1 = view.getByText("Run safety check") as HTMLButtonElement;
    const btn2 = view.getByText("Review changes") as HTMLButtonElement;
    assert.equal(btn1.disabled, true);
    assert.equal(btn2.disabled, true);
    
    // Attempting to click disabled buttons doesn't trigger events
    fireEvent.click(btn1);
    assert.equal(mockOnSubmit.calls.length, 0);
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
