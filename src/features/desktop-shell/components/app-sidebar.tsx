import { useState } from "react";
import {
  ArrowLeftIcon,
  ChevronDown,
  FileTextIcon,
  FolderGit2Icon,
  GitBranchIcon,
  ListChecksIcon,
  PlusIcon,
  ShieldCheckIcon,
  SettingsIcon,
  WaypointsIcon,
  PuzzleIcon,
  Trash2Icon,
} from "lucide-react";

import { GitPanel } from "./git-panel";
import { useGitStore } from "../../../store/git-store";
import { useChatStore } from "../../../store/chat-store";

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
} from "../../../components/ui/sidebar";
import type { Conversation, RunStatus } from "../../../contracts/chat";
import type {
  WorkspaceEntry,
  WorkspaceSummary,
} from "../../../contracts/workspace";
import type { Theme } from "../../../hooks/use-theme";
import { cn } from "../../../lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { ThreadMenuItem } from "./thread-menu-item";

interface AppSidebarProps {
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  activeWorkspaceId: string | null;
  activeThreadId: string;
  threads: Conversation[];
  theme: Theme;
  runStatus: RunStatus;
  onImportWorkspace: () => void;
  onActivateWorkspace: (workspaceId: string) => Promise<void>;
  onRemoveWorkspace: (workspaceId: string) => Promise<void>;
  onCreateThread: () => void;
  onSelectThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
}

function getThreadStatusLabel(
  thread: Conversation,
  isActive: boolean,
  runStatus: RunStatus,
) {
  if (isActive && runStatus === "running") {
    return {
      label: "Working",
      colorClass: "text-teal-600 dark:text-teal-300/90",
      dotClass: "bg-teal-600 dark:bg-teal-300/90",
      pulse: true,
    };
  }
  if (thread.messages.length > 0) {
    return {
      label: "Idle",
      colorClass: "text-zinc-500 dark:text-zinc-400",
      dotClass: "bg-zinc-500 dark:bg-zinc-400",
      pulse: false,
    };
  }
  return {
    label: "New",
    colorClass: "text-zinc-400 dark:text-zinc-500",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    pulse: false,
  };
}

function GitSidebarSection() {
  const [open, setOpen] = useState(true);
  const status = useGitStore((s) => s.status);
  const changeCount = status?.files.length ?? 0;

  return (
    <SidebarGroup className="px-2 py-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/40"
      >
        <div className="flex items-center gap-1.5">
          <GitBranchIcon className="size-3 text-muted-foreground/50" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Source Control
          </span>
          {changeCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-px text-[9px] font-semibold text-amber-400">
              {changeCount}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-3 text-muted-foreground/40 transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="overflow-hidden">
          <GitPanel />
        </div>
      )}
    </SidebarGroup>
  );
}

export function AppSidebar({
  workspaces,
  workspace,
  activeWorkspaceId,
  activeThreadId,
  threads,
  theme,
  runStatus,
  onImportWorkspace,
  onActivateWorkspace,
  onRemoveWorkspace,
  onCreateThread,
  onSelectThread,
  onRenameThread,
}: AppSidebarProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isSettingsRoute =
    pathname === "/settings" || pathname.startsWith("/settings/");
  const settingsSection =
    pathname === "/settings"
      ? "general"
      : pathname.startsWith("/settings/")
        ? (pathname.split("/")[2] ?? "general")
        : null;

  return (
    <Sidebar
      side="left"
      collapsible="offcanvas"
      className="drag-region border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]"
      style={{ minWidth: "220px" }}
    >
      <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[88px]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="ml-1 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground/92">
              MaTE X
            </span>
            <span className="rounded-full bg-muted/45 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
              ALPHA
            </span>
          </div>
        </div>
      </SidebarHeader>

      {isSettingsRoute ? (
        <>
          <SidebarContent className="no-drag overflow-x-hidden">
            <SidebarGroup className="px-2 py-3">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "general"}
                    className={
                      settingsSection === "general"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "general" }}
                      />
                    }
                  >
                    <SettingsIcon className="size-4 shrink-0" />
                    <span>General</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "connections"}
                    className={
                      settingsSection === "connections"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "connections" }}
                      />
                    }
                  >
                    <WaypointsIcon className="size-4 shrink-0" />
                    <span>Connections</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "trust"}
                    className={
                      settingsSection === "trust"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "trust" }}
                      />
                    }
                  >
                    <ShieldCheckIcon className="size-4 shrink-0" />
                    <span>Trust</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "workspace-memory"}
                    className={
                      settingsSection === "workspace-memory"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "workspace-memory" }}
                      />
                    }
                  >
                    <FileTextIcon className="size-4 shrink-0" />
                    <span>Workspace Memory</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "integrations"}
                    className={
                      settingsSection === "integrations"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "integrations" }}
                      />
                    }
                  >
                    <PuzzleIcon className="size-4 shrink-0" />
                    <span>Integrations</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "archive"}
                    className={
                      settingsSection === "archive"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <Link
                        to="/settings/$section"
                        params={{ section: "archive" }}
                      />
                    }
                  >
                    <Trash2Icon className="size-4 shrink-0" />
                    <span>Archive</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarSeparator />
          <SidebarFooter className="no-drag p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  className="gap-2 px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  render={<Link to="/" />}
                >
                  <ArrowLeftIcon className="size-4" />
                  <span>Back</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </>
      ) : (
        <>
          <SidebarContent className="no-drag gap-0">
            <SidebarGroup className="px-2 py-2">
              <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Projects
                </span>
                <button
                  onClick={onImportWorkspace}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  title="Import folder"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>

              <SidebarMenu>
                {workspaces.map((project) => {
                  const isWorkspaceActive = project.id === activeWorkspaceId;

                  return (
                    <SidebarMenuItem key={project.id} className="rounded-md">
                      <div className="group/project flex items-center gap-1">
                        <SidebarMenuButton
                          size="sm"
                          className="gap-2 px-2 text-[12px] font-medium"
                          isActive={isWorkspaceActive}
                          onClick={() => void onActivateWorkspace(project.id)}
                        >
                          <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
                          <span className="truncate">{project.name}</span>
                        </SidebarMenuButton>
                        {workspaces.length > 1 ? (
                          <button
                            onClick={() => void onRemoveWorkspace(project.id)}
                            className="hidden rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-red-400 group-hover/project:inline-flex"
                            title={`Remove ${project.name}`}
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        ) : null}
                      </div>

                      {isWorkspaceActive ? (
                        <div className="mt-1 flex flex-col gap-0.5 pl-4 pr-1">
                          <div className="flex items-start justify-between gap-2 px-2 pb-1 text-[10px] text-muted-foreground/40">
                            <div className="min-w-0">
                              <div className="truncate">{workspace?.path}</div>
                              <div className="truncate">
                                {workspace?.branch === "not-a-repo"
                                  ? "No git repository"
                                  : `Branch ${workspace?.branch ?? "unknown"}`}
                              </div>
                            </div>
                            <button
                              onClick={onCreateThread}
                              className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                              title="New thread"
                            >
                              <PlusIcon className="size-3" />
                            </button>
                          </div>

                          {threads
                            .filter((t) => !t.isArchived)
                            .map((thread) => (
                              <ThreadMenuItem
                                key={thread.id}
                                thread={thread}
                                isActive={thread.id === activeThreadId}
                                runStatus={runStatus}
                                onSelectThread={onSelectThread}
                                onArchiveThread={(id) => {
                                  void useChatStore
                                    .getState()
                                    .archiveThread(id);
                                }}
                                onDeleteThread={(id) => {
                                  void useChatStore.getState().deleteThread(id);
                                }}
                                onRenameThread={onRenameThread}
                                getThreadStatusLabel={getThreadStatusLabel}
                              />
                            ))}
                        </div>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}

                {workspaces.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground/50">
                    Import a folder to start working.
                  </div>
                ) : null}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarSeparator />

            <GitSidebarSection />
          </SidebarContent>

          <SidebarSeparator className="mt-0" />
          <SidebarFooter className="no-drag p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="mb-1 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60">
                  <Link
                    to="/runs"
                    className="flex min-w-0 items-center gap-2 text-muted-foreground/70 transition-colors hover:text-foreground"
                    aria-label="Open Mission Log"
                  >
                    <ListChecksIcon className="size-3.5" />
                    <span className="text-xs">Mission Log</span>
                  </Link>
                </div>
                <div className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60">
                  <Link
                    to="/settings/$section"
                    params={{ section: "general" }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground/70 transition-colors hover:text-foreground"
                    aria-label="Open settings"
                  >
                    <SettingsIcon className="size-3.5" />
                    <span className="text-xs">Settings</span>
                  </Link>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]",
                      theme === "dark"
                        ? "bg-accent text-foreground"
                        : "bg-muted/70 text-muted-foreground",
                    )}
                  >
                    {theme}
                  </span>
                </div>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </>
      )}
    </Sidebar>
  );
}
