import type { ChatMessage } from '../../../contracts/chat';
import { cn } from '../../../lib/utils';
import { formatTimestamp } from '../../../lib/time';

interface MessageCardProps {
  message: ChatMessage;
}

export function MessageCard({ message }: MessageCardProps) {
  const isUser = message.role === 'user';

  return (
    <article
      className={cn(
        'rounded-[1.75rem] border px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]',
        isUser
          ? 'ml-auto max-w-2xl border-transparent bg-[var(--foreground)] text-[var(--background)]'
          : 'max-w-4xl border-[var(--border)] bg-[var(--surface)]',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs uppercase tracking-[0.18em] opacity-70">
          {isUser ? 'operator' : 'assistant'}
        </span>
        <span className="text-xs opacity-70">{formatTimestamp(message.createdAt)}</span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{message.content}</p>
    </article>
  );
}
