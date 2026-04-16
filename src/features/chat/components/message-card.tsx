import { AlertTriangle, CheckCircle2, Info, TerminalSquare } from 'lucide-react';

import type { AuditFinding } from '../../../contracts/audit';
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

      {message.events && message.events.length > 0 ? (
        <div className="mt-4 rounded-[1.25rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--background)_16%,transparent)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TerminalSquare className="size-4" />
            Execution trace
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {message.events.map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{event.label}</span>
                  <span className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                    {event.status}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  {event.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message.report ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-[1.25rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--background)_16%,transparent)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              audit summary
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {message.report.summary}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {message.report.checkedAreas.map((area) => (
                <span
                  key={area}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>

          {message.report.findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function FindingCard({ finding }: { finding: AuditFinding }) {
  const icon =
    finding.severity === 'critical' ? (
      <AlertTriangle className="size-4" />
    ) : finding.severity === 'warning' ? (
      <Info className="size-4" />
    ) : (
      <CheckCircle2 className="size-4" />
    );

  return (
    <section className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {finding.title}
        </div>
        <span className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
          {finding.severity}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{finding.summary}</p>
      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
        {finding.file}
      </p>
      <p className="mt-2 text-sm leading-6">{finding.recommendation}</p>
    </section>
  );
}
