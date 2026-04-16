import { MoonStar, PlusIcon, SettingsIcon, SunMedium } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '../../../components/ui/sidebar';
import type { Conversation, RunStatus } from '../../../contracts/chat';
import type { SearchMatch, WorkspaceSummary } from '../../../contracts/workspace';
import type { Theme } from '../../../hooks/use-theme';
import { cn } from '../../../lib/utils';
import { formatRelativeTimestamp } from '../model';

interface AppSidebarProps {
  workspace: WorkspaceSummary | null;
  activeThreadId: string;
  threads: Conversation[];
  repoFiles: string[];
  repoSignals: SearchMatch[];
  theme: Theme;
  runStatus: RunStatus;
  onCreateThread: () => void;
  onSelectThread: (threadId: string) => void;
  onThemeChange: (theme: Theme) => void;
}

function T3Wordmark() {
  return (
    <svg
      aria-label="Mate"
      className="h-2.5 w-auto shrink-0 text-foreground"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

function getThreadStatusLabel(thread: Conversation, isActive: boolean, runStatus: RunStatus) {
  if (isActive && runStatus === 'running') {
    return { label: 'Working', colorClass: 'text-teal-600 dark:text-teal-300/90', dotClass: 'bg-teal-600 dark:bg-teal-300/90', pulse: true };
  }
  if (thread.messages.length > 0) {
    return { label: 'Idle', colorClass: 'text-zinc-500 dark:text-zinc-400', dotClass: 'bg-zinc-500 dark:bg-zinc-400', pulse: false };
  }
  return { label: 'New', colorClass: 'text-zinc-400 dark:text-zinc-500', dotClass: 'bg-zinc-400 dark:bg-zinc-500', pulse: false };
}

export function AppSidebar({
  workspace,
  activeThreadId,
  threads,
  theme,
  runStatus,
  onCreateThread,
  onSelectThread,
  onThemeChange,
}: AppSidebarProps) {
  return (
    <Sidebar
      side="left"
      collapsible="offcanvas"
      className="drag-region border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]"
      style={{ minWidth: '220px' }}
    >
      <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[88px]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="ml-1 flex min-w-0 items-center gap-1.5">
            <T3Wordmark />
            <span className="truncate text-sm font-medium tracking-tight text-foreground">
              Mate X
            </span>
            <span className="rounded-full bg-muted/45 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
              ALPHA
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="no-drag gap-0">
        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <button
              onClick={onCreateThread}
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>

          <SidebarMenu>
            <SidebarMenuItem className="rounded-md">
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 text-[13px] font-medium"
                isActive
              >
                <span className="truncate">{workspace?.name || 'mate-x'}</span>
              </SidebarMenuButton>

              <div className="mt-1 flex flex-col gap-0.5 pl-4 pr-1">
                {threads.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const status = getThreadStatusLabel(thread, isActive, runStatus);

                  return (
                    <button
                      key={thread.id}
                      onClick={() => onSelectThread(thread.id)}
                      className={cn(
                        'group relative flex w-full items-center gap-1.5 overflow-hidden rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            status.dotClass,
                            status.pulse ? 'animate-pulse' : '',
                          )}
                        />
                        <span className="flex-1 truncate">
                          {thread.title || 'New thread'}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center justify-end">
                        <span className="hidden text-[10px] text-muted-foreground/40 group-hover:inline-block">
                          {formatRelativeTimestamp(thread.lastUpdatedAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="no-drag p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex w-full items-center justify-between px-2 py-1.5">
              <div className="flex items-center gap-2 text-muted-foreground/70">
                <SettingsIcon className="size-3.5" />
                <span className="text-xs">Settings</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onThemeChange('light')}
                  className={cn(
                    'rounded-md p-1.5 transition-colors hover:bg-accent hover:text-foreground',
                    theme === 'light' ? 'bg-accent text-foreground' : 'text-muted-foreground/60',
                  )}
                  aria-label="Light theme"
                >
                  <SunMedium className="size-3.5" />
                </button>
                <button
                  onClick={() => onThemeChange('dark')}
                  className={cn(
                    'rounded-md p-1.5 transition-colors hover:bg-accent hover:text-foreground',
                    theme === 'dark' ? 'bg-accent text-foreground' : 'text-muted-foreground/60',
                  )}
                  aria-label="Dark theme"
                >
                  <MoonStar className="size-3.5" />
                </button>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
