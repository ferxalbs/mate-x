import { Bot, FolderGit2, GitBranch, MonitorCog, MoonStar, SunMedium } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import type { Conversation } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import type { Theme } from '../../../hooks/use-theme';
import { getWorkspaceFact } from '../model';

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation;
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  onThemeChange: (theme: Theme) => void;
}

export function ChatTopbar({
  workspace,
  conversation,
  theme,
  resolvedTheme,
  onThemeChange,
}: ChatTopbarProps) {
  const provider = getWorkspaceFact(workspace, 'AI provider');
  const fileCount = getWorkspaceFact(workspace, 'Tracked files');

  return (
    <header className="drag-region flex h-10 items-center justify-between gap-3 border-b border-[var(--titlebar-border)] bg-[var(--titlebar)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
            <Bot className="size-3" />
            Active thread
          </div>
          <h2 className="truncate text-sm font-medium text-[var(--foreground)]">
            {conversation.title}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="min-w-0 overflow-hidden">
          <FolderGit2 className="size-3" />
          <span className="truncate">{workspace?.name ?? 'mate-x'}</span>
        </Badge>
        <Badge variant="outline">
          <GitBranch className="size-3" />
          {workspace?.branch ?? 'main'}
        </Badge>
        <Badge variant="outline">
          <MonitorCog className="size-3" />
          {provider ?? 'OpenAI status'}
        </Badge>
        {fileCount ? <Badge variant="outline">{fileCount} files</Badge> : null}
        <div className="drag-region ml-1 flex items-center gap-1">
          <Button
            aria-label="Light theme"
            className="rounded-full"
            onClick={() => onThemeChange('light')}
            size="icon-xs"
            variant={theme === 'light' ? 'outline' : 'ghost'}
          >
            <SunMedium className="size-3.5" />
          </Button>
          <Button
            aria-label="Dark theme"
            className="rounded-full"
            onClick={() => onThemeChange('dark')}
            size="icon-xs"
            variant={theme === 'dark' ? 'outline' : 'ghost'}
          >
            <MoonStar className="size-3.5" />
          </Button>
          <Button
            aria-label="System theme"
            className="rounded-full"
            onClick={() => onThemeChange('system')}
            size="icon-xs"
            variant={theme === 'system' ? 'outline' : 'ghost'}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              {resolvedTheme === 'dark' ? 'D' : 'L'}
            </span>
          </Button>
        </div>
      </div>
    </header>
  );
}
