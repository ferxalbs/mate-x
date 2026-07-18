import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  AssistantRunOptions,
  ChatMessage,
} from "../../../contracts/chat";
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
}) {
  const isUser = message.role === "user";
  const deferredContent = useDeferredValue(message.content);
  const events = message.events ?? [];
  const hasTimeline = events.length > 0;
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
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
      await window.mate.ui.copyToClipboard(message.content);
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
                <CheckIcon className="size-3.5" />
              ) : (
                <CopyIcon className="size-3.5" />
              )
            }
            onClick={() => void handleCopy()}
          />
          {canUndo ? (
            <MessageActionButton
              ariaLabel="Undo last turn"
              icon={<ArrowCounterClockwiseIcon className="size-4" weight="regular" />}
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
        />
        {normalizedContent.length > 0 ? (
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
        <MessageActionButton
          ariaLabel={copied ? "Copied message" : "Copy message"}
          icon={
            copied ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )
          }
          onClick={() => void handleCopy()}
        />
      </div>
    </article>
  );
});

function normalizeAssistantVisibleText(value: string) {
  return value
    .replace(
      /<\|channel\|>\s*(?:analysis|thought|thinking|reasoning|final)?/gi,
      "",
    )
    .replace(
      /<\|(?:start|end|message|channel|constrain|return|recipient)\|>/gi,
      "",
    )
    .replace(
      /<\/?\s*channel\s*>\s*(?:analysis|thought|thinking|reasoning|final)?/gi,
      "",
    )
    .replace(
      /<\s*channel\s*\|\s*>\s*(?:analysis|thought|thinking|reasoning|final)?/gi,
      "",
    )
    .replace(
      /(^|\n)\s*(?:analysis|thought|thinking|reasoning|final)\b\s*(?=<|\n|$)/gi,
      "$1",
    )
    .replace(/[ \t]+\n/g, "\n");
}

function stripTraceTransportMarkers(value: string) {
  return normalizeAssistantVisibleText(value).trim();
}

function ResultFallback() {
  return (
    <section className="rounded-2xl border border-border/65 bg-[var(--mate-surface-bg)] p-3.5 backdrop-blur-xl">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/85">
        <FileTextIcon className="size-3.5" />
        Result
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        No final synthesis text was returned for this run. The audit timeline
        above has the full execution trace.
      </p>
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
  thought = "",
  isStreaming = true,
}: {
  hasErrorEvent?: boolean;
  thought?: string;
  isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    }
  }, [isStreaming]);

  return (
    <div className="group space-y-2 rounded-2xl border border-border/45 bg-[var(--surface-soft)]/40 p-3 text-xs text-muted-foreground/85 transition-colors duration-[var(--motion-press)] ease-[var(--ease-out)] hover:bg-[var(--surface-soft)]/60">
      <button
        className="inline-flex items-center gap-2 font-medium text-foreground/70 transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {isStreaming && hasErrorEvent ? (
          <WarningCircleIcon className="size-4 text-warning" weight="regular" />
        ) : isStreaming ? (
          <SpinnerGapIcon className="size-4 animate-spin text-primary motion-reduce:animate-none" weight="regular" />
        ) : expanded ? (
          <CaretDownIcon className="size-4" weight="regular" />
        ) : (
          <CaretRightIcon className="size-4" weight="regular" />
        )}
        {isStreaming && hasErrorEvent
          ? "Recovering after tool error"
          : "Thinking process"}
      </button>
      {expanded ? (
        <p className="max-w-[820px] whitespace-pre-wrap pl-6 text-[12px] leading-5 text-muted-foreground/80">
          {thought}
        </p>
      ) : null}
    </div>
  );
}
