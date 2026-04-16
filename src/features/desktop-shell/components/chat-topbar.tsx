import { Bot, FolderGit2, GitBranch, Sparkles } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import type { Conversation } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { getWorkspaceFact } from '../model';

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation;
}

export function ChatTopbar({ workspace, conversation }: ChatTopbarProps) {
  const provider = getWorkspaceFact(workspace, 'AI provider');
  const fileCount = getWorkspaceFact(workspace, 'Tracked files');

  return (
    <header className="drag-region flex h-[52px] items-center justify-between gap-3 border-b border-[var(--border)] px-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            <Bot className="size-3" />
            Active thread
          </div>
          <h2 className="truncate text-sm font-medium text-[var(--foreground)]">
            {conversation.title}
          </h2>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="min-w-0 overflow-hidden">
          <FolderGit2 className="size-3" />
          <span className="truncate">{workspace?.name ?? 'mate-x'}</span>
        </Badge>
        <Badge variant="outline">
          <GitBranch className="size-3" />
          {workspace?.branch ?? 'main'}
        </Badge>
        <Badge variant="outline">
          <Sparkles className="size-3" />
          {provider ?? 'OpenAI status'}
        </Badge>
        {fileCount ? <Badge variant="outline">{fileCount} files</Badge> : null}
      </div>
    </header>
  );
}
