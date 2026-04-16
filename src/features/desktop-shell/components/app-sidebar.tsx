import {
  Folder,
  FolderGit2,
  GitBranch,
  MoonStar,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  SunMedium,
} from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import type { Conversation } from '../../../contracts/chat';
import type { SearchMatch, WorkspaceSummary } from '../../../contracts/workspace';
import { cn } from '../../../lib/utils';
import {
  formatRelativeTimestamp,
  getConversationPreview,
  getWorkspaceFact,
} from '../model';
import { SettingsDialog } from './settings-dialog';
import type { Theme } from '../../../hooks/use-theme';

function MateWordmark() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
      </div>
      <span className="text-[13px] font-semibold tracking-[0.12em] text-[var(--foreground)]">
        MATE X
      </span>
      <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
        Desktop
      </span>
    </div>
  );
}

interface AppSidebarProps {
  workspace: WorkspaceSummary | null;
  activeThreadId: string;
  threads: Conversation[];
  repoFiles: string[];
  repoSignals: SearchMatch[];
  theme: Theme;
  onCreateThread: () => void;
  onSelectThread: (threadId: string) => void;
  onThemeChange: (theme: Theme) => void;
}

export function AppSidebar({
  workspace,
  activeThreadId,
  threads,
  repoFiles,
  repoSignals,
  theme,
  onCreateThread,
  onSelectThread,
  onThemeChange,
}: AppSidebarProps) {
  const aiProvider = getWorkspaceFact(workspace, 'AI provider');

  return (
    <aside className="relative flex h-full min-h-0 w-[274px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
      <div className="drag-region flex h-10 items-center border-b border-[var(--titlebar-border)] px-4">
        <MateWordmark />
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--muted-foreground)]">
              Projects
            </p>
            <h1 className="truncate pt-1 text-sm font-medium text-[var(--sidebar-foreground)]">
              {workspace?.name ?? 'Mate-X'}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Create thread"
              className="text-[var(--muted-foreground)]"
              onClick={onCreateThread}
              size="icon-xs"
              variant="ghost"
            >
              <Plus className="size-3.5" />
            </Button>
            <SettingsDialog repoFiles={repoFiles} repoSignals={repoSignals} workspace={workspace} />
          </div>
        </div>

        <button
          className="mt-3 flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-accent)]"
          onClick={() => workspace && onSelectThread(activeThreadId)}
          type="button"
        >
          <Folder className="size-4 text-[var(--muted-foreground)]" />
          <span className="truncate">{workspace?.name ?? 'workspace'}</span>
        </button>
      </div>

      <div className="border-t border-[var(--sidebar-border)] px-4 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            className="bg-transparent [&_[data-slot=input]]:pl-8"
            placeholder="Search threads"
            size="sm"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        <section className="border-b border-[var(--sidebar-border)] px-1 pb-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
              Workspace
            </p>
            <Badge variant="outline" size="sm">
              {workspace?.status ?? 'ready'}
            </Badge>
          </div>
          <div className="rounded-2xl border border-[var(--sidebar-border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_96%,white_4%)_0%,var(--surface)_100%)] px-3 py-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-[var(--sidebar-accent)] p-2 text-[var(--foreground)]">
                <FolderGit2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {workspace?.name ?? 'mate-x'}
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <GitBranch className="size-3.5" />
                  <span>{workspace?.branch ?? 'main'}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">
                  {workspace?.path ?? 'Preparing workspace metadata'}
                </p>
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  {aiProvider ?? 'OpenAI key missing'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-1 py-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
              Threads
            </p>
            <span className="text-xs text-[var(--muted-foreground)]">{threads.length}</span>
          </div>
          <div className="space-y-1">
            {threads.map((thread) => {
              const isActive = thread.id === activeThreadId;

              return (
                <button
                  key={thread.id}
                  className={cn(
                    'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                    isActive
                      ? 'border-[color-mix(in_srgb,var(--primary)_18%,var(--sidebar-border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface))] text-[var(--foreground)]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--foreground)]',
                  )}
                  onClick={() => onSelectThread(thread.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {thread.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">
                        {getConversationPreview(thread)}
                      </p>
                    </div>
                    <span className="shrink-0 pt-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      {formatRelativeTimestamp(thread.lastUpdatedAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-auto px-1 pt-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
              Repo surface
            </p>
            <span className="text-xs text-[var(--muted-foreground)]">{repoSignals.length}</span>
          </div>
          <div className="space-y-1.5">
            {repoSignals.slice(0, 3).map((item, index) => (
              <Fragment key={`${item.file}:${item.line}`}>
                <div className="px-3 py-1 text-xs text-[var(--muted-foreground)]">
                  <p className="truncate uppercase tracking-[0.16em]">{item.file}:{item.line}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--foreground)]">
                    {item.text}
                  </p>
                </div>
                {index < Math.min(repoSignals.length, 3) - 1 ? (
                  <div className="mx-3 border-b border-[var(--sidebar-border)]" />
                ) : null}
              </Fragment>
            ))}
          </div>
        </section>
      </div>

      <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
        <Button className="w-full justify-start rounded-xl" size="sm" variant="secondary">
          <RefreshCcw className="size-3.5" />
          Restart to update
        </Button>
        <div className="mt-3 flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-1">
            <Button
              aria-label="Use light theme"
              onClick={() => onThemeChange('light')}
              size="icon-xs"
              variant={theme === 'light' ? 'outline' : 'ghost'}
            >
              <SunMedium className="size-3.5" />
            </Button>
            <Button
              aria-label="Use dark theme"
              onClick={() => onThemeChange('dark')}
              size="icon-xs"
              variant={theme === 'dark' ? 'outline' : 'ghost'}
            >
              <MoonStar className="size-3.5" />
            </Button>
            <Button
              aria-label="Use system theme"
              onClick={() => onThemeChange('system')}
              size="icon-xs"
              variant={theme === 'system' ? 'outline' : 'ghost'}
            >
              <Settings2 className="size-3.5" />
            </Button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{repoFiles.length} mapped files</p>
        </div>
      </div>
    </aside>
  );
}
