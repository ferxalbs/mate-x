import { LoaderCircle } from 'lucide-react';
import { useDeferredValue, useEffect, useRef } from 'react';

import type { ChatMessage } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { ChatMarkdown } from './chat-markdown';

interface MessageStreamProps {
  messages: ChatMessage[];
  isRunning: boolean;
  workspace: WorkspaceSummary | null;
  hasActiveThread: boolean;
}

export function MessageStream({
  messages,
  isRunning,
  workspace,
  hasActiveThread,
}: MessageStreamProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;

    element.scrollTo({
      top: element.scrollHeight,
      behavior: messages.length > 0 ? 'smooth' : 'auto',
    });
  }, [messages, isRunning]);

  return (
    <div ref={scrollerRef} className="flex min-h-0 flex-1 overflow-y-auto px-9 pb-8 pt-7">
      <div className="relative mx-auto flex w-full max-w-[980px] flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-7">
          {messages.length === 0 ? (
            <EmptyState hasActiveThread={hasActiveThread} workspace={workspace} />
          ) : null}

          {messages.map((message) => (
            <MessageEntry key={message.id} message={message} />
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

function MessageEntry({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const deferredContent = useDeferredValue(message.content);

  if (isUser) {
    return (
      <article className="ml-auto flex w-full max-w-[610px] justify-end">
        <div className="rounded-[20px] border border-border/65 bg-[var(--surface)] px-5 py-4 text-left shadow-none">
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-foreground">
            {message.content}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground/55">
            {formatTimestamp(message.createdAt)}
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="pl-6">
      <div className="max-w-[760px] text-[14px] leading-6 text-foreground">
        <ChatMarkdown content={deferredContent} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/55">{formatTimestamp(message.createdAt)}</p>

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
