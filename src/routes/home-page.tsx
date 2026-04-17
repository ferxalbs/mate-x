import { useTheme } from '../hooks/use-theme';
import { useChatStore } from '../store/chat-store';
import { ChatTopbar } from '../features/desktop-shell/components/chat-topbar';
import { ComposerPanel } from '../features/desktop-shell/components/composer-panel';
import { MessageStream } from '../features/desktop-shell/components/message-stream';

export function HomePage() {
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
  const importWorkspace = useChatStore((state) => state.importWorkspace);
  const createThread = useChatStore((state) => state.createThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const submitPrompt = useChatStore((state) => state.submitPrompt);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const fallbackConversation = {
    id: 'thread-fallback',
    title: 'New thread',
    lastUpdatedAt: new Date(0).toISOString(),
    messages: [],
  };
  const threads = activeWorkspaceId ? (threadsByWorkspace[activeWorkspaceId] ?? []) : [];
  const activeThreadId = activeWorkspaceId ? (activeThreadIds[activeWorkspaceId] ?? '') : '';
  const conversation = threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? fallbackConversation;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <ChatTopbar
        conversation={conversation}
        onCreateThread={createThread}
        onImportWorkspace={importWorkspace}
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
  );
}
