import { Bot, CheckCircle2, Info, TerminalSquare, TriangleAlert, User2 } from 'lucide-react';

import type { AuditFinding } from '../../../contracts/audit';
import type { ChatMessage } from '../../../contracts/chat';
import { formatTimestamp } from '../../../lib/time';
import { cn } from '../../../lib/utils';

interface MessageStreamProps {
  messages: ChatMessage[];
}

export function MessageStream({ messages }: MessageStreamProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-5 pt-3 sm:px-5">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
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
        'rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.14)]',
        isUser
          ? 'ml-auto w-full max-w-3xl border-[color-mix(in_srgb,var(--primary)_26%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]'
          : 'w-full border-[var(--border)] bg-[var(--surface)]',
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          <span className={cn('inline-flex size-7 items-center justify-center rounded-full', isUser ? 'bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-[var(--primary)]' : 'bg-[var(--surface-soft)] text-[var(--foreground)]')}>
            {isUser ? <User2 className="size-3.5" /> : <Bot className="size-3.5" />}
          </span>
          {isUser ? 'Operator' : 'Mate-X'}
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">{formatTimestamp(message.createdAt)}</span>
      </div>

      <div className="px-4 py-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">{message.content}</p>

        {message.events?.length ? (
          <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <TerminalSquare className="size-4 text-[var(--primary)]" />
              Execution trace
            </div>
            <div className="mt-3 space-y-3">
              {message.events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{event.label}</span>
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

        {message.report ? (
          <section className="mt-4 space-y-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Audit summary
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                {message.report.summary}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {message.report.checkedAreas.map((area) => (
                  <span
                    key={area}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]"
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>

            {message.report.findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </section>
        ) : null}
      </div>
    </article>
  );
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const icon =
    finding.severity === 'critical' ? (
      <TriangleAlert className="size-4" />
    ) : finding.severity === 'warning' ? (
      <Info className="size-4" />
    ) : (
      <CheckCircle2 className="size-4" />
    );

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
          <span
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-full',
              finding.severity === 'critical'
                ? 'bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)] text-[var(--destructive)]'
                : finding.severity === 'warning'
                  ? 'bg-[color-mix(in_srgb,orange_16%,transparent)] text-orange-300'
                  : 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]',
            )}
          >
            {icon}
          </span>
          {finding.title}
        </div>
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          {finding.severity}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">{finding.summary}</p>
      <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
        {finding.file}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{finding.recommendation}</p>
    </section>
  );
}
