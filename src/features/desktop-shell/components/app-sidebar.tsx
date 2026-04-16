import {
  Command,
  FolderGit2,
  GitBranch,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';

import { Input } from '../../../components/ui/input';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { buildSidebarSections, type SidebarFactItem } from '../model';
import type { Conversation } from '../../../contracts/chat';

interface AppSidebarProps {
  workspace: WorkspaceSummary | null;
  conversation: Conversation;
}

export function AppSidebar({ workspace, conversation }: AppSidebarProps) {
  const sections = buildSidebarSections(workspace, conversation);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
      <div className="drag-region flex h-[52px] items-center gap-2 px-4 pl-[90px]">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-[0.18em] text-[var(--muted-foreground)] uppercase">
            Mate X
          </p>
        </div>
      </div>

      <div className="border-b border-[var(--sidebar-border)] px-3 pb-3 pt-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
              Mate-X
            </p>
            <h1 className="truncate text-base font-semibold text-[var(--sidebar-foreground)]">
              Desktop Agent
            </h1>
          </div>
          <button
            className="inline-flex size-7 items-center justify-center rounded-lg border border-transparent bg-transparent text-[var(--muted-foreground)] transition hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]"
            type="button"
          >
            <Command className="size-3.5" />
          </button>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            className="[&_[data-slot=input]]:pl-8"
            placeholder="Search threads, repos, commands"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button className="flex-1 justify-center" size="sm">
            <Plus className="size-4" />
            New thread
          </Button>
          <Button size="icon" variant="ghost" className="size-8">
            <Settings2 className="size-4" />
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
          <div className="mx-1 rounded-lg border border-[var(--sidebar-border)] bg-[var(--surface-soft)] p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-[var(--sidebar-accent)] p-1.5 text-[var(--foreground)]">
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
              </div>
            </div>
          </div>
        </section>

        {sections.map((section) => (
          <section key={section.id} className="mt-5">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                {section.title}
              </p>
              <span className="text-xs text-[var(--muted-foreground)]">{section.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => (
                <SidebarFactRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function SidebarFactRow({ item }: { item: SidebarFactItem }) {
  return (
    <div
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition',
        item.tone === 'critical'
          ? 'border-[color-mix(in_srgb,var(--destructive)_24%,var(--sidebar-border))] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)]'
          : item.tone === 'warning'
            ? 'border-[color-mix(in_srgb,orange_20%,var(--sidebar-border))] bg-[color-mix(in_srgb,orange_10%,transparent)]'
            : 'border-[var(--sidebar-border)] bg-[var(--surface-soft)]',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          {item.label}
        </p>
        <p className="mt-1 text-sm leading-5 text-[var(--foreground)]">{item.value}</p>
      </div>
    </div>
  );
}
