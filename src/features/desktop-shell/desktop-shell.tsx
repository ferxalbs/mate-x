import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";

import { SidebarProvider } from "../../components/ui/sidebar";
import { useTheme } from "../../hooks/use-theme";
import {
  applyRendererSettings,
  getAppSettings,
} from "../../services/settings-client";
import { useChatStore } from "../../store/chat-store";
import { EnhancementPanel } from "./components/enhancement-panel";
import { AppSidebar } from "./components/app-sidebar";
import { SearchModal } from "./components/search-modal";

export function DesktopShell() {
  const workspaces = useChatStore((state) => state.workspaces);
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
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
      <main className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="flex h-full w-full overflow-hidden bg-background">
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

          <div className="relative flex min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-w-0 flex-1">
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
