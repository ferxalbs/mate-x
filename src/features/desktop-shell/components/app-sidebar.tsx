import { ArrowUpRight, FolderGit2, GitBranch, Plus, Search, Sparkles } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { Conversation } from '../../../contracts/chat';
import type { SearchMatch, WorkspaceSummary } from '../../../contracts/workspace';
import { cn } from '../../../lib/utils';
import {
  formatRelativeTimestamp,
  getConversationPreview,
  getWorkspaceFact,
} from '../model';
import { SettingsDialog } from './settings-dialog';

interface AppSidebarProps {
  workspace: WorkspaceSummary | null;
  activeThreadId: string;
  threads: Conversation[];
  repoFiles: string[];
  repoSignals: SearchMatch[];
  onCreateThread: () => void;
  onSelectThread: (threadId: string) => void;
}

export function AppSidebar({
  workspace,
  activeThreadId,
  threads,
  repoFiles,
  repoSignals,
  onCreateThread,
  onSelectThread,
}: AppSidebarProps) {
  const aiProvider = getWorkspaceFact(workspace, 'AI provider');

  return (
    <aside className="relative flex h-full min-h-0 w-full flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
      <div className="drag-region flex h-[52px] items-center justify-between gap-2 px-4 pl-[88px]">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.28em] text-[var(--muted-foreground)]">
          Mate-X
        </p>
        <div className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_18px_rgba(74,222,128,0.65)]" />
      </div>

      <div className="border-b border-[var(--sidebar-border)] px-3 pb-3 pt-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
              Desktop agent
            </p>
            <h1 className="truncate text-base font-semibold text-[var(--sidebar-foreground)]">
              {workspace?.name ?? 'Mate-X'}
            </h1>
          </div>
          <SettingsDialog repoFiles={repoFiles} repoSignals={repoSignals} workspace={workspace} />
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input className="[&_[data-slot=input]]:pl-8" placeholder="Search threads, files, commands" />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button className="flex-1 justify-center" size="sm" onClick={onCreateThread}>
            <Plus className="size-4" />
            New thread
          </Button>
          <Button size="icon-sm" variant="ghost" className="shrink-0">
            <Sparkles className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
        <section>
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
              Workspace
            </p>
            <span className="text-xs text-[var(--muted-foreground)]">{workspace?.status ?? '...'}</span>
          </div>
          <div className="mx-1 rounded-[22px] border border-[var(--sidebar-border)] bg-[var(--surface)] p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-[var(--surface-soft)] p-2 text-[var(--foreground)]">
                <FolderGit2 className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{workspace?.name ?? 'Loading workspace'}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                  <GitBranch className="size-3.5" />
                  <span>{workspace?.branch ?? '...'}</span>
                </div>
                <p className="mt-2 truncate text-[11px] text-[var(--muted-foreground)]">
                  {workspace?.path ?? 'Preparing workspace metadata'}
                </p>
                <div className="mt-3 inline-flex rounded-full border border-[var(--sidebar-border)] bg-[var(--sidebar-accent)] px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                  {aiProvider ?? 'Checking OpenAI'}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
              Threads
            </p>
            <span className="text-xs text-[var(--muted-foreground)]">{threads.length}</span>
          </div>
          <div className="space-y-1.5">
            {threads.map((thread) => {
              const isActive = thread.id === activeThreadId;

              return (
                <button
                  key={thread.id}
                  className={cn(
                    'w-full rounded-[20px] border px-3 py-3 text-left transition',
                    isActive
                      ? 'border-[color-mix(in_srgb,var(--primary)_30%,var(--sidebar-border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface))]'
                      : 'border-[var(--sidebar-border)] bg-[var(--surface)] hover:bg-[var(--surface-soft)]',
                  )}
                  onClick={() => onSelectThread(thread.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {thread.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">
                        {getConversationPreview(thread)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      {formatRelativeTimestamp(thread.lastUpdatedAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
              Repo surface
            </p>
            <span className="text-xs text-[var(--muted-foreground)]">{repoSignals.length}</span>
          </div>
          <div className="space-y-1.5">
            {repoSignals.slice(0, 4).map((item) => (
              <div
                key={`${item.file}:${item.line}`}
                className="w-full rounded-[18px] border border-[var(--sidebar-border)] bg-[var(--surface)] px-3 py-2.5"
              >
                <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  {item.file}:{item.line}
                </p>
                <p className="mt-1 text-sm leading-5 text-[var(--foreground)]">{item.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="border-t border-[var(--sidebar-border)] p-3">
        <div className="flex items-center justify-between rounded-[20px] border border-[var(--sidebar-border)] bg-[var(--surface)] px-3 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              System
            </p>
            <p className="mt-1 text-sm text-[var(--foreground)]">{repoFiles.length} mapped files</p>
          </div>
          <div className="inline-flex size-9 items-center justify-center rounded-2xl bg-[var(--surface-soft)] text-[var(--foreground)]">
            <ArrowUpRight className="size-4" />
          </div>
        </div>
      </div>
    </aside>
  );
}
