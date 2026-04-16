import { Bot, CornerDownRight, Sparkles, TerminalSquare, User2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ChatMessage } from '../../../contracts/chat';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';

interface MessageStreamProps {
  messages: ChatMessage[];
}

export function MessageStream({ messages }: MessageStreamProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  return (
    <div
      ref={scrollerRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--background)] px-6 pb-12 pt-8"
    >
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <article
      className={cn(
        'border border-[var(--panel-border)] bg-[var(--surface)]',
        isUser
          ? 'ml-auto w-full max-w-[760px] border-[color-mix(in_srgb,var(--primary)_24%,var(--panel-border))] bg-[color-mix(in_srgb,var(--primary)_9%,var(--surface))]'
          : 'w-full',
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-5 py-3">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          <span
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md',
              isUser
                ? 'bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-[var(--primary)]'
                : 'bg-[var(--surface-soft)] text-[var(--foreground)]',
            )}
          >
            {isUser ? <User2 className="size-3.5" /> : <Bot className="size-3.5" />}
          </span>
          {isUser ? 'Operator' : 'Mate-X'}
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">{formatTimestamp(message.createdAt)}</span>
      </div>

      <div className="px-5 py-5">
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">
          {message.content}
        </p>

        {message.artifacts?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.artifacts.map((artifact) => (
              <span
                key={artifact.id}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
                  artifact.tone === 'success'
                    ? 'border-emerald-400/18 bg-emerald-400/10 text-emerald-300'
                    : artifact.tone === 'warning'
                      ? 'border-amber-400/18 bg-amber-400/10 text-amber-300'
                      : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--foreground)]',
                )}
              >
                <Sparkles className="size-3" />
                <span className="text-[var(--muted-foreground)]">{artifact.label}</span>
                <span>{artifact.value}</span>
              </span>
            ))}
          </div>
        ) : null}

        {message.events?.length ? (
          <section className="mt-4 rounded-lg border border-[var(--panel-border)] bg-[var(--surface-soft)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <TerminalSquare className="size-4 text-[var(--primary)]" />
              Work log
            </div>
            <div className="mt-3 space-y-3">
              {message.events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-md border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                      <CornerDownRight className="size-3.5 text-[var(--muted-foreground)]" />
                      {event.label}
                    </span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                    {event.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}
