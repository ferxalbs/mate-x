import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "bun:test";
import { act, render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { MessageStream } from "./message-stream";
import { MessageScrollerProvider } from "../../../components/ui/message-scroller";
import type { ChatMessage } from "../../../contracts/chat";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactElement } from "react";

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

/**
 * Base UI ScrollArea schedules layout measurements after mount. Flush them
 * inside act so test runners do not report false-positive act(...) warnings.
 */
async function renderAmbient(ui: ReactElement) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MessageScrollerProvider>
        <ScrollArea.Root>
          {ui}
        </ScrollArea.Root>
      </MessageScrollerProvider>,
    );
    // Allow ScrollArea measurement microtasks / rAF-like updates to settle.
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

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

  it("renders contextual action buttons when ambient safety note is present", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={defaultMessages}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    assert.ok(view.getByText("Run verification"));
    assert.ok(view.getByText("Review changes"));
  });

  it("clicking Run verification submits immediately and preserves mode/intent", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={defaultMessages}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByText("Run verification"));
    });
    await waitFor(() => assert.equal(mockOnSubmit.calls.length, 1));
    assert.match(mockOnSubmit.calls[0][0], /Run verification/);
    assert.deepEqual(mockOnSubmit.calls[0][1], { runbookId: "patch_test_verify", access: "approval" });
    assert.equal(mockOnSelect.calls.length, 0);
  });

  it("clicking Review changes submits immediately and preserves mode/intent", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={defaultMessages}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByText("Review changes"));
    });
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

    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={defaultMessages}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    const button = view.getByText("Run verification") as HTMLButtonElement;
    // Same-tick double click must not start two submits (ref guard).
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => assert.equal(mockOnSubmit.calls.length, 1));
    assert.equal(button.disabled, true);
    await act(async () => {
      resolveSubmit();
    });
  });

  it("buttons are disabled and cursor-not-allowed when isRunning is true", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={defaultMessages}
        isRunning={true}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    const btn1 = view.getByText("Run verification") as HTMLButtonElement;
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
