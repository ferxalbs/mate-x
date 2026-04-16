import { Bot, CornerDownRight, LoaderCircle, TerminalSquare, User2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ChatMessage } from '../../../contracts/chat';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';

interface MessageStreamProps {
  messages: ChatMessage[];
  isRunning: boolean;
}

export function MessageStream({ messages, isRunning }: MessageStreamProps) {
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
  }, [messages, isRunning]);

  return (
    <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-8 pt-6">
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-8">
        {messages.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--muted-foreground)]">
              Workspace ready
            </p>
            <h3 className="text-2xl font-medium text-[var(--foreground)]">
              Ask for a repo-grounded implementation pass.
            </h3>
            <p className="max-w-[42rem] text-sm leading-7 text-[var(--muted-foreground)]">
              Build on the live workspace state, OpenAI responses, and local file search.
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageEntry key={message.id} message={message} />
        ))}

        {isRunning ? <ThinkingRow /> : null}
      </div>
    </div>
  );
}

function MessageEntry({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <article className={cn('space-y-3', isUser ? 'ml-auto w-full max-w-[760px]' : 'w-full')}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[var(--muted-foreground)]">
        <span
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-full border',
            isUser
              ? 'border-[color-mix(in_srgb,var(--primary)_28%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]'
              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]',
          )}
        >
          {isUser ? <User2 className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <span>{isUser ? 'Operator' : 'Mate-X'}</span>
        <span className="text-[var(--muted-foreground)]">{formatTimestamp(message.createdAt)}</span>
      </div>

      <div className={cn('space-y-4', isUser ? 'pl-8' : 'pl-8')}>
        <p className="whitespace-pre-wrap text-[15px] leading-8 text-[var(--foreground)]">
          {message.content}
        </p>

        {message.artifacts?.length ? (
          <div className="flex flex-wrap gap-2">
            {message.artifacts.map((artifact) => (
              <span
                key={artifact.id}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
                  artifact.tone === 'success'
                    ? 'border-emerald-400/18 bg-emerald-400/10 text-emerald-300'
                    : artifact.tone === 'warning'
                      ? 'border-amber-400/18 bg-amber-400/10 text-amber-300'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]',
                )}
              >
                <span className="text-[var(--muted-foreground)]">{artifact.label}</span>
                <span>{artifact.value}</span>
              </span>
            ))}
          </div>
        ) : null}

        {message.events?.length ? (
          <section className="rounded-[24px] border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.26em] text-[var(--muted-foreground)]">
              <TerminalSquare className="size-3.5" />
              Tool calls ({message.events.length})
            </div>
            <div className="mt-3 space-y-2">
              {message.events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-[18px] border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                      <CornerDownRight className="size-3.5 text-[var(--muted-foreground)]" />
                      {event.label}
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
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

function ThinkingRow() {
  return (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.26em] text-[var(--muted-foreground)]">
      <LoaderCircle className="size-4 animate-spin text-[var(--primary)]" />
      Thinking with OpenAI
    </div>
  );
}
