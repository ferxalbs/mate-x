import { useState } from "react";

import {
  ArrowLeftIcon,
  FileTextIcon,
  ListChecksIcon,
  RouteIcon,
  ShieldIcon,
  ShieldCheckIcon,
  SettingsIcon,
  WaypointsIcon,
  PuzzleIcon,
  Trash2Icon,
} from "lucide-react";
import {
  CaretDownIcon,
  FolderIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
} from "@phosphor-icons/react";

import { useChatStore } from "../../../store/chat-store";
import { Button } from "../../../components/ui/button";
import { Kbd, KbdGroup } from "../../../components/ui/kbd";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";

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
import type { AppSettings } from "../../../contracts/settings";
import type { Theme } from "../../../hooks/use-theme";
import { usePlatform } from "../../../hooks/use-platform";
import { cn } from "../../../lib/utils";
import { useLocalStorage, type LocalStorageCodec } from "../../../hooks/useLocalStorage";
import { Link, useRouterState } from "@tanstack/react-router";
import { ThreadMenuItem } from "./thread-menu-item";

const expandedWorkspacesCodec: LocalStorageCodec<Record<string, boolean>> = {
  parse: (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  },
  serialize: (value) => JSON.stringify(value),
};

const SettingsLink = Link as any;

const COLLAPSED_THREAD_LIMIT = 10;



interface AppSidebarProps {
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  activeWorkspaceId: string | null;
  activeThreadId: string;
  threadsByWorkspace: Record<string, Conversation[]>;
  theme: Theme;
  resolvedTheme: "light" | "dark";
  settings: AppSettings;
  runStatus: RunStatus;
  onImportWorkspace: () => void;
  onActivateWorkspace: (workspaceId: string) => Promise<void>;
  onRemoveWorkspace: (workspaceId: string) => Promise<void>;
  onOpenSearch: () => void;
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



export function AppSidebar({
  workspaces,
  workspace: _workspace,
  activeWorkspaceId,
  activeThreadId,
  threadsByWorkspace,
  theme,
  resolvedTheme,
  runStatus,
  onImportWorkspace,
  onActivateWorkspace,
  onRemoveWorkspace,
  onOpenSearch,
  onCreateThread,
  onSelectThread,
  onRenameThread,
}: AppSidebarProps) {
  const platform = usePlatform();
  const [expandedWorkspaces, setExpandedWorkspaces] = useLocalStorage<
    Record<string, boolean>
  >("matex-sidebar-expanded-workspaces", {}, expandedWorkspacesCodec);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [workspacePendingRemoval, setWorkspacePendingRemoval] =
    useState<WorkspaceEntry | null>(null);

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


  const sidebarContent = (
    <div className="relative z-10 flex h-full min-h-0 flex-col">
      <SidebarHeader className={cn(
        "drag-region h-[52px] flex-row items-center gap-2 px-4 py-0",
        platform === "mac" && "pl-[88px]"
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="ml-1 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-[-0.015em] text-foreground/90">
              MaTE X
            </span>
            <span className="rounded-md bg-foreground/[0.05] border border-foreground/[0.03] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-foreground/50">
              ALPHA
            </span>
          </div>
        </div>
      </SidebarHeader>

      {isSettingsRoute ? (
        <>
          <SidebarContent className="no-drag overflow-x-hidden p-2">
            <SidebarGroup className="p-0">
              <SidebarMenu className="gap-1">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "general"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "general"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "general" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <SettingsIcon className="size-4 shrink-0 opacity-80" />
                    <span>General</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "connections"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "connections"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "connections" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <WaypointsIcon className="size-4 shrink-0 opacity-80" />
                    <span>Connections</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "trust"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "trust"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "trust" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <ShieldCheckIcon className="size-4 shrink-0 opacity-80" />
                    <span>Trust</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "privacy"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "privacy"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "privacy" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <ShieldIcon className="size-4 shrink-0 opacity-80" />
                    <span>Privacy</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "workspace-memory"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "workspace-memory"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "workspace-memory" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <FileTextIcon className="size-4 shrink-0 opacity-80" />
                    <span>Workspace Memory</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "agent-profiler"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "agent-profiler"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "agent-profiler" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <RouteIcon className="size-4 shrink-0 opacity-80" />
                    <span>Agent Profiler</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "integrations"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "integrations"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "integrations" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <PuzzleIcon className="size-4 shrink-0 opacity-80" />
                    <span>Integrations</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={settingsSection === "archive"}
                    className={cn(
                      "gap-2 px-3 py-2 text-left text-xs rounded-xl transition-all duration-200 w-full",
                      settingsSection === "archive"
                        ? "bg-foreground/[0.06] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
                    )}
                    render={
                      <SettingsLink
                        params={{ section: "archive" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <Trash2Icon className="size-4 shrink-0 opacity-80" />
                    <span>Archive</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarSeparator className="opacity-35" />
          <SidebarFooter className="no-drag p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  className="gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground rounded-xl transition-all duration-200"
                  render={<Link to="/" />}
                >
                  <ArrowLeftIcon className="size-4" />
                  <span className="font-medium">Back</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </>
      ) : (
        <>
          <SidebarContent className="no-drag gap-0 p-2">
            <SidebarGroup className="p-0">
              <div className="mb-4 px-1">
                <button
                  onClick={onOpenSearch}
                  className="flex h-[34px] w-full items-center justify-between gap-2 rounded-xl border border-[var(--sidebar-border)]/35 bg-foreground/[0.03] px-3 text-[12px] text-muted-foreground transition-all duration-200 hover:bg-foreground/[0.06] hover:text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/45"
                  type="button"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground/80" weight="regular" />
                    <span className="truncate text-[11px] font-medium tracking-tight">Search...</span>
                  </div>
                  <KbdGroup className="shrink-0 gap-0.5 opacity-60">
                    <Kbd className="h-4.5 min-w-[22px] rounded bg-foreground/[0.05] border border-foreground/[0.03] px-1 text-[9px] font-medium">
                      ⌘K
                    </Kbd>
                  </KbdGroup>
                </button>
              </div>

              <div className="mb-2.5 flex h-6 items-center justify-between px-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  Projects
                </span>
                <button
                  onClick={onImportWorkspace}
                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  title="Import folder"
                  aria-label="Import folder"
                  type="button"
                >
                  <FolderPlusIcon className="size-3.5" weight="regular" />
                </button>
              </div>

              <SidebarMenu className="gap-1.5">
                {workspaces.map((project) => {
                  const isWorkspaceActive = project.id === activeWorkspaceId;
                  const isProjectOpen = expandedWorkspaces[project.id] ?? true;
                  const projectThreads = threadsByWorkspace[project.id] ?? [];
                  const activeThreads = projectThreads.filter((t) => !t.isArchived);
                  const visibleThreads = showAllThreads
                     ? activeThreads
                     : activeThreads.slice(0, COLLAPSED_THREAD_LIMIT);
                  const hiddenThreadCount =
                    activeThreads.length - visibleThreads.length;

                  return (
                    <SidebarMenuItem key={project.id}>
                      <div className={cn(
                        "group/project flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-all duration-200",
                        isWorkspaceActive ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.02]"
                      )}>
                        <button
                          onClick={() =>
                            setExpandedWorkspaces((current) => ({
                              ...current,
                              [project.id]: !isProjectOpen,
                            }))
                          }
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                          title={
                            isProjectOpen
                              ? "Collapse history"
                              : "Expand history"
                          }
                          aria-label={
                            isProjectOpen
                              ? `Collapse ${project.name} history`
                              : `Expand ${project.name} history`
                          }
                          type="button"
                        >
                          <CaretDownIcon
                            className={cn(
                              "size-3 transition-transform duration-200",
                              isProjectOpen ? "rotate-0" : "-rotate-90",
                            )}
                            weight="regular"
                          />
                        </button>
                        <button
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] font-medium transition-colors",
                            isWorkspaceActive
                              ? "text-foreground"
                              : "text-muted-foreground/80 hover:text-foreground",
                          )}
                          onClick={() => void onActivateWorkspace(project.id)}
                          type="button"
                        >
                          <span className={cn(
                            "flex size-4 shrink-0 items-center justify-center transition-colors",
                            isWorkspaceActive ? "text-primary" : "text-muted-foreground/60"
                          )}>
                            <FolderIcon className="size-3.5" weight={isWorkspaceActive ? "fill" : "regular"} />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {project.name}
                          </span>
                        </button>
                        {workspaces.length > 1 ? (
                          <button
                            onClick={() => setWorkspacePendingRemoval(project)}
                            className="hidden shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-foreground/[0.08] hover:text-red-400 group-hover/project:inline-flex"
                            title={`Remove ${project.name}`}
                            aria-label={`Remove project ${project.name}`}
                            type="button"
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        ) : null}
                      </div>

                      {isProjectOpen ? (
                        <div className="ml-2.5 mt-1 flex flex-col gap-0.5 border-l border-[var(--sidebar-border)]/35 pl-3.5 pr-0.5">
                          <div className="flex items-start justify-between gap-2 pb-1.5 pt-0.5 text-[10px] text-muted-foreground/40">
                            <div className="min-w-0 flex-1 font-mono tracking-tight leading-normal">
                              <div className="truncate text-muted-foreground/45" title={project.path}>
                                {project.path.replace(/^\/Users\/[^/]+/, "~")}
                              </div>
                              <div className="text-[9px] text-muted-foreground/35 font-sans font-medium">
                                {activeThreads.length} saved threads
                              </div>
                            </div>
                            <button
                              onClick={onCreateThread}
                              className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                              title="New thread"
                              aria-label="New thread"
                              type="button"
                            >
                              <NotePencilIcon
                                className="size-3.5"
                                weight="regular"
                              />
                            </button>
                          </div>

                          {visibleThreads.map((thread) => (
                            <ThreadMenuItem
                              key={thread.id}
                              thread={thread}
                              isActive={thread.id === activeThreadId}
                              runStatus={runStatus}
                              onSelectThread={onSelectThread}
                              onArchiveThread={(id) => {
                                void useChatStore.getState().archiveThread(id);
                              }}
                              onDeleteThread={(id) => {
                                void useChatStore.getState().deleteThread(id);
                              }}
                              onRenameThread={onRenameThread}
                              getThreadStatusLabel={getThreadStatusLabel}
                            />
                          ))}
                          {hiddenThreadCount > 0 ? (
                            <button
                              onClick={() => setShowAllThreads(true)}
                              className="ml-2 mt-1 inline-flex h-7 items-center justify-center rounded-md px-3 text-[11px] text-muted-foreground/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                              type="button"
                            >
                              Show {hiddenThreadCount} older
                            </button>
                          ) : null}
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
          </SidebarContent>

          <SidebarSeparator className="mt-0 opacity-35" />
          <SidebarFooter className="no-drag p-2">
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <div className="rounded-xl px-3 py-1.5 transition-all duration-200 hover:bg-foreground/[0.04]">
                  <Link
                    to="/runs"
                    className="flex min-w-0 items-center gap-2.5 text-muted-foreground/80 transition-colors hover:text-foreground"
                    aria-label="Open Mission Log"
                  >
                    <ListChecksIcon className="size-4 text-muted-foreground/75" />
                    <span className="text-[12px] font-medium">Mission Log</span>
                  </Link>
                </div>
                <div className="flex items-center justify-between rounded-xl px-3 py-1.5 transition-all duration-200 hover:bg-foreground/[0.04]">
                  <SettingsLink
                    params={{ section: "general" }}
                    to="/settings/$section"
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-muted-foreground/80 transition-colors hover:text-foreground"
                    aria-label="Open settings"
                  >
                    <SettingsIcon className="size-4 text-muted-foreground/75" />
                    <span className="text-[12px] font-medium">Settings</span>
                  </SettingsLink>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                      resolvedTheme === "dark"
                        ? "bg-foreground/[0.08] text-foreground/80"
                        : "bg-muted/70 text-muted-foreground/80",
                    )}
                  >
                    {theme}
                  </span>
                </div>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <AlertDialog
            open={workspacePendingRemoval !== null}
            onOpenChange={(open) => {
              if (!open) {
                setWorkspacePendingRemoval(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Repository</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove "{workspacePendingRemoval?.name}" from MaTE X? This
                  deletes its workspace session from the database and removes
                  MaTE X internal local data stored under the app userData
                  folder. The repository folder on disk is not deleted. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="ghost" size="sm" />}>
                  Cancel
                </AlertDialogClose>
                <AlertDialogClose
                  render={
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (workspacePendingRemoval) {
                          void onRemoveWorkspace(workspacePendingRemoval.id);
                        }
                      }}
                    />
                  }
                >
                  Remove
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );



  return (
    <Sidebar
      side="left"
      collapsible="offcanvas"
      className="app-sidebar-container drag-region border-r border-[var(--sidebar-border)]/35 bg-[var(--sidebar)] text-[var(--sidebar-foreground)]"
    >
      {sidebarContent}
    </Sidebar>
  );
}
