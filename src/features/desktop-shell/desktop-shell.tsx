import { useEffect } from 'react';

import { useTheme } from '../../hooks/use-theme';
import { useChatStore } from '../../store/chat-store';
import { AppSidebar } from './components/app-sidebar';
import { ChatTopbar } from './components/chat-topbar';
import { ComposerPanel } from './components/composer-panel';
import { MessageStream } from './components/message-stream';

// Add import for SidebarProvider
import { SidebarProvider } from '../../components/ui/sidebar';

export function DesktopShell() {
  const workspace = useChatStore((state) => state.workspace);
  const repoFiles = useChatStore((state) => state.repoFiles);
  const repoSignals = useChatStore((state) => state.repoSignals);
  const threads = useChatStore((state) => state.threads);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const runStatus = useChatStore((state) => state.runStatus);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const createThread = useChatStore((state) => state.createThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const submitPrompt = useChatStore((state) => state.submitPrompt);
  const conversation = threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
  const { theme, resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <SidebarProvider defaultOpen>
      <main className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="flex h-full w-full overflow-hidden bg-background">
          <AppSidebar
            activeThreadId={activeThreadId}
            onCreateThread={createThread}
            onThemeChange={setTheme}
            onSelectThread={selectThread}
            repoFiles={repoFiles}
            repoSignals={repoSignals}
            theme={theme}
            threads={threads}
            workspace={workspace}
            runStatus={runStatus}
          />

          <section className="flex min-w-0 flex-1 flex-col bg-background">
            <ChatTopbar
              conversation={conversation}
              onCreateThread={createThread}
              onThemeChange={setTheme}
              onSelectThread={selectThread}
              resolvedTheme={resolvedTheme}
              runStatus={runStatus}
              theme={theme}
              workspace={workspace}
            />
            <MessageStream
              isRunning={runStatus === 'running'}
              messages={conversation.messages}
              workspace={workspace}
            />
            <ComposerPanel
              isRunning={runStatus === 'running'}
              onSubmit={submitPrompt}
              workspace={workspace}
              resolvedTheme={resolvedTheme}
            />
          </section>
        </div>
      </main>
    </SidebarProvider>
  );
}
