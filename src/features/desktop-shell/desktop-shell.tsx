import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";

import { SidebarProvider } from "../../components/ui/sidebar";
import { useTheme } from "../../hooks/use-theme";
import { usePlatform } from "../../hooks/use-platform";
import {
  applyRendererSettings,
  getAppSettings,
  updateAppSettings,
} from "../../services/settings-client";
import { useChatStore } from "../../store/chat-store";
import { cn } from "../../lib/utils";
import { EnhancementPanel } from "./components/enhancement-panel";
import {
  ambientSafetyActions,
  defaultAmbientSafetyRunOptions,
} from "./components/ambient-safety-actions";
import { AppSidebar } from "./components/app-sidebar";
import { ModelLaunchCard } from "./components/model-launch-card";
import { SearchModal } from "./components/search-modal";
import { toastManager } from "../../components/ui/toast";
import type { CSSProperties } from "react";

/** Module-stable empty style object — never recreated per render. */
const EMPTY_SHELL_STYLE: CSSProperties = Object.freeze({});

function toLocalImageUrl(filePath: string): string {
  // Keep local paths inside Electron's explicitly registered protocol instead
  // of exposing a file:// URL to the renderer.
  return `mate-local://${filePath.split('/').map(encodeURIComponent).join('/')}`;
}

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
  const [backgroundImageState, setBackgroundImageState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const failedBackgroundPath = useRef<string | null>(null);
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
  const { theme, resolvedTheme, setTheme, setBlurEnabled } = useTheme();
  const platform = usePlatform();
  // Stable identity — never rebuild an empty style object each render (effect deps).
  // Dynamic --mate-shell-* vars currently come from CSS themes, not React state.
  const shellStyle = EMPTY_SHELL_STYLE;

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
          applyRendererSettings(settings);
          setTheme(settings.theme);
          // Interface blur is independent of transparency mode.
          setBlurEnabled(settings.blurEnabled);
        }
      })
      .catch(() => {
        // Keep renderer defaults when settings are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [setTheme, setBlurEnabled]);

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

  const vibrancyMode = settings.vibrancyMode || 'solid';
  const usesCssGlass = vibrancyMode === "sidebar" || vibrancyMode === "special";
  const backgroundImage = settings.customBackgroundImage
    ? toLocalImageUrl(settings.customBackgroundImage)
    : null;
  const backgroundOpacity = Math.min(
    1,
    Math.max(0, settings.customBackgroundOpacity ?? 1),
  );

  useEffect(() => {
    if (!backgroundImage || !settings.customBackgroundImage) {
      setBackgroundImageState("idle");
      return;
    }

    let cancelled = false;
    let hasVerifiedImage = false;
    const verifyBackgroundImage = () => {
      const image = new Image();
      if (!hasVerifiedImage) setBackgroundImageState("loading");
      image.onload = () => {
        if (!cancelled) {
          hasVerifiedImage = true;
          failedBackgroundPath.current = null;
          setBackgroundImageState("ready");
        }
      };
      image.onerror = () => {
        if (cancelled) return;
        setBackgroundImageState("error");

        const failedPath = backgroundImage;
        if (failedBackgroundPath.current === failedPath) return;
        failedBackgroundPath.current = failedPath;

        // A moved, deleted, or corrupt file should never leave a permanent
        // broken wallpaper reference. Fall back to the normal canvas and retain
        // every other setting.
        const latestSettings = useChatStore.getState().settings;
        if (latestSettings.customBackgroundImage !== failedPath) return;
        void updateAppSettings({
          ...latestSettings,
          customBackgroundImage: undefined,
        })
          .then((nextSettings) => {
            useChatStore.getState().setSettings(nextSettings);
            toastManager.add({
              type: "warning",
              title: "Background image unavailable",
              description: "The source image was removed or could not be read. MaTE X returned to the standard background.",
            });
          })
          .catch(() => {
            // The visual fallback still applies even if storage is unavailable.
          });
      };
      // Bypass the image cache when checking a long-running desktop session.
      image.src = `${backgroundImage}?background-probe=${Date.now()}`;
    };

    verifyBackgroundImage();
    const recheck = window.setInterval(verifyBackgroundImage, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(recheck);
    };
  }, [backgroundImage, settings.customBackgroundImage]);

  return (
    <SidebarProvider defaultOpen>
      <main
        className={cn(
          "relative flex h-screen w-full overflow-hidden text-foreground",
          backgroundImage && "has-custom-background",
          vibrancyMode === "solid" && "vibrancy-solid bg-background",
          vibrancyMode === "sidebar" && "vibrancy-sidebar bg-transparent",
          vibrancyMode === "special" && "vibrancy-special bg-transparent",
          platform === "mac" ? "platform-mac" : platform === "windows" ? "platform-windows" : ""
        )}
        style={shellStyle}
      >
        {backgroundImage && backgroundImageState === "ready" ? (
          <div
            aria-hidden
            className="app-custom-background"
            style={{
              backgroundImage: `url("${backgroundImage}")`,
              opacity: backgroundOpacity,
            }}
          />
        ) : null}
        {/* Ambient mesh gives CSS backdrop-filter something real to blur
            (native mica/vibrancy are intentionally disabled). */}
        {usesCssGlass ? <div aria-hidden className="app-ambient" /> : null}

        <div
          className={cn(
            "relative z-10 flex h-full w-full overflow-hidden bg-transparent",
          )}
        >
          <AppSidebar
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            onActivateWorkspace={activateWorkspace}
            onCreateThread={async (workspaceId) => {
              if (workspaceId !== activeWorkspaceId) {
                await activateWorkspace(workspaceId);
              }
              createThread();
              await navigate({ to: '/' });
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
          {/* Non-blocking Rainy model launch card — never gates app startup. */}
          <ModelLaunchCard />

          <div className="app-main-content-container relative isolate flex min-w-0 flex-1 overflow-hidden">

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
