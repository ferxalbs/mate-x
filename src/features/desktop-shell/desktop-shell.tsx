import { useEffect, useState, type CSSProperties } from "react";
import { Outlet } from "@tanstack/react-router";

import { SidebarProvider } from "../../components/ui/sidebar";
import { useTheme } from "../../hooks/use-theme";
import {
  applyRendererSettings,
  getAppSettings,
} from "../../services/settings-client";
import { useChatStore } from "../../store/chat-store";
import { cn } from "../../lib/utils";
import { EnhancementPanel } from "./components/enhancement-panel";
import { AppSidebar } from "./components/app-sidebar";
import { SearchModal } from "./components/search-modal";

const SHINE_COLOR_STOPS = {
  default: ["rgba(77, 124, 255, 0.18)", "rgba(20, 184, 166, 0.14)", "rgba(244, 114, 182, 0.12)"],
  oled: ["rgba(56, 189, 248, 0.16)", "rgba(168, 85, 247, 0.12)", "rgba(16, 185, 129, 0.1)"],
  blue: ["rgba(59, 130, 246, 0.24)", "rgba(6, 182, 212, 0.16)", "rgba(129, 140, 248, 0.12)"],
  deepblue: ["rgba(14, 165, 233, 0.24)", "rgba(37, 99, 235, 0.18)", "rgba(45, 212, 191, 0.12)"],
  deeppurple: ["rgba(168, 85, 247, 0.24)", "rgba(236, 72, 153, 0.14)", "rgba(96, 165, 250, 0.12)"],
  casimiri: ["rgba(251, 146, 60, 0.16)", "rgba(244, 114, 182, 0.12)", "rgba(45, 212, 191, 0.1)"],
  greenspace: ["rgba(34, 197, 94, 0.22)", "rgba(20, 184, 166, 0.16)", "rgba(132, 204, 22, 0.1)"],
  midnight: ["rgba(45, 212, 191, 0.2)", "rgba(59, 130, 246, 0.16)", "rgba(168, 85, 247, 0.12)"],
} as const;

function getShineStyle(theme: keyof typeof SHINE_COLOR_STOPS) {
  const shineColors = SHINE_COLOR_STOPS[theme] ?? SHINE_COLOR_STOPS.midnight;

  return {
    "--shine-a": shineColors[0],
    "--shine-b": shineColors[1],
    "--shine-c": shineColors[2],
    "--shine-base":
      "linear-gradient(135deg, color-mix(in srgb, var(--background) 88%, var(--shine-a)), var(--background) 42%, color-mix(in srgb, var(--background) 90%, var(--shine-c)))",
    "--shine-field":
      "linear-gradient(120deg, var(--shine-a), transparent 34%, var(--shine-b) 58%, transparent 76%, var(--shine-c))",
    "--shine-glass":
      "linear-gradient(180deg, color-mix(in srgb, var(--panel) 72%, transparent), color-mix(in srgb, var(--background) 84%, transparent))",
  } as CSSProperties;
}

export function DesktopShell() {
  const workspaces = useChatStore((state) => state.workspaces);
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
  const settings = useChatStore((state) => state.settings);
  const [searchOpen, setSearchOpen] = useState(false);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const importWorkspace = useChatStore((state) => state.importWorkspace);
  const activateWorkspace = useChatStore((state) => state.activateWorkspace);
  const removeWorkspace = useChatStore((state) => state.removeWorkspace);
  const createThread = useChatStore((state) => state.createThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const renameThread = useChatStore((state) => state.renameThread);
  const threads = activeWorkspaceId
    ? (threadsByWorkspace[activeWorkspaceId] ?? [])
    : [];
  const activeThreadId = activeWorkspaceId
    ? (activeThreadIds[activeWorkspaceId] ?? "")
    : "";
  const { theme, resolvedTheme, setTheme } = useTheme();
  const shineEnabled = settings.liquidGlassSidebar && settings.liquidGlassShineColors;
  const shineStyle = shineEnabled ? getShineStyle(settings.theme) : undefined;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings()
      .then((settings) => {
        if (!cancelled) {
          setTheme(settings.theme);
          applyRendererSettings(settings);
        }
      })
      .catch(() => {
        // Keep renderer defaults when settings are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  return (
    <SidebarProvider defaultOpen>
      <main
        className="relative flex h-screen w-full overflow-hidden bg-background text-foreground"
        style={shineStyle}
      >
        {shineEnabled ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[image:var(--shine-base)]"
          />
        ) : null}
        <div
          className={cn(
            "relative flex h-full w-full overflow-hidden",
            shineEnabled ? "bg-transparent" : "bg-background",
          )}
        >
          <AppSidebar
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            onActivateWorkspace={activateWorkspace}
            onCreateThread={createThread}
            onImportWorkspace={importWorkspace}
            onOpenSearch={() => setSearchOpen(true)}
            onRemoveWorkspace={removeWorkspace}
            onSelectThread={selectThread}
            onRenameThread={renameThread}
            theme={theme}
            resolvedTheme={resolvedTheme}
            settings={settings}
            threads={threads}
            workspaces={workspaces}
            workspace={workspace}
            runStatus={runStatus}
          />
          <SearchModal
            activeThreadId={activeThreadId}
            onOpenChange={setSearchOpen}
            onSelectThread={selectThread}
            open={searchOpen}
            threads={threads}
            workspaceName={workspace?.name ?? "Current project"}
          />

          <div className="relative isolate flex min-w-0 flex-1 overflow-hidden">
            {shineEnabled ? (
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-20 bg-[image:var(--shine-base)]"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--shine-field)] opacity-70 blur-2xl saturate-150"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--shine-glass)] backdrop-blur-2xl"
                />
              </>
            ) : null}
            <div className="relative flex h-full min-w-0 flex-1">
              <Outlet />
            </div>
            <EnhancementPanel
              conversation={threads.find((thread) => thread.id === activeThreadId) ?? null}
              health={workspace?.health ?? null}
              runStatus={runStatus}
              workspaceId={activeWorkspaceId}
            />
          </div>
        </div>
      </main>
    </SidebarProvider>
  );
}
