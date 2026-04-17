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
import { useDeferredValue, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { ChatMessage, MessageArtifact, ToolEvent } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { ChatMarkdown } from './chat-markdown';

interface MessageStreamProps {
  canUndoLastTurn: boolean;
  messages: ChatMessage[];
  isRunning: boolean;
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
}: {
  message: ChatMessage;
  isStreaming: boolean;
  canUndo: boolean;
  onUndo: () => Promise<string | null>;
}) {
  const isUser = message.role === 'user';
  const deferredContent = useDeferredValue(message.content);
  const events = message.events ?? [];
  const artifacts = message.artifacts ?? [];
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
  const hideMarkdownWhileStreaming = isStreaming && hasTimeline;
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
        {hasTimeline ? (
          <RunTimeline
            artifacts={artifacts}
            events={events}
            isStreaming={isStreaming}
          />
        ) : null}
        {shouldRenderMarkdown ? (
          <ChatMarkdown content={deferredContent} isStreaming={isStreaming} />
        ) : null}
        {shouldRenderResultFallback ? (
          <ResultFallback />
        ) : null}
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
}: {
  events: ToolEvent[];
  artifacts: MessageArtifact[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(isStreaming);
  const total = events.length;
  const doneCount = events.filter((event) => event.status === 'done').length;
  const errorCount = events.filter((event) => event.status === 'error').length;

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
          {events.map((event) => (
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

function StatusIcon({ status }: { status: ToolEvent['status'] }) {
  if (status === 'active') {
    return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-foreground/80" />;
  }

  if (status === 'error') {
    return <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-300/90" />;
  }

  return <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-300/90" />;
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

function ThinkingRow() {
  return (
    <div className="pl-6 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-[var(--surface)] px-3 py-1.5">
        <LoaderCircle className="size-3.5 animate-spin text-foreground/80" />
        Thinking with OpenAI
      </span>
    </div>
  );
}
