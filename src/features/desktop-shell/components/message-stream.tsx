import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  LoaderCircle,
} from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
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
        "px-4 pt-6 transition-all duration-300 sm:px-6 lg:px-9 pb-[var(--mate-composer-inset,148px)]",
      )}
    >
      <MessageScrollerContent
        className={cn(
          "mx-auto flex min-w-0 w-full max-w-full flex-col overflow-x-hidden transition-all duration-300",
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

  async function handleCopy() {
    try {
      await window.mate.ui.copyToClipboard(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }

  if (isUser) {
    const settings = useChatStore.getState().settings;
    return (
      <article
        className={cn(
          "group ml-auto flex w-full flex-col items-end gap-1.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          settings.compactMode ? "max-w-[540px]" : "max-w-[680px]",
        )}
      >
        <div className="rounded-[20px] border border-border/65 bg-[var(--mate-surface-bg)] px-4 py-3 text-left shadow-none backdrop-blur-xl">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
            {message.content}
          </p>
        </div>
        <div className="flex items-center justify-end gap-1.5 pr-2 opacity-0 transition-opacity duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:opacity-100">
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
              icon={<RotateUndoIcon />}
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
  const actionDisabled = isRunning || pendingAction !== null;

  async function submitAmbientAction(action: AmbientSafetyAction) {
    if (actionDisabled) return;

    setPendingAction(action.id);
    try {
      if (onSubmitPrompt) {
        await onSubmitPrompt(action.prompt, action.overrides);
      } else {
        onSelectPrompt(action.prompt);
      }
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <article className="group min-w-0 max-w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] pl-6">
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
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
        <p className="text-[11px] text-muted-foreground/55">
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
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/45 opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}

function RotateUndoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M9 10H4V5M4 10a8 8 0 1 1-2 5.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
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
    <div className="group space-y-2 rounded-2xl border border-border/45 bg-[var(--surface-soft)]/40 p-3 text-xs text-muted-foreground/85 transition-all hover:bg-[var(--surface-soft)]/60">
      <button
        className="inline-flex items-center gap-2 font-medium text-foreground/70 transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {isStreaming && hasErrorEvent ? (
          <AlertCircleIcon className="size-3.5 text-warning" />
        ) : isStreaming ? (
          <LoaderCircle className="size-3.5 animate-spin text-primary/60" />
        ) : expanded ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
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
