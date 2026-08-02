import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";

import type { ChatMessage, ToolEvent } from "../../../contracts/chat";
import type { ExecutionOutcome } from "../../../contracts/execution";
import { MessageScrollerProvider } from "../../../components/ui/message-scroller";
import { compactConversationSnapshotForPersistence } from "../../../lib/conversation-persistence";
import { MessageStream } from "./message-stream";
import {
  getOutcomeEvidenceRow,
  getTerminalAssistantResponse,
} from "./terminal-outcome-presentation";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

Object.defineProperty(window, "mate", {
  configurable: true,
  value: {
    telemetry: { sendFeedback: async () => ({ accepted: true }) },
    ui: { copyToClipboard: async () => undefined },
  },
});

afterEach(() => {
  cleanup();
});

const terminalEvents: ToolEvent[] = [
  {
    id: "repository-inspection",
    label: "Inspected runtime services",
    detail: "Inspected three runtime services.",
    status: "done",
    type: "read",
    visibility: "public",
    segmentKind: "tool",
    timestamp: "2026-08-02T00:00:00.000Z",
  },
  {
    id: "focused-tests",
    label: "Focused tests passed",
    detail: "Focused repository tests passed.",
    status: "done",
    type: "validation",
    visibility: "public",
    segmentKind: "tool",
    timestamp: "2026-08-02T00:00:42.000Z",
  },
];

function makeOutcome(
  completionKind: ExecutionOutcome["completionKind"],
  options: {
    changedFiles?: string[];
    validationStatus?: ExecutionOutcome["evidence"]["validation"]["status"];
    validationCause?: ExecutionOutcome["evidence"]["validation"]["cause"];
    testEvidenceStatus?: "passed" | "failed" | "not_run";
    objectiveStatus?: "satisfied" | "unsatisfied" | "indeterminate";
    coverage?: "complete" | "partial";
  } = {},
): ExecutionOutcome {
  const changedFiles = options.changedFiles ?? [];
  const objectiveStatus = options.objectiveStatus ?? "satisfied";
  const coverage = options.coverage ?? "complete";
  const validationStatus = options.validationStatus ?? "not_required";
  const terminalState = completionKind === "changed_unverified"
    ? "partial"
    : completionKind === "blocked" || completionKind === "awaiting_approval"
      ? "blocked"
      : "completed";

  return {
    terminalState,
    completionKind,
    summary: "INTERNAL changed_unverified diagnostic summary",
    evidence: {
      completedSteps: [],
      failedSteps: [],
      blockedSteps: [],
      changedFiles: changedFiles.map((path) => ({
        path,
        operation: "modified",
        backupCreated: false,
        impactAnalysis: "full",
      })),
      objective: {
        state: objectiveStatus === "satisfied" ? "satisfied" : "unknown",
        mutationOccurred: changedFiles.length > 0,
        evidenceIds: ["objective-verification-1"],
        verification: {
          id: "objective-verification-1",
          objectiveId: "objective-1",
          objectiveContractHash: "objective-hash",
          requiredScopeHash: "scope-hash",
          runId: "run-1",
          workspaceId: "workspace-1",
          repositorySnapshotId: "snapshot-1",
          repositoryHead: "head-1",
          status: objectiveStatus,
          coverage,
          assertions: [
            {
              id: "forbidden-runtime-call-absent",
              kind: "forbidden_pattern_absent",
              scope: ["semantic:runtime_service"],
              exclusions: [],
              status: objectiveStatus === "satisfied" ? "passed" : "indeterminate",
              matches: [],
              reason: "Runtime calls inspected.",
            },
            {
              id: "replacement-runtime-call-present",
              kind: "required_pattern_present",
              scope: ["semantic:runtime_service"],
              exclusions: [],
              status: objectiveStatus === "satisfied" ? "passed" : "indeterminate",
              matches: [
                { path: "src/services/customer-one.ts" },
                { path: "src/services/customer-two.ts" },
                { path: "src/services/customer-three.ts" },
              ],
              reason: "Replacement calls inspected.",
            },
            {
              id: "legacy-match-allowed-only",
              kind: "allowed_match_only",
              scope: ["semantic:repository_source"],
              exclusions: ["semantic:runtime_service"],
              status: objectiveStatus === "satisfied" ? "passed" : "indeterminate",
              matches: [{ path: "src/sdk/client.ts", line: 8, symbol: "createCustomer" }],
              reason: "Deprecated declaration is allowed.",
            },
          ],
          inspectedFiles: [
            "src/services/customer-one.ts",
            "src/services/customer-two.ts",
            "src/services/customer-three.ts",
            "src/sdk/client.ts",
          ],
          evidenceExecutionIds: ["repository-inspection"],
          createdAt: "2026-08-02T00:00:42.000Z",
        },
      },
      validation: {
        status: validationStatus,
        cause: options.validationCause,
        contract: {
          schemaVersion: 1,
          actualMutation: changedFiles.length > 0,
          objectiveAlreadySatisfied: completionKind === "already_satisfied",
          validationIsPrimaryObjective: false,
          compiledAt: "2026-08-02T00:00:00.000Z",
          source: "canonical_compiler",
          items: [{
            id: "focused-tests",
            signal: "test",
            obligation: "required",
            trigger: "always",
            applicability: "applicable",
            availability: "resolved",
            command: "bun test focused.test.ts",
            commandSource: "repository_script",
            evidence: {
              status: options.testEvidenceStatus ?? "passed",
              executionId: "focused-tests",
            },
            reason: "Requested focused tests.",
          }],
        },
      },
      synthesis: { status: "valid" },
    },
  };
}

function makeMessage(outcome: ExecutionOutcome): ChatMessage {
  return {
    id: "assistant-terminal",
    role: "assistant",
    content: "Provider progress prose with changed_unverified and raw tool diagnostics.",
    createdAt: "2026-08-02T00:00:42.000Z",
    events: terminalEvents,
    executionOutcome: outcome,
  };
}

function stream(message: ChatMessage, isRunning = false) {
  return (
    <MessageStream
      canUndoLastTurn={false}
      isRunning={isRunning}
      messages={[message]}
      onSelectPrompt={() => undefined}
      onSubmitPrompt={() => undefined}
      onUndoLastTurn={async () => null}
    />
  );
}

function shell(content: ReactElement) {
  return (
    <MessageScrollerProvider>
      <ScrollArea.Root>{content}</ScrollArea.Root>
    </MessageScrollerProvider>
  );
}

async function renderStream(message: ChatMessage, isRunning = false) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(shell(stream(message, isRunning)));
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

function getActivityToggle(container: HTMLElement) {
  const toggle = container.querySelector<HTMLButtonElement>(
    'section[aria-label="Agent activity"] > button',
  );
  assert.ok(toggle);
  return toggle;
}

describe("terminal message composition", () => {
  it("renders a natural assistant response outside the compact outcome card", async () => {
    const view = await renderStream(makeMessage(makeOutcome("already_satisfied")));
    const response = view.container.querySelector('[data-slot="assistant-final-response"]');
    const card = view.container.querySelector('[data-slot="agent-outcome-card"]');

    assert.ok(response?.textContent?.includes("The migration was already complete."));
    assert.ok(card?.textContent?.includes("No changes needed"));
    assert.equal(card?.contains(response ?? null), false);
    assert.equal(response?.contains(card ?? null), false);
  });

  it("automatically collapses activity once a running message completes", async () => {
    const runningMessage: ChatMessage = {
      id: "assistant-terminal",
      role: "assistant",
      content: "Inspecting repository.",
      createdAt: "2026-08-02T00:00:00.000Z",
      events: [{ ...terminalEvents[0], status: "active" }],
    };
    const view = await renderStream(runningMessage, true);
    const runningToggle = getActivityToggle(view.container);
    assert.equal(runningToggle.getAttribute("aria-expanded"), "true");

    view.rerender(shell(stream(makeMessage(makeOutcome("already_satisfied")), false)));
    const completedToggle = view.getByRole("button", { name: /Worked for/ });
    await waitFor(() => {
      assert.equal(completedToggle.getAttribute("aria-expanded"), "false");
    });
  });

  it("keeps the complete append-only activity trace expandable", async () => {
    const view = await renderStream(makeMessage(makeOutcome("already_satisfied")));
    const toggle = view.getByRole("button", { name: /Worked for/ });
    assert.equal(view.queryByText("Inspected three runtime services."), null);

    fireEvent.click(toggle);
    fireEvent.click(view.getByRole("button", { name: /Read files.*validated/ }));
    assert.ok(view.getByRole("button", { name: /Inspected runtime services/ }));
    assert.ok(view.getByRole("button", { name: /Focused tests passed/ }));
  });

  it("keeps a terminal evidence summary visible when hydrated activity events are unavailable", async () => {
    const message = makeMessage(makeOutcome("already_satisfied"));
    message.events = [];
    const view = await renderStream(message);

    const toggle = view.getByRole("button", {
      name: /Repository verified · No changes required · Tests passed/,
    });
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  });

  it("preserves manual expansion after completion across terminal hydration updates", async () => {
    const message = makeMessage(makeOutcome("already_satisfied"));
    const view = await renderStream(message);
    const toggle = view.getByRole("button", { name: /Worked for/ });
    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");

    view.rerender(shell(stream({ ...message, artifacts: [] })));
    assert.equal(view.getByRole("button", { name: /Worked for/ }).getAttribute("aria-expanded"), "true");
  });

  it("keeps running and approval-required activity expanded", async () => {
    const runningMessage: ChatMessage = {
      id: "running",
      role: "assistant",
      content: "Running.",
      createdAt: "2026-08-02T00:00:00.000Z",
      events: [{ ...terminalEvents[0], status: "active" }],
    };
    const runningView = await renderStream(runningMessage, true);
    const runningToggle = getActivityToggle(runningView.container);
    assert.equal(runningToggle.getAttribute("aria-expanded"), "true");
    assert.equal(runningToggle.hasAttribute("disabled"), true);
    cleanup();

    const approvalOutcome = makeOutcome("awaiting_approval", {
      objectiveStatus: "indeterminate",
      coverage: "partial",
    });
    const approvalMessage = makeMessage(approvalOutcome);
    approvalMessage.outcome = {
      status: "needs_approval",
      summary: "Approval is required.",
      approvalId: "approval-1",
    };
    const approvalView = await renderStream(approvalMessage);
    const approvalToggle = approvalView.getByRole("button", { name: /Worked for/ });
    assert.equal(approvalToggle.getAttribute("aria-expanded"), "true");
    assert.equal(approvalToggle.hasAttribute("disabled"), true);
  });

  it("keeps the outcome card compact and evidence-backed", async () => {
    const view = await renderStream(makeMessage(makeOutcome("already_satisfied")));
    const card = view.container.querySelector('[data-slot="agent-outcome-card"]');
    assert.ok(card?.textContent?.includes("No changes needed"));
    assert.ok(card?.textContent?.includes("0 files changed · 3 services verified · Tests passed"));
    assert.equal(card?.textContent?.match(/test(?:s)? passed/gi)?.length, 1);
    assert.equal(card?.textContent?.includes("The requested state was already present."), false);
    assert.equal(card?.querySelector("details")?.hasAttribute("open"), false);
  });

  it("restores response, collapsed activity, and card once after persistence hydration", async () => {
    const message = makeMessage(makeOutcome("already_satisfied"));
    const persisted = compactConversationSnapshotForPersistence([{
      id: "thread-1",
      title: "Migration",
      messages: [message],
      lastUpdatedAt: message.createdAt,
    }], "thread-1");
    const view = await renderStream(persisted[0].messages[0]);

    assert.equal(view.getAllByText(/Focused tests passed, so no files were changed\./).length, 1);
    assert.equal(view.getAllByText("No changes needed").length, 1);
    assert.equal(view.getAllByText(/0 files changed · 3 services verified · Tests passed/).length, 1);
    const toggle = view.getByRole("button", { name: /Worked for.*Tests passed/ });
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    fireEvent.click(toggle);
    fireEvent.click(view.getByRole("button", { name: /Read files.*validated/ }));
    assert.ok(view.getByRole("button", { name: /Inspected runtime services/ }));
    assert.ok(view.getByRole("button", { name: /Focused tests passed/ }));
  });
});

describe("terminal assistant response projection", () => {
  it("uses natural no-change wording for already-satisfied work", () => {
    const response = getTerminalAssistantResponse(makeOutcome("already_satisfied"));
    assert.equal(
      response,
      "The migration was already complete. I verified all 3 runtime services and confirmed no obsolete runtime calls remain. The only legacy references are the allowed SDK declarations. Focused tests passed, so no files were changed.",
    );
  });

  it("explains verified changes and passed checks", () => {
    const response = getTerminalAssistantResponse(makeOutcome("changed_verified", {
      changedFiles: [
        "src/services/customer-one.ts",
        "src/services/customer-two.ts",
        "src/services/customer-three.ts",
      ],
      validationStatus: "passed",
    }));
    assert.match(response, /Updated 3 service files/);
    assert.match(response, /no prohibited runtime calls remain/i);
    assert.match(response, /Focused tests passed\./);
  });

  it("explains an unavailable check naturally after changes", () => {
    const response = getTerminalAssistantResponse(makeOutcome("changed_unverified", {
      changedFiles: ["src/services/customer-one.ts"],
      validationStatus: "not_run",
      validationCause: "TYPECHECK_UNAVAILABLE",
    }));
    assert.match(response, /does not define a typecheck command/i);
    assert.match(response, /Review the diff before shipping\./);
  });

  it("never presents missing or failed focused tests as passed", () => {
    for (const testEvidenceStatus of ["not_run", "failed"] as const) {
      const outcome = makeOutcome("already_satisfied", { testEvidenceStatus });
      assert.doesNotMatch(getTerminalAssistantResponse(outcome), /tests passed/i);
      assert.doesNotMatch(getOutcomeEvidenceRow(outcome), /tests passed/i);
    }
  });

  it("never exposes internal enums, diagnostics, or provider progress prose", async () => {
    const outcome = makeOutcome("changed_unverified", {
      changedFiles: ["src/services/customer-one.ts"],
      validationStatus: "not_run",
      validationCause: "VALIDATION_COMMAND_UNRESOLVED",
    });
    const response = getTerminalAssistantResponse(outcome);
    assert.doesNotMatch(response, /changed_unverified|VALIDATION_COMMAND_UNRESOLVED|INTERNAL/);

    const view = await renderStream(makeMessage(outcome));
    const natural = view.container.querySelector('[data-slot="assistant-final-response"]');
    assert.doesNotMatch(natural?.textContent ?? "", /changed_unverified|raw tool diagnostics|Provider progress/);
  });
});
