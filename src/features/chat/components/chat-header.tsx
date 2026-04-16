import { Bot, GitBranch, FolderKanban } from 'lucide-react';

import type { WorkspaceSummary } from '../../../contracts/workspace';

interface ChatHeaderProps {
  workspace: WorkspaceSummary | null;
}

export function ChatHeader({ workspace }: ChatHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          mate x
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Native repo chat</h1>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-[var(--muted-foreground)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <FolderKanban className="size-4" />
          {workspace?.name ?? 'Loading workspace'}
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <GitBranch className="size-4" />
          {workspace?.branch ?? '...'}
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <Bot className="size-4" />
          audit runtime v0
        </div>
      </div>
    </header>
  );
}
