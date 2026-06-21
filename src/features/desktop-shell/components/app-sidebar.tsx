import { useEffect, useState } from "react";
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  ZStack,
} from "@liquid-dom/react";
import {
  ArrowLeftIcon,
  FileTextIcon,
  FlaskConicalIcon,
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
import { cn } from "../../../lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { ThreadMenuItem } from "./thread-menu-item";
import {
  UniversalBackground,
  getUniversalBackgroundStyle,
} from "./universal-background";

const SettingsLink = Link as any;

const COLLAPSED_THREAD_LIMIT = 10;

/**
 * Liquid-glass sidebar panel.
 *
 * Architecture mirrors MusicSidebarDemo exactly:
 *
 *   LiquidCanvas
 *     ZStack
 *       Html (zIndex=-2)  ← UniversalBackground: the same gradient mesh as
 *                             the real app background. GlassContainer blurs
 *                             this, making the glass look like it genuinely
 *                             refracts the scene behind the sidebar.
 *       Frame → GlassContainer → Transform → Glass → Frame → Html
 *         {children}           ← the actual sidebar nav, rendered inside
 *                                 the glass (same as the demo’s <Sidebar />)
 *
 * This is the only architecture that makes GlassContainer work correctly:
 * both the backdrop AND the glass must share one LiquidCanvas scene graph.
 */
function LiquidSidebarGlass({
  theme,
  resolvedTheme,
  children,
}: {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  children: React.ReactNode;
}) {
  const isLight = resolvedTheme === "light";

  // The backdrop style resolves --mate-shell-a/b/c variables so the div
  // inside Html can paint identically to the real UniversalBackground.
  const backdropVars = getUniversalBackgroundStyle(theme, true, false);

  return (
    <div className="absolute inset-0 overflow-hidden rounded-[30px]">
      <LiquidCanvas
        className="absolute inset-0 h-full w-full"
        canvasClassName="absolute inset-0 h-full w-full rounded-[30px] bg-transparent"
      >
        <ZStack alignment="topLeading">
          {/* ── Backdrop ─────────────────────────────────────────────────
              Same gradient mesh as the real app background (UniversalBackground).
              GlassContainer blurs this layer, producing the frosted-glass look
              against what appears to be the real scene behind the sidebar. */}
          <Html zIndex={-2} sizing="fill">
            <div
              className="h-full w-full"
              style={backdropVars}
            >
              <UniversalBackground field={false} />
            </div>
          </Html>

          {/* ── Glass panel ── native liquid-dom at full strength ────────
              blur=500      : deep frosted glass depth
              bezelWidth=280: wide refractive rim — the core glass-look prop
              displacementBlur=60: strong chromatic dispersion at edges
              specularOpacity=0.75: bright specular band (real glass glint)
              specularFalloff=1.2: broad highlight spread
              tint=0        : zero colour cast — pure crystal */}
          <Frame maxWidth={Infinity} maxHeight={Infinity}>
            <GlassContainer
              blur={500}
              bezelWidth={100}
              displacementBlur={18}
              thickness={0}
              shadowColor={{ r: 0, g: 0, b: 0, a: isLight ? 0.18 : 0.35 }}
              shadowBlur={40}
              specularOpacity={0.12}
              surfaceProfile="concave"
              specularFalloff={1.2}
              tint={{ r: 1, g: 1, b: 1, a: 0 }}
            >
              <Glass cornerRadius={30}>
                <Frame maxWidth={Infinity} maxHeight={Infinity}>
                  <Html sizing="fill">
                    <div className="h-full w-full">
                      {children}
                    </div>
                  </Html>
                </Frame>
              </Glass>
            </GlassContainer>
          </Frame>

        </ZStack>
      </LiquidCanvas>
    </div>
  );
}

interface AppSidebarProps {
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  activeWorkspaceId: string | null;
  activeThreadId: string;
  threads: Conversation[];
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

async function getLiquidGlassAvailability() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent;
  const isMac = platform.includes("mac");
  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: {
        platform?: string;
        getHighEntropyValues?: (
          hints: string[],
        ) => Promise<{ platformVersion?: string }>;
      };
    }
  ).userAgentData;
  const isClientHintsMac =
    userAgentData?.platform?.toLowerCase() === "macos";

  if (userAgentData?.getHighEntropyValues && (isMac || isClientHintsMac)) {
    const values = await userAgentData.getHighEntropyValues(["platformVersion"]);
    const major = Number(values.platformVersion?.split(".")[0] ?? "0");

    return major >= 15;
  }

  const macVersion = userAgent.match(/Mac OS X (1[5-9]|[2-9]\d)[._]/);

  return isMac && macVersion !== null;
}

export function AppSidebar({
  workspaces,
  workspace,
  activeWorkspaceId,
  activeThreadId,
  threads,
  theme,
  resolvedTheme,
  settings,
  runStatus,
  onImportWorkspace,
  onActivateWorkspace,
  onRemoveWorkspace,
  onOpenSearch,
  onCreateThread,
  onSelectThread,
  onRenameThread,
}: AppSidebarProps) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<
    Record<string, boolean>
  >({});
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [workspacePendingRemoval, setWorkspacePendingRemoval] =
    useState<WorkspaceEntry | null>(null);
  const [liquidGlassAvailable, setLiquidGlassAvailable] = useState(false);
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
  useEffect(() => {
    let cancelled = false;
    void getLiquidGlassAvailability().then((available) => {
      if (!cancelled) {
        setLiquidGlassAvailable(available);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);
  const liquidGlassEnabled =
    settings.liquidGlassSidebar && liquidGlassAvailable;

  const sidebarContent = (
    <div className="relative z-10 flex h-full min-h-0 flex-col">
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
                      <SettingsLink
                        params={{ section: "general" }}
                        to="/settings/$section"
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
                      <SettingsLink
                        params={{ section: "connections" }}
                        to="/settings/$section"
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
                      <SettingsLink
                        params={{ section: "trust" }}
                        to="/settings/$section"
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
                    isActive={settingsSection === "privacy"}
                    className={
                      settingsSection === "privacy"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <SettingsLink
                        params={{ section: "privacy" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <ShieldIcon className="size-4 shrink-0" />
                    <span>Privacy</span>
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
                      <SettingsLink
                        params={{ section: "workspace-memory" }}
                        to="/settings/$section"
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
                    isActive={settingsSection === "agent-profiler"}
                    className={
                      settingsSection === "agent-profiler"
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    render={
                      <SettingsLink
                        params={{ section: "agent-profiler" }}
                        to="/settings/$section"
                      />
                    }
                  >
                    <RouteIcon className="size-4 shrink-0" />
                    <span>Agent Profiler</span>
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
                      <SettingsLink
                        params={{ section: "integrations" }}
                        to="/settings/$section"
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
                      <SettingsLink
                        params={{ section: "archive" }}
                        to="/settings/$section"
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
                  className="gap-2 p-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
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
            <SidebarGroup className="px-3 py-3">
              <SidebarMenu className="mb-5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    className="h-8 gap-2 rounded-full px-0 text-[12px] text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={onOpenSearch}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      <MagnifyingGlassIcon
                        className="size-4"
                        weight="regular"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">Search</span>
                    <KbdGroup className="shrink-0 gap-0.5 opacity-65">
                      <Kbd className="h-5 min-w-5 rounded-lg bg-muted/55 px-1 text-[10px]">
                        ⌘K
                      </Kbd>
                    </KbdGroup>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <div className="mb-2 flex h-6 items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Projects
                </span>
                <button
                  onClick={onImportWorkspace}
                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/55 transition-colors hover:bg-accent/70 hover:text-foreground"
                  title="Import folder"
                  type="button"
                >
                  <FolderPlusIcon className="size-3.5" weight="regular" />
                </button>
              </div>

              <SidebarMenu className="gap-1">
                {workspaces.map((project) => {
                  const isWorkspaceActive = project.id === activeWorkspaceId;
                  const isProjectOpen = expandedWorkspaces[project.id] ?? true;
                  const activeThreads = isWorkspaceActive
                    ? threads.filter((t) => !t.isArchived)
                    : [];
                  const visibleThreads = showAllThreads
                    ? activeThreads
                    : activeThreads.slice(0, COLLAPSED_THREAD_LIMIT);
                  const hiddenThreadCount =
                    activeThreads.length - visibleThreads.length;

                  return (
                    <SidebarMenuItem key={project.id} className="rounded-2xl">
                      <div className="group/project grid grid-cols-[1fr_auto_auto] items-center gap-1">
                        <button
                          className={cn(
                            "flex h-7 min-w-0 items-center gap-2 rounded-full px-0 text-left text-[12px] font-medium transition-colors",
                            isWorkspaceActive
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => void onActivateWorkspace(project.id)}
                          type="button"
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/60">
                            <FolderIcon className="size-4" weight="regular" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {project.name}
                          </span>
                        </button>
                        {isWorkspaceActive ? (
                          <button
                            onClick={() =>
                              setExpandedWorkspaces((current) => ({
                                ...current,
                                [project.id]: !isProjectOpen,
                              }))
                            }
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/45 transition-colors hover:bg-accent hover:text-foreground"
                            title={
                              isProjectOpen
                                ? "Collapse history"
                                : "Expand history"
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
                        ) : null}
                        {workspaces.length > 1 ? (
                          <button
                            onClick={() => setWorkspacePendingRemoval(project)}
                            className="hidden rounded-full p-1 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-red-400 group-hover/project:inline-flex"
                            title={`Remove ${project.name}`}
                            type="button"
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        ) : null}
                      </div>

                      {isWorkspaceActive && isProjectOpen ? (
                        <div className="ml-2 mt-1 flex flex-col gap-0.5 border-l border-[var(--sidebar-border)]/70 pl-3 pr-0.5">
                          <div className="flex items-start justify-between gap-2 pb-1 text-[10px] text-muted-foreground/40">
                            <div className="min-w-0">
                              <div className="truncate">{workspace?.path}</div>
                              <div className="truncate">
                                {activeThreads.length} saved threads
                              </div>
                            </div>
                            <button
                              onClick={onCreateThread}
                              className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                              title="New thread"
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
                              className="ml-2 mt-1 inline-flex h-7 items-center justify-center rounded-full px-3 text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
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

          <SidebarSeparator className="mt-0" />
          <SidebarFooter className="no-drag p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="mb-1 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60">
                  <Link
                    to="/proof"
                    className="mb-2 flex min-w-0 items-center gap-2 text-muted-foreground/70 transition-colors hover:text-foreground"
                    aria-label="Open Proof Mode"
                  >
                    <FlaskConicalIcon className="size-3.5" />
                    <span className="text-xs">Proof Mode</span>
                  </Link>
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
                  <SettingsLink
                    params={{ section: "general" }}
                    to="/settings/$section"
                    className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground/70 transition-colors hover:text-foreground"
                    aria-label="Open settings"
                  >
                    <SettingsIcon className="size-3.5" />
                    <span className="text-xs">Settings</span>
                  </SettingsLink>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]",
                      resolvedTheme === "dark"
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

  if (liquidGlassEnabled) {
    return (
      <aside className="drag-region relative z-10 h-full w-[288px] shrink-0 overflow-visible border-r border-transparent bg-transparent p-2 text-[var(--sidebar-foreground)]">
        {/*
          LiquidSidebarGlass owns the full panel: the canvas fills it,
          UniversalBackground blurs inside the scene graph, and sidebarContent
          renders inside the Glass’s Html — the MusicSidebarDemo pattern exactly.
        */}
        <LiquidSidebarGlass theme={settings.theme} resolvedTheme={resolvedTheme}>
          {sidebarContent}
        </LiquidSidebarGlass>
      </aside>
    );
  }

  return (
    <Sidebar
      side="left"
      collapsible="offcanvas"
      className="drag-region border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]"
    >
      {sidebarContent}
    </Sidebar>
  );
}
