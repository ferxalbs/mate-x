import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";

import { SidebarProvider } from "../../components/ui/sidebar";
import { useTheme } from "../../hooks/use-theme";
import {
  applyRendererSettings,
  getAppSettings,
} from "../../services/settings-client";
import { useChatStore } from "../../store/chat-store";
import { cn } from "../../lib/utils";
import { EnhancementPanel } from "./components/enhancement-panel";
import {
  ambientSafetyActions,
  defaultAmbientSafetyRunOptions,
} from "./components/ambient-safety-actions";
import { AppSidebar } from "./components/app-sidebar";
import { SearchModal } from "./components/search-modal";
import { toastManager } from "../../components/ui/toast";


export function DesktopShell() {
  const navigate = useNavigate();
  const workspaces = useChatStore((state) => state.workspaces);
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
  const settings = useChatStore((state) => state.settings);
  const isSubmittingContextualAction = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const importWorkspace = useChatStore((state) => state.importWorkspace);
  const activateWorkspace = useChatStore((state) => state.activateWorkspace);
  const removeWorkspace = useChatStore((state) => state.removeWorkspace);
  const createThread = useChatStore((state) => state.createThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const renameThread = useChatStore((state) => state.renameThread);
  const submitPrompt = useChatStore((state) => state.submitPrompt);
  const threads = activeWorkspaceId
    ? (threadsByWorkspace[activeWorkspaceId] ?? [])
    : [];
  const activeThreadId = activeWorkspaceId
    ? (activeThreadIds[activeWorkspaceId] ?? "")
    : "";
  const { theme, resolvedTheme, setTheme } = useTheme();
  const shellStyle: React.CSSProperties = {};

  const submitContextualAction = async (
    prompt: string,
    overrides = ambientSafetyActions.runSafetyCheck.overrides,
  ) => {
    if (isSubmittingContextualAction.current || runStatus === "running") return;
    isSubmittingContextualAction.current = true;

    try {
      await submitPrompt(prompt, {
        ...defaultAmbientSafetyRunOptions,
        ...overrides,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Submission failed",
        description:
          error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      isSubmittingContextualAction.current = false;
    }
  };

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

  // Mirror --mate-shell-* variables onto :root so CSS portal elements
  // (e.g. Base UI Select popup teleported to document.body) can inherit them.
  // Variables set only on <main> are invisible to portal descendants.
  useEffect(() => {
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(shellStyle)) {
      if (typeof value === "string") {
        root.style.setProperty(prop, value);
      }
    }
    // No cleanup needed — variables are harmless on :root and will be
    // overwritten on the next effect run when settings change.
  }, [shellStyle]);

  return (
    <SidebarProvider defaultOpen>
      <main
        className="relative flex h-screen w-full overflow-hidden bg-background text-foreground"
        style={shellStyle}
      >

        <div
          className={cn(
            "relative flex h-full w-full overflow-hidden bg-background",
          )}
        >
          <AppSidebar
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            onActivateWorkspace={activateWorkspace}
            onCreateThread={() => {
              createThread();
              navigate({ to: '/' });
            }}
            onImportWorkspace={importWorkspace}
            onOpenSearch={() => setSearchOpen(true)}
            onRemoveWorkspace={removeWorkspace}
            onSelectThread={(id) => {
              selectThread(id);
              navigate({ to: '/' });
            }}
            onRenameThread={renameThread}
            theme={theme}
            resolvedTheme={resolvedTheme}
            settings={settings}
            threadsByWorkspace={threadsByWorkspace}
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

            <div className="relative flex h-full min-w-0 flex-1">
              <Outlet />
            </div>
            <EnhancementPanel
              conversation={threads.find((thread) => thread.id === activeThreadId) ?? null}
              onMakeTrustworthy={() => {
                void submitContextualAction(
                  ambientSafetyActions.runSafetyCheck.prompt,
                  ambientSafetyActions.runSafetyCheck.overrides,
                );
              }}
              runStatus={runStatus}
              workspace={workspace}
              workspaceId={activeWorkspaceId}
            />
          </div>
        </div>
      </main>
    </SidebarProvider>
  );
}
