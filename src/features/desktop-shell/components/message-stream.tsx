import { HugeiconsIcon } from "@hugeicons/react";
import {
  ReloadIcon,
  CheckIcon,
  CopyIcon,
  File01Icon,
  Loading02Icon,
  Alert01Icon,
  ThumbsUpIcon,
  ThumbsDownIcon,
} from "@hugeicons/core-free-icons";

import {
  memo,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  AgentOutcome,
  AssistantRunOptions,
  ChatMessage,
} from "../../../contracts/chat";
import type { ExecutionOutcome } from "../../../contracts/execution";
import type { TelemetryFeedbackRating } from "../../../contracts/telemetry";
import { sanitizeAssistantOutput } from "../../../lib/assistant-output";
import { formatTimestamp } from "../../../lib/time";
import { cn } from "../../../lib/utils";
import {
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
} from "../../../components/ui/message-scroller";
import { ChatMarkdown } from "./chat-markdown";
import { useChatStore } from "../../../store/chat-store";
import {
  ambientSafetyActions,
  type AmbientSafetyAction,
} from "./ambient-safety-actions";
import { AgentExecutionTrace } from "./agent-execution-trace";

interface MessageStreamProps {
  canUndoLastTurn: boolean;
  messages: ChatMessage[];
  isRunning: boolean;
  onSelectPrompt: (prompt: string) => void;
  onSubmitPrompt?: (
    prompt: string,
    overrides?: Partial<AssistantRunOptions>,
  ) => Promise<void> | void;
  onUndoLastTurn: () => Promise<string | null>;
}

export function MessageStream({
  canUndoLastTurn,
  messages,
  isRunning,
  onSelectPrompt,
  onSubmitPrompt,
  onUndoLastTurn,
}: MessageStreamProps) {
  const settings = useChatStore((state) => state.settings);
  const hasStreamingAssistantMessage =
    isRunning && messages.at(-1)?.role === "assistant";

  return (
    <MessageScrollerViewport
      className={cn(
        // Bottom inset tracks actual composer dock height (see ComposerDock CSS var).
        // Never couple scroll padding to blurEnabled — founder incident fix.
        "px-4 pt-6 sm:px-6 lg:px-9 pb-[var(--mate-composer-inset,148px)]",
      )}
    >
      <MessageScrollerContent
        className={cn(
          "mx-auto flex min-w-0 w-full max-w-full flex-col overflow-x-hidden",
          settings.compactMode && messages.length > 0
            ? "max-w-[680px]"
            : "max-w-[820px]",
        )}
      >
        {messages.map((message, index) => (
          <MessageScrollerItem key={message.id}>
            <MessageEntry
              canUndo={
                canUndoLastTurn &&
                message.role === "user" &&
                index === messages.length - 1
              }
              isStreaming={
                isRunning &&
                index === messages.length - 1 &&
                message.role === "assistant"
              }
              isLast={index === messages.length - 1}
              isRunning={isRunning}
              message={message}
              onSelectPrompt={onSelectPrompt}
              onSubmitPrompt={onSubmitPrompt}
              onUndo={onUndoLastTurn}
              retryPrompt={
                message.role === "assistant"
                  ? [...messages.slice(0, index)]
                      .reverse()
                      .find((candidate) => candidate.role === "user")?.content
                  : undefined
              }
            />
          </MessageScrollerItem>
        ))}

        {isRunning && !hasStreamingAssistantMessage ? (
          <MessageScrollerItem>
            <ThinkingRow />
          </MessageScrollerItem>
        ) : null}
      </MessageScrollerContent>
    </MessageScrollerViewport>
  );
}

const MessageEntry = memo(function MessageEntry({
  message,
  isStreaming,
  isLast,
  isRunning,
  canUndo,
  onSelectPrompt,
  onSubmitPrompt,
  onUndo,
  retryPrompt,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
  isRunning: boolean;
  canUndo: boolean;
  onSelectPrompt: (prompt: string) => void;
  onSubmitPrompt?: (
    prompt: string,
    overrides?: Partial<AssistantRunOptions>,
  ) => Promise<void> | void;
  onUndo: () => Promise<string | null>;
  retryPrompt?: string;
}) {
  const isUser = message.role === "user";
  const deferredContent = useDeferredValue(message.content);
  const events = message.events ?? [];
  const hasTimeline = events.length > 0;
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TelemetryFeedbackRating | null>(null);
  const [pendingFeedback, setPendingFeedback] = useState<TelemetryFeedbackRating | null>(null);
  // Synchronous guard so double-clicks in the same tick cannot start two submits
  // before React re-renders with pendingAction set.
  const ambientActionInFlightRef = useRef(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await window.mate.ui.copyToClipboard(
        isUser ? message.content : stripTraceTransportMarkers(message.content),
      );
      setCopied(true);
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopied(false);
      }, 1200);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }

  async function handleRetry() {
    if (
      !retryPrompt ||
      isRunning ||
      ambientActionInFlightRef.current ||
      pendingAction !== null
    ) {
      return;
    }

    ambientActionInFlightRef.current = true;
    setPendingAction("retry");
    try {
      const prompt = isLast ? await onUndo() : retryPrompt;
      if (!prompt) return;
      if (onSubmitPrompt) {
        await onSubmitPrompt(prompt);
      } else {
        onSelectPrompt(prompt);
      }
    } catch (error) {
      console.error("Failed to retry response:", error);
    } finally {
      ambientActionInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  async function handleFeedback(rating: TelemetryFeedbackRating) {
    if (pendingFeedback || feedback === rating) return;

    setPendingFeedback(rating);
    try {
      const result = await window.mate.telemetry.sendFeedback({
        messageId: message.id,
        rating,
      });
      if (result.accepted) setFeedback(rating);
    } catch (error) {
      console.error("Failed to send response feedback:", error);
    } finally {
      setPendingFeedback(null);
    }
  }

  if (isUser) {
    const settings = useChatStore.getState().settings;
    return (
      <article
        className={cn(
          "group ml-auto flex w-full flex-col items-end gap-1.5",
          settings.compactMode ? "max-w-[540px]" : "max-w-[680px]",
        )}
      >
        <div className="rounded-[20px] border border-border/65 bg-[var(--mate-surface-bg)] px-4 py-3 text-left shadow-none backdrop-blur-xl">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
            {message.content}
          </p>
        </div>
        <div className="flex items-center justify-end gap-1.5 pr-2 opacity-0 transition-opacity duration-[var(--motion-press)] ease-[var(--ease-out)] group-hover:opacity-100">
          <p className="text-[11px] text-muted-foreground/60">
            {formatTimestamp(message.createdAt)}
          </p>
          <MessageActionButton
            ariaLabel={copied ? "Copied message" : "Copy message"}
            icon={
              copied ? (
                <HugeiconsIcon icon={CheckIcon} className="size-3.5" />
              ) : (
                <HugeiconsIcon icon={CopyIcon} className="size-3.5" />
              )
            }
            onClick={() => void handleCopy()}
          />
          {canUndo ? (
            <MessageActionButton
              ariaLabel="Undo last turn"
              icon={<HugeiconsIcon icon={ReloadIcon} className="size-4" />}
              onClick={() => void onUndo()}
            />
          ) : null}
        </div>
      </article>
    );
  }

  const normalizedContent = deferredContent.trim();
  const showAmbientActions = normalizedContent.includes(
    "Repo note: changes need a safety check before commit.",
  );
  const actionDisabled =
    isRunning || pendingAction !== null || ambientActionInFlightRef.current;

  async function submitAmbientAction(action: AmbientSafetyAction) {
    if (isRunning || ambientActionInFlightRef.current || pendingAction !== null) {
      return;
    }

    ambientActionInFlightRef.current = true;
    setPendingAction(action.id);
    try {
      if (onSubmitPrompt) {
        await onSubmitPrompt(action.prompt, action.overrides);
      } else {
        onSelectPrompt(action.prompt);
      }
    } finally {
      ambientActionInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  return (
    <article className="group min-w-0 max-w-full pl-6">
      <div className="min-w-0 max-w-full space-y-4 overflow-hidden text-[14px] leading-6 text-foreground">
        <AgentExecutionTrace
          events={events}
          isRunning={isStreaming}
          validationState={
            message.executionOutcome?.validationState ??
            message.executionOutcome?.evidence.validation.status ??
            message.evidencePack?.executionOutcome?.evidence.validation.status ??
            message.evidencePack?.executionOutcome?.validationState
          }
          completionKind={message.executionOutcome?.completionKind ?? message.evidencePack?.executionOutcome?.completionKind}
        />
        {message.executionOutcome ? (
          <ExecutionOutcomeCard
            onConfigureTypecheck={() => onSelectPrompt("Configure a repository-local typecheck command for this workspace.")}
            outcome={message.executionOutcome}
          />
        ) : message.outcome &&
        (message.outcome.status === "blocked" ||
          message.outcome.status === "needs_approval" ||
          message.outcome.status === "failed") ? (
          <AgentOutcomeCard outcome={message.outcome} />
        ) : normalizedContent.length > 0 && (!isStreaming || !hasTimeline) ? (
          <ChatMarkdown
            content={stripTraceTransportMarkers(message.content)}
            isStreaming={isStreaming}
          />
        ) : !hasTimeline && !isStreaming ? <ResultFallback /> : null}
        {isLast && showAmbientActions ? (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:text-foreground active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
              disabled={actionDisabled}
              onClick={() =>
                void submitAmbientAction(ambientSafetyActions.runSafetyCheck)
              }
              type="button"
            >
              {pendingAction === ambientSafetyActions.runSafetyCheck.id
                ? "Starting..."
                : ambientSafetyActions.runSafetyCheck.label}
            </button>
            <button
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:text-foreground active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
              disabled={actionDisabled}
              onClick={() =>
                void submitAmbientAction(ambientSafetyActions.reviewChanges)
              }
              type="button"
            >
              {pendingAction === ambientSafetyActions.reviewChanges.id
                ? "Starting..."
                : ambientSafetyActions.reviewChanges.label}
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <p className="mate-text-secondary">
          {formatTimestamp(message.createdAt)}
        </p>
        {normalizedContent.length > 0 && !isStreaming ? (
          <ResponseActions
            copied={copied}
            feedback={feedback}
            onCopy={() => void handleCopy()}
            onFeedback={(rating) => void handleFeedback(rating)}
            onRetry={() => void handleRetry()}
            pendingFeedback={pendingFeedback}
            retryDisabled={
              isRunning || pendingAction !== null || !retryPrompt
            }
          />
        ) : null}
      </div>
    </article>
  );
});

function stripTraceTransportMarkers(value: string) {
  return sanitizeAssistantOutput(value);
}

function ResponseActions({
  copied,
  feedback,
  onCopy,
  onFeedback,
  onRetry,
  pendingFeedback,
  retryDisabled,
}: {
  copied: boolean;
  feedback: TelemetryFeedbackRating | null;
  onCopy: () => void;
  onFeedback: (rating: TelemetryFeedbackRating) => void;
  onRetry: () => void;
  pendingFeedback: TelemetryFeedbackRating | null;
  retryDisabled: boolean;
}) {
  const buttonClass =
    "inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground/70 transition-[background-color,color,opacity,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:bg-accent hover:text-foreground active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 motion-reduce:transform-none";

  return (
    <div className="flex items-center gap-0.5" aria-label="Response actions">
      {(["like", "dislike"] as const).map((rating) => {
        const selected = feedback === rating;
        const pending = pendingFeedback === rating;
        return (
          <button
            aria-label={rating === "like" ? "Thumbs up" : "Thumbs down"}
            aria-pressed={selected}
            className={cn(buttonClass, selected && "bg-accent text-foreground")}
            disabled={pendingFeedback !== null}
            key={rating}
            onClick={() => onFeedback(rating)}
            title={rating === "like" ? "Thumbs up" : "Thumbs down"}
            type="button"
          >
            <HugeiconsIcon
              icon={
                rating === "like" ? ThumbsUpIcon : ThumbsDownIcon
              }
              className={cn("size-3.5", pending && "animate-pulse")}
            />
          </button>
        );
      })}
      <button
        aria-label="Retry"
        className={buttonClass}
        disabled={retryDisabled}
        onClick={onRetry}
        title="Retry"
        type="button"
      >
        <HugeiconsIcon icon={ReloadIcon} className="size-3.5" />
      </button>
      <button
        aria-label={copied ? "Copied" : "Copy"}
        className={buttonClass}
        onClick={onCopy}
        title="Copy"
        type="button"
      >
        <HugeiconsIcon
          icon={copied ? CheckIcon : CopyIcon}
          className="size-3.5"
        />
      </button>
    </div>
  );
}

function ResultFallback() {
  return (
    <section className="rounded-2xl border border-border/65 bg-[var(--mate-surface-bg)] p-3.5 backdrop-blur-xl">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/85">
        <HugeiconsIcon icon={File01Icon} className="size-3.5" />
        Result
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        No final synthesis text was returned for this run. The audit timeline
        above has the full execution trace.
      </p>
    </section>
  );
}

function ExecutionOutcomeCard({
  onConfigureTypecheck,
  outcome,
}: {
  onConfigureTypecheck: () => void;
  outcome: ExecutionOutcome;
}) {
  const presentation = getExecutionOutcomePresentation(outcome);
  const changedFiles = outcome.files ?? outcome.evidence.changedFiles.map((file) => ({
    path: file.path,
    operation: file.operation,
    verification: "verified" as const,
  }));

  return (
    <section className="rounded-2xl border border-border/70 bg-[var(--mate-surface-bg)] p-3.5 shadow-none">
      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
        <HugeiconsIcon icon={presentation.icon} className={cn("size-4", presentation.iconClassName)} />
        {presentation.title}
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
        {presentation.summary}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">{presentation.statusRow}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {changedFiles.length > 0 ? <span className="rounded-xl border border-border/70 px-3 py-1.5 text-[11px] font-medium">Review changes</span> : null}
        {presentation.canConfigureTypecheck ? (
          <button className="rounded-xl border border-border/70 px-3 py-1.5 text-[11px] font-medium hover:bg-accent" onClick={onConfigureTypecheck} type="button">Configure typecheck</button>
        ) : null}
      </div>
      <details className="mt-2.5 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground/80">Details</summary>
        {changedFiles.length > 0 ? <ul className="mt-2 space-y-1">{changedFiles.map((file) => <li className="flex gap-3" key={`${file.path}:${file.operation}`}><span className="min-w-0 flex-1 break-all">{file.path}</span><span>{fileOperationLabel(file.operation)}</span></li>)}</ul> : null}
        <p className="mt-2">Checks: {presentation.checksDetail}</p>
        {presentation.validationCause ? <p className="mt-1">Unavailable: {presentation.validationCause}</p> : null}
      </details>
      <details className="mt-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground/80">Advanced</summary>
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt>Canonical outcome</dt><dd>{outcome.terminalState}</dd>
          <dt>Workspace</dt><dd>{outcome.worktreeHealth ?? "unchanged"}</dd>
          <dt>Validation</dt><dd>{outcome.validationState ?? outcome.evidence.validation.status}</dd>
          <dt>Completion</dt><dd>{outcome.completionKind ?? "unknown"}</dd>
          <dt>Evidence IDs</dt><dd>{outcome.evidence.validation.executionIds?.join(", ") || outcome.evidence.objective?.evidenceIds.join(", ") || "None"}</dd>
          {outcome.primaryCause ? <><dt>Cause</dt><dd>{outcome.primaryCause.summary}</dd></> : null}
        </dl>
      </details>
    </section>
  );
}

export function getExecutionOutcomePresentation(outcome: ExecutionOutcome) {
  const unavailableTypecheck =
    outcome.completionKind === "changed_unverified" &&
    outcome.evidence.validation.cause === "TYPECHECK_UNAVAILABLE";
  const title = outcome.completionKind === "changed_verified" || outcome.completionKind === "changed_unverified"
      ? "Changes applied"
      : outcome.completionKind === "already_satisfied"
        ? "No changes needed"
        : outcome.completionKind === "inspection_completed"
          ? "Review complete"
          : outcome.completionKind === "validation_completed"
            ? "Checks completed"
            : outcome.completionKind === "awaiting_approval"
              ? "Approval required"
        : outcome.terminalState === "blocked"
          ? "Couldn’t continue"
          : outcome.terminalState === "cancelled"
            ? "Cancelled"
            : outcome.terminalState === "failed"
              ? "Task failed"
              : "Changes applied";
  const changedCount = (outcome.files ?? outcome.evidence.changedFiles).length;
  const passedChecks = outcome.evidence.validation.contract?.items.filter(
    (item) => item.evidence?.status === "passed",
  ) ?? [];
  const unavailableCount = outcome.evidence.validation.status === "not_run" ? 1 : 0;
  const statusRow = [
    changedCount > 0 ? `${changedCount} ${changedCount === 1 ? "file" : "files"} modified` : null,
    passedChecks.length > 0 || outcome.evidence.validation.status === "passed" ? "Tests passed" : null,
    unavailableCount > 0 ? `${unavailableCount} check unavailable` : null,
  ].filter(Boolean).join(" · ");
  return {
    title,
    summary: buildPrimaryOutcomeSummary(outcome, changedCount, passedChecks.length > 0),
    statusRow,
    checksDetail: passedChecks.length > 0 ? passedChecks.map((item) => `${item.signal} passed`).join(", ") : outcome.evidence.validation.status.replaceAll("_", " "),
    validationCause: unavailableTypecheck ? "This repository does not define a typecheck command." : outcome.evidence.validation.summary,
    canConfigureTypecheck: unavailableTypecheck,
    icon: outcome.terminalState === "failed" || outcome.terminalState === "blocked" ? Alert01Icon : CheckIcon,
    iconClassName: outcome.terminalState === "failed" || outcome.terminalState === "blocked" ? "text-amber-500" : "text-emerald-500",
  };
}

function buildPrimaryOutcomeSummary(
  outcome: ExecutionOutcome,
  changedCount: number,
  hasPassedCheck: boolean,
) {
  if (outcome.completionKind === "changed_unverified" && outcome.evidence.validation.cause === "TYPECHECK_UNAVAILABLE") {
    const serviceFiles = outcome.evidence.changedFiles.length > 0 && outcome.evidence.changedFiles.every((file) => /service/i.test(file.path));
    const subject = serviceFiles ? "service files" : changedCount === 1 ? "file" : "files";
    return `Updated ${changedCount} ${subject}${hasPassedCheck ? " and confirmed the focused tests pass" : ""}. This repository does not define a typecheck command, so that check could not run.`;
  }
  return outcome.summary.replace(/\n/g, " ");
}

export function fileOperationLabel(operation: string) {
  if (operation === "created") return "Added";
  if (operation === "deleted") return "Deleted";
  return "Modified";
}

function AgentOutcomeCard({
  outcome,
}: {
  outcome: Exclude<AgentOutcome, { status: "completed" }>;
}) {
  const remediation =
    outcome.status === "blocked"
      ? outcome.blocker.remediation
      : outcome.status === "failed"
        ? outcome.remediation
        : undefined;
  const canSelectModel = remediation?.type === "select_model";
  return (
    <section className="rounded-2xl border border-border/70 bg-[var(--mate-surface-bg)] p-3.5 shadow-none">
      <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
        <HugeiconsIcon icon={Alert01Icon} className="size-4 text-amber-500" />
        {outcome.status === "needs_approval"
          ? "Approval required"
          : outcome.status === "blocked"
            ? "Blocked"
            : "Couldn’t complete"}
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
        {outcome.summary}
      </p>
      {remediation ? (
        canSelectModel ? (
          <button
            className="mt-2 rounded-xl border border-border/70 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
            onClick={() =>
              document
                .querySelector<HTMLElement>("[data-model-selector-trigger]")
                ?.click()
            }
            type="button"
          >
            {remediation.label}
          </button>
        ) : (
          <p className="mt-2 text-[11px] font-medium text-foreground/80">
            Next: {remediation.label}
          </p>
        )
      ) : null}
    </section>
  );
}

function MessageActionButton({
  ariaLabel,
  icon,
  onClick,
}: {
  ariaLabel: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] motion-reduce:transform-none group-hover:opacity-100"
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}

function ThinkingRow({
  hasErrorEvent = false,
  isStreaming = true,
}: {
  hasErrorEvent?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground/85">
        {isStreaming && hasErrorEvent ? (
          <HugeiconsIcon icon={Alert01Icon} className="size-4 text-warning" />
        ) : isStreaming ? (
          <HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin text-primary motion-reduce:animate-none" />
        ) : (
          <HugeiconsIcon icon={CheckIcon} className="size-4" />
        )}
        {isStreaming && hasErrorEvent
          ? "Recovering after tool error"
          : isStreaming
            ? "Working"
            : "Complete"}
    </div>
  );
}
