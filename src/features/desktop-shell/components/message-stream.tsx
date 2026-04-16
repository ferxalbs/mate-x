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
    <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
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
        'rounded-[24px] border shadow-[0_14px_40px_rgba(0,0,0,0.18)]',
        isUser
          ? 'ml-auto w-full max-w-[720px] border-[color-mix(in_srgb,var(--primary)_24%,var(--border))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_14%,var(--surface))_0%,var(--surface)_100%)]'
          : 'w-full border-[var(--border)] bg-[var(--surface)]',
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-5 py-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          <span
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-full',
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
        <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">{message.content}</p>

        {message.artifacts?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.artifacts.map((artifact) => (
              <span
                key={artifact.id}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
                  artifact.tone === 'success'
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                    : artifact.tone === 'warning'
                      ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
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
          <section className="mt-4 rounded-[20px] border border-[var(--border)] bg-[var(--surface-soft)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <TerminalSquare className="size-4 text-[var(--primary)]" />
              Work log
            </div>
            <div className="mt-3 space-y-3">
              {message.events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
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
