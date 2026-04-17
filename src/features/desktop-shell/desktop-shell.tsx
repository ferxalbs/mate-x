import { useEffect } from 'react';
import { Outlet } from '@tanstack/react-router';

import { SidebarProvider } from '../../components/ui/sidebar';
import { useTheme } from '../../hooks/use-theme';
import { useChatStore } from '../../store/chat-store';
import { AppSidebar } from './components/app-sidebar';

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
  const threads = activeWorkspaceId ? (threadsByWorkspace[activeWorkspaceId] ?? []) : [];
  const activeThreadId = activeWorkspaceId ? (activeThreadIds[activeWorkspaceId] ?? '') : '';
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
            onThemeChange={setTheme}
            onSelectThread={selectThread}
            theme={theme}
            threads={threads}
            workspaces={workspaces}
            workspace={workspace}
            runStatus={runStatus}
          />

          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
