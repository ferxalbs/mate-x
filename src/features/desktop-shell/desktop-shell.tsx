import { useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { ActivityIcon } from "lucide-react";

import { SidebarProvider } from "../../components/ui/sidebar";
import type { WorkspaceHealthProfile } from "../../contracts/workspace";
import { useTheme } from "../../hooks/use-theme";
import {
  applyRendererSettings,
  getAppSettings,
} from "../../services/settings-client";
import { useChatStore } from "../../store/chat-store";
import { AppSidebar } from "./components/app-sidebar";

export function DesktopShell() {
  const workspaces = useChatStore((state) => state.workspaces);
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
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
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
            onRemoveWorkspace={removeWorkspace}
            onSelectThread={selectThread}
            onRenameThread={renameThread}
            theme={theme}
            threads={threads}
            workspaces={workspaces}
            workspace={workspace}
            runStatus={runStatus}
          />

          <div className="relative flex min-w-0 flex-1">
            <Outlet />
            <RepoHealthCard health={workspace?.health ?? null} />
          </div>
        </div>
      </main>
    </SidebarProvider>
  );
}

function RepoHealthCard({
  health,
}: {
  health: WorkspaceHealthProfile | null;
}) {
  if (!health) {
    return null;
  }

  const fields = [
    ["Stack", health.stack.join(", ")],
    ["PM", health.packageManager],
    ["Test", health.testCommand],
    ["Lint", health.lintCommand],
    ["Build", health.buildCommand],
    ["Git", health.gitDirtyState],
    ["Deps", String(health.dependencyWarningCount)],
    ["Secrets", String(health.secretWarningCount)],
  ];

  return (
    <aside className="pointer-events-none absolute top-3 right-4 z-20 w-[320px] max-w-[calc(100%-2rem)] rounded-lg border border-border/80 bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ActivityIcon className="size-4 shrink-0 text-primary" />
          <h2 className="truncate font-semibold text-sm">Repo Health</h2>
        </div>
        <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {health.framework}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-4">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 border-t pt-2">
        <p className="text-muted-foreground text-[10px] uppercase tracking-[0.08em]">
          Next action
        </p>
        <p className="truncate font-medium text-xs" title={health.recommendedNextAction}>
          {health.recommendedNextAction}
        </p>
      </div>
    </aside>
  );
}
