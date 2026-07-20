import { BotIcon, GitBranchIcon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { WorkspaceSummary } from '../../../contracts/workspace';

interface ChatHeaderProps {
  workspace: WorkspaceSummary | null;
}

export function ChatHeader({ workspace }: ChatHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">
          mate x
        </p>
        <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground/90">Native repo chat</h1>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-mate-control-bg px-2.5 py-1 text-[11px] font-mono tracking-tight">
          <HugeiconsIcon icon={Folder01Icon} className="size-3.5 opacity-80" />
          <span>{workspace?.name ?? 'loading'}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-mate-control-bg px-2.5 py-1 text-[11px] font-mono tracking-tight">
          <HugeiconsIcon icon={GitBranchIcon} className="size-3.5 opacity-80" />
          <span>{workspace?.branch ?? '...'}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-mate-control-bg px-2.5 py-1 text-[11px] font-mono tracking-tight">
          <HugeiconsIcon icon={BotIcon} className="size-3.5 opacity-80" />
          <span>audit runtime v0</span>
        </div>
      </div>
    </header>
  );
}

