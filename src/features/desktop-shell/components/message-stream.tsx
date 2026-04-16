import { LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import type { ChatMessage } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';

interface MessageStreamProps {
  messages: ChatMessage[];
  isRunning: boolean;
  workspace: WorkspaceSummary | null;
}

export function MessageStream({ messages, isRunning, workspace }: MessageStreamProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const visibleMessages = useMemo(() => {
    if (messages.length > 0) {
      return messages;
    }

    return [
      {
        id: 'welcome-message',
        role: 'assistant' as const,
        content: `Hi! What do you want to work on in ${workspace?.name ?? 'mate-x'}?`,
        createdAt: new Date().toISOString(),
      },
    ];
  }, [messages, workspace?.name]);

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
        <div className="flex flex-1 flex-col gap-8">
          {visibleMessages.map((message, index) => (
            <MessageEntry
              key={message.id}
              message={message}
              isGreeting={messages.length === 0 && index === 0}
            />
          ))}

          {isRunning ? <ThinkingRow /> : null}
        </div>
      </div>
    </div>
  );
}

function MessageEntry({
  message,
  isGreeting,
}: {
  message: ChatMessage;
  isGreeting: boolean;
}) {
  const isUser = message.role === 'user';

  if (isGreeting) {
    return (
      <article className="mt-16 pl-6">
        <p className="max-w-[620px] text-[28px] font-medium tracking-[-0.02em] text-foreground">
          {message.content}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatTimestamp(message.createdAt)}
          {' · '}
          9.5s
        </p>
      </article>
    );
  }

  if (isUser) {
    return (
      <article className="ml-auto flex w-full max-w-[340px] justify-end">
        <div className="rounded-[18px] border border-border/80 bg-[var(--surface)] px-5 py-4 text-right shadow-none">
          <p className="whitespace-pre-wrap text-[24px] font-medium tracking-[-0.02em] text-foreground">
            {message.content}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{formatTimestamp(message.createdAt)}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="pl-6">
      <p className="max-w-[760px] whitespace-pre-wrap text-[15px] leading-7 text-foreground">
        {message.content}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{formatTimestamp(message.createdAt)}</p>

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
