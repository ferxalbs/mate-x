import { Bot, FolderGit2, GitBranch, Plus, Sparkles } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import type { Conversation, RunStatus } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import type { Theme } from '../../../hooks/use-theme';
import { getWorkspaceFact } from '../model';

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation;
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  runStatus: RunStatus;
  onCreateThread: () => void;
  onSelectThread: (threadId: string) => void;
  onThemeChange: (theme: Theme) => void;
}

function statusCopy(runStatus: RunStatus) {
  if (runStatus === 'running') {
    return { label: 'Working', tone: 'text-cyan-300' };
  }
  if (runStatus === 'failed') {
    return { label: 'Needs attention', tone: 'text-rose-300' };
  }
  if (runStatus === 'completed') {
    return { label: 'Completed', tone: 'text-emerald-300' };
  }
  return { label: 'Idle', tone: 'text-[var(--muted-foreground)]' };
}

export function ChatTopbar({
  workspace,
  conversation,
  theme,
  resolvedTheme,
  runStatus,
  onCreateThread,
  onSelectThread,
  onThemeChange,
}: ChatTopbarProps) {
  const provider = getWorkspaceFact(workspace, 'AI provider');
  const model = getWorkspaceFact(workspace, 'Model');
  const status = statusCopy(runStatus);

  return (
    <header className="drag-region flex h-12 items-center justify-between gap-3 border-b border-[var(--titlebar-border)] bg-[var(--titlebar)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
            <Bot className="size-3" />
            Active thread
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-medium text-[var(--foreground)]">
              {conversation.title}
            </h2>
            <span className={['text-[10px] uppercase tracking-[0.22em]', status.tone].join(' ')}>
              {status.label}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" size="sm" className="min-w-0 overflow-hidden">
          <FolderGit2 className="size-3" />
          <span className="truncate">{workspace?.name ?? 'mate-x'}</span>
        </Badge>
        <Badge variant="outline" size="sm">
          <GitBranch className="size-3" />
          {workspace?.branch ?? 'main'}
        </Badge>
        <Badge variant="outline" size="sm">
          <Sparkles className="size-3" />
          {provider ?? 'OpenAI'}
        </Badge>
        {model ? (
          <Badge variant="outline" size="sm">
            {model}
          </Badge>
        ) : null}
        <div className="drag-region ml-1 flex items-center gap-1">
          <Button
            aria-label="Create thread"
            onClick={onCreateThread}
            size="icon-xs"
            variant="ghost"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            aria-label="Light theme"
            onClick={() => onThemeChange('light')}
            size="icon-xs"
            variant={theme === 'light' ? 'outline' : 'ghost'}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">L</span>
          </Button>
          <Button
            aria-label="Dark theme"
            onClick={() => onThemeChange('dark')}
            size="icon-xs"
            variant={theme === 'dark' ? 'outline' : 'ghost'}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">D</span>
          </Button>
          <Button
            aria-label="System theme"
            onClick={() => onThemeChange('system')}
            size="icon-xs"
            variant={theme === 'system' ? 'outline' : 'ghost'}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              {resolvedTheme === 'dark' ? 'N' : 'Y'}
            </span>
          </Button>
          <Button
            aria-label="Select active thread"
            onClick={() => onSelectThread(conversation.id)}
            size="icon-xs"
            variant="ghost"
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">↗</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
