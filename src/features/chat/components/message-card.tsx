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
      {message.factoryRun ? <FactoryRunCard message={message} /> : null}
    </article>
  );
}

function FactoryRunCard({ message }: { message: ChatMessage }) {
  const run = message.factoryRun;
  if (!run) return null;

  return (
    <section className="mt-4 rounded-2xl border border-border/70 bg-[var(--panel)]/70 p-3 text-xs shadow-none backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Factory Run
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {run.mode === "ship" ? "Ship workflow" : "Engineering workflow"}
          </div>
        </div>
        <span className="rounded-full border border-border/70 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          approval required
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {run.stages.map((stage) => (
          <div key={stage.id} className="rounded-2xl border border-border/70 bg-transparent p-2 shadow-none">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">{stage.label}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider", stageTone(stage.status))}>
                {stage.status}
              </span>
            </div>
            <p className="mt-1 break-words text-muted-foreground">{stage.summary}</p>
          </div>
        ))}
      </div>

      {run.shipProof ? (
        <div className="mt-3 rounded-2xl border border-border/70 bg-transparent p-3 shadow-none">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Ship Proof
          </div>
          <div className="mt-2 grid gap-1.5 text-muted-foreground sm:grid-cols-2">
            <span>Verdict: {run.shipProof.verdict}</span>
            <span>Touched files: {run.shipProof.touchedFilesCount}</span>
            <span>Privacy: {run.shipProof.privacyStatus}</span>
            <span>Git: {run.shipProof.gitStatus}</span>
            <span className="break-words sm:col-span-2">
              Validation: {run.shipProof.validationCommands.join(", ") || "missing"}
            </span>
            <span className="break-words sm:col-span-2">
              Risk surfaces: {run.shipProof.riskSurfaces.join(", ") || "none recorded"}
            </span>
            <span className="break-words sm:col-span-2">
              Passed evidence: {run.shipProof.passedEvidence.join(", ") || "none recorded"}
            </span>
            <span className="break-words sm:col-span-2">
              Failed evidence: {run.shipProof.failedEvidence.join(", ") || "none recorded"}
            </span>
            <span className="break-words sm:col-span-2">
              Missing evidence: {run.shipProof.missingEvidence.join(", ") || "none recorded"}
            </span>
          </div>
        </div>
      ) : null}

      {run.ratchetSuggestions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {run.ratchetSuggestions.map((suggestion) => (
            <div key={suggestion.id} className="rounded-2xl border border-border/70 bg-transparent p-3 shadow-none">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Suggested repo rule for {suggestion.target}
              </div>
              <p className="mt-1 break-words text-muted-foreground">{suggestion.reason}</p>
              <p className="mt-2 break-words font-mono text-[11px] text-foreground">{suggestion.rule}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestion.actions.map((action) => (
                  <button
                    key={action}
                    className="rounded-full border border-border/70 bg-transparent px-3 py-1 text-[11px] text-foreground shadow-none"
                    type="button"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function stageTone(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/12 text-emerald-500";
    case "blocked":
    case "missing":
      return "bg-amber-500/12 text-amber-500";
    case "active":
      return "bg-primary/12 text-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
}
