import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PlusIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import type { Conversation, RunStatus } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import type { Theme } from '../../../hooks/use-theme';

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

function TitlebarButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      className="h-8 rounded-full border-border/70 bg-background/65 px-3 text-[12px] font-medium text-foreground/90 shadow-none hover:bg-accent"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function ChatTopbar({
  workspace,
  conversation,
  theme,
  runStatus,
  onCreateThread,
  onSelectThread,
  onThemeChange,
}: ChatTopbarProps) {
  return (
    <header className="drag-region flex h-[52px] items-center justify-between gap-3 border-b border-[var(--titlebar-border)] bg-[var(--titlebar)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate text-sm font-semibold text-foreground">{conversation.title}</h2>
        {runStatus === 'running' ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Running
          </span>
        ) : null}
      </div>

      <div className="no-drag flex shrink-0 items-center gap-2">
        <TitlebarButton>
          <PlusIcon className="size-3.5" />
          Add action
        </TitlebarButton>
        <TitlebarButton onClick={() => onSelectThread(conversation.id)}>
          <ExternalLinkIcon className="size-3.5" />
          Open
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </TitlebarButton>
        <TitlebarButton>
          <GitBranchIcon className="size-3.5" />
          Commit &amp; push
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </TitlebarButton>
        <Button
          aria-label="Create thread"
          size="icon-xs"
          variant="outline"
          className="size-8 rounded-full border-border/70 bg-background/65 shadow-none hover:bg-accent"
          onClick={onCreateThread}
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Toggle theme"
          size="icon-xs"
          variant="outline"
          className="size-8 rounded-full border-border/70 bg-background/65 shadow-none hover:bg-accent"
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
            {theme === 'dark' ? 'N' : 'D'}
          </span>
        </Button>
        <Button
          aria-label={workspace?.branch ? `Current checkout ${workspace.branch}` : 'Current checkout'}
          size="icon-xs"
          variant="outline"
          className="size-8 rounded-full border-border/70 bg-background/65 shadow-none hover:bg-accent"
        >
          <EllipsisVerticalIcon className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}
