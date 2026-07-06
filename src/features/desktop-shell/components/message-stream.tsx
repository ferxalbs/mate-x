import {
  ActivityIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  LoaderCircle,
  TerminalIcon,
} from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type {
  ChatMessage,
  MessageArtifact,
  ToolEvent,
} from "../../../contracts/chat";
import { formatTimestamp } from "../../../lib/time";
import { cn } from "../../../lib/utils";
import { MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "../../../components/ui/message-scroller";
import { ChatMarkdown } from "./chat-markdown";
import { useChatStore } from "../../../store/chat-store";

interface MessageStreamProps {
  canUndoLastTurn: boolean;
  messages: ChatMessage[];
  isRunning: boolean;
  onSelectPrompt: (prompt: string) => void;
  onSubmitPrompt?: (prompt: string) => void;
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
    <MessageScrollerViewport className={cn(
      "px-4 pt-6 transition-all duration-300 sm:px-6 lg:px-9",
      settings.blurEnabled ? "pb-[200px]" : "pb-6"
    )}>
      <MessageScrollerContent
        className={cn(
          "mx-auto flex w-full flex-col transition-all duration-300",
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
      <MessageScrollerButton />
    </MessageScrollerViewport>
  );
}

const MessageEntry = memo(function MessageEntry({
  message,
  isStreaming,
  isLast,
  canUndo,
  onSelectPrompt,
  onSubmitPrompt,
  onUndo,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
  canUndo: boolean;
  onSelectPrompt: (prompt: string) => void;
  onSubmitPrompt?: (prompt: string) => void;
  onUndo: () => Promise<string | null>;
}) {
  const isUser = message.role === "user";
  const deferredContent = useDeferredValue(message.content);
  const events = message.events ?? [];
  const artifacts = message.artifacts ?? [];
  const thought = message.thought?.trim() ?? "";
  const hasTimeline = events.length > 0;
  const hasErrorEvent = events.some((event) => event.status === "error");
  const [copied, setCopied] = useState(false);

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
  const showAmbientActions = normalizedContent.includes("Repo note: changes need a safety check before commit.");

  return (
    <article className="group animate-in fade-in slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] pl-6">
      <div className="max-w-[820px] space-y-4 text-[14px] leading-6 text-foreground">
        {thought ? (
          <ThinkingRow
            hasErrorEvent={hasErrorEvent}
            isStreaming={isStreaming}
            thought={thought}
          />
        ) : null}
        {normalizedContent.length > 0 || hasTimeline ? (
          <InterleavedMessageContent
            content={message.content}
            events={events}
            isStreaming={isStreaming}
          />
        ) : isStreaming ? (
          <AssistantPendingRow events={events} />
        ) : null}
        {isLast && showAmbientActions && !isStreaming ? (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
              onClick={() => (onSubmitPrompt ?? onSelectPrompt)("Run the smallest useful safety check for the current changes. Do not claim Ready unless validation passes and proof is available.")}
              type="button"
            >
              Run safety check
            </button>
            <button
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
              onClick={() => (onSubmitPrompt ?? onSelectPrompt)("Explain the current changes in plain language. Highlight what changed, why it matters, likely blast radius, and what I should inspect first.")}
              type="button"
            >
              Review changes
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

function InterleavedMessageContent({
  content,
  events,
  isStreaming,
}: {
  content: string;
  events: ToolEvent[];
  isStreaming: boolean;
}) {
  const parts = useMemo(() => {
    return content.split(
      /(<!-- mate-trace:.*? -->|<(?:thought|think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/(?:thought|think|thinking|reasoning|analysis)>|$))/gi,
    );
  }, [content]);

  const usedEventIds = new Set<string>();
  const pendingTraceEvents: ToolEvent[] = [];
  let hasRenderedModelText = false;

  const renderedParts = parts.map((part, index) => {
    const markerMatch = part.match(/<!-- mate-trace:(.*?) -->/);
    if (markerMatch) {
      const eventId = markerMatch[1];
      const event = events.find((e) => e.id === eventId);
      if (event && isInlineTraceEvent(event)) {
        usedEventIds.add(eventId);
        pendingTraceEvents.push(event);
      }
      return null;
    }

    // Hide partial markers during streaming
    const cleanedPart = normalizeAssistantVisibleText(
      isStreaming
        ? part.replace(/<!-- mate-trace:.*$/, "").replace(/<!--$/, "")
        : part,
    );
    const trimmedPart = cleanedPart.trim();
    if (!trimmedPart) return null;

    // Ignore garbage empty thought prefixes generated by some models
    if (/^(?:thought|pensamiento):?$/i.test(trimmedPart)) {
      return null;
    }

    // Detect strict XML thought blocks
    const thoughtTagMatch = trimmedPart.match(
      /^<(?:thought|think|thinking|reasoning|analysis)\b[^>]*>([\s\S]*?)(?:<\/(?:thought|think|thinking|reasoning|analysis)>)?$/i,
    );
    if (thoughtTagMatch) {
      const traceGroup =
        pendingTraceEvents.length > 0 ? (
          <div className="my-1.5">
            <InlineTraceGroup events={pendingTraceEvents.splice(0)} />
          </div>
        ) : null;
      const isFirstModelText = !hasRenderedModelText;
      hasRenderedModelText = true;

      return (
        <div key={`thought-${index}`} className="my-2 space-y-2">
          {isFirstModelText ? null : traceGroup}
          <ThinkingRow
            isStreaming={isStreaming}
            thought={thoughtTagMatch[1].trim()}
          />
          {isFirstModelText ? traceGroup : null}
        </div>
      );
    }

    const traceGroup =
      pendingTraceEvents.length > 0 ? (
        <div className="my-1.5">
          <InlineTraceGroup events={pendingTraceEvents.splice(0)} />
        </div>
      ) : null;
    const isFirstModelText = !hasRenderedModelText;
    hasRenderedModelText = true;

    return (
      <div key={`text-${index}`} className="space-y-2">
        {isFirstModelText ? null : traceGroup}
        <ChatMarkdown content={cleanedPart} isStreaming={isStreaming} />
        {isFirstModelText ? traceGroup : null}
      </div>
    );
  });

  const trailingTraceEvents = [
    ...pendingTraceEvents,
    ...events.filter(
      (event) => isInlineTraceEvent(event) && !usedEventIds.has(event.id),
    ),
  ];
  const trailingTraceGroup =
    trailingTraceEvents.length > 0 ? (
      <div className="my-1.5">
        <InlineTraceGroup events={trailingTraceEvents} />
      </div>
    ) : null;

  if (!hasRenderedModelText && isStreaming) {
    return <AssistantPendingRow events={events} />;
  }

  return (
    <div className="space-y-4">
      {renderedParts}
      {trailingTraceGroup}
      {!hasRenderedModelText && !isStreaming ? <ResultFallback /> : null}
    </div>
  );
}

function AssistantPendingRow({ events }: { events: ToolEvent[] }) {
  const latestTraceEvent =
    [...events].reverse().find((event) => {
      return isInlineTraceEvent(event) && event.status === "active";
    }) ?? [...events].reverse().find(isInlineTraceEvent);
  const status = latestTraceEvent
    ? summarizeInlineTraceEvent(latestTraceEvent)
    : "Working";

  return (
    <div className="inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground/72">
      <LoaderCircle className="size-3.5 animate-spin" />
      <span>{status}</span>
    </div>
  );
}

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


function isInlineTraceEvent(event: ToolEvent) {
  const label = event.label.toLowerCase();

  if (
    label.includes("agent pass") ||
    label.includes("tool batch") ||
    label.includes("workspace metadata") ||
    label.includes("repository surface") ||
    label.includes("prompt-linked files") ||
    label.includes("rainy api fallback") ||
    label.includes("response complete")
  ) {
    return false;
  }

  return label.startsWith("executing ") || event.status === "error";
}



function CompactInlineTrace({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(
    event.status === "error" && !isMissingInternalToolEvent(event),
  );
  const summary = summarizeInlineTraceEvent(event);
  const rawDetail = getUserFacingTraceDetail(event);
  const detail = tryPrettyJson(rawDetail) ?? rawDetail;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] text-[12px] leading-5 text-muted-foreground/72">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/45 hover:text-foreground/85"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <InlineTraceStatusDot status={event.status} />
        <span className="truncate">{summary}</span>
      </button>
      {expanded && detail ? (
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] ml-6 mt-1 max-w-[760px] whitespace-pre-wrap rounded-md border border-border/35 bg-[var(--mate-control-bg)] px-2.5 py-2 font-mono text-[11px] leading-5 text-muted-foreground/78 backdrop-blur-md">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function InlineTraceGroup({ events }: { events: ToolEvent[] }) {
  const active = events.some((event) => event.status === "active");
  const failed = events.some((event) => event.status === "error");
  const missingInternalOnly =
    failed && events.every((event) => event.status !== "error" || isMissingInternalToolEvent(event));
  const [expanded, setExpanded] = useState(failed && !missingInternalOnly);
  const label =
    events.length === 1
      ? summarizeInlineTraceEvent(events[0])
      : failed
        ? `${events.filter((event) => event.status === "error").length} action${events.filter((event) => event.status === "error").length === 1 ? "" : "s"} need attention`
        : `${active ? "Running" : "Ran"} ${events.length} actions`;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] text-[12px] leading-5 text-muted-foreground/72">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/45 hover:text-foreground/85"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <InlineTraceStatusDot
          status={active ? "active" : failed ? "error" : "done"}
        />
        <span className="truncate">{label}</span>
      </button>
      {expanded ? (
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] ml-6 mt-1 space-y-1">
          {events.map((event) => (
            <CompactInlineTrace key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineTraceStatusDot({ status }: { status: ToolEvent["status"] }) {
  if (status === "active") {
    return (
      <LoaderCircle className="size-3 shrink-0 animate-spin text-primary/70" />
    );
  }

  if (status === "error") {
    return (
      <span className="size-1.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.4)]" />
    );
  }

  return (
    <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
  );
}

function summarizeInlineTraceEvent(event: ToolEvent) {
  if (isMissingInternalToolEvent(event)) {
    const tool = missingInternalToolName(event);
    return tool ? `Tool unavailable - ${tool}` : "Tool unavailable";
  }

  const label =
    cleanTraceText(event.label.replace(/^Executing\s+/i, "")) || event.label;
  const target = extractInlineTraceTarget(event.detail);
  // Don't append "failed" if the label already contains it (e.g. "WorkPlan final gate failed")
  const alreadyDescribesFail = /fail/i.test(label);

  if (event.status === "error" && !alreadyDescribesFail) {
    return target ? `${label} failed - ${target}` : `${label} failed`;
  }

  return target ? `${label} - ${target}` : label;
}

function getUserFacingTraceDetail(event: ToolEvent) {
  if (isMissingInternalToolEvent(event)) {
    const tool = missingInternalToolName(event);
    return tool
      ? `${tool} is not available in this build. The run should fall back to available repo tools instead of asking you to debug this.`
      : "A requested internal tool is not available in this build. The run should fall back to available repo tools.";
  }

  return extractCommandFromEvent(event) ?? event.detail;
}

function isMissingInternalToolEvent(event: ToolEvent) {
  return event.status === "error" && /Tool\s+"[^"]+"\s+not found/i.test(event.detail);
}

function missingInternalToolName(event: ToolEvent) {
  return event.detail.match(/Tool\s+"([^"]+)"/i)?.[1] ?? null;
}

function extractInlineTraceTarget(detail: string) {
  const argsMatch = detail.match(
    /^Running\s+[a-zA-Z0-9_]+\s+with arguments:\s+(.+)$/,
  );
  if (!argsMatch) {
    return null;
  }

  try {
    const args = JSON.parse(argsMatch[1]) as Record<string, unknown>;
    const value =
      args.path ??
      args.file ??
      args.pattern ??
      args.query ??
      args.command ??
      args.name;

    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function tryPrettyJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}


function ToolPolicyBadges({ event }: { event: ToolEvent }) {
  const policy = event.policy;
  if (!policy) {
    return null;
  }

  const riskTone =
    policy.riskClass === "safe"
      ? "border-emerald-300/30 bg-emerald-400/8 text-emerald-300"
      : policy.riskClass === "sensitive"
        ? "border-sky-300/30 bg-sky-400/8 text-sky-200"
        : policy.riskClass === "dangerous"
          ? "border-amber-300/30 bg-amber-400/8 text-amber-200"
          : "border-red-300/30 bg-red-400/8 text-red-200";
  const contractLabel = policy.allowedByContract
    ? "contract allowed"
    : "contract blocked";
  const escalationLabel = policy.escalationRequired
    ? "escalation needed"
    : "no escalation";

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] leading-none">
      <span className={cn("rounded-md border px-2 py-1 capitalize", riskTone)}>
        {policy.riskClass}
      </span>
      {policy.impactTypes.map((impact) => (
        <span
          key={impact}
          className="rounded-md border border-border/55 bg-[var(--mate-control-bg)] px-2 py-1 text-muted-foreground backdrop-blur-md"
        >
          {impact.replaceAll("_", " ")}
        </span>
      ))}
      <span className="rounded-md border border-border/55 bg-[var(--mate-control-bg)] px-2 py-1 text-muted-foreground backdrop-blur-md">
        {contractLabel}
      </span>
      <span className="rounded-md border border-border/55 bg-[var(--mate-control-bg)] px-2 py-1 text-muted-foreground backdrop-blur-md">
        {escalationLabel}
      </span>
      <span className="basis-full text-[10px] leading-4 text-muted-foreground/75">
        {policy.reason}
      </span>
    </div>
  );
}

function extractCommandFromEvent(event: ToolEvent) {
  if (!event.label.startsWith("Executing ")) {
    return null;
  }

  const match = event.detail.match(
    /^Running\s+([a-zA-Z0-9_]+)\s+with arguments:\s+(.+)$/,
  );
  if (!match) {
    return null;
  }

  return `${match[1]} ${match[2]}`;
}

function describeTraceEvent(event: ToolEvent, command: string | null) {
  if (command) {
    return {
      title: event.status === "active" ? "Running command" : "Ran command",
      detail: command,
    };
  }

  const title = cleanTraceText(event.label);
  const detail = cleanTraceText(event.detail);
  if (!detail || detail.toLowerCase() === title.toLowerCase()) {
    return { title, detail: "" };
  }

  return { title, detail };
}

function cleanTraceText(value: string) {
  return value
    .replace(/\bawaiting\b/gi, "resolving")
    .replace(/\bawait\b/gi, "wait")
    .replace(/^Executing\s+/i, "")
    .replace(/^Running\s+agent\s+pass\b/i, "Agent pass")
    .replace(/^Done\s+agent\s+pass\b/i, "Agent pass complete")
    .replace(/\s+/g, " ")
    .trim();
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
        {isStreaming && hasErrorEvent ? "Recovering after tool error" : "Thinking process"}
      </button>
      {expanded ? (
        <p className="max-w-[820px] whitespace-pre-wrap pl-6 text-[12px] leading-5 text-muted-foreground/80">
          {thought}
        </p>
      ) : null}
    </div>
  );
}
