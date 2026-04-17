import { CheckIcon, CopyIcon, LoaderCircle } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { ChatMessage } from '../../../contracts/chat';
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

          {isRunning ? <ThinkingRow /> : null}
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

  return (
    <article className="group pl-6">
      <div className="max-w-[760px] text-[14px] leading-6 text-foreground">
        <ChatMarkdown content={deferredContent} isStreaming={isStreaming} />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground/55">{formatTimestamp(message.createdAt)}</p>
        <MessageActionButton
          ariaLabel={copied ? 'Copied message' : 'Copy message'}
          icon={copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          onClick={() => void handleCopy()}
        />
      </div>

      {message.artifacts?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {message.artifacts.map((artifact) => (
            <span
              key={artifact.id}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
                artifact.tone === 'success'
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  : artifact.tone === 'warning'
                    ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                    : 'border-border/80 bg-[var(--surface)] text-foreground',
              )}
            >
              <span className="text-muted-foreground">{artifact.label}</span>
              <span>{artifact.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
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
