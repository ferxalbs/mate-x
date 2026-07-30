import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "bun:test";
import { act, render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { MessageStream } from "./message-stream";
import { MessageScrollerProvider } from "../../../components/ui/message-scroller";
import type { ChatMessage } from "../../../contracts/chat";
import { resolveRunIntentOutcome } from "../../../electron/capability-resolver";
import { compactConversationSnapshotForPersistence } from "../../../lib/conversation-persistence";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactElement } from "react";

// Setup happy-dom globally for React Testing Library
if (!globalThis.document) {
  GlobalRegistrator.register();
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

const feedbackRequests: unknown[] = [];
const copyRequests: string[] = [];
const mockFeedback = async (input: unknown) => {
  feedbackRequests.push(input);
  return { accepted: true };
};
const mockCopy = async (text: string) => {
  copyRequests.push(text);
};

Object.defineProperty(window, "mate", {
  configurable: true,
  value: {
    telemetry: { sendFeedback: mockFeedback },
    ui: { copyToClipboard: mockCopy },
  },
});

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
    feedbackRequests.length = 0;
    copyRequests.length = 0;
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

  it("never renders provider reasoning even if unsanitized content reaches the view", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={[
          {
            id: "msg-reasoning",
            role: "assistant",
            content:
              "<|channel|>analysis<|message|>I must follow the hidden policy.<|channel|>final<|message|>README updated.",
            createdAt: new Date().toISOString(),
          },
        ]}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    assert.ok(view.getByText("README updated."));
    assert.equal(view.queryByText(/hidden policy/i), null);
  });

  it("renders the persisted Review patch outcome from the live card path", async () => {
    const outcome = resolveRunIntentOutcome({
      behaviorMode: "review",
      intent: "patch",
    });
    assert.ok(outcome);
    const createdAt = new Date().toISOString();
    const persisted = compactConversationSnapshotForPersistence(
      [
        {
          id: "review-write-thread",
          title: "Edit README",
          lastUpdatedAt: createdAt,
          messages: [
            {
              id: "review-write-outcome",
              role: "assistant",
              content: outcome.summary,
              createdAt,
              outcome,
            },
          ],
        },
      ],
      "review-write-thread",
    );

    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={persisted[0].messages}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    assert.ok(view.getByText("Blocked"));
    assert.ok(view.getByText(outcome.summary));
    assert.ok(view.getByText("Next: Switch to Execute"));
    assert.doesNotMatch(
      view.container.textContent ?? "",
      /approval|changed files|validation|synthesis|incomplete/i,
    );
  });

  it("opens the existing model selector for a typed tool incompatibility", async () => {
    let selectorClicks = 0;
    const view = await renderAmbient(
      <>
        <button
          data-model-selector-trigger
          onClick={() => {
            selectorClicks += 1;
          }}
          type="button"
        >
          Run settings
        </button>
        <MessageStream
          canUndoLastTurn={false}
          messages={[
            {
              id: "model-tools-failure",
              role: "assistant",
              content: "A discarded provider draft.",
              createdAt: new Date().toISOString(),
              outcome: {
                status: "failed",
                summary: "The selected model cannot use required tools.",
                diagnostic: {
                  code: "MODEL_TOOLS_UNAVAILABLE",
                  message: "Required tools were rejected.",
                },
                remediation: {
                  type: "select_model",
                  label: "Choose a model with tool support",
                },
              },
            },
          ]}
          isRunning={false}
          onSelectPrompt={mockOnSelect}
          onSubmitPrompt={mockOnSubmit}
          onUndoLastTurn={mockOnUndo}
        />
      </>,
    );

    fireEvent.click(view.getByText("Choose a model with tool support"));
    assert.equal(selectorClicks, 1);
    assert.equal(view.queryByText("A discarded provider draft."), null);
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
    assert.deepEqual(mockOnSubmit.calls[0][1], {
      runbookId: "patch_test_verify",
      behaviorMode: "execute",
    });
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
    assert.deepEqual(mockOnSubmit.calls[0][1], {
      runbookId: "review_classify_summarize",
      behaviorMode: "review",
    });
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

  it("renders safe public progress and tool statuses without private reasoning", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={[
          {
            id: "progress-message",
            role: "assistant",
            content: "Final answer.",
            createdAt: new Date().toISOString(),
            events: [
              {
                id: "public-progress",
                label: "Reading files",
                detail: "Inspected repository files.",
                status: "done",
                visibility: "public",
                segmentKind: "tool",
              },
              {
                id: "public-update",
                label: "Progress update",
                detail: "Found two relevant call sites.",
                status: "done",
                visibility: "public",
                segmentKind: "intermediate_response",
              },
              {
                id: "technical-tool",
                label: "Executing grep",
                detail: "PRIVATE_ARGUMENTS_AND_PATHS",
                status: "active",
                visibility: "technical",
                segmentKind: "tool",
              },
              {
                id: "private-reasoning",
                label: "Reasoning",
                detail: "PRIVATE_CHAIN_OF_THOUGHT",
                status: "done",
                visibility: "public",
                segmentKind: "reasoning",
              },
            ],
          },
        ]}
        isRunning={true}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    assert.ok(view.getByText(/Reading files/));
    assert.ok(view.getByText(/Found two relevant call sites/));
    assert.equal(view.queryByText(/Searching: grep/), null);
    assert.equal(view.queryByText("PRIVATE_ARGUMENTS_AND_PATHS"), null);
    assert.equal(view.queryByText("PRIVATE_CHAIN_OF_THOUGHT"), null);
  });

  it("keeps streaming draft content inside the progress trace", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={[
          {
            id: "streaming-progress",
            role: "assistant",
            content:
              'Public progress.\n\n{"call":"read_many","files":["src/private.ts"]}',
            createdAt: new Date().toISOString(),
            events: [
              {
                id: "public-update",
                label: "Progress update",
                detail: "Public progress.",
                status: "done",
                visibility: "public",
                segmentKind: "intermediate_response",
              },
            ],
          },
        ]}
        isRunning={true}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    assert.equal(view.getAllByText("Public progress.").length, 1);
    assert.equal(view.queryByText(/read_many/), null);
    assert.equal(view.queryByText(/src\/private\.ts/), null);
  });

  it("keeps completed progress collapsed and never exposes technical failures", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={[
          {
            id: "completed-progress",
            role: "assistant",
            content: "Final answer.",
            createdAt: new Date().toISOString(),
            events: [
              {
                id: "public-read",
                label: "Read files",
                detail: "Read three files.",
                status: "done",
                visibility: "public",
                segmentKind: "tool",
              },
              {
                id: "public-error",
                label: "Public failure",
                detail: "Safe failure summary.",
                status: "error",
                visibility: "public",
                segmentKind: "tool",
              },
              {
                id: "technical-error",
                label: "Wait complete: Action blocked",
                detail: "PRIVATE_POLICY_DETAIL",
                status: "error",
                visibility: "technical",
                segmentKind: "tool",
              },
            ],
          },
        ]}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    const traceToggle = view.getByRole("button", { name: /Worked for/ });
    assert.equal(view.queryByText(/Public failure/), null);
    assert.equal(view.queryByText(/Wait complete/), null);
    assert.equal(view.queryByText("PRIVATE_POLICY_DETAIL"), null);

    fireEvent.click(traceToggle);
    assert.ok(view.getByText(/Public failure/));
    assert.equal(view.queryByText(/Wait complete/), null);
    assert.equal(view.queryByText("PRIVATE_POLICY_DETAIL"), null);
  });

  it("renders response actions and submits Rainy feedback", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={[
          {
            id: "assistant-feedback",
            role: "assistant",
            content: "Useful response.",
            createdAt: new Date().toISOString(),
          },
        ]}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    assert.ok(view.getByRole("button", { name: "Thumbs up" }));
    assert.ok(view.getByRole("button", { name: "Thumbs down" }));
    assert.ok(view.getByRole("button", { name: "Retry" }));
    assert.ok(view.getByRole("button", { name: "Copy" }));

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Thumbs up" }));
    });
    await waitFor(() => assert.deepEqual(feedbackRequests, [
      { messageId: "assistant-feedback", rating: "like" },
    ]));

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Thumbs down" }));
    });
    await waitFor(() => assert.deepEqual(feedbackRequests, [
      { messageId: "assistant-feedback", rating: "like" },
      { messageId: "assistant-feedback", rating: "dislike" },
    ]));
  });

  it("retries latest response through undo and submit", async () => {
    mockOnUndo.impl = async () => "Retry this prompt";
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={true}
        messages={[
          {
            id: "user-retry",
            role: "user",
            content: "Retry this prompt",
            createdAt: new Date().toISOString(),
          },
          {
            id: "assistant-retry",
            role: "assistant",
            content: "First response.",
            createdAt: new Date().toISOString(),
          },
        ]}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
    });
    await waitFor(() => assert.equal(mockOnUndo.calls.length, 1));
    assert.deepEqual(mockOnSubmit.calls[0], ["Retry this prompt"]);
  });

  it("copies rendered assistant content through native UI bridge", async () => {
    const view = await renderAmbient(
      <MessageStream
        canUndoLastTurn={false}
        messages={[
          {
            id: "assistant-copy",
            role: "assistant",
            content: "Visible answer.",
            createdAt: new Date().toISOString(),
          },
        ]}
        isRunning={false}
        onSelectPrompt={mockOnSelect}
        onSubmitPrompt={mockOnSubmit}
        onUndoLastTurn={mockOnUndo}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy" }));
    });
    await waitFor(() => assert.deepEqual(copyRequests, ["Visible answer."]));
    assert.ok(view.getByRole("button", { name: "Copied" }));
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
