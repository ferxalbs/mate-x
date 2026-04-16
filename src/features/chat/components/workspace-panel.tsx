import { FolderOpen, Layers3, ShieldCheck } from 'lucide-react';

import type { WorkspaceSummary } from '../../../contracts/workspace';

interface WorkspacePanelProps {
  workspace: WorkspaceSummary | null;
}

export function WorkspacePanel({ workspace }: WorkspacePanelProps) {
  return (
    <aside className="flex flex-col gap-5 rounded-[1.75rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.24)]">
      <section>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          <FolderOpen className="size-3.5" />
          workspace
        </div>

        <h2 className="mt-4 text-lg font-medium">{workspace?.name ?? 'Loading…'}</h2>
        <p className="mt-2 break-all text-sm leading-6 text-[var(--muted-foreground)]">
          {workspace?.path ?? 'Preparing local workspace summary.'}
        </p>
      </section>

      <section>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          stack
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {workspace?.stack.map((item) => (
            <span
              key={item}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--foreground)]"
            >
              {item}
            </span>
          )) ?? null}
        </div>
      </section>

      <section>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          repo facts
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {workspace?.facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <span className="text-sm text-[var(--muted-foreground)]">{fact.label}</span>
              <span className="text-sm font-medium">{fact.value}</span>
            </div>
          )) ?? null}
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent-soft)_65%,transparent),transparent)] p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent)]">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h3 className="font-medium">Audit direction</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              The next layer is typed IPC for commands, repo reads, and permission-gated actions.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent)]">
            <Layers3 className="size-5" />
          </div>
          <div>
            <h3 className="font-medium">Modular layers</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              `contracts` + `services` + `store` + `features` keeps the runtime replaceable.
            </p>
          </div>
        </div>
      </section>
    </aside>
  );
}
