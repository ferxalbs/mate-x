import {
  ActivityIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  GitBranchIcon,
  Loader2Icon,
  MapIcon,
  PanelRightIcon,
  PlusIcon,
  TargetIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../../../components/ui/menu';
import { SidebarTrigger, useSidebar } from '../../../components/ui/sidebar';
import type { Conversation, RunStatus } from '../../../contracts/chat';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import type { Appearance } from '../../../hooks/use-theme';
import { cn } from '../../../lib/utils';
import { openWorkspacePath } from '../../../services/repo-client';

interface ChatTopbarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation | null;
  resolvedTheme: 'light' | 'dark';
  runStatus: RunStatus;
  onCreateThread: () => void;
  onImportWorkspace: () => Promise<void>;
  onAppearanceChange: (appearance: Appearance) => void;
}

function TitlebarButton({
  children,
  onClick,
  className,
}: {
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      className={cn(
        'h-8 rounded-full border-border/55 bg-background/55 px-3 text-[12px] font-medium text-foreground/85 shadow-none hover:border-primary/35 hover:bg-primary/10 hover:text-primary',
        className,
      )}
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
}: ChatTopbarProps) {
  const { state } = useSidebar();
  const [openTarget, setOpenTarget] = useState('folder');
  const [gitAction, setGitAction] = useState('commit-push');
  const title = conversation?.title ?? 'No active thread';
  const eventCount = conversation?.messages.length ?? 0;
  const liveLabel = runStatus === 'running' ? 'Live running' : eventCount > 0 ? 'Live ready' : 'Live idle';
  const liveTone =
    runStatus === 'running'
      ? 'border-blue-400/45 bg-blue-500/14 text-blue-300 hover:bg-blue-500/18'
      : eventCount > 0
        ? 'border-emerald-400/45 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/18'
        : 'border-[var(--panel-border)]/60 bg-background/55 text-foreground/80';
  const toggleLivePanel = () => {
    window.dispatchEvent(new Event('mate:toggle-enhancement-panel'));
  };
  const sendLiveCommand = (detail: { action?: 'open' | 'scan'; view?: 'trace' | 'impact' | 'validation' | 'evidence' }) => {
    window.dispatchEvent(new CustomEvent('mate:enhancement-panel-command', { detail }));
  };

  return (
    <header
      className={cn(
        'drag-region glass sticky top-0 z-10 flex h-[52px] items-center justify-between gap-3 border-b border-[var(--titlebar-border)]/40 px-4 transition-[padding-left] duration-200 ease-linear',
        state === 'collapsed' && 'pl-[88px]',
      )}
      style={{ '--glass-bg': 'var(--titlebar)' } as any}
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
          <MenuTrigger render={<TitlebarButton className={liveTone} onClick={toggleLivePanel} />}>
            {runStatus === 'running' ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <ActivityIcon className="size-3.5" />
            )}
            <span>{liveLabel}</span>
            <span className="rounded-full bg-background/45 px-1.5 py-0.5 text-[10px] text-current/80">
              {eventCount}
            </span>
            <ChevronDownIcon className="size-3.5 text-current/65" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => sendLiveCommand({ action: 'open' })}>
              <PanelRightIcon className="size-3.5" />
              Open panel
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ action: 'scan' })}>
              <GitBranchIcon className="size-3.5" />
              Scan impact
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: 'trace' })}>
              <ActivityIcon className="size-3.5" />
              TRACE
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: 'impact' })}>
              <MapIcon className="size-3.5" />
              Impact
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: 'validation' })}>
              <TargetIcon className="size-3.5" />
              Validation
            </MenuItem>
            <MenuItem onClick={() => sendLiveCommand({ view: 'evidence' })}>
              <FileSearchIcon className="size-3.5" />
              Evidence
            </MenuItem>
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
      </div>
    </header>
  );
}
