import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  LoaderCircle,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { ChatMessage, MessageArtifact, ToolEvent } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { ChatMarkdown } from './chat-markdown';

interface MessageStreamProps {
  canUndoLastTurn: boolean;
  messages: ChatMessage[];
  isRunning: boolean;
  traceVersion: 'v1' | 'v2';
  traceV2InlineEvents: boolean;
  workspace: WorkspaceSummary | null;
  hasActiveThread: boolean;
  onUndoLastTurn: () => Promise<string | null>;
  onVisibilityChange: (visible: boolean) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
}

export function MessageStream({
  canUndoLastTurn,
  messages,
  isRunning,
  traceVersion,
  traceV2InlineEvents,
  workspace,
  hasActiveThread,
  onUndoLastTurn,
  onVisibilityChange,
  scrollerRef,
}: MessageStreamProps) {
  const shouldStickToBottomRef = useRef(true);
  const hasStreamingAssistantMessage =
    isRunning && messages.at(-1)?.role === 'assistant';

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) {
      return;
    }

    const updateScrollState = () => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      const nextShowScrollButton = distanceFromBottom > 140;
      const nextStickToBottom = distanceFromBottom < 32;

      shouldStickToBottomRef.current = nextStickToBottom;
      onVisibilityChange(nextShowScrollButton);
    };

    updateScrollState();
    element.addEventListener('scroll', updateScrollState, { passive: true });

    return () => {
      element.removeEventListener('scroll', updateScrollState);
      onVisibilityChange(false);
    };
  }, [onVisibilityChange, scrollerRef]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    if (!shouldStickToBottomRef.current && messages.length > 0) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior: messages.length > 0 ? 'smooth' : 'auto',
    });
  }, [messages, isRunning]);

  return (
    <div ref={scrollerRef} className="flex min-h-0 flex-1 overflow-y-auto px-9 pb-8 pt-7">
      <div className="mx-auto flex w-full max-w-[980px] flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-7">
          {messages.length === 0 ? (
            <EmptyState hasActiveThread={hasActiveThread} workspace={workspace} />
          ) : null}

          {messages.map((message, index) => (
            <MessageEntry
              key={message.id}
              canUndo={canUndoLastTurn && message.role === 'user' && index === messages.length - 1}
              isStreaming={isRunning && index === messages.length - 1 && message.role === 'assistant'}
              message={message}
              onUndo={onUndoLastTurn}
              traceVersion={traceVersion}
              traceV2InlineEvents={traceV2InlineEvents}
            />
          ))}

          {isRunning && !hasStreamingAssistantMessage ? <ThinkingRow /> : null}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  hasActiveThread,
  workspace,
}: {
  hasActiveThread: boolean;
  workspace: WorkspaceSummary | null;
}) {
  const title = hasActiveThread ? 'Start a review to continue' : 'Pick a thread to continue';
  const description = hasActiveThread
    ? `Ask MaTE X to inspect ${workspace?.name ?? 'your repository'} and stream the results here.`
    : 'Select an existing thread or create a new one to get started.';

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-[470px] rounded-[28px] border border-border/55 bg-[var(--surface-soft)]/72 px-10 py-11 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <p className="text-[15px] font-semibold tracking-[-0.02em] text-foreground/94">{title}</p>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function MessageEntry({
  message,
  isStreaming,
  canUndo,
  onUndo,
  traceVersion,
  traceV2InlineEvents,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  canUndo: boolean;
  onUndo: () => Promise<string | null>;
  traceVersion: 'v1' | 'v2';
  traceV2InlineEvents: boolean;
}) {
  const isUser = message.role === 'user';
  const deferredContent = useDeferredValue(message.content);
  const events = message.events ?? [];
  const artifacts = message.artifacts ?? [];
  const thought = message.thought?.trim() ?? '';
  const hasTimeline = events.length > 0;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (isUser) {
    return (
      <article className="ml-auto flex w-full max-w-[610px] justify-end">
        <div className="group rounded-[20px] border border-border/65 bg-[var(--surface)] px-5 py-4 text-left shadow-none">
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-foreground">
            {message.content}
          </p>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <p className="text-[11px] text-muted-foreground/55">
              {formatTimestamp(message.createdAt)}
            </p>
            <MessageActionButton
              ariaLabel={copied ? 'Copied message' : 'Copy message'}
              icon={copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
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
        </div>
      </article>
    );
  }

  const normalizedContent = deferredContent.trim();
  const hideMarkdownWhileStreaming =
    isStreaming && hasTimeline && !(traceVersion === 'v2' && traceV2InlineEvents);
  const hideProgressTranscript =
    hasTimeline &&
    isProgressTranscript(normalizedContent) &&
    !normalizedContent.toLowerCase().includes('recent execution trace:');
  const shouldRenderMarkdown =
    normalizedContent.length > 0 &&
    !hideMarkdownWhileStreaming &&
    !hideProgressTranscript;
  const shouldRenderResultFallback = !isStreaming && hasTimeline && !shouldRenderMarkdown;

  return (
    <article className="group pl-6">
      <div className="max-w-[820px] space-y-4 text-[14px] leading-6 text-foreground">
        {thought ? <ThinkingRow isStreaming={isStreaming} thought={thought} /> : null}
        {traceVersion === "v2" && traceV2InlineEvents ? (
          normalizedContent.length > 0 ? (
            <InterleavedMessageContent
              content={message.content}
              events={events}
              isStreaming={isStreaming}
            />
          ) : isStreaming ? (
            <AssistantPendingRow events={events} />
          ) : null
        ) : (
          <>
            {hasTimeline ? (
              <RunTimeline
                artifacts={artifacts}
                events={events}
                isStreaming={isStreaming}
                traceVersion={traceVersion}
                traceV2InlineEvents={traceV2InlineEvents}
              />
            ) : null}
            {shouldRenderMarkdown ? (
              <ChatMarkdown content={deferredContent} isStreaming={isStreaming} />
            ) : null}
            {shouldRenderResultFallback ? <ResultFallback /> : null}
          </>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground/55">{formatTimestamp(message.createdAt)}</p>
        <MessageActionButton
          ariaLabel={copied ? 'Copied message' : 'Copy message'}
          icon={copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          onClick={() => void handleCopy()}
        />
      </div>
    </article>
  );
}

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
    return content.split(/(<!-- mate-trace:.*? -->|<(?:thought|think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?<\/(?:thought|think|thinking|reasoning|analysis)>)/gi);
  }, [content]);

  const usedEventIds = new Set<string>();
  const leadingTraceEvents: ToolEvent[] = [];
  let hasRenderedModelText = false;

  const renderedParts = parts.map((part, index) => {
    const markerMatch = part.match(/<!-- mate-trace:(.*?) -->/);
    if (markerMatch) {
      const eventId = markerMatch[1];
      const event = events.find((e) => e.id === eventId);
      if (event && isInlineTraceEvent(event)) {
        usedEventIds.add(eventId);
        if (!hasRenderedModelText) {
          leadingTraceEvents.push(event);
          return null;
        }

        return (
          <div key={`${eventId}-${index}`} className="my-1.5 first:mt-0 last:mb-0">
            <CompactInlineTrace event={event} />
          </div>
        );
      }
      return null;
    }

    // Hide partial markers during streaming
    const cleanedPart = normalizeAssistantVisibleText(
      isStreaming ? part.replace(/<!-- mate-trace:.*$/, "").replace(/<!--$/, "") : part,
    );
    const trimmedPart = cleanedPart.trim();
    if (!trimmedPart) return null;

    // Ignore garbage empty thought prefixes generated by some models
    if (/^(?:thought|pensamiento):?$/i.test(trimmedPart)) {
      return null;
    }

    // Detect strict XML thought blocks
    const thoughtTagMatch = trimmedPart.match(/^<(?:thought|think|thinking|reasoning|analysis)\b[^>]*>([\s\S]*?)<\/(?:thought|think|thinking|reasoning|analysis)>$/i);
    if (thoughtTagMatch) {
      hasRenderedModelText = true;
      return (
        <div key={`thought-${index}`} className="my-2">
          <ThinkingRow isStreaming={isStreaming} thought={thoughtTagMatch[1].trim()} />
        </div>
      );
    }

    hasRenderedModelText = true;
    const leadingGroup = leadingTraceEvents.length > 0
      ? (
        <div className="my-1.5">
          <InlineTraceGroup events={leadingTraceEvents.splice(0)} />
        </div>
      )
      : null;

    return (
      <div key={`text-${index}`} className="space-y-2">
        <ChatMarkdown
          content={cleanedPart}
          isStreaming={isStreaming}
        />
        {leadingGroup}
      </div>
    );
  });

  return <div className="space-y-4">{renderedParts}</div>;
}

function AssistantPendingRow({ events }: { events: ToolEvent[] }) {
  const latestTraceEvent = [...events].reverse().find((event) => {
    return isInlineTraceEvent(event) && event.status === 'active';
  }) ?? [...events].reverse().find(isInlineTraceEvent);
  const status = latestTraceEvent ? summarizeInlineTraceEvent(latestTraceEvent) : 'Working';

  return (
    <div className="inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground/72">
      <LoaderCircle className="size-3.5 animate-spin" />
      <span>{status}</span>
    </div>
  );
}

function normalizeAssistantVisibleText(value: string) {
  return value
    .replace(/<\|(?:start|end|message|channel|constrain|return|recipient)\|>/gi, "")
    .replace(/<\s*channel\s*\|\s*>/gi, "")
    .replace(/^\s*(?:analysis|thought|thinking|reasoning|final)\b\s*/i, "")
    .replace(/[ \t]+\n/g, "\n");
}

function ResultFallback() {
  return (
    <section className="rounded-2xl border border-border/65 bg-[var(--surface)]/78 p-3.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/85">
        <FileTextIcon className="size-3.5" />
        Result
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        No final synthesis text was returned for this run. The audit timeline above has the full execution trace.
      </p>
    </section>
  );
}

function RunTimeline({
  events,
  artifacts,
  isStreaming,
  traceVersion,
  traceV2InlineEvents,
}: {
  events: ToolEvent[];
  artifacts: MessageArtifact[];
  isStreaming: boolean;
  traceVersion: 'v1' | 'v2';
  traceV2InlineEvents: boolean;
}) {
  if (traceVersion === 'v2') {
    return (
      <RunTimelineV2
        events={events}
        artifacts={artifacts}
        isStreaming={isStreaming}
        inlineEvents={traceV2InlineEvents}
      />
    );
  }

  return <RunTimelineV1 events={events} artifacts={artifacts} isStreaming={isStreaming} />;
}

function RunTimelineV1({
  events,
  artifacts,
  isStreaming,
}: {
  events: ToolEvent[];
  artifacts: MessageArtifact[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(isStreaming);
  const [phaseFilter, setPhaseFilter] = useState<'all' | EventPhase>('all');
  const total = events.length;
  const doneCount = events.filter((event) => event.status === 'done').length;
  const errorCount = events.filter((event) => event.status === 'error').length;
  const phaseCounts = useMemo(() => {
    const counts: Record<EventPhase, number> = {
      initial: 0,
      investigation: 0,
      updates: 0,
      summary: 0,
    };

    for (const event of events) {
      counts[classifyEventPhase(event)] += 1;
    }

    return counts;
  }, [events]);
  const filteredEvents = useMemo(
    () => (phaseFilter === 'all' ? events : events.filter((event) => classifyEventPhase(event) === phaseFilter)),
    [events, phaseFilter],
  );

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
      return;
    }

    setExpanded(false);
  }, [isStreaming, total]);

  return (
    <section className="rounded-2xl border border-border/65 bg-[var(--surface)]/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
          Run activity
          <span className="text-muted-foreground/65">{total} steps</span>
        </button>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <span>{doneCount} done</span>
          {errorCount > 0 ? <span className="text-amber-300/90">{errorCount} issues</span> : null}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded-md border border-border/60 bg-background/45 px-2 py-1 text-muted-foreground">
          Agent Trace v1
        </span>
        <PhaseFilterChip
          active={phaseFilter === 'all'}
          label={`All (${total})`}
          onClick={() => setPhaseFilter('all')}
        />
        <PhaseFilterChip
          active={phaseFilter === 'initial'}
          label={`Initial (${phaseCounts.initial})`}
          onClick={() => setPhaseFilter('initial')}
        />
        <PhaseFilterChip
          active={phaseFilter === 'investigation'}
          label={`Investigation (${phaseCounts.investigation})`}
          onClick={() => setPhaseFilter('investigation')}
        />
        <PhaseFilterChip
          active={phaseFilter === 'updates'}
          label={`Updates (${phaseCounts.updates})`}
          onClick={() => setPhaseFilter('updates')}
        />
        <PhaseFilterChip
          active={phaseFilter === 'summary'}
          label={`Summary (${phaseCounts.summary})`}
          onClick={() => setPhaseFilter('summary')}
        />
      </div>

      {artifacts.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {artifacts.slice(0, 6).map((artifact) => (
            <span
              key={artifact.id}
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] leading-none",
                artifact.tone === "success"
                  ? "border-emerald-300/30 bg-emerald-400/8 text-emerald-300"
                  : artifact.tone === "warning"
                    ? "border-amber-300/30 bg-amber-400/8 text-amber-200"
                    : "border-border/60 bg-background/45 text-muted-foreground",
              )}
            >
              {artifact.label}: {artifact.value}
            </span>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="space-y-1.5">
          {filteredEvents.map((event) => (
            <TimelineEventRow key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border/45 bg-background/38 px-2.5 py-2 text-[11px] text-muted-foreground">
          Details are collapsed. Expand <span className="text-foreground/85">Run activity</span> to inspect audit rows and commands.
        </div>
      )}
    </section>
  );
}

function RunTimelineV2({
  events,
  artifacts,
  isStreaming,
  inlineEvents,
}: {
  events: ToolEvent[];
  artifacts: MessageArtifact[];
  isStreaming: boolean;
  inlineEvents: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllActionsModal, setShowAllActionsModal] = useState(false);
  const actionRows = useMemo(
    () =>
      events.filter(isInlineTraceEvent).map((event) => {
        const command = extractCommandFromEvent(event);
        if (command) {
          return `Ran command - ${command}`;
        }

        return `${event.label} - ${event.detail}`;
      }),
    [events],
  );
  const statusLabel = isStreaming ? 'running' : 'done';
  const previewRows = actionRows.slice(0, 10);

  useEffect(() => {
    if (inlineEvents || !showAllActionsModal) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAllActionsModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [inlineEvents, showAllActionsModal]);

  if (inlineEvents) {
    const visibleRows = isStreaming ? actionRows.slice(-6) : actionRows;

    return (
      <section className="space-y-2">
        <div className="space-y-1.5 rounded-2xl border border-border/45 bg-background/22 p-2.5">
          {visibleRows.length > 0 ? visibleRows.map((row, index) => (
            <div
              key={`${row}-${index}`}
              className="flex min-w-0 items-start gap-2 rounded-xl border border-border/35 bg-[var(--surface)]/45 px-3 py-2 text-[12px] leading-5 text-muted-foreground/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
            >
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground/60">{">_"}</span>
              <span className="min-w-0 flex-1 break-words">{row}</span>
            </div>
          )) : (
            <div className="rounded-xl border border-border/35 bg-[var(--surface)]/45 px-3 py-2 text-[12px] text-muted-foreground">
              No tool actions captured in this turn.
            </div>
          )}
          {isStreaming && actionRows.length > visibleRows.length ? (
            <div className="px-1 pt-0.5 text-[11px] text-muted-foreground/55">
              Showing latest {visibleRows.length} of {actionRows.length} trace events.
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-border/45 bg-background/35 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        <span className="font-medium text-foreground/85">Model actions</span>
        <span>{actionRows.length}</span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/75">{statusLabel}</span>
      </button>

      {expanded ? (
        <div className="space-y-1.5">
          {actionRows.length > 0 ? previewRows.map((row, index) => (
            <div
              key={`${row}-${index}`}
              className={cn(
                "rounded-xl border border-border/40 bg-background/25 px-3 py-2 text-[12px] text-muted-foreground/95 backdrop-blur-sm",
                index % 2 === 0 ? "mr-5" : "ml-5",
              )}
            >
              <span className="mr-2 font-mono text-[11px] text-muted-foreground/70">{">_"}</span>
              {row}
            </div>
          )) : (
            <div className="rounded-xl border border-border/40 bg-background/25 px-3 py-2 text-[12px] text-muted-foreground">
              No tool actions captured in this turn.
            </div>
          )}
          {actionRows.length > previewRows.length ? (
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-border/55 bg-background/45 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setShowAllActionsModal(true)}
            >
              View all actions ({actionRows.length})
            </button>
          ) : null}
          {artifacts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {artifacts.slice(0, 4).map((artifact) => (
                <span
                  key={artifact.id}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10px] leading-none",
                    artifact.tone === "success"
                      ? "border-emerald-300/30 bg-emerald-400/8 text-emerald-300"
                      : artifact.tone === "warning"
                        ? "border-amber-300/30 bg-amber-400/8 text-amber-200"
                        : "border-border/60 bg-background/45 text-muted-foreground",
                  )}
                >
                  {artifact.label}: {artifact.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showAllActionsModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          onClick={() => setShowAllActionsModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-border/60 bg-[var(--surface)]/96 p-3 shadow-[0_20px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[12px] font-semibold text-foreground/90">
                All model actions
              </div>
              <button
                type="button"
                className="rounded-md border border-border/55 bg-background/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setShowAllActionsModal(false)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[64vh] space-y-1.5 overflow-y-auto pr-1">
              {actionRows.map((row, index) => (
                <div
                  key={`${row}-modal-${index}`}
                  className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-2 text-[12px] text-muted-foreground"
                >
                  <span className="mr-2 font-mono text-[11px] text-muted-foreground/70">{index + 1}.</span>
                  {row}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
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
    label.includes("response complete")
  ) {
    return false;
  }

  return label.startsWith("executing ") || event.status === "error";
}

type EventPhase = 'initial' | 'investigation' | 'updates' | 'summary';

function PhaseFilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 transition-colors",
        active
          ? "border-border/70 bg-accent text-foreground"
          : "border-border/55 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function StatusIcon({ status }: { status: ToolEvent['status'] }) {
  if (status === 'active') {
    return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-foreground/80" />;
  }

  if (status === 'error') {
    return <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-300/90" />;
  }

  return <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-300/90" />;
}

function CompactInlineTrace({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInlineTraceEvent(event);
  const detail = extractCommandFromEvent(event) ?? event.detail;

  return (
    <div className="text-[12px] leading-5 text-muted-foreground/72">
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
        <div className="ml-6 mt-1 max-w-[760px] whitespace-pre-wrap rounded-md border border-border/35 bg-background/24 px-2.5 py-2 font-mono text-[11px] leading-5 text-muted-foreground/78">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function InlineTraceGroup({ events }: { events: ToolEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const active = events.some((event) => event.status === 'active');
  const failed = events.some((event) => event.status === 'error');
  const label = events.length === 1
    ? summarizeInlineTraceEvent(events[0])
    : `${active ? 'Running' : 'Ran'} ${events.length} actions`;

  return (
    <div className="text-[12px] leading-5 text-muted-foreground/72">
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
        <InlineTraceStatusDot status={active ? 'active' : failed ? 'error' : 'done'} />
        <span className="truncate">{label}</span>
      </button>
      {expanded ? (
        <div className="ml-6 mt-1 space-y-1">
          {events.map((event) => (
            <CompactInlineTrace key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineTraceStatusDot({ status }: { status: ToolEvent['status'] }) {
  if (status === 'active') {
    return <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground/70" />;
  }

  if (status === 'error') {
    return <span className="size-1.5 shrink-0 rounded-full bg-amber-300/90" />;
  }

  return <span className="size-1.5 shrink-0 rounded-full bg-emerald-300/80" />;
}

function summarizeInlineTraceEvent(event: ToolEvent) {
  const label = event.label.replace(/^Executing\s+/i, '').trim() || event.label;
  const target = extractInlineTraceTarget(event.detail);

  if (event.status === 'error') {
    return target ? `${label} failed - ${target}` : `${label} failed`;
  }

  return target ? `${label} - ${target}` : label;
}

function extractInlineTraceTarget(detail: string) {
  const argsMatch = detail.match(/^Running\s+[a-zA-Z0-9_]+\s+with arguments:\s+(.+)$/);
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

    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function TimelineEventRow({ event }: { event: ToolEvent }) {
  const command = extractCommandFromEvent(event);
  const hasExtra = Boolean(command) || event.detail.length > 180;
  const [expanded, setExpanded] = useState(event.status === 'active');
  const preview = event.detail.length > 180
    ? `${event.detail.slice(0, 177).trimEnd()}...`
    : event.detail;

  return (
    <div className="rounded-lg border border-border/45 bg-background/38 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <StatusIcon status={event.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-medium text-foreground/90">{event.label}</div>
            {hasExtra ? (
              <button
                type="button"
                className="inline-flex items-center rounded px-1 text-[10px] text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
              </button>
            ) : null}
          </div>
          <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
            {expanded ? event.detail : preview}
          </div>
          {command ? (
            <div className="mt-1 rounded-md border border-border/45 bg-background/70 px-2 py-1 font-mono text-[10px] leading-4 text-foreground/85">
              {command}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function extractCommandFromEvent(event: ToolEvent) {
  if (!event.label.startsWith('Executing ')) {
    return null;
  }

  const match = event.detail.match(/^Running\s+([a-zA-Z0-9_]+)\s+with arguments:\s+(.+)$/);
  if (!match) {
    return null;
  }

  return `${match[1]} ${match[2]}`;
}

function classifyEventPhase(event: ToolEvent): EventPhase {
  const label = event.label.toLowerCase();
  const detail = event.detail.toLowerCase();
  const combined = `${label} ${detail}`;

  if (
    combined.includes('response complete') ||
    combined.includes('turn complete') ||
    combined.includes('final') ||
    combined.includes('synthesis')
  ) {
    return 'summary';
  }

  if (
    combined.includes('executing') ||
    combined.includes('tool') ||
    combined.includes('command') ||
    combined.includes('patch') ||
    combined.includes('file change')
  ) {
    return 'investigation';
  }

  if (
    combined.includes('running agent pass') ||
    combined.includes('start') ||
    combined.includes('turn started') ||
    combined.includes('agent message')
  ) {
    return 'initial';
  }

  return 'updates';
}

function isProgressTranscript(content: string) {
  if (!content) {
    return false;
  }

  const lowered = content.toLowerCase();
  const signals = [
    'running agent pass',
    'done agent pass',
    'tool batch',
    'executing ',
    'continue investigation',
    'response complete',
  ];

  return signals.some((signal) => lowered.includes(signal));
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

function ThinkingRow({ thought = '', isStreaming = true }: { thought?: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    }
  }, [isStreaming]);

  return (
    <div className="space-y-2 rounded-2xl border border-border/40 bg-[var(--surface-soft)]/45 p-3 text-xs text-muted-foreground/85 transition-all hover:bg-[var(--surface-soft)]/65">
      <button
        className="inline-flex items-center gap-2 font-medium text-foreground/75 hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {isStreaming ? (
          <LoaderCircle className="size-3.5 animate-spin text-foreground/60" />
        ) : expanded ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        Thinking process
      </button>
      {expanded ? (
        <p className="max-w-[820px] whitespace-pre-wrap pl-6 text-[12px] leading-5 text-muted-foreground/80">
          {thought}
        </p>
      ) : null}
    </div>
  );
}
