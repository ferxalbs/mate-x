import { Bot, GitBranch, PanelLeftClose } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import type { Conversation } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation;
}

export function ChatTopbar({ workspace, conversation }: ChatTopbarProps) {
  return (
    <header className="drag-region flex h-[52px] items-center justify-between gap-3 border-b border-[var(--border)] px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          className="inline-flex size-7 items-center justify-center rounded-lg border border-transparent bg-transparent text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)] lg:hidden"
          type="button"
        >
          <PanelLeftClose className="size-4" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            <Bot className="size-3" />
            Active Thread
          </div>
          <h2 className="truncate text-sm font-medium text-[var(--foreground)]">
            {conversation.title}
          </h2>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="min-w-0 overflow-hidden">
          <span className="truncate">{workspace?.name ?? 'mate-x'}</span>
        </Badge>
        <Badge variant="outline">
          <GitBranch className="size-3" />
          {workspace?.branch ?? 'main'}
        </Badge>
      </div>
    </header>
  );
}
