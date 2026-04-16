import { useEffect } from 'react';

import { useTheme } from '../../hooks/use-theme';
import { useChatStore } from '../../store/chat-store';
import { AppSidebar } from './components/app-sidebar';
import { ChatTopbar } from './components/chat-topbar';
import { ComposerPanel } from './components/composer-panel';
import { MessageStream } from './components/message-stream';

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
    <main className="relative flex h-screen w-full overflow-hidden bg-[var(--app-chrome-background)]">
      <div className="relative flex h-full w-full overflow-hidden bg-[var(--background)]">
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
        />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--background)]">
          <ChatTopbar
            conversation={conversation}
            onThemeChange={setTheme}
            resolvedTheme={resolvedTheme}
            theme={theme}
            workspace={workspace}
          />
          <MessageStream messages={conversation.messages} />
          <ComposerPanel isRunning={runStatus === 'running'} onSubmit={submitPrompt} workspace={workspace} />
        </section>
      </div>
    </main>
  );
}
