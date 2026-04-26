import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PlusIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../../../components/ui/menu';
import { SidebarTrigger, useSidebar } from '../../../components/ui/sidebar';
import type { Conversation, RunStatus } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import type { Theme } from '../../../hooks/use-theme';
import { cn } from '../../../lib/utils';
import { openWorkspacePath } from '../../../services/repo-client';

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation | null;
  resolvedTheme: 'light' | 'dark';
  runStatus: RunStatus;
  onCreateThread: () => void;
  onImportWorkspace: () => Promise<void>;
  onThemeChange: (theme: Theme) => void;
}

function TitlebarButton({
  children,
  onClick,
}: {
  children?: ReactNode;
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
  runStatus,
  onCreateThread,
  onImportWorkspace,
  onThemeChange,
}: ChatTopbarProps) {
  const { state } = useSidebar();
  const [openTarget, setOpenTarget] = useState('folder');
  const [gitAction, setGitAction] = useState('commit-push');
  const title = conversation?.title ?? 'No active thread';
  const openImpactPanel = () => {
    window.dispatchEvent(new CustomEvent('mate:open-impact-panel'));
  };

  return (
    <header
      className={cn(
        'drag-region flex h-[52px] items-center justify-between gap-3 border-b border-[var(--titlebar-border)] bg-[var(--titlebar)] px-4 transition-[padding-left] duration-200 ease-linear',
        state === 'collapsed' && 'pl-[88px]',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="no-drag h-8 w-8 rounded-full bg-transparent text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground" />
        <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground/92">
          {title}
        </h2>
        {workspace ? (
          <span className="rounded-md border border-border/60 bg-background/55 px-2 py-1 text-[11px] text-muted-foreground">
            {workspace.name}
          </span>
        ) : null}
        {runStatus === 'running' ? (
          <span className="rounded-md bg-accent px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Running
          </span>
        ) : null}
      </div>

      <div className="no-drag flex shrink-0 items-center gap-2">
        <Menu>
          <MenuTrigger render={<TitlebarButton />}>
            <PlusIcon className="size-3.5" />
            Add action
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={onCreateThread}>New thread</MenuItem>
            <MenuItem onClick={() => void onImportWorkspace()}>Import folder</MenuItem>
            <MenuItem>Search project</MenuItem>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger render={<TitlebarButton onClick={() => undefined} />}>
            <ExternalLinkIcon className="size-3.5" />
            {openTarget === 'folder' ? 'Open' : openTarget === 'vscode' ? 'VS Code' : 'Terminal'}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() => {
                setOpenTarget('folder');
                void openWorkspacePath('folder');
              }}
            >
              Open
            </MenuItem>
            <MenuItem
              onClick={() => {
                setOpenTarget('vscode');
                void openWorkspacePath('vscode');
              }}
            >
              Open in VS Code
            </MenuItem>
            <MenuItem
              onClick={() => {
                setOpenTarget('terminal');
                void openWorkspacePath('terminal');
              }}
            >
              Open in Terminal
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger render={<TitlebarButton onClick={() => undefined} />}>
            <GitBranchIcon className="size-3.5" />
            {gitAction === 'commit-push'
              ? 'Commit & push'
              : gitAction === 'commit'
                ? 'Commit'
                : 'Push & PR'}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => setGitAction('commit')}>Commit</MenuItem>
            <MenuItem onClick={() => setGitAction('commit-push')}>Commit &amp; push</MenuItem>
            <MenuItem onClick={() => setGitAction('push-pr')}>Push &amp; PR</MenuItem>
          </MenuPopup>
        </Menu>
        <Button
          aria-label="Create thread"
          size="icon-xs"
          variant="outline"
          className="size-8 rounded-lg border-border/70 bg-background/65 shadow-none hover:bg-accent"
          onClick={onCreateThread}
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Analyze change impact"
          size="xs"
          variant="outline"
          className="h-8 rounded-lg border-border/70 bg-background/65 px-3 text-[12px] font-medium shadow-none hover:bg-accent"
          onClick={openImpactPanel}
        >
          <ShieldCheckIcon className="size-3.5" />
          Analyze
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={
                  workspace?.branch ? `Current checkout ${workspace.branch}` : 'Current checkout'
                }
                size="icon-xs"
                variant="outline"
                className="size-8 rounded-lg border-border/70 bg-background/65 shadow-none hover:bg-accent"
              />
            }
          >
            <EllipsisVerticalIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => onThemeChange('light')}>Light mode</MenuItem>
            <MenuItem onClick={() => onThemeChange('dark')}>Dark mode</MenuItem>
            <MenuItem onClick={() => onThemeChange('system')}>System mode</MenuItem>
            <MenuItem>{workspace?.branch ?? 'main'}</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </header>
  );
}
